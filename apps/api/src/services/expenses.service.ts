import type { Expense } from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  expense_no: string;
  expense_date: string | Date;
  description: string;
  category: string;
  case_label: string;
  amount_inr: number;
  status: Expense['status'];
  reimbursable: boolean;
  billable: boolean;
}

function dateOnly(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function fromRow(r: Row): Expense {
  return {
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
  };
}

export const expensesService = {
  async list(firmId: string | null): Promise<Expense[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select id, expense_no, expense_date, description, category,
             case_label, amount_inr, status, reimbursable, billable
      from expenses
      where firm_id = ${firmId}::uuid
      order by expense_date desc
    `;
    return rows.map(fromRow);
  },

  async create(input: Omit<Expense, 'id'>, firmId: string | null): Promise<Expense> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create expense'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into expenses
        (firm_id, expense_no, expense_date, description, category, case_label,
         amount_inr, status, reimbursable, billable)
      values
        (${firmId}::uuid, ${input.expenseNo}, ${input.date}, ${input.description}, ${input.category},
         ${input.caseLabel}, ${input.amountInr}, ${input.status},
         ${input.reimbursable}, ${input.billable})
      returning id, expense_no, expense_date, description, category, case_label,
                amount_inr, status, reimbursable, billable
    `;
    return fromRow(rows[0]!);
  },
};
