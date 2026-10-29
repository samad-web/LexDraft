import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { draftingService, type NoteContextItem, type CaseFacts } from '../services/drafting.service';
import { draftAgentService, NoProviderError } from '../services/draft-agent.service';
import { draftingOrchestratorService } from '../services/drafting-orchestrator.service';
import { draftAutoService } from '../services/draft-auto.service';
import { draftChatService } from '../services/draft-chat.service';
import {
  draftReviseService,
  ReviseUnavailableError,
  MAX_REVISE_CHARS,
  MAX_REVISE_PARAGRAPHS,
} from '../services/draft-revise.service';
import { draftExtractService } from '../services/draft-extract.service';
import { offenceKbService } from '../services/offence-kb.service';
import { caseNotesService } from '../services/case-notes.service';
import { casesService } from '../services/cases.service';
import { firmIdForUser } from '../services/tenant';
import { firmFormatsService, isFirmFormatLabel } from '../services/firm-formats.service';
import { requireFeature } from '../services/permissions.service';
import {
  aiQuotaService,
  AiQuotaExceededError,
  type QuotaStatus,
} from '../services/ai-quota.service';
import { aiUsageService } from '../services/ai-usage.service';
import {
  engineClient,
  EngineValidationError,
  EngineSignoffConflict,
  EngineDisabledError,
} from '../services/engine-client.service';
import { shadowRecorderService } from '../services/shadow-recorder.service';
import { shadowReportService } from '../services/shadow-report.service';
import { factSheetService } from '../services/factsheet.service';
import { intakeService, IntakeError, IntakeUnavailableError } from '../services/intake.service';
import { mapFormToEngine, isRoutable, LABEL_TO_ENGINE_DOC, LEGACY_FORM_BLOCKED } from '../lib/engine-field-map';
import { llmGenerationLimiter } from '../middleware/rateLimit';
import { env } from '../env';
import { logger } from '../logger';

const ExtractFields = z.object({
  docType: z.string().min(1),
  brief: z.string().min(1).max(20_000),
  provider: z.enum(['xai', 'anthropic']).optional(),
  fields: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        type: z.enum(['text', 'textarea', 'select', 'date', 'number', 'currency']),
        options: z.array(z.string()).optional(),
        required: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
});

// One-input auto draft: the advocate gives ONLY a free-form brief (typed or
// dictated). The server triages the document type/forum/blocks, then runs the
// grounded pipeline. No doc type or field form required.
const AutoDraft = z.object({
  brief: z.string().min(1).max(40_000),
  provider: z.enum(['xai', 'anthropic']).optional(),
  docTypeOverride: z.string().min(1).max(120).optional(),
  // Advocate-corrected section set (offence-KB ids). When present the pipeline
  // SKIPS automatic classification and grounds the draft on exactly these
  // sections — this is how "add / remove / swap sections" is honoured.
  sectionsOverride: z.array(z.string().min(1)).max(30).optional(),
  // The advocate's own format text; the agent drafts into it (form only).
  templateFormat: z.string().max(60_000).optional(),
});

// Grounded pipeline: reason -> BNS/BNSS sections -> draft. The advocate supplies
// a free-text brief; the orchestrator classifies KB-backed sections and drafts
// the requested blocks. Blocks/requiredFields come from the doc skeleton.
const PipelineDraft = z.object({
  docType: z.string().min(1),
  forum: z.string().min(1),
  brief: z.string().min(1).max(40_000),
  requiredFields: z.array(z.string()).max(100).optional(),
  blocks: z
    .array(
      z.object({
        block: z.string().min(1),
        instruction: z.string().min(1).max(2_000),
      }),
    )
    .min(1)
    .max(20),
  provider: z.enum(['xai', 'anthropic']).optional(),
  // Shadow mode (engine migration, Phase 1): when the client supplies the fact
  // sheet's matterId AND the engine-shaped inbound fields, the model draft is
  // ALSO run through the engine and the pair is recorded for the shadow report.
  // Both optional; absent -> no capture (never synthetic). User-visible output is
  // unchanged either way.
  shadowMatterId: z.string().uuid().optional(),
  shadowFields: z.record(z.string(), z.unknown()).optional(),
});

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

/**
 * Pull the authoritative case-record facts (court, CNR, stage, FIR particulars,
 * parties) for a draft request. Tenant-safe: casesService.get enforces the
 * firm_id match, so a caseId belonging to another firm resolves to null and no
 * facts leak. Returns null when there's no caseId, no firm, or the case isn't
 * found — the agent then simply drafts without a case-record block.
 */
