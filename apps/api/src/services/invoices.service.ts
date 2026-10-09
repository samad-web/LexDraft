import type { Invoice } from '@lexdraft/types';
import { db } from '../db/client';
import { ConflictError } from '../lib/errors';

interface Row {
  id: string;
  invoice_no: string;
  client: string;
  amount_inr: number;
  issued_date: string | Date;
  due_date: string | Date;
  status: Invoice['status'];
}

function dateOnly(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function fromRow(r: Row): Invoice {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    client: r.client,
    amountInr: Number(r.amount_inr ?? 0),
    issuedDate: dateOnly(r.issued_date),
    dueDate: dateOnly(r.due_date),
    status: r.status,
  };
}

export const invoicesService = {
  async list(firmId: string | null): Promise<Invoice[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select id, invoice_no, client, amount_inr, issued_date, due_date, status
      from invoices
      where firm_id = ${firmId}::uuid
      order by issued_date desc, invoice_no desc
    `;
    return rows.map(fromRow);
  },

  async create(input: Omit<Invoice, 'id'>, firmId: string | null): Promise<Invoice> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create invoice'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    let rows: Row[];
    try {
      rows = await sql<Row[]>`
        insert into invoices (firm_id, invoice_no, client, amount_inr, issued_date, due_date, status)
        values (${firmId}::uuid, ${input.invoiceNo}, ${input.client}, ${input.amountInr},
                ${input.issuedDate}, ${input.dueDate}, ${input.status})
        returning id, invoice_no, client, amount_inr, issued_date, due_date, status
      `;
    } catch (err) {
      // An invoice with this number already exists for the firm
      // (invoices_firm_no_idx) - surface a clear, actionable 409 instead of
      // a raw 500 "Internal Server Error" with no explanation.
      if (input.invoiceNo && (err as { code?: string }).code === '23505') {
        throw new ConflictError(`An invoice with number ${input.invoiceNo} already exists.`, { code: 'duplicate_invoice_no' });
      }
      throw err;
    }
    return fromRow(rows[0]!);
  },
};
