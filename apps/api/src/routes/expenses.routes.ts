import { Router } from 'express';
import { z } from 'zod';
import { expensesService } from '../services/expenses.service';

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

expensesRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await expensesService.list() });
  } catch (err) {
    next(err);
  }
});

expensesRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await expensesService.create(Input.parse(req.body)));
  } catch (err) {
    next(err);
  }
});
