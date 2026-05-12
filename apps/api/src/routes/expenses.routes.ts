import { Router } from 'express';
import { z } from 'zod';
import { expensesService } from '../services/expenses.service';
import { firmIdForUser } from '../services/tenant';
import { validate } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

const Input = z.object({
  expenseNo: z.string().min(1),
  date: z.string(),
  description: z.string().min(1),
  category: z.string().min(1),
  caseLabel: z.string().default(''),
  amountInr: z.number().int().nonnegative(),
  status: z.enum(['pending', 'approved', 'billed']).default('pending'),
  reimbursable: z.boolean().default(false),
  billable: z.boolean().default(true),
});

export const expensesRouter: Router = Router();

expensesRouter.get('/', requireFeature('billing.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await expensesService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

expensesRouter.post(
  '/',
  requireFeature('billing.expense'),
  validate({ body: Input }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.status(201).json(await expensesService.create(req.body, firmId));
    } catch (err) {
      next(err);
    }
  },
);
