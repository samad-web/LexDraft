import { Router } from 'express';
import { z } from 'zod';
import { casesService } from '../services/cases.service';
import { firmIdForUser } from '../services/tenant';
import { validate, idParam } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

const CaseInput = z.object({
  cnr: z.string(),
  title: z.string(),
  court: z.string(),
  stage: z.string(),
  client: z.string(),
  status: z.enum(['Active', 'Pending', 'Closed', 'Archived']),
  next: z.string(),
  type: z.string(),
});
const CaseListQuery = z.object({
  type: z.string().optional(),
  q: z.string().optional(),
});

export const casesRouter: Router = Router();

function strParam(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

casesRouter.get('/', requireFeature('matter.view'), validate({ query: CaseListQuery }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const items = await casesService.list({
      firmId,
      type: typeof req.query['type'] === 'string' ? (req.query['type'] as string) : undefined,
      q:    typeof req.query['q']    === 'string' ? (req.query['q']    as string) : undefined,
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

casesRouter.get('/:id', requireFeature('matter.view'), validate({ params: idParam }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const c = await casesService.get(strParam(req.params['id']), firmId);
    if (!c) {
      res.status(404).json({ error: 'Case not found' });
      return;
    }
    res.json(c);
  } catch (err) {
    next(err);
  }
});

casesRouter.post(
  '/',
  requireFeature('matter.create'),
  validate({ body: CaseInput }),
  withAudit({ action: 'case.create', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.status(201).json(await casesService.create(req.body, firmId));
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.patch(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: idParam, body: CaseInput.partial() }),
  withAudit({ action: 'case.update', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await casesService.update(strParam(req.params['id']), req.body, firmId);
      if (!updated) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

casesRouter.delete(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: idParam }),
  withAudit({ action: 'case.delete', targetType: 'case' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const removed = await casesService.remove(strParam(req.params['id']), firmId);
      if (!removed) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
