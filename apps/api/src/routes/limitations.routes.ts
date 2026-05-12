import { Router } from 'express';
import { z } from 'zod';
import { limitationsService } from '../services/limitations.service';
import { calculate, FILING_TYPES } from '../services/limitations.calculator';
import { firmIdForUser } from '../services/tenant';
import { validate } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

const Input = z.object({
  caseLabel: z.string().min(1),
  cnr: z.string().default(''),
  filingType: z.string().min(1),
  forum: z.string().default(''),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'deadline must be ISO YYYY-MM-DD'),
  filedBy: z.string().default(''),
});

const CalculateInput = z.object({
  filingTypeId: z.string().min(1),
  triggerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'triggerDate must be ISO YYYY-MM-DD'),
});

export const limitationsRouter: Router = Router();

// Limitations list/create are scoped to the matter feature domain.

limitationsRouter.get('/', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await limitationsService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

limitationsRouter.post(
  '/',
  requireFeature('matter.create'),
  validate({ body: Input }),
  withAudit({ action: 'limitation.create', targetType: 'limitation' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.status(201).json(await limitationsService.create(req.body, firmId));
    } catch (err) {
      next(err);
    }
  },
);

// ---- Calculator -----------------------------------------------------------
// Pure deterministic computation; no firm/tenant scoping required.

limitationsRouter.get('/calculator/types', (_req, res) => {
  res.json({ items: FILING_TYPES });
});

limitationsRouter.post(
  '/calculator/calculate',
  validate({ body: CalculateInput }),
  (req, res, next) => {
    try {
      res.json(calculate(req.body));
    } catch (err) {
      next(err);
    }
  },
);