async function resolveCaseFacts(
  body: z.infer<typeof Generate>,
  userId: string | undefined,
): Promise<CaseFacts | null> {
  if (!body.caseId || !userId) return null;
  const firmId = await firmIdForUser(userId);
  if (!firmId) return null;
  const c = await casesService.get(body.caseId, firmId);
  if (!c) return null;
  const facts: CaseFacts = {
    ...(c.title ? { title: c.title } : {}),
    ...(c.court ? { court: c.court } : {}),
    ...(c.cnr ? { cnr: c.cnr } : {}),
    ...(c.stage ? { stage: c.stage } : {}),
    ...(c.type ? { caseType: c.type } : {}),
    ...(c.client ? { client: c.client } : {}),
    ...(c.firNo ? { firNo: c.firNo } : {}),
    ...(c.firYear != null ? { firYear: c.firYear } : {}),
    ...(c.policeStCode != null ? { policeStation: String(c.policeStCode) } : {}),
    ...(c.firDetails ? { firDetails: c.firDetails } : {}),
    ...(c.next ? { nextHearing: c.next } : {}),
  };
  // Return null when literally nothing usable came back, so the renderer skips
  // the block entirely rather than emitting an empty heading.
  return Object.keys(facts).length > 0 ? facts : null;
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
    const [notes, facts] = await Promise.all([
      resolveNotesForDraft(parsed, userId),
      resolveCaseFacts(parsed, userId),
    ]);
    const result = await draftingService.generate(draftReq, {
      provider,
      notes,
      facts,
      onUsage: (u) =>
        aiUsageService.recordAsync({
          firmId, userId, feature: 'drafting',
          provider: u.provider, model: u.model,
          tokensIn: u.tokensIn, tokensOut: u.tokensOut,
          cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite,
        }),
    });
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
    const [notes, facts] = await Promise.all([
      resolveNotesForDraft(parsed, userId),
      resolveCaseFacts(parsed, userId),
    ]);
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
      for await (const chunk of draftingService.generateStream(draftReq, {
        provider,
        notes,
        facts,
        onUsage: (u) =>
          aiUsageService.recordAsync({
            firmId, userId, feature: 'drafting',
            provider: u.provider, model: u.model,
            tokensIn: u.tokensIn, tokensOut: u.tokensOut,
          }),
      })) {
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

// Grounded drafting agent: plan -> draft -> review -> refine. Streams the final
// document token-by-token exactly like /generate/stream (same `delta`/`done`/
// `error` events) plus a `stage` event on each pipeline transition so the UI
// can show progress. Falls back to single-shot streaming when no provider key
// is configured, so behaviour in a keyless dev env is unchanged.
draftingRouter.post('/agent/stream', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
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
    const [notes, facts] = await Promise.all([
      resolveNotesForDraft(parsed, userId),
      resolveCaseFacts(parsed, userId),
    ]);
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

    let recorded = false;
    const recordOnce = () => {
      if (recorded) return;
      recorded = true;
      void aiQuotaService
        .record(firmId, userId, 'stream', {
          provider: provider ?? env.llmProvider,
          docType: parsed.docType,
        })
        .catch((err) => logger.warn({ err, userId }, 'ai-quota record (agent) failed'));
    };

    try {
      const iterator = draftAgentService.run(draftReq, {
        provider,
        notes,
        facts,
        onUsage: (u) =>
          aiUsageService.recordAsync({
            firmId, userId, feature: 'drafting',
            provider: u.provider, model: u.model,
            tokensIn: u.tokensIn, tokensOut: u.tokensOut,
          }),
        onStage: (evt) => {
          if (!aborted) send('stage', evt);
        },
      });
      for await (const chunk of iterator) {
        if (aborted) return;
        recordOnce();
        send('delta', { text: chunk });
      }
      if (!aborted) send('done', { generatedAt: new Date().toISOString(), notesUsed: notes.length });
    } catch (err) {
      if (err instanceof NoProviderError) {
        // No key configured — degrade to the deterministic single-shot path so
        // the dev experience is identical to /generate/stream.
        try {
          for await (const chunk of draftingService.generateStream(draftReq, { provider, notes, facts })) {
            if (aborted) return;
            recordOnce();
            send('delta', { text: chunk });
          }
          if (!aborted) send('done', { generatedAt: new Date().toISOString(), notesUsed: notes.length });
        } catch (inner) {
          logger.warn({ err: inner }, 'drafting agent fallback failed');
          send('error', { message: 'Drafting failed. Please retry.' });
        }
      } else {
        logger.warn({ err }, 'drafting agent stream failed');
        send('error', { message: 'Drafting agent failed. Please retry.' });
      }
    } finally {
      res.end();
    }
  } catch (err) {
    next(err);
  }
});

// One-input auto draft: brief (typed/dictated) -> TRIAGE (pick document) ->
// grounded pipeline. Returns the triage decision + the pipeline result so the
// UI can show "Detected: <doc> · <forum>" and let the advocate override.
draftingRouter.post('/auto', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = AutoDraft.parse(req.body);
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const firmId = await firmIdForUser(userId);
    try {
      const result = await draftAutoService.run(
        {
          brief: parsed.brief,
          ...(parsed.provider ? { provider: parsed.provider } : {}),
          ...(parsed.docTypeOverride ? { docTypeOverride: parsed.docTypeOverride } : {}),
          ...(parsed.sectionsOverride ? { sectionsOverride: parsed.sectionsOverride } : {}),
          ...(parsed.templateFormat ? { templateFormat: parsed.templateFormat } : {}),
        },
        { firmId, userId },
      );
      res.json(result);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        respondQuotaExceeded(res, err.status);
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Conversational drafting chat: the advocate talks in plain words. This routes
// intent (greeting / question / off-topic / ready-to-draft) and replies
// naturally. On ready_to_draft it hands the distilled brief to the SAME grounded
// auto-draft engine, so all legal content still comes from the pipeline — the
// chat layer never states law itself.
const ChatBody = z.object({
  message: z.string().min(1).max(8_000),
  history: z
    .array(z.object({
      role: z.enum(['advocate', 'assistant']),
      text: z.string().max(8_000),
    }))
    .max(40)
    .optional(),
  provider: z.enum(['xai', 'anthropic']).optional(),
});

draftingRouter.post('/chat', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = ChatBody.parse(req.body);
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const firmId = await firmIdForUser(userId);

    const chat = await draftChatService.converse({
      message: parsed.message,
      history: parsed.history ?? [],
      ...(parsed.provider ? { provider: parsed.provider } : {}),
    });

    // If the advocate is ready to draft, run the grounded engine now and return
    // the draft ALONGSIDE the chat reply, so the UI shows one assistant turn:
    // a natural line + the drafted document (or the clarifying questions).
    if (chat.intent === 'ready_to_draft' && chat.draftBrief) {
      try {
        const draft = await draftAutoService.run(
          { brief: chat.draftBrief, ...(parsed.provider ? { provider: parsed.provider } : {}) },
          { firmId, userId },
        );
        res.json({ intent: chat.intent, reply: chat.reply, draft });
        return;
      } catch (err) {
        if (err instanceof AiQuotaExceededError) { respondQuotaExceeded(res, err.status); return; }
        throw err;
      }
    }

    // Conversational turn only — no drafting.
    res.json({ intent: chat.intent, reply: chat.reply, draft: null });
  } catch (err) {
    next(err);
  }
});

