import { Router } from 'express';
import { z } from 'zod';
import { leadsService } from '../services/leads.service';
import { firmIdForUser } from '../services/tenant';
import { validate, idParam } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

const Stage = z.enum(['new', 'qualified', 'proposal', 'won', 'lost']);

const CreateInput = z.object({
  name: z.string().min(1),
  valueInr: z.number().int().nonnegative(),
  referrer: z.string().default(''),
  stage: Stage.default('new'),
});

const StageInput = z.object({ stage: Stage });

export const leadsRouter: Router = Router();

leadsRouter.get('/', requireFeature('leads.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await leadsService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

leadsRouter.post(
  '/',
  requireFeature('leads.create'),
  validate({ body: CreateInput }),
  withAudit({ action: 'lead.create', targetType: 'lead' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.status(201).json(await leadsService.create(req.body, firmId));
    } catch (err) {
      next(err);
    }
  },
);

function strParam(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

leadsRouter.patch(
  '/:id/stage',
  requireFeature('leads.create'),
  validate({ params: idParam, body: StageInput }),
  withAudit({ action: 'lead.stage.update', targetType: 'lead' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await leadsService.updateStage(strParam(req.params['id']), req.body.stage, firmId);
      if (!updated) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

leadsRouter.delete(
  '/:id',
  requireFeature('leads.create'),
  validate({ params: idParam }),
  withAudit({ action: 'lead.delete', targetType: 'lead' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const removed = await leadsService.remove(strParam(req.params['id']), firmId);
      if (!removed) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
