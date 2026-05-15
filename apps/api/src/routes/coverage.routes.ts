/**
 * Coverage swap board routes.
 *
 * All endpoints are gated by `coverage.requests` - granted to Practice and
 * Firm tier plans. The orchestrator wires the plan_features rows; until
 * those land, only baseline users and explicit grant-overrides can reach
 * these handlers.
 *
 * Auth is enforced one layer up in routes/index.ts via `requireAuth`. Each
 * handler resolves the caller's firm via `firmIdForUser` and the service
 * scopes every read/write by firm_id.
 */

import { Router } from 'express';
import { z } from 'zod';
import { coverageService } from '../services/coverage.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { UnauthorizedError } from '../lib/errors';
import type { CoverageStatus } from '../types/coverage.types';

const STATUSES = ['open', 'claimed', 'cancelled', 'completed'] as const;

const CreateBody = z.object({
  hearingId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
  caseLabel: z.string().min(1).optional(),
  court: z.string().min(1).optional(),
  hearingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hearingTime: z.string().min(1).optional(),
  purpose: z.string().min(1).optional(),
  briefUrl: z.string().max(2000).optional(),
  briefNotes: z.string().max(4000).optional(),
});

const ListQuery = z.object({
  status: z.enum(STATUSES).optional(),
});

export const coverageRouter: Router = Router();

coverageRouter.get('/', requireFeature('coverage.requests'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const parsed = ListQuery.safeParse(req.query);
    const status: CoverageStatus | undefined = parsed.success ? parsed.data.status : undefined;
    const items = await coverageService.list({ firmId, status });
    res.json({ items });
  } catch (err) { next(err); }
});

coverageRouter.get('/:id', requireFeature('coverage.requests'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const item = await coverageService.get(String(req.params.id ?? ''), firmId);
    res.json(item);
  } catch (err) { next(err); }
});

coverageRouter.post('/', requireFeature('coverage.requests'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    const body = CreateBody.parse(req.body);
    const created = await coverageService.create({
      ...body,
      firmId,
      requestedBy: userId,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
});

coverageRouter.post('/:id/claim', requireFeature('coverage.requests'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    const updated = await coverageService.claim(String(req.params.id ?? ''), userId, firmId);
    res.json(updated);
  } catch (err) { next(err); }
});

coverageRouter.post('/:id/cancel', requireFeature('coverage.requests'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    const updated = await coverageService.cancel(String(req.params.id ?? ''), userId, firmId);
    res.json(updated);
  } catch (err) { next(err); }
});

coverageRouter.post('/:id/complete', requireFeature('coverage.requests'), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    const firmId = await firmIdForUser(userId);
    const updated = await coverageService.complete(String(req.params.id ?? ''), userId, firmId);
    res.json(updated);
  } catch (err) { next(err); }
});
