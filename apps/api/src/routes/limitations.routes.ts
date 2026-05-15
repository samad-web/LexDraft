import { Router } from 'express';
import { z } from 'zod';
import { limitationsService } from '../services/limitations.service';
import {
  calculate,
  computeDeadline,
  FILING_TYPES,
  getRules,
} from '../services/limitations.calculator';
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
  // Statute-aware fields (migration 0022). All optional - older clients that
  // typed in a deadline by hand continue to post the original payload.
  matterType:    z.string().optional(),
  basisStatute:  z.string().optional(),
  basisSection:  z.string().optional(),
  computedFrom:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'computedFrom must be ISO YYYY-MM-DD').optional(),
});

const CalculateInput = z.object({
  filingTypeId: z.string().min(1),
  triggerDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'triggerDate must be ISO YYYY-MM-DD'),
});

const ComputeRuleInput = z.object({
  matterType: z.string().min(1),
  computedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'computedFrom must be ISO YYYY-MM-DD'),
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

// ---- Matter-type rules (statute-aware) ------------------------------------
// `getRules()` returns the curated matter-type → statute/section mapping.
// `computeDeadline` is the matter-type counterpart of /calculator/calculate.

limitationsRouter.get('/rules', (_req, res) => {
  res.json({ items: getRules() });
});

limitationsRouter.post(
  '/rules/compute',
  validate({ body: ComputeRuleInput }),
  (req, res, next) => {
    try {
      res.json(computeDeadline(req.body));
    } catch (err) {
      next(err);
    }
  },
);