// One-line redraft instruction on a finished draft. Returns PROPOSED paragraph
// edits plus guard warnings; nothing is applied until the advocate accepts in the
// UI. See draft-revise.service for the no-invented-facts rules.
const ReviseBody = z.object({
  docType: z.string().min(1).max(200),
  instruction: z.string().min(3).max(2_000),
  paragraphs: z.array(z.string().max(20_000)).min(1).max(MAX_REVISE_PARAGRAPHS),
  focus: z.object({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional(),
  provider: z.enum(['xai', 'anthropic']).optional(),
});

draftingRouter.post('/revise', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = ReviseBody.parse(req.body);
    if (parsed.paragraphs.reduce((n, p) => n + p.length, 0) > MAX_REVISE_CHARS) {
      res.status(413).json({ error: 'draft_too_long', code: 'draft_too_long' });
      return;
    }
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const firmId = await firmIdForUser(userId);
    const { provider, focus, ...rest } = parsed;
    const result = await draftReviseService.revise(
      {
        ...rest,
        ...(provider ? { provider } : {}),
        ...(focus && focus.from <= focus.to ? { focus } : {}),
      },
      { firmId, userId },
    );
    res.json(result);
  } catch (err) {
    if (err instanceof AiQuotaExceededError) { respondQuotaExceeded(res, err.status); return; }
    if (err instanceof ReviseUnavailableError) { res.status(503).json({ error: err.message, code: 'ai_unavailable' }); return; }
    next(err);
  }
});

// Grounded four-stage pipeline: EXTRACT -> CLASSIFY (KB-grounded BNS/BNSS
// sections) -> DRAFT -> VERIFY. Returns a structured review result (sections,
// drafted blocks, audit verdict) rather than a finished filing — the client
// renders a review screen and only lets the advocate export when not `blocked`.
// The orchestrator handles quota internally and never throws on AI failure.
draftingRouter.post('/pipeline', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = PipelineDraft.parse(req.body);
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const firmId = await firmIdForUser(userId);
    try {
      const result = await draftingOrchestratorService.run(
        {
          docType: parsed.docType,
          forum: parsed.forum,
          brief: parsed.brief,
          requiredFields: parsed.requiredFields ?? [],
          blocks: parsed.blocks,
          ...(parsed.provider ? { provider: parsed.provider } : {}),
        },
        { firmId, userId },
      );
      // Respond to the advocate FIRST — the model result is what they see; shadow
      // capture is a fire-and-forget background step that never blocks or throws.
      res.json(result);
      if (parsed.shadowMatterId && parsed.shadowFields && engineClient.enabled) {
        void shadowRecorderService
          .capture({
            docType: parsed.docType,
            matterId: parsed.shadowMatterId,
            firmId,
            capturedBy: userId,
            fields: parsed.shadowFields,
            model: result,
          })
          .catch((err) => logger.warn({ err }, 'shadow capture failed (non-fatal)'));
      }
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        respondQuotaExceeded(res, err.status);
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Extract structured field values from a free-form brief (dictated or typed) so
// the drafting form can be pre-filled and the gaps surfaced for completion. The
// client supplies the target doc type's field spec (the schema lives web-side).
draftingRouter.post('/extract-fields', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = ExtractFields.parse(req.body);
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const firmId = await firmIdForUser(userId);
    res.json(await draftExtractService.extractFields(parsed, { firmId, userId }));
  } catch (err) {
    if (err instanceof AiQuotaExceededError) {
      respondQuotaExceeded(res, err.status);
      return;
    }
    next(err);
  }
});

