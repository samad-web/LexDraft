import type { DiaryEntry } from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  entry_date: string | Date;
  entry_time: string;
  kind: DiaryEntry['kind'];
  case_label: string;
  cnr: string;
  detail: string;
  forum: string;
}

function dateOnly(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function fromRow(r: Row): DiaryEntry {
  return {
    id: r.id,
    date: dateOnly(r.entry_date),
    time: r.entry_time,
    kind: r.kind,
    caseLabel: r.case_label,
    cnr: r.cnr,
    detail: r.detail,
    forum: r.forum,
  };
}

export const diaryService = {
  async list(firmId: string | null): Promise<DiaryEntry[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select id, entry_date, entry_time, kind, case_label, cnr, detail, forum
      from diary_entries
      where firm_id = ${firmId}::uuid
      order by entry_date asc, entry_time asc
    `;
    return rows.map(fromRow);
  },

  async create(input: Omit<DiaryEntry, 'id'>, firmId: string | null): Promise<DiaryEntry> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create diary entry'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into diary_entries
        (firm_id, entry_date, entry_time, kind, case_label, cnr, detail, forum)
      values
        (${firmId}::uuid, ${input.date}, ${input.time}, ${input.kind}, ${input.caseLabel},
         ${input.cnr}, ${input.detail}, ${input.forum})
      returning id, entry_date, entry_time, kind, case_label, cnr, detail, forum
    `;
    return fromRow(rows[0]!);
  },
};
