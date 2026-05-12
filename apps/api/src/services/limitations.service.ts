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
  matter_type: string | null;
  basis_statute: string | null;
  basis_section: string | null;
  computed_from: string | Date | null;
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

/**
 * Public row shape returned to clients. Augments the shared Limitation type
 * with the statute-aware fields (added in migration 0022). The fields are
 * optional on the shared type for backwards compatibility with rows entered
 * before the calculator existed — we surface them as `null`-safe strings so
 * the UI can render "—" when missing.
 */
export interface LimitationRow extends Limitation {
  matterType?: string | null;
  basisStatute?: string | null;
  basisSection?: string | null;
  computedFrom?: string | null;
}

function fromRow(r: Row): LimitationRow {
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
    matterType: r.matter_type,
    basisStatute: r.basis_statute,
    basisSection: r.basis_section,
    computedFrom: r.computed_from ? dateOnly(r.computed_from) : null,
  };
}

export interface CreateLimitationInput extends Omit<Limitation, 'id' | 'daysRemaining'> {
  matterType?: string | null;
  basisStatute?: string | null;
  basisSection?: string | null;
  /** ISO YYYY-MM-DD trigger date the deadline was computed from. */
  computedFrom?: string | null;
}

const ROW_COLS = 'id, case_label, cnr, filing_type, forum, deadline, filed_by, matter_type, basis_statute, basis_section, computed_from';

export const limitationsService = {
  async list(firmId: string | null): Promise<LimitationRow[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select ${sql.unsafe(ROW_COLS)}
      from limitations
      where firm_id = ${firmId}::uuid
      order by deadline asc
    `;
    return rows.map(fromRow);
  },

  async create(input: CreateLimitationInput, firmId: string | null): Promise<LimitationRow> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached — cannot create limitation'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into limitations (
        firm_id, case_label, cnr, filing_type, forum, deadline, filed_by,
        matter_type, basis_statute, basis_section, computed_from
      )
      values (
        ${firmId}::uuid,
        ${input.caseLabel},
        ${input.cnr},
        ${input.filingType},
        ${input.forum},
        ${input.deadline},
        ${input.filedBy},
        ${input.matterType    ?? null},
        ${input.basisStatute  ?? null},
        ${input.basisSection  ?? null},
        ${input.computedFrom  ?? null}
      )
      returning ${sql.unsafe(ROW_COLS)}
    `;
    return fromRow(rows[0]!);
  },
};
