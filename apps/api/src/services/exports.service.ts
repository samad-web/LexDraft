/**
 * Financial export — CSV generation for GST + Tally compliance.
 *
 * Indian advocates need quarterly tax & GST returns. The schema doesn't
 * carry GST fields yet (no `gst_pct`, `sac_code`, `paid_date`, etc.), so
 * we synthesise defaults: 18% GST, SAC code 9982 (legal services). These
 * defaults are flagged in a comment header line at the top of every CSV
 * so the accountant knows which columns to verify before filing.
 *
 * Output is RFC-4180:
 *   - comma-separated
 *   - CRLF row terminator (Excel and Tally both prefer CRLF)
 *   - fields containing comma, double-quote, CR, or LF are wrapped in "…"
 *   - internal `"` doubled to `""`
 *   - leading `=`, `+`, `-`, `@` are prefixed with a single-quote when wrapped
 *     to neutralise the CSV-injection class of bugs (OWASP CSV-injection)
 *
 * Tally compatibility: the column set below maps cleanly to the journal-
 * voucher import templates Tally Prime ships with. The accountant maps
 * `client_name` → "Party Ledger" and `total_inr` → "Amount" at import time;
 * we keep our column names lowercase + underscored to avoid colliding with
 * Tally's reserved column titles.
 *
 * No server-side storage: callers stream the string straight into the HTTP
 * response. Nothing is persisted.
 */

import type { Invoice, Expense } from '@lexdraft/types';
import { db } from '../db/client';
import { invoicesService } from './invoices.service';
import { expensesService } from './expenses.service';
import type { InvoicesExportFilter, ExpensesExportFilter } from '../types/exports.types';

// ---- GST defaults --------------------------------------------------------
// The schema doesn't carry per-invoice GST fields yet. These constants are
// the legal-services defaults under the CGST Act, 2017 (Notification
// 12/2017-Central Tax (Rate)). When migrations add real columns,
// `assembleInvoiceRow` should prefer the row values and fall back here.
const DEFAULT_GST_PCT  = 18;
const DEFAULT_SAC_CODE = '9982';

// ---- RFC-4180 primitives -------------------------------------------------
const NEEDS_QUOTE_RE = /[",\r\n]/;
// Cells beginning with one of these can be interpreted as a formula by
// Excel / LibreOffice / Google Sheets. We quote and prefix with `'` so the
// content is preserved but the formula doesn't execute.
const FORMULA_INJECTION_RE = /^[=+\-@]/;

function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : v;
  const needsQuote = NEEDS_QUOTE_RE.test(s) || FORMULA_INJECTION_RE.test(s);
  if (!needsQuote) return s;
  const safe = FORMULA_INJECTION_RE.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvRow(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvField).join(',') + '\r\n';
}

/** Comment line at the top of the file. CSV has no formal comment syntax,
 *  but a `#`-prefixed row is widely tolerated by import tools (Tally
 *  ignores it as a malformed header; Excel renders it as a single cell). */
function commentLine(text: string): string {
  return `# ${text}\r\n`;
}

// ---- Helpers for the invoice path ----------------------------------------
// We read GST-style columns via `to_jsonb(row)->>'col_name'` instead of
// referencing the column directly. That's deliberate: when a future
// migration adds `gst_pct`, `gst_no`, `sac_code`, `paid_date` etc. the
// existing query lights up automatically — and when the column doesn't
// exist yet, `to_jsonb(row)->>'missing'` returns NULL instead of erroring
// (Postgres treats absent keys as NULL on jsonb access). One query path,
// forward-compatible with the schema, no `information_schema` round-trip.

interface InvoiceExtras {
  gstNo: string;
  sacCode: string;
  gstPct: number;
  paidDate: string;
}

interface ExpenseExtras {
  vendor: string;
  gstNo: string;
  gstInr: number;
  paymentMethod: string;
}

/**
 * Split a gross amount into base + GST at the configured percent. We treat
 * `amount_inr` from `invoices` as the GROSS total (most firms enter the
 * client-facing amount) and back-derive the base. If a migration later
 * stores base + GST separately, that path should override this calc.
 *
 * Worked example: gross ₹11,800 at 18% → base ₹10,000, GST ₹1,800.
 */
function splitGstFromGross(gross: number, pct: number): { base: number; gst: number; total: number } {
  if (gross <= 0 || pct <= 0) return { base: gross, gst: 0, total: gross };
  const base = Math.round((gross / (1 + pct / 100)) * 100) / 100;
  const gst  = Math.round((gross - base) * 100) / 100;
  return { base, gst, total: gross };
}