// ---- Offence-KB search: lets the advocate ADD / SWAP sections by hand -------
// The agent classifies KB-grounded sections automatically, but counsel must be
// able to correct them. This endpoint searches the offence knowledge base by
// plain words ("cheating", "grievous hurt") or a section number ("318") and
// returns candidate sections the UI renders as add-able chips. Read-only, no
// LLM, no quota — just the deterministic KB index.
// Shadow report: the classified engine-vs-model divergences from REAL recorded
// pairs (engine migration, Phase 1). Read-only, no LLM. Reports only on captured
// traffic — with zero pairs it says so rather than inventing any.
draftingRouter.get('/shadow-report/:docType', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const raw = req.params.docType;
    const docType = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
    if (!docType) {
      res.status(400).json({ error: 'docType is required' });
      return;
    }
    const report = await shadowReportService.build(docType);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

draftingRouter.get('/kb/search', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
    if (!q) {
      res.json({ items: [] });
      return;
    }
    const hits = offenceKbService.search(q, { limit: 8 });
    const items = hits.map((h) => ({
      id: h.entry.id,
      citation: `${h.entry.law} ${h.entry.section}`,
      offenceName: h.entry.offenceName,
      law: h.entry.law,
      section: h.entry.section,
      sectionTitle: h.entry.sectionTitle,
      verified: h.entry.verification === 'verified',
      status: h.entry.verification,
    }));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// ENGINE-ROUTED PATH (Phase 2, flagged). s.138 notice leads.
//
// This path calls ONLY the drafting engine — never the model orchestrator. For
// s.138 (no narrative slots) the model is out of the loop entirely: no EXTRACT,
// no CLASSIFY, no DRAFT, no VERIFY, no LLM. The engine validates (422), refuses
// (200 outcome:refused), or generates (200 with blocks + banner + docx).
//
// The flag is an email allowlist (env ENGINE_ROUTING_ALLOWLIST). When the caller
// is not allowlisted, or the engine is not configured, or the doc type has no
// field map, these endpoints report the path as unavailable and the frontend
// keeps using the existing model pipeline.
// =============================================================================

// KNOWN LATENT BREAK — read before widening the allowlist. The engine's
// `affidavit` doc type now REQUIRES matter_type + affidavit_kind (and, when
// matter_type == "s138", the cheque/dishonour fields). The web Draft form
// (doc-schemas.ts) does not yet collect matter_type/affidavit_kind, and the
// affidavit path is passthrough, so an engine-routed affidavit draft will 422
// until doc-schemas.ts gains those inputs. This is inert while the allowlist is
// empty (the default); do NOT enable engine routing for a user who will draft
// affidavits until the web form is updated. See engine-doc-contract.json for the
// current required-field contract.
function engineRoutingAllowed(email: string | undefined): boolean {
  if (!engineClient.enabled) return false;
  if (!email) return false;
  // Dev-only escape hatch: any logged-in user (still requires the engine to be
  // configured and an authenticated email). Force-off in production via env.
  if (env.engineRoutingAllowAll) return true;
  // Deliberate production-wide open (not NODE_ENV-gated) — every current AND
  // future account, not just an enumerated allowlist.
  if (env.engineRoutingOpenProd) return true;
  return env.engineRoutingAllowlist.has(email.toLowerCase());
}

// The live engine's served doc types, cached briefly so /engine/status (hit on
// every Draft page load) doesn't round-trip the engine each time.
let servedCache: { at: number; value: Set<string> | null } | null = null;
const SERVED_TTL_MS = 60_000;
async function servedDocTypesCached(): Promise<Set<string> | null> {
  if (servedCache && Date.now() - servedCache.at < SERVED_TTL_MS) return servedCache.value;
  const value = engineClient.enabled ? await engineClient.servedDocTypes() : null;
  servedCache = { at: Date.now(), value };
  return value;
}

const EngineDraftBody = z.object({
  /** Draft-page document label, e.g. "Notice u/s 138 NI Act". */
  docLabel: z.string().min(1),
  /** The fact sheet's matter id (the engine keys sign-off on its current version). */
  matterId: z.string().uuid(),
  /** The Draft-page FORM fields (form vocabulary; mapped to the engine here). */
  form: z.record(z.string(), z.unknown()),
  /** Fields the form doesn't collect yet (advocate enrolment, dates, dispatch). */
  extra: z.record(z.string(), z.unknown()).optional(),
});

// Tell the client whether the engine-routed path is available for this user +
// document. Drives whether the frontend shows the engine panel or the model UI.
draftingRouter.get('/engine/status', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const email = req.user?.email;
    const allowed = engineRoutingAllowed(email);
    // Only list what the LIVE engine serves: an imported format awaiting approval
    // is hidden by the production engine, so it must not appear here either. If
    // the engine can't be reached, fall back to the static list (as before).
    const served = await servedDocTypesCached();
    const routableLabels = Object.keys(LABEL_TO_ENGINE_DOC).filter((l) => {
      const docType = LABEL_TO_ENGINE_DOC[l]!;
      return isRoutable(docType) && (served === null || served.has(docType));
    });
    // The firm's own approved formats (uploaded on the Draft page).
    const firmFormats = (await firmFormatsService.list(await firmIdForUser(req.user?.id), { approvedOnly: true }))
      .map((f) => ({ id: f.id, label: f.label, title: f.title }));
    const labels = [...routableLabels, ...firmFormats.map((f) => f.label)];
    res.json({
      enabled: allowed,
      // Documents the CURRENT user can draft through the engine right now (empty
      // until the allowlist flag is on for them).
      docLabels: allowed ? labels : [],
      // The full engine format catalogue, INDEPENDENT of the per-user flag, so
      // surfaces like "My formats" can bind a saved house-style format to a real
      // engine document even before engine routing is switched on for the user.
      formats: labels,
      firmFormats,
    });
  } catch (err) {
    next(err);
  }
});

// The FORMS LIBRARY (Draft page "Formats"): the LAWE forms, each mapped to the
// Draft-page label that drafts it here (+ the variant preset) and a link to the
// original on lawe.co.in. DifAi never re-hosts LAWE's own files. Cached
// briefly — it only changes on an engine deploy.
let laweCache: { at: number; value: unknown[] } | null = null;
draftingRouter.get('/engine/library', requireFeature('drafting.ai'), async (_req, res, next) => {
  try {
    if (!laweCache || Date.now() - laweCache.at > 10 * 60_000) {
      const forms = engineClient.enabled ? await engineClient.laweCatalog() : [];
      const labelFor = new Map(Object.entries(LABEL_TO_ENGINE_DOC).map(([label, dt]) => [dt, label]));
      const value = forms
        .map((f) => ({
          id: f.id, title: f.title, group: f.group, url: f.url,
          docLabel: labelFor.get(f.doc_type) ?? null, preset: f.preset ?? {},
        }))
        .filter((f) => f.docLabel !== null);
      laweCache = { at: Date.now(), value };
    }
    res.json({ lawe: laweCache.value, laweSource: 'https://www.lawe.co.in/lawe-downloads.html' });
  } catch (err) {
    if (err instanceof EngineDisabledError) { res.json({ lawe: [], laweSource: null }); return; }
    next(err);
  }
});

