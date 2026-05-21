import { Router, type Response } from 'express';
import { z } from 'zod';
import { draftingService, type NoteContextItem } from '../services/drafting.service';
import { caseNotesService } from '../services/case-notes.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import {
  aiQuotaService,
  AiQuotaExceededError,
  type QuotaStatus,
} from '../services/ai-quota.service';
import { llmGenerationLimiter } from '../middleware/rateLimit';
import { env } from '../env';
import { logger } from '../logger';

const Generate = z.object({
  docType: z.string().min(1),
  language: z.enum(['EN', 'HI', 'TA']),
  tone: z.enum(['Professional', 'Firm', 'Urgent', 'Conciliatory']),
  fields: z.record(z.string(), z.string()),
  draftDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'draftDate must be YYYY-MM-DD')
    .optional(),
  // Optional per-request provider override. Falls back to env.llmProvider.
  provider: z.enum(['xai', 'anthropic']).optional(),
  // Case-notes context. When `caseId` is set and `includeNotes` is not
  // explicitly false, accessible notes are folded into the user message.
  caseId: z.string().uuid().optional(),
  includeNotes: z.boolean().optional(),
  noteIds: z.array(z.string().uuid()).max(50).optional(),
});

export const draftingRouter: Router = Router();

/**
 * Pull case-note context for a draft request, gated by the same shared/own-
 * private rules the notes routes use. Silent when caseId is missing, the
 * user has no firm, or includeNotes was explicitly toggled off.
 */
async function resolveNotesForDraft(
  body: z.infer<typeof Generate>,
  userId: string | undefined,
): Promise<NoteContextItem[]> {
  if (!body.caseId) return [];
  if (body.includeNotes === false) return [];
  if (!userId) return [];
  const firmId = await firmIdForUser(userId);
  if (!firmId) return [];
  return caseNotesService.contextForDrafting(
    body.caseId,
    { firmId, viewerUserId: userId },
    { ...(body.noteIds ? { noteIds: body.noteIds } : {}) },
  );
}

/** Translate a quota-exceeded error into a 429 + Retry-After payload. The
 *  retry-after seconds is the time until the user's billing cycle ends, so
 *  clients can render "resets on <date>" without a second round trip. */
function respondQuotaExceeded(res: Response, status: QuotaStatus): Response {
  const resetMs = Math.max(0, new Date(status.cycleEnd).getTime() - Date.now());
  const retryAfterSec = Math.max(1, Math.ceil(resetMs / 1000));
  res.setHeader('Retry-After', String(retryAfterSec));
  return res.status(429).json({
    error: 'AI generation quota exceeded',
    code: 'ai_quota_exceeded',
    cap: status.cap,
    used: status.used,
    remaining: 0,
    resetsAt: status.cycleEnd,
    planTier: status.planTier,
    upgrade: status.planTier !== 'Firm',
  });
}

draftingRouter.post('/generate', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = Generate.parse(req.body);
    const { provider, caseId: _caseId, includeNotes: _inc, noteIds: _ids, ...draftReq } = parsed;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const firmId = await firmIdForUser(userId);
    try {
      await aiQuotaService.assertCanGenerate(firmId, userId);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        respondQuotaExceeded(res, err.status);
        return;
      }
      throw err;
    }
    const notes = await resolveNotesForDraft(parsed, userId);
    const result = await draftingService.generate(draftReq, { provider, notes });
    try {
      await aiQuotaService.record(firmId, userId, 'generate', {
        provider: provider ?? env.llmProvider,
        docType: parsed.docType,
      });
    } catch (err) {
      // Dropping a quota record is non-fatal: the user already got their
      // document, and the rate-limiter still bounds abuse within the hour.
      logger.warn({ err, userId }, 'ai-quota record (generate) failed');
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

draftingRouter.post('/generate/stream', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = Generate.parse(req.body);
    const { provider, caseId: _caseId, includeNotes: _inc, noteIds: _ids, ...draftReq } = parsed;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const firmId = await firmIdForUser(userId);
    try {
      await aiQuotaService.assertCanGenerate(firmId, userId);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        respondQuotaExceeded(res, err.status);
        return;
      }
      throw err;
    }
    const notes = await resolveNotesForDraft(parsed, userId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    // Stream counts as one generation. We record on the first delta so that
    // even an aborted-mid-stream call still counts against the cap (the
    // user got partial output, the provider was billed).
    let recorded = false;
    const recordOnce = () => {
      if (recorded) return;
      recorded = true;
      void aiQuotaService
        .record(firmId, userId, 'stream', {
          provider: provider ?? env.llmProvider,
          docType: parsed.docType,
        })
        .catch((err) => logger.warn({ err, userId }, 'ai-quota record (stream) failed'));
    };

    try {
      for await (const chunk of draftingService.generateStream(draftReq, { provider, notes })) {
        if (aborted) return;
        recordOnce();
        send('delta', { text: chunk });
      }
      if (!aborted) send('done', { generatedAt: new Date().toISOString(), notesUsed: notes.length });
    } catch (err) {
      // Log the raw error server-side, ship a generic message to the wire.
      // Provider errors (Anthropic / xAI) frequently embed prompt fragments,
      // model names, and request URLs in `err.message` — none of which
      // belongs in a client-visible SSE frame.
      logger.warn({ err }, 'drafting stream failed');
      send('error', { message: 'Drafting stream failed. Please retry.' });
    } finally {
      res.end();
    }
  } catch (err) {
    next(err);
  }
});
