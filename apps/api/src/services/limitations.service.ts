import type { Limitation } from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  case_label: string;
  cnr: string;
  filing_type: string;
  forum: string;
  deadline: string | Date;
  filed_by: string;
}

function dateOnly(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

/** Whole-day delta from local midnight today to the supplied YYYY-MM-DD
 *  deadline. Negative when the deadline is in the past. Exported for tests. */
export function daysBetween(deadline: string): number {
  const d = new Date(deadline + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms = d.getTime() - today.getTime();
  return Math.round(ms / 86_400_000);
}

function fromRow(r: Row): Limitation {
  const deadline = dateOnly(r.deadline);
  return {
    id: r.id,
    caseLabel: r.case_label,
    cnr: r.cnr,
    filingType: r.filing_type,
    forum: r.forum,
    deadline,
    filedBy: r.filed_by,
    daysRemaining: daysBetween(deadline),
  };
}

export const limitationsService = {
  async list(firmId: string | null): Promise<Limitation[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select id, case_label, cnr, filing_type, forum, deadline, filed_by
      from limitations
      where firm_id = ${firmId}::uuid
      order by deadline asc
    `;
    return rows.map(fromRow);
  },

  async create(input: Omit<Limitation, 'id' | 'daysRemaining'>, firmId: string | null): Promise<Limitation> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached — cannot create limitation'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into limitations (firm_id, case_label, cnr, filing_type, forum, deadline, filed_by)
      values (${firmId}::uuid, ${input.caseLabel}, ${input.cnr}, ${input.filingType},
              ${input.forum}, ${input.deadline}, ${input.filedBy})
      returning id, case_label, cnr, filing_type, forum, deadline, filed_by
    `;
    return fromRow(rows[0]!);
  },
};
