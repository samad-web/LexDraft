/**
 * /api/mock-arguments — AI-opposed oral-advocacy practice.
 *
 *   POST   /uploads                            - upload a case PDF/DOCX
 *   GET    /sessions                           - list the caller's sessions
 *   POST   /sessions                           - create a session (caseId | uploadId)
 *   GET    /sessions/:id                       - session + turns + review
 *   POST   /sessions/:id/turns/stream          - SSE: append user turn, stream AI reply
 *   POST   /sessions/:id/conclude              - run the review, persist, return state
 *
 * The upload endpoint accepts the file as base64 inside the JSON body. We
 * deliberately skipped the presigned-URL + finalize dance the case-notes
 * route uses — slice 1 keeps the surface small, and PDFs under ~12 MB
 * comfortably fit inside the 16 MB express.json limit. The presign flow can
 * land in a later slice if/when users hit the size ceiling.
 *
 * Everything is gated by `mock_arguments.use` (migration 0035) and travels
 * through `llmGenerationLimiter` so a runaway client can't burn through the
 * LLM budget by re-submitting turns.
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { mockArgumentsService } from '../services/mock-arguments.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { llmGenerationLimiter } from '../middleware/rateLimit';
import { validate, uuidParam } from '../middleware/validate';
import { UnauthorizedError, UnprocessableEntityError } from '../lib/errors';
import { logger } from '../logger';

const Role = z.enum([
  'petitioner', 'respondent', 'prosecution', 'defense', 'appellant', 'appellee',
]);
const JudgePersona = z.enum(['neutral', 'strict', 'socratic']);
const InputMode = z.enum(['voice', 'text']);

const MatterSummarySchema = z.object({
  title: z.string().min(1).max(200),
  court: z.string().max(200).nullable().optional(),
  parties: z.object({
    petitioner: z.string().max(200).nullable().optional(),
    respondent: z.string().max(200).nullable().optional(),
  }).default({ petitioner: null, respondent: null }),
  facts: z.array(z.string().max(500)).max(20).default([]),
  issues: z.array(z.string().max(500)).max(20).default([]),
  applicableStatutes: z.array(z.string().max(200)).max(20).default([]),
  priorJudgments: z.array(z.string().max(200)).max(20).default([]),
});

// ---- /uploads --------------------------------------------------------------

// 12 MB cap on the decoded buffer — gives us headroom under the 16 MB JSON
// limit once you add base64 overhead and JSON envelope. Larger files should
// land on the presigned-URL path once we add it.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const SUPPORTED_UPLOAD_MIMES = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

const UploadInput = z.object({
  fileName: z.string().min(1).max(255),
  fileMime: z.enum(SUPPORTED_UPLOAD_MIMES),
  /** base64-encoded body. The route decodes and length-checks before
   *  handing the buffer to the service. */
  contentBase64: z.string().min(1),
});

// ---- /sessions -------------------------------------------------------------

const CreateSessionInput = z.object({
  caseId: z.string().uuid().optional(),
  uploadId: z.string().uuid().optional(),
  matterSummary: MatterSummarySchema,
  role: Role,
  judgePersona: JudgePersona.default('neutral'),
  plannedDurationSeconds: z.number().int().positive().max(60 * 60 * 4).nullable().optional(),
  inputMode: InputMode.default('text'),
  /** BCP-47 code. Validated for shape only — the service rejects codes that
   *  aren't in our LANGUAGES catalogue so the picker and the prompt builder
   *  stay aligned. Omitted means "fall back to the user's profile default". */
  languageCode: z.string().min(2).max(16).optional(),
});

const TurnInput = z.object({
  transcript: z.string().min(1).max(5000),
});

// ---- helpers ---------------------------------------------------------------

async function ctxOrThrow(req: import('express').Request): Promise<{ firmId: string; userId: string }> {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedError();
  const firmId = await firmIdForUser(userId);
  if (!firmId) {
    // 422 because the auth is fine but the user has no tenant — no place to
    // attach the session. Matches the shape every other write path returns.
    throw new UnprocessableEntityError('No firm attached — cannot use Mock Arguments');
  }
  return { firmId, userId };
}

export const mockArgumentsRouter: Router = Router();

const gate = requireFeature('mock_arguments.use');

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

