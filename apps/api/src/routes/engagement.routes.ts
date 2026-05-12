/**
 * Engagement-letter routes — gated by `engagement.letters` (Firm-tier only;
 * the orchestrator wires the feature → plan grant).
 *
 * GET    /api/engagement/templates       — list (also returns grouped view)
 * POST   /api/engagement/templates       — create
 * GET    /api/engagement/templates/:id   — single
 * PATCH  /api/engagement/templates/:id   — update
 * DELETE /api/engagement/templates/:id   — remove
 * POST   /api/engagement/generate        — interpolate + return text
 *
 * Auth is applied at mount time (apiRouter.use('/engagement', requireAuth, …)).
 * Tenant scope is resolved per-request from the bearer's userId.
 */

import { Router } from 'express';
import { z } from 'zod';
import { engagementService } from '../services/engagement.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

const CreateTemplate = z.object({
  matterType: z.string().min(1).max(120),
  scopeClauses: z.string().min(1),
  feeClauses: z.string().min(1),
  retainerInr: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

const UpdateTemplate = z.object({
  matterType: z.string().min(1).max(120).optional(),
  scopeClauses: z.string().min(1).optional(),
  feeClauses: z.string().min(1).optional(),
  retainerInr: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

const Generate = z.object({
  caseId: z.string().min(1),
  templateId: z.string().min(1).optional(),
});

const gate = requireFeature('engagement.letters');

export const engagementRouter: Router = Router();

engagementRouter.get('/templates', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json(await engagementService.list(firmId));
  } catch (err) { next(err); }
});

engagementRouter.post('/templates', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const body = CreateTemplate.parse(req.body);
    const created = await engagementService.create({
      firmId: firmId ?? '',
      createdBy: req.user?.id ?? null,
      matterType: body.matterType,
      scopeClauses: body.scopeClauses,
      feeClauses: body.feeClauses,
      retainerInr: body.retainerInr ?? null,
      notes: body.notes ?? null,
      isDefault: body.isDefault ?? false,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

engagementRouter.get('/templates/:id', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json(await engagementService.get(String(req.params.id ?? ''), firmId));
  } catch (err) { next(err); }
});

engagementRouter.patch('/templates/:id', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const body = UpdateTemplate.parse(req.body);
    const updated = await engagementService.update(
      String(req.params.id ?? ''),
      body,
      firmId,
    );
    res.json(updated);
  } catch (err) { next(err); }
});

engagementRouter.delete('/templates/:id', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    await engagementService.remove(String(req.params.id ?? ''), firmId);
    res.status(204).end();
  } catch (err) { next(err); }
});

engagementRouter.post('/generate', gate, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const body = Generate.parse(req.body);
    const result = await engagementService.generate({
      firmId,
      caseId: body.caseId,
      ...(body.templateId ? { templateId: body.templateId } : {}),
    });
    res.json(result);
  } catch (err) { next(err); }
});
