import { Router } from 'express';
import { z } from 'zod';
import { invoicesService } from '../services/invoices.service';

const Input = z.object({
  invoiceNo: z.string().min(1),
  client: z.string().min(1),
  amountInr: z.number().int().nonnegative(),
  issuedDate: z.string(),
  dueDate: z.string(),
  status: z.enum(['paid', 'pending', 'overdue']).default('pending'),
});

export const invoicesRouter: Router = Router();

invoicesRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await invoicesService.list() });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await invoicesService.create(Input.parse(req.body)));
  } catch (err) {
    next(err);
  }
});