// A format as a BLANK, editable Word form (Draft page "Download blank").
// 409 needs_facts when the format's legal checks need real facts to render.
const BlankBody = z.object({
  docLabel: z.string().min(1),
  preset: z.record(z.string(), z.string().max(200)).optional(),
});
draftingRouter.post('/engine/blank', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const parsed = BlankBody.parse(req.body);
    let docType = LABEL_TO_ENGINE_DOC[parsed.docLabel];
    let spec: unknown;
    if (!docType && isFirmFormatLabel(parsed.docLabel)) {
      const firm = await firmFormatsService.getByLabel(await firmIdForUser(req.user?.id), parsed.docLabel);
      if (firm) { docType = firm.docType; spec = firm.spec; }
    }
    if (!docType) { res.status(404).json({ error: 'doc_not_routable' }); return; }
    const out = await engineClient.blank({
      docType, ...(spec !== undefined ? { spec } : {}), ...(parsed.preset ? { preset: parsed.preset } : {}),
    });
    if ('needsFacts' in out) {
      res.status(409).json({ error: 'needs_facts', message: out.needsFacts });
      return;
    }
    res.json({ docxBase64: out.docxBase64, blocks: out.blocks, fileName: `${parsed.docLabel} (blank)` });
  } catch (err) {
    if (err instanceof EngineDisabledError) { res.status(503).json({ error: 'engine_unavailable' }); return; }
    next(err);
  }
});

// Download after HAND EDITS: write the edited paragraphs back into the engine
// .docx so the Word/PDF keeps the court layout. {matched:false} when paragraphs
// were added/removed (the client then uses its generic export).
const ApplyEditsBody = z.object({
  docxBase64: z.string().min(1).max(20_000_000),
  paragraphs: z.array(z.string().max(20_000)).max(5_000),
});
draftingRouter.post('/engine/apply-edits', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const parsed = ApplyEditsBody.parse(req.body);
    const docx = await engineClient.applyEdits(parsed.docxBase64, parsed.paragraphs);
    res.json(docx ? { matched: true, docxBase64: docx } : { matched: false });
  } catch (err) {
    if (err instanceof EngineDisabledError) { res.status(503).json({ error: 'engine_unavailable' }); return; }
    next(err);
  }
});

// Replace engine-block lines [start, end] of an engine .docx with new paragraphs —
// how an accepted Redraft reaches the filing copy (paragraphs added or removed
// included), so the preview PDF and downloads keep the court layout.
const SpliceLinesBody = z.object({
  docxBase64: z.string().min(1).max(20_000_000),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  paragraphs: z.array(z.string().max(20_000)).min(1).max(5_000),
});
draftingRouter.post('/engine/splice-lines', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const p = SpliceLinesBody.parse(req.body);
    const spliced = await engineClient.spliceLines(p.docxBase64, p.start, p.end, p.paragraphs);
    res.json(spliced ? { matched: true, docxBase64: spliced.docxBase64, blocks: spliced.blocks } : { matched: false });
  } catch (err) {
    if (err instanceof EngineDisabledError) { res.status(503).json({ error: 'engine_unavailable' }); return; }
    next(err);
  }
});

// Ensure a fact sheet exists for this draft and return its matterId. The Draft
// page has no fact sheet of its own yet; this creates one (version 1) from the
// current form so the engine has a versioned matter to key sign-off on. If a
// matterId is supplied, the form is committed as a NEW version (immutable revise),
// which is exactly what makes a prior sign-off go stale when the facts change.
const EnsureMatterBody = z.object({
  matterId: z.string().uuid().optional(),
  facts: z.record(z.string(), z.unknown()),
});

draftingRouter.post('/engine/ensure-matter', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const parsed = EnsureMatterBody.parse(req.body);
    if (!engineRoutingAllowed(req.user?.email)) {
      res.status(403).json({ error: 'engine_routing_not_enabled' });
      return;
    }
    const userId = req.user!.id;
    const firmId = await firmIdForUser(userId);
    const ctx = { firmId, userId };
    const sheet = parsed.matterId
      ? await factSheetService.revise(parsed.matterId, parsed.facts, ctx)
      : await factSheetService.create(parsed.facts, ctx);
    res.json({ matterId: sheet.matterId, version: sheet.version });
  } catch (err) {
    next(err);
  }
});

