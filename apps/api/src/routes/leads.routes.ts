import { Router } from 'express';
import { z } from 'zod';
import { leadsService } from '../services/leads.service';
import { firmIdForUser } from '../services/tenant';
import { validate, idParam } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

// Legal-intake stages (see LeadStage in @lexdraft/types). 'qualified' kept for
// legacy rows captured before the intake redesign.
const Stage = z.enum(['new', 'conflict', 'consultation', 'qualified', 'proposal', 'won', 'lost']);
const Conflict = z.enum(['', 'clear', 'conflict']);

const CreateInput = z.object({
  name: z.string().min(1),
  valueInr: z.number().int().nonnegative().default(0),
  referrer: z.string().default(''),
  stage: Stage.default('new'),
  contact: z.string().default(''),
  practiceArea: z.string().default(''),
  matterSummary: z.string().default(''),
  probability: z.number().int().min(0).max(100).default(50),
  conflictStatus: Conflict.default(''),
  declineReason: z.string().default(''),
});

// Partial edit — every field optional.
const UpdateInput = CreateInput.partial();

const StageInput = z.object({ stage: Stage });

export const leadsRouter: Router = Router();

function strParam(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

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

// Edit any lead field (contact, value, probability, conflict status, …).
leadsRouter.patch(
  '/:id',
  requireFeature('leads.create'),
  validate({ params: idParam, body: UpdateInput }),
  withAudit({ action: 'lead.update', targetType: 'lead' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await leadsService.update(strParam(req.params['id']), req.body, firmId);
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

// Move stage. Enforces the conflict-check gate (409 CONFLICT_NOT_CLEARED).
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

// Retain a lead → creates/links the client, marks it won, returns a matter
// prefill for the "New matter" form. Conflict must be clear (409 otherwise).
leadsRouter.post(
  '/:id/retain',
  requireFeature('leads.create'),
  validate({ params: idParam }),
  withAudit({ action: 'lead.retain', targetType: 'lead' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const result = await leadsService.retain(strParam(req.params['id']), firmId);
      if (!result) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }
      res.json(result);
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
