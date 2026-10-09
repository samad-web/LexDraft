import { Router } from 'express';
import { z } from 'zod';
import { invoicesService } from '../services/invoices.service';
import { firmIdForUser } from '../services/tenant';
import { validate } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';
import { notify } from '../services/notifications.service';
import { db } from '../db/client';

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
      // Best-effort: notify the client when the invoice is issued (i.e. not
      // a draft). The portal hides drafts (status != 'draft' filter); we
      // mirror that here so the email and the portal stay in sync.
      try {
        const status = String(req.body?.status ?? 'pending');
        const clientName = typeof req.body?.client === 'string' ? req.body.client : '';
        if (status !== 'draft' && clientName && firmId) {
          const sql = db();
          if (sql) {
            const rows = await sql<Array<{ id: string }>>`
              select id from clients
              where firm_id = ${firmId}::uuid
                and name = ${clientName}
                and portal_enabled = true
              limit 1
            `;
            const clientId = rows[0]?.id;
            if (clientId) {
              await notify.invoiceIssued(clientId, {
                invoiceNo: typeof req.body?.invoiceNo === 'string' ? req.body.invoiceNo : '',
                amountInr: typeof req.body?.amountInr === 'number' ? req.body.amountInr : 0,
                dueDate: typeof req.body?.dueDate === 'string' ? req.body.dueDate : '',
              });
            }
          }
        }
      } catch { /* best effort */ }
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);
