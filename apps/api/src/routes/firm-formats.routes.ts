// =============================================================================
// /firm-formats — a firm's OWN drafting formats (Draft page "Upload a format").
//
//   GET    /            the firm's saved formats
//   POST   /read        upload a file -> read it into a spec + engine preview
//                       (nothing saved; the advocate reviews the preview first)
//   POST   /            save a reviewed format as APPROVED (re-validated here —
//                       the client's copy of the spec is never trusted)
//   DELETE /:id         remove one
//
// Firm-scoped throughout (firm-formats.service keys every query by firm_id).
// =============================================================================

import { Router } from 'express';
import { z } from 'zod';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { aiQuotaService, AiQuotaExceededError } from '../services/ai-quota.service';
import { aiUsageService } from '../services/ai-usage.service';
import { EngineDisabledError, engineClient } from '../services/engine-client.service';
import {
  firmFormatsService,
  FirmFormatConflictError,
  labelForTitle,
  type FirmFormatSpec,
} from '../services/firm-formats.service';
import { formatReader, FormatReadError, PREVIEW_DOC_TYPE } from '../services/format-reader.service';
import { LABEL_TO_ENGINE_DOC } from '../lib/engine-field-map';
import { validate, idParam } from '../middleware/validate';
import { llmGenerationLimiter } from '../middleware/rateLimit';
import { logger } from '../logger';

const ReadInput = z.object({
  fileName: z.string().min(1).max(255),
  mime: z.string().max(255).default(''),
  dataBase64: z.string().min(1).max(14_000_000), // ~10 MB file
  titleHint: z.string().max(200).optional(),
});

const SaveInput = z.object({
  title: z.string().trim().min(3).max(150),
  spec: z.object({
    court_issued: z.boolean(),
    fields: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
    blocks: z.array(z.record(z.string(), z.unknown())).min(1).max(600),
  }),
  reviewNotes: z.object({
    summary: z.string().max(4_000).optional(),
    corrections: z.array(z.object({ original: z.string(), corrected: z.string() })).max(200).optional(),
    law_updates: z.array(z.object({ original: z.string(), updated: z.string(), note: z.string() })).max(200).optional(),
    uncertain: z.array(z.string()).max(200).optional(),
  }).default({}),
  sourceName: z.string().max(255).default(''),
  sourceSha256: z.string().max(64).default(''),
  /** The advocate's explicit confirmation that they checked the preview. */
  reviewed: z.literal(true),
});

export const firmFormatsRouter: Router = Router();

firmFormatsRouter.get('/', requireFeature('drafting.ai'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const items = await firmFormatsService.list(firmId);
    res.json({
      items: items.map((f) => ({
        id: f.id, title: f.title, label: f.label, status: f.status,
        fieldCount: f.spec.fields.length, sourceName: f.sourceName,
        approvedAt: f.approvedAt, createdAt: f.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

firmFormatsRouter.post(
  '/read',
  requireFeature('drafting.ai'),
  llmGenerationLimiter,
  validate({ body: ReadInput }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
      const firmId = await firmIdForUser(userId);
      try {
        await aiQuotaService.assertCanGenerate(firmId, userId);
      } catch (err) {
        if (err instanceof AiQuotaExceededError) {
          res.status(429).json({ error: 'AI generation quota exceeded', code: 'ai_quota_exceeded' });
          return;
        }
        throw err;
      }
      const body = req.body as z.infer<typeof ReadInput>;
      const result = await formatReader.read({
        fileName: body.fileName,
        mime: body.mime,
        data: Buffer.from(body.dataBase64, 'base64'),
        ...(body.titleHint ? { titleHint: body.titleHint } : {}),
      });
      aiUsageService.recordAsync({
        firmId, userId, feature: 'drafting', provider: 'anthropic', model: result.usage.model,
        ...(result.usage.tokensIn !== undefined ? { tokensIn: result.usage.tokensIn } : {}),
        ...(result.usage.tokensOut !== undefined ? { tokensOut: result.usage.tokensOut } : {}),
        ...(result.usage.cacheRead !== undefined ? { cacheReadTokens: result.usage.cacheRead } : {}),
        ...(result.usage.cacheWrite !== undefined ? { cacheWriteTokens: result.usage.cacheWrite } : {}),
      });
      const { usage: _usage, ...out } = result;
      res.json(out);
    } catch (err) {
      if (err instanceof FormatReadError) { res.status(err.status).json({ error: 'format_read_failed', message: err.message }); return; }
      if (err instanceof EngineDisabledError) { res.status(503).json({ error: 'engine_unavailable' }); return; }
      logger.error({ err }, 'firm-formats: read failed');
      next(err);
    }
  },
);

firmFormatsRouter.post('/', requireFeature('drafting.ai'), validate({ body: SaveInput }), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const firmId = await firmIdForUser(userId);
    const body = req.body as z.infer<typeof SaveInput>;
    const title = body.title.trim();
    if (LABEL_TO_ENGINE_DOC[title] || LABEL_TO_ENGINE_DOC[labelForTitle(title)]) {
      res.status(409).json({ error: 'title_taken', message: `"${title}" is already a built-in format name.` });
      return;
    }
    // Never trust the client's spec: the engine re-validates and re-renders it.
    const check = await engineClient.checkSpec(PREVIEW_DOC_TYPE, { title, ...body.spec });
    if (!check.ok) {
      res.status(422).json({ error: 'invalid_spec', problems: check.problems });
      return;
    }
    const checked = check.spec as FirmFormatSpec;
    const saved = await firmFormatsService.createApproved({
      title,
      spec: { title, court_issued: Boolean(checked.court_issued), fields: checked.fields, blocks: checked.blocks },
      reviewNotes: body.reviewNotes,
      sourceName: body.sourceName,
      sourceSha256: body.sourceSha256,
    }, { firmId, userId });
    res.status(201).json({ id: saved.id, title: saved.title, label: saved.label, status: saved.status });
  } catch (err) {
    if (err instanceof FirmFormatConflictError) { res.status(409).json({ error: 'title_taken', message: err.message }); return; }
    if (err instanceof EngineDisabledError) { res.status(503).json({ error: 'engine_unavailable' }); return; }
    next(err);
  }
});

firmFormatsRouter.delete('/:id', requireFeature('drafting.ai'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const removed = await firmFormatsService.remove(String(req.params['id']), firmId);
    if (!removed) { res.status(404).json({ error: 'Format not found' }); return; }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
