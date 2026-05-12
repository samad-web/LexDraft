/**
 * Financial export endpoints — invoices + expenses CSV, sized for GST and
 * Tally quarterly compliance.
 *
 * Two read-only GETs, both gated by `exports.financial`. The CSV body is
 * built in memory and streamed back as a text/csv attachment; nothing is
 * persisted server-side. Filters (date window + status / category) come
 * in as query strings, are zod-parsed, and passed through to the service.
 */

import { Router } from 'express';
import { z } from 'zod';
import { exportsService } from '../services/exports.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

// YYYY-MM-DD only — sanitises against SQL injection at the parse layer and
// keeps the route surface narrow. Both pg client and Postgres tolerate ISO
// dates with no further escaping when passed via parameter binding.
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const InvoicesQuery = z.object({
  since:  IsoDate.optional(),
  until:  IsoDate.optional(),
  status: z.enum(['paid', 'pending', 'overdue']).optional(),
});

const ExpensesQuery = z.object({
  since: IsoDate.optional(),
  until: IsoDate.optional(),
  type:  z.string().min(1).max(64).optional(),
});

function setCsvHeaders(res: import('express').Response, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  // Some browsers / proxies (notably Cloudflare) will try to gzip a CSV
  // mid-stream — we send the body as a single buffer below so that's
  // moot, but explicitly disabling caching keeps stale exports from
  // sneaking into a shared proxy.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

export const exportsRouter: Router = Router();

exportsRouter.get(
  '/invoices.csv',
  requireFeature('exports.financial'),
  async (req, res, next) => {
    try {
      const q = InvoicesQuery.parse(req.query);
      const firmId = await firmIdForUser(req.user?.id);
      const csv = await exportsService.invoicesCsv({
        firmId,
        ...(q.since  !== undefined ? { since:  q.since }  : {}),
        ...(q.until  !== undefined ? { until:  q.until }  : {}),
        ...(q.status !== undefined ? { status: q.status } : {}),
      });
      const date = new Date().toISOString().slice(0, 10);
      setCsvHeaders(res, `lexdraft-invoices-${date}.csv`);
      res.status(200).send(csv);
    } catch (err) { next(err); }
  },
);

exportsRouter.get(
  '/expenses.csv',
  requireFeature('exports.financial'),
  async (req, res, next) => {
    try {
      const q = ExpensesQuery.parse(req.query);
      const firmId = await firmIdForUser(req.user?.id);
      const csv = await exportsService.expensesCsv({
        firmId,
        ...(q.since !== undefined ? { since: q.since } : {}),
        ...(q.until !== undefined ? { until: q.until } : {}),
        ...(q.type  !== undefined ? { type:  q.type  } : {}),
      });
      const date = new Date().toISOString().slice(0, 10);
      setCsvHeaders(res, `lexdraft-expenses-${date}.csv`);
      res.status(200).send(csv);
    } catch (err) { next(err); }
  },
);