mockArgumentsRouter.post(
  '/uploads',
  gate,
  llmGenerationLimiter, // distilling the matter summary calls the LLM
  validate({ body: UploadInput }),
  async (req, res, next) => {
    try {
      const ctx = await ctxOrThrow(req);
      const body = req.body as z.infer<typeof UploadInput>;
      const buffer = Buffer.from(body.contentBase64, 'base64');
      if (buffer.length === 0) {
        throw new UnprocessableEntityError('Decoded upload was empty');
      }
      if (buffer.length > MAX_UPLOAD_BYTES) {
        throw new UnprocessableEntityError(
          `Upload exceeds ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit`,
        );
      }
      // The storage_key column on mock_argument_uploads is for the future
      // presigned-URL flow; slice 1 stores the bytes inline (via the
      // extracted `body` column) but still records a synthetic key so the
      // schema invariant holds and a later migration can backfill real keys.
      const storageKey = `mock-arguments/${ctx.firmId}/${crypto.randomUUID()}/${body.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120)}`;
      const upload = await mockArgumentsService.createUpload(
        { fileName: body.fileName, fileMime: body.fileMime, buffer, storageKey },
        ctx,
      );
      res.status(201).json(upload);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

mockArgumentsRouter.get('/sessions', gate, async (req, res, next) => {
  try {
    const ctx = await ctxOrThrow(req);
    const items = await mockArgumentsService.listSessions(ctx);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

/**
 * Pre-fill helper: given a caseId, return the matter summary we'd seed the
 * setup form with. Kept as a separate GET so the client can fetch it before
 * the user has confirmed they want to start a session.
 */
mockArgumentsRouter.get(
  '/case-summary/:id',
  gate,
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const ctx = await ctxOrThrow(req);
      const caseId = req.params['id'] as string;
      res.json(await mockArgumentsService.summaryFromCase(caseId, ctx));
    } catch (err) {
      next(err);
    }
  },
);

mockArgumentsRouter.post(
  '/sessions',
  gate,
  validate({ body: CreateSessionInput }),
  async (req, res, next) => {
    try {
      const ctx = await ctxOrThrow(req);
      const body = req.body as z.infer<typeof CreateSessionInput>;
      // Zod's .nullable().optional() yields `string | null | undefined`;
      // normalise to the service's `string | null` shape before handing off.
      const ms = body.matterSummary;
      const normalisedSummary = {
        title: ms.title,
        court: ms.court ?? null,
        parties: {
          petitioner: ms.parties.petitioner ?? null,
          respondent: ms.parties.respondent ?? null,
        },
        facts: ms.facts,
        issues: ms.issues,
        applicableStatutes: ms.applicableStatutes,
        priorJudgments: ms.priorJudgments,
      };
      const session = await mockArgumentsService.createSession(
        {
          ...(body.caseId ? { caseId: body.caseId } : {}),
          ...(body.uploadId ? { uploadId: body.uploadId } : {}),
          matterSummary: normalisedSummary,
          role: body.role,
          judgePersona: body.judgePersona,
          plannedDurationSeconds: body.plannedDurationSeconds ?? null,
          inputMode: body.inputMode,
          ...(body.languageCode ? { languageCode: body.languageCode } : {}),
        },
        ctx,
      );
      res.status(201).json(session);
    } catch (err) {
      next(err);
    }
  },
);

mockArgumentsRouter.get(
  '/sessions/:id',
  gate,
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const ctx = await ctxOrThrow(req);
      res.json(await mockArgumentsService.getSession(req.params['id'] as string, ctx));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Turn stream (SSE)
// ---------------------------------------------------------------------------

mockArgumentsRouter.post(
  '/sessions/:id/turns/stream',
  gate,
  llmGenerationLimiter,
  validate({ params: uuidParam, body: TurnInput }),
  async (req, res, next) => {
    try {
      const ctx = await ctxOrThrow(req);
      const sessionId = req.params['id'] as string;
      const body = req.body as z.infer<typeof TurnInput>;

      // beginTurn persists the user turn immediately, then returns a stream
      // wrapping the AI reply. We open SSE only AFTER beginTurn resolves so
      // any validation / not-found failure surfaces as a normal JSON 4xx,
      // not as an SSE error frame on a 200 response.
      const { userTurn, citations, stream, finalAiTurn } =
        await mockArgumentsService.beginTurn(sessionId, body.transcript, ctx);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const send = (event: string, data: unknown): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // First frame: the persisted user turn + citations. Lets the client
      // render the AI bubble's "sources" affordance as the AI reply streams.
      send('user_turn', userTurn);
      send('citations', { citations });

      let aborted = false;
      req.on('close', () => { aborted = true; });

      try {
        for await (const chunk of stream) {
          if (aborted) return;
          send('delta', { text: chunk });
        }
        if (!aborted) {
          const aiTurn = await finalAiTurn;
          send('ai_turn', aiTurn);
          send('done', { generatedAt: new Date().toISOString() });
        }
      } catch (err) {
        // Don't echo raw provider errors to the client — log + ship generic.
        logger.warn({ err }, 'mock-arguments stream failed');
        send('error', { message: 'Stream failed. Please retry.' });
      } finally {
        res.end();
      }
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Conclude → review
// ---------------------------------------------------------------------------

mockArgumentsRouter.post(
  '/sessions/:id/conclude',
  gate,
  llmGenerationLimiter,
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const ctx = await ctxOrThrow(req);
      const updated = await mockArgumentsService.concludeSession(
        req.params['id'] as string,
        ctx,
      );
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Re-run the review pass on a session that's already been concluded.
 * Overwrites the existing mock_argument_reviews row in place; the session
 * stays `concluded` and `ended_at` is preserved. Same gate + rate limiter
 * as the original conclude — both burn an LLM call.
 */
mockArgumentsRouter.post(
  '/sessions/:id/review/rerun',
  gate,
  llmGenerationLimiter,
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const ctx = await ctxOrThrow(req);
      const updated = await mockArgumentsService.rerunReview(
        req.params['id'] as string,
        ctx,
      );
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);