export const exportsService = {
  /**
   * Build the invoices CSV. Filters by firm, optional date window + status.
   * Returns a single string ready to write to the HTTP response.
   */
  async invoicesCsv(filter: InvoicesExportFilter): Promise<string> {
    if (!filter.firmId) {
      return [
        commentLine('LexDraft invoices export — no firm attached, file intentionally empty.'),
        csvRow(['invoice_no', 'issued_date', 'due_date', 'client_name', 'gst_no',
                'sac_code', 'amount_inr', 'gst_pct', 'gst_inr', 'total_inr',
                'status', 'paid_date']),
      ].join('');
    }

    const rows = await fetchInvoicesForExport(filter);

    const out: string[] = [];
    out.push(commentLine(
      `LexDraft invoices export — generated ${new Date().toISOString().slice(0, 10)}. ` +
      `GST defaults used where source data is absent: gst_pct=${DEFAULT_GST_PCT}, sac_code=${DEFAULT_SAC_CODE} (legal services). ` +
      `These cells are ESTIMATED — verify before filing.`,
    ));
    out.push(csvRow([
      'invoice_no', 'issued_date', 'due_date', 'client_name', 'gst_no',
      'sac_code', 'amount_inr', 'gst_pct', 'gst_inr', 'total_inr',
      'status', 'paid_date',
    ]));
    for (const r of rows) {
      const { base, gst, total } = splitGstFromGross(r.invoice.amountInr, r.extras.gstPct);
      out.push(csvRow([
        r.invoice.invoiceNo,
        r.invoice.issuedDate,
        r.invoice.dueDate,
        r.invoice.client,
        r.extras.gstNo,
        r.extras.sacCode,
        base.toFixed(2),
        r.extras.gstPct,
        gst.toFixed(2),
        total.toFixed(2),
        r.invoice.status,
        r.extras.paidDate,
      ]));
    }
    return out.join('');
  },

  /**
   * Build the expenses CSV. Filters by firm, optional date window + category.
   */
  async expensesCsv(filter: ExpensesExportFilter): Promise<string> {
    if (!filter.firmId) {
      return [
        commentLine('LexDraft expenses export — no firm attached, file intentionally empty.'),
        csvRow(['expense_no', 'incurred_date', 'category', 'vendor', 'gst_no',
                'amount_inr', 'gst_inr', 'total_inr', 'payment_method', 'case_label']),
      ].join('');
    }

    const rows = await fetchExpensesForExport(filter);

    const out: string[] = [];
    out.push(commentLine(
      `LexDraft expenses export — generated ${new Date().toISOString().slice(0, 10)}. ` +
      `gst_inr is estimated as ${DEFAULT_GST_PCT}% of net where source data is absent. ` +
      `vendor / gst_no / payment_method default to blank when unknown — verify before filing.`,
    ));
    out.push(csvRow([
      'expense_no', 'incurred_date', 'category', 'vendor', 'gst_no',
      'amount_inr', 'gst_inr', 'total_inr', 'payment_method', 'case_label',
    ]));
    for (const r of rows) {
      // For expenses the stored amount is treated as NET (pre-GST), which
      // matches typical bookkeeping practice — vendor invoices break out
      // base + GST. If real fields land later, use them in place of split.
      const net   = r.expense.amountInr;
      const gst   = r.extras.gstInr > 0
        ? r.extras.gstInr
        : Math.round((net * DEFAULT_GST_PCT) / 100 * 100) / 100;
      const total = Math.round((net + gst) * 100) / 100;
      out.push(csvRow([
        r.expense.expenseNo,
        r.expense.date,
        r.expense.category,
        r.extras.vendor,
        r.extras.gstNo,
        net.toFixed(2),
        gst.toFixed(2),
        total.toFixed(2),
        r.extras.paymentMethod,
        r.expense.caseLabel,
      ]));
    }
    return out.join('');
  },
};

// ---- Fetchers ------------------------------------------------------------
// Kept separate from the assembly step so they can be unit-tested without
// hitting the CSV layer and so the SQL stays close to schema reality.

interface InvoiceExportRow { invoice: Invoice; extras: InvoiceExtras }
interface ExpenseExportRow { expense: Expense; extras: ExpenseExtras }

