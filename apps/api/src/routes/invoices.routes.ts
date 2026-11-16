import { Router } from 'express';
import { z } from 'zod';
import { invoicesService } from '../services/invoices.service';
import { firmIdForUser } from '../services/tenant';
import { validate } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';

// 100 crore (₹1,00,00,00,000) - a generous but bounded ceiling for a single
// invoice, well under the Postgres int4 column max (2147483647), to catch
// fat-finger entry errors (e.g. an extra zero or two) before they corrupt
// billing totals/exports.
const MAX_AMOUNT_INR = 1_00_00_00_000;

const Input = z
  .object({
    invoiceNo: z.string().min(1),
    client: z.string().min(1),
    amountInr: z.number().int().nonnegative().max(MAX_AMOUNT_INR),
    issuedDate: z.string(),
    dueDate: z.string(),
    status: z.enum(['paid', 'pending', 'overdue']).default('pending'),
  })
  .refine((data) => data.dueDate >= data.issuedDate, {
    message: 'dueDate must be on or after issuedDate',
    path: ['dueDate'],
  });

export const invoicesRouter: Router = Router();

invoicesRouter.get('/', requireFeature('billing.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await invoicesService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post(
  '/',
  requireFeature('billing.invoice'),
  validate({ body: Input }),
  withAudit({ action: 'invoice.create', targetType: 'invoice' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const created = await invoicesService.create(req.body, firmId);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);