// Draft through the ENGINE. No model call anywhere on this path.
draftingRouter.post('/engine/draft', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const parsed = EngineDraftBody.parse(req.body);
    if (!engineRoutingAllowed(req.user?.email)) {
      res.status(403).json({ error: 'engine_routing_not_enabled' });
      return;
    }
    const docType = LABEL_TO_ENGINE_DOC[parsed.docLabel];
    if (!docType || !isRoutable(docType) || LEGACY_FORM_BLOCKED.has(docType)) {
      res.status(404).json({ error: 'doc_not_routable', docLabel: parsed.docLabel });
      return;
    }

    // FORM -> ENGINE fields. No LLM extraction: a field the form lacks is simply
    // absent, and the engine returns a 422 "required" the advocate completes.
    const { fields } = mapFormToEngine(docType, parsed.form, parsed.extra ?? {});

    try {
      // render:true so we get blocks + the .docx; the engine resolves the review
      // banner from sign-off state. Version comes from the fact sheet inside the
      // client — the caller never supplies one.
      const result = await engineClient.draft(docType, parsed.matterId, fields, {
        render: true,
      });

      // A refusal is a legal finding the client renders conversationally (200, no
      // render). Only a generated doc gets rendered to a filing artifact.
      if (result.outcome === 'refused') {
        res.json(result);
        return;
      }

      // SINGLE RENDERING PATH: the engine's .docx becomes the filing artifact. We do
      // NOT return docx_base64 to the client (it must never re-render its own copy).
      // Instead we create a draft_renders row and enqueue the LibreOffice conversion
      // as a background job; the client polls GET /engine/render/:id for the PDF/.docx.
      const { documentRenderService } = await import('../services/document-render.service');
      const { jobs } = await import('../services/jobs.service');
      const firmId = await firmIdForUser(req.user?.id);
      const current = await factSheetService.getCurrent(parsed.matterId);
      const factSheetVersion = current?.version ?? 1;

      const { docxBase64, ...clientResult } = result;
      let renderId: string | null = null;
      let renderStatus: 'pending' | 'ready' | 'failed' | 'unavailable' = 'unavailable';

      if (docxBase64) {
        const renderReq = {
          matterId: parsed.matterId,
          factSheetVersion,
          firmId,
          docType,
          docxBase64,
          templateId: result.templateId,
          templateVersion: result.templateVersion,
        };
        const row = await documentRenderService.ensurePending(renderReq);
        renderId = row.id;
        renderStatus = row.renderStatus;
        // Enqueue conversion. In memory mode this runs inline (jobs.service fallback),
        // so dev without pg-boss still produces the PDF before the response returns.
        await jobs.enqueue('document.render', renderReq, {
          singletonKey: `${parsed.matterId}:${factSheetVersion}`,
        });
      }

      // Return blocks/signals (display metadata) + a handle to the render, never the
      // raw .docx bytes.
      res.json({ ...clientResult, renderId, renderStatus });
    } catch (err) {
      if (err instanceof EngineValidationError) {
        // 422: incomplete/malformed FORM — a different channel from a refusal.
        res.status(422).json({ error: 'validation', issues: err.issues });
        return;
      }
      if (err instanceof EngineDisabledError) {
        res.status(503).json({ error: 'engine_unavailable' });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Poll a render's status and, when ready, get short-lived presigned URLs for the
// filing artifacts. AUTHORISATION: the render is scoped to the requesting user's firm
// — a render whose firm_id does not match the caller's firm returns 404 (not 403, so
// we don't leak the existence of another firm's render). These are privileged client
// documents; the presigned URLs expire in 15 minutes.
draftingRouter.get('/engine/render/:id', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    if (!engineRoutingAllowed(req.user?.email)) {
      res.status(403).json({ error: 'engine_routing_not_enabled' });
      return;
    }
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: 'bad_render_id' });
      return;
    }
    const { documentRenderService } = await import('../services/document-render.service');
    const firmId = await firmIdForUser(req.user?.id);
    const render = await documentRenderService.getForFirm(id.data, firmId);
    if (!render) {
      // Not found OR belongs to another firm — same response either way.
      res.status(404).json({ error: 'render_not_found' });
      return;
    }
    const body: Record<string, unknown> = {
      id: render.id,
      renderStatus: render.renderStatus,
      docType: render.docType,
      templateId: render.templateId,
      templateVersion: render.templateVersion,
      sofficeVersion: render.sofficeVersion,
    };
    if (render.renderStatus === 'ready') {
      const urls = await documentRenderService.presignArtifacts(render);
      body.pdfUrl = urls.pdfUrl;
      body.docxUrl = urls.docxUrl;
      body.expiresAt = urls.expiresAt;
    } else if (render.renderStatus === 'failed') {
      body.error = render.errorDetail;
    }
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// Sign a rendered engine document final (records reviewer/date/version; the banner
// then clears). 409 when a narrative slot is unfilled (n/a for s.138).
const EngineSignOffBody = z.object({
  docLabel: z.string().min(1),
  matterId: z.string().uuid(),
  signedOn: z.string().min(1),
  context: z.record(z.string(), z.unknown()),
});

draftingRouter.post('/engine/sign-off', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const parsed = EngineSignOffBody.parse(req.body);
    if (!engineRoutingAllowed(req.user?.email)) {
      res.status(403).json({ error: 'engine_routing_not_enabled' });
      return;
    }
    let docType = LABEL_TO_ENGINE_DOC[parsed.docLabel];
    if (!docType && isFirmFormatLabel(parsed.docLabel)) {
      const firm = await firmFormatsService.getByLabel(await firmIdForUser(req.user?.id), parsed.docLabel);
      docType = firm?.docType;
    }
    if (!docType) {
      res.status(404).json({ error: 'doc_not_routable' });
      return;
    }
    try {
      const out = await engineClient.signOff({
        docType,
        matterId: parsed.matterId,
        reviewer: req.user!.email,      // the advocate signing off, from their session
        signedOn: parsed.signedOn,
        context: parsed.context,
      });
      res.json({ outcome: 'signed_off', version: out.version });
    } catch (err) {
      if (err instanceof EngineSignoffConflict) {
        res.status(409).json({ error: 'signoff_refused', message: err.message });
        return;
      }
      if (err instanceof EngineValidationError) {
        res.status(422).json({ error: 'validation', issues: err.issues });
        return;
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// CONVERSATIONAL INTAKE (engine-driven, model-phrased). See
// docs/conversational-intake-plan.md. The advocate narrates the matter; the
// MODEL extracts prose into fields and phrases the engine's questions; the
// ENGINE decides which fields are required and whether the matter is sound.
//
// This path DOES call the LLM (extractor + phraser) — deliberately, unlike the
// form draft path. It is fenced into intake.service + intake-llm.service, which
// never import the drafting orchestrator/agent (a static test enforces that).
// Gated by the SAME engine-routing allowlist as the form path.
// =============================================================================

// The opening `message` carries the CASE CONTEXT (preamble + the extracted text of
// every document on the matter), so it grows with the number/size of case
// documents — a matter with several affidavits easily exceeds 20k chars. The cap
// exists only to bound abuse; the extractor truncates its own view internally
// (MAX_TRANSCRIPT_CHARS), so a generous 200k ceiling is safe and stops a legit
// multi-document case from being rejected at the door with a 400.
const CASE_CONTEXT_MAX = 200_000;

const IntakeStart = z.object({
  docLabel: z.string().min(1),
  message: z.string().min(1).max(CASE_CONTEXT_MAX),
  provider: z.enum(['xai', 'anthropic']).optional(),
  /** Variant pre-selected from the forms library (e.g. a LAWE "Property" form =
   *  Court Warrant with kind=possession). Seeds the form; the facts still win. */
  preset: z.record(z.string(), z.string().max(200)).optional(),
});

const IntakeReply = z.object({
  matterId: z.string().uuid(),
  docLabel: z.string().min(1),
  message: z.string().min(1).max(CASE_CONTEXT_MAX),
  provider: z.enum(['xai', 'anthropic']).optional(),
});

// DRAFT NOW (DraftBot-style): draft the WHOLE document from what's on record,
// filling genuinely-missing required fields with clearly-marked [placeholders]
// instead of running a question loop. Hard-stops (refusals) still block.
const IntakeDraftNow = z.object({
  matterId: z.string().uuid(),
  docLabel: z.string().min(1),
  // Output language for the rendered document. 'EN' default; 'TA' → Tamil render.
  language: z.enum(['EN', 'HI', 'TA']).optional(),
});

const IntakeEdit = z.object({
  matterId: z.string().uuid(),
  docLabel: z.string().min(1),
  edits: z.record(z.string(), z.string()).refine((e) => Object.keys(e).length > 0, 'no edits'),
  /** Live "Missing details" panel: save the edits, then re-draft at once with
   *  [placeholders] for whatever is still missing (no questions asked). */
  draftNow: z.boolean().optional(),
  language: z.enum(['EN', 'HI', 'TA']).optional(),
});

const IntakeLoad = z.object({
  matterId: z.string().uuid(),
  docLabel: z.string().min(1),
});

// Attachments are session-only: read to extract facts, then discarded (nothing
// persisted). Capped in size/count so a big upload can't blow the request body.
const MAX_ATTACH_BYTES = 8 * 1024 * 1024; // 8 MB per file (base64-decoded)
const IntakeAttach = z.object({
  matterId: z.string().uuid(),
  docLabel: z.string().min(1),
  caption: z.string().max(20_000).optional(),
  files: z
    .array(
      z.object({
        fileName: z.string().min(1).max(400),
        mime: z.string().max(200),
        dataBase64: z.string().min(1).refine(
          (b) => Buffer.byteLength(b, 'base64') <= MAX_ATTACH_BYTES,
          `each file must be at most ${MAX_ATTACH_BYTES} bytes`,
        ),
      }),
    )
    .min(1)
    .max(8),
});

/** Shared guard + quota + ctx resolution for the intake endpoints. Returns the
 *  run context, or writes an error response and returns null. */
async function intakeSetup(
  req: Request,
  res: Response,
  docLabel: string,
  usesLlm: boolean,
): Promise<{ firmId: string | null; userId: string } | null> {
  if (!engineRoutingAllowed(req.user?.email)) {
    res.status(403).json({ error: 'engine_routing_not_enabled' });
    return null;
  }
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const firmId = await firmIdForUser(userId);
  // firmId is needed to resolve the firm's own formats; built-ins ignore it.
  if (!(await intakeService.routable(docLabel, firmId))) {
    res.status(404).json({ error: 'doc_not_routable', docLabel });
    return null;
  }
  if (usesLlm) {
    // Extractor + phraser are real model calls — guard the quota like /generate.
    await aiQuotaService.assertCanGenerate(firmId, userId);
  }
  return { firmId, userId };
}

/** Map an engine-unavailable / intake error to a response; returns true if handled. */
function handleIntakeError(err: unknown, res: Response): boolean {
  if (err instanceof EngineDisabledError) {
    res.status(503).json({ error: 'engine_unavailable' });
    return true;
  }
  if (err instanceof IntakeError) {
    res.status(400).json({ error: 'intake_error', message: err.message });
    return true;
  }
  return false;
}

const IntakeStartAuto = z.object({
  message: z.string().min(1).max(CASE_CONTEXT_MAX),
  /** The advocate's OWN instruction ("draft a complaint u/s 138"), separate from
   *  the case/reference-document text folded into `message`. Used to classify the
   *  document type authoritatively so an attached Notice/agreement can't override
   *  what the advocate asked to draft. Optional (older clients omit it). */
  instruction: z.string().max(2_000).optional(),
  provider: z.enum(['xai', 'anthropic']).optional(),
});

// Begin a conversation WITHOUT a chosen format — the opening description is
// classified into one of the engine's routable documents, then the normal intake
// runs for it. The response's detectedDocLabel tells the UI what was picked.
draftingRouter.post('/engine/intake/start-auto', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = IntakeStartAuto.parse(req.body);
    // Guard on the engine flag + quota, but NOT on a specific docLabel (there
    // isn't one yet — classification chooses it).
    if (!engineRoutingAllowed(req.user?.email)) {
      res.status(403).json({ error: 'engine_routing_not_enabled' });
      return;
    }
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const firmId = await firmIdForUser(userId);
    await aiQuotaService.assertCanGenerate(firmId, userId);
    try {
      const state = await intakeService.startAuto(
        parsed.message,
        { firmId, userId, ...(parsed.provider ? { provider: parsed.provider } : {}) },
        parsed.instruction,
      );
      res.json(state);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) { respondQuotaExceeded(res, err.status); return; }
      // The advocate named a document that can't be drafted here: say so,
      // rather than drafting something else.
      if (err instanceof IntakeUnavailableError) {
        res.status(422).json({ error: 'doc_unavailable', message: err.message });
        return;
      }
      // Couldn't classify -> ask the client to pick a format explicitly.
      if (err instanceof IntakeError) {
        res.status(422).json({ error: 'doc_type_unclear', message: err.message });
        return;
      }
      if (handleIntakeError(err, res)) return;
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Begin a conversation from the advocate's opening description.
draftingRouter.post('/engine/intake/start', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = IntakeStart.parse(req.body);
    const ctx = await intakeSetup(req, res, parsed.docLabel, true);
    if (!ctx) return;
    try {
      const state = await intakeService.start(parsed.docLabel, parsed.message, {
        ...ctx, ...(parsed.provider ? { provider: parsed.provider } : {}),
      }, parsed.preset);
      res.json(state);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) { respondQuotaExceeded(res, err.status); return; }
      if (handleIntakeError(err, res)) return;
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Continue a conversation with the advocate's next message.
draftingRouter.post('/engine/intake/reply', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = IntakeReply.parse(req.body);
    const ctx = await intakeSetup(req, res, parsed.docLabel, true);
    if (!ctx) return;
    try {
      const state = await intakeService.reply(parsed.matterId, parsed.docLabel, parsed.message, {
        ...ctx, ...(parsed.provider ? { provider: parsed.provider } : {}),
      });
      res.json(state);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) { respondQuotaExceeded(res, err.status); return; }
      if (handleIntakeError(err, res)) return;
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// DRAFT NOW — force the whole document out with [placeholders] for gaps.
draftingRouter.post('/engine/intake/draft-now', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = IntakeDraftNow.parse(req.body);
    const ctx = await intakeSetup(req, res, parsed.docLabel, true);
    if (!ctx) return;
    try {
      const state = await intakeService.draftNow(parsed.matterId, parsed.docLabel, {
        ...ctx,
        ...(parsed.language ? { language: parsed.language } : {}),
      });
      res.json(state);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) { respondQuotaExceeded(res, err.status); return; }
      if (handleIntakeError(err, res)) return;
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Directly edit fact-sheet fields (§10). Uses the phraser (LLM) to re-ask any
// still-missing fields, so it is quota-guarded too.
draftingRouter.post('/engine/intake/edit', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = IntakeEdit.parse(req.body);
    const ctx = await intakeSetup(req, res, parsed.docLabel, true);
    if (!ctx) return;
    try {
      const state = await intakeService.edit(parsed.matterId, parsed.docLabel, parsed.edits, {
        ...ctx, ...(parsed.language ? { language: parsed.language } : {}),
      }, { draftNow: parsed.draftNow === true });
      res.json(state);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) { respondQuotaExceeded(res, err.status); return; }
      if (handleIntakeError(err, res)) return;
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Attach files (cheque/memo image, scanned PDF, .docx) as an extraction source.
// Session-only: the files are read to fill fields, then discarded (not stored).
// Reading is FREE + LOCAL (tesseract OCR for images, mammoth/pdf-parse for docs,
// then the deterministic rule extractor) — no vision API. The only possible model
// call is phrasing the next question, so it stays quota-guarded like the others.
draftingRouter.post('/engine/intake/attach', requireFeature('drafting.ai'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const parsed = IntakeAttach.parse(req.body);
    const ctx = await intakeSetup(req, res, parsed.docLabel, true);
    if (!ctx) return;
    try {
      const state = await intakeService.attach(
        parsed.matterId, parsed.docLabel, parsed.files, parsed.caption ?? '', ctx,
      );
      res.json(state);
    } catch (err) {
      if (err instanceof AiQuotaExceededError) { respondQuotaExceeded(res, err.status); return; }
      if (handleIntakeError(err, res)) return;
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// On-demand: convert an engine .docx (base64) to PDF via LibreOffice and stream it
// back. This makes "Download PDF" produce a PDF that is IDENTICAL to the engine's
// formatted .docx (tables, backing sheet, exact font/alignment) instead of a
// client-side HTML rasterisation that flattens the layout. No storage, no DB row —
// a stateless conversion of bytes the client already holds.
const DocxToPdf = z.object({
  docxBase64: z.string().min(1),
  fileName: z.string().max(200).optional(),
});
draftingRouter.post('/engine/docx-to-pdf', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const parsed = DocxToPdf.parse(req.body);
    const { documentRenderService } = await import('../services/document-render.service');
    let pdf: Buffer;
    try {
      pdf = await documentRenderService.convertBase64ToPdf(parsed.docxBase64);
    } catch (err) {
      logger.warn({ err }, 'docx-to-pdf conversion failed');
      res.status(503).json({ error: 'pdf_render_unavailable', message: (err as Error)?.message });
      return;
    }
    const name = (parsed.fileName ?? 'document').replace(/[^a-zA-Z0-9._ -]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// Reload an existing conversation (no LLM call — re-evaluates against the engine
// and re-renders; does not phrase new questions or advance ask counts).
draftingRouter.post('/engine/intake/load', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const parsed = IntakeLoad.parse(req.body);
    const ctx = await intakeSetup(req, res, parsed.docLabel, false);
    if (!ctx) return;
    try {
      const state = await intakeService.load(parsed.matterId, parsed.docLabel, ctx);
      res.json(state);
    } catch (err) {
      if (handleIntakeError(err, res)) return;
      throw err;
    }
  } catch (err) {
    next(err);
  }
});