async function fetchInvoicesForExport(filter: InvoicesExportFilter): Promise<InvoiceExportRow[]> {
  const sql = db();
  if (!sql) {
    // No DB — fall back to the same service the routes use, then filter in
    // memory. Keeps demo-mode + tests honest.
    const all = await invoicesService.list(filter.firmId ?? null);
    return all
      .filter((inv) => matchInvoiceFilter(inv, filter))
      .map((invoice) => ({ invoice, extras: defaultInvoiceExtras() }));
  }

  const since  = filter.since  ?? null;
  const until  = filter.until  ?? null;
  const status = filter.status ?? null;

  // `to_jsonb(i)->>'col'` returns NULL when the column is absent rather
  // than raising — so this query is forward-compatible with a future
  // migration that adds gst_pct / gst_no / sac_code / paid_date columns.
  const rows = await sql<Array<{
    id: string; invoice_no: string; client: string; amount_inr: number;
    issued_date: string | Date; due_date: string | Date; status: Invoice['status'];
    gst_pct: string | null; gst_no: string | null; sac_code: string | null;
    paid_date: string | null;
  }>>`
    select i.id, i.invoice_no, i.client, i.amount_inr, i.issued_date, i.due_date, i.status,
           to_jsonb(i)->>'gst_pct'   as gst_pct,
           to_jsonb(i)->>'gst_no'    as gst_no,
           to_jsonb(i)->>'sac_code'  as sac_code,
           to_jsonb(i)->>'paid_date' as paid_date
    from invoices i
    where i.firm_id = ${filter.firmId}::uuid
      and (${since}::date is null or i.issued_date >= ${since}::date)
      and (${until}::date is null or i.issued_date <= ${until}::date)
      and (${status}::text is null or i.status::text = ${status}::text)
    order by i.issued_date desc, i.invoice_no desc
  `;
  return rows.map((r) => ({
    invoice: {
      id: r.id,
      invoiceNo: r.invoice_no,
      client: r.client,
      amountInr: Number(r.amount_inr ?? 0),
      issuedDate: dateOnly(r.issued_date),
      dueDate: dateOnly(r.due_date),
      status: r.status,
    },
    extras: {
      gstPct:   r.gst_pct   ? Number(r.gst_pct) || DEFAULT_GST_PCT : DEFAULT_GST_PCT,
      gstNo:    r.gst_no    ?? '',
      sacCode:  r.sac_code  ?? DEFAULT_SAC_CODE,
      paidDate: r.paid_date ? dateOnly(r.paid_date) : '',
    },
  }));
}

async function fetchExpensesForExport(filter: ExpensesExportFilter): Promise<ExpenseExportRow[]> {
  const sql = db();
  if (!sql) {
    const all = await expensesService.list(filter.firmId ?? null);
    return all
      .filter((e) => matchExpenseFilter(e, filter))
      .map((expense) => ({ expense, extras: defaultExpenseExtras() }));
  }

  const since = filter.since ?? null;
  const until = filter.until ?? null;
  const type  = filter.type  ?? null;

  // Same forward-compatible jsonb extraction trick as the invoice path —
  // NULLs surface here when columns don't exist yet, and we coalesce to
  // sensible defaults below.
  const rows = await sql<Array<{
    id: string; expense_no: string; expense_date: string | Date;
    description: string; category: string; case_label: string;
    amount_inr: number; status: Expense['status'];
    reimbursable: boolean; billable: boolean;
    vendor: string | null; gst_no: string | null;
    gst_inr: string | null; payment_method: string | null;
  }>>`
    select e.id, e.expense_no, e.expense_date, e.description, e.category, e.case_label,
           e.amount_inr, e.status, e.reimbursable, e.billable,
           to_jsonb(e)->>'vendor'         as vendor,
           to_jsonb(e)->>'gst_no'         as gst_no,
           to_jsonb(e)->>'gst_inr'        as gst_inr,
           to_jsonb(e)->>'payment_method' as payment_method
    from expenses e
    where e.firm_id = ${filter.firmId}::uuid
      and (${since}::date is null or e.expense_date >= ${since}::date)
      and (${until}::date is null or e.expense_date <= ${until}::date)
      and (${type}::text  is null or lower(e.category) = lower(${type}::text))
    order by e.expense_date desc, e.expense_no desc
  `;
  return rows.map((r) => ({
    expense: {
      id: r.id,
      expenseNo: r.expense_no,
      date: dateOnly(r.expense_date),
      description: r.description,
      category: r.category,
      caseLabel: r.case_label,
      amountInr: Number(r.amount_inr ?? 0),
      status: r.status,
      reimbursable: r.reimbursable,
      billable: r.billable,
    },
    extras: {
      vendor:        r.vendor ?? '',
      gstNo:         r.gst_no ?? '',
      gstInr:        r.gst_inr ? Number(r.gst_inr) || 0 : 0,
      paymentMethod: r.payment_method ?? '',
    },
  }));
}

function dateOnly(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function defaultInvoiceExtras(): InvoiceExtras {
  return { gstNo: '', sacCode: DEFAULT_SAC_CODE, gstPct: DEFAULT_GST_PCT, paidDate: '' };
}

function defaultExpenseExtras(): ExpenseExtras {
  return { vendor: '', gstNo: '', gstInr: 0, paymentMethod: '' };
}

function matchInvoiceFilter(inv: Invoice, f: InvoicesExportFilter): boolean {
  if (f.since && inv.issuedDate < f.since) return false;
  if (f.until && inv.issuedDate > f.until) return false;
  if (f.status && inv.status !== f.status) return false;
  return true;
}

function matchExpenseFilter(e: Expense, f: ExpensesExportFilter): boolean {
  if (f.since && e.date < f.since) return false;
  if (f.until && e.date > f.until) return false;
  if (f.type  && e.category.toLowerCase() !== f.type.toLowerCase()) return false;
  return true;
}
