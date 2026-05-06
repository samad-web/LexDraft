import type { Invoice } from '@lexdraft/types';
import { db } from '../db/client';

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
  async list(): Promise<Invoice[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select id, invoice_no, client, amount_inr, issued_date, due_date, status
      from invoices order by issued_date desc, invoice_no desc
    `;
    return rows.map(fromRow);
  },

  async create(input: Omit<Invoice, 'id'>): Promise<Invoice> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into invoices (invoice_no, client, amount_inr, issued_date, due_date, status)
      values (${input.invoiceNo}, ${input.client}, ${input.amountInr},
              ${input.issuedDate}, ${input.dueDate}, ${input.status})
      returning id, invoice_no, client, amount_inr, issued_date, due_date, status
    `;
    return fromRow(rows[0]!);
  },
};
