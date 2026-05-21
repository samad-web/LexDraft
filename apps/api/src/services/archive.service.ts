import type { ArchivedMatter } from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  cnr: string;
  title: string;
  client: string;
  court: string;
  outcome: ArchivedMatter['outcome'] | null;
  closed_at: string | Date | null;
}

function dateOnly(v: string | Date | null): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

export const archiveService = {
  async list(firmId: string | null): Promise<ArchivedMatter[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select id, cnr, title, client, court, outcome, closed_at
      from cases
      where firm_id = ${firmId}::uuid
        and kind = 'matter'
        and (status = 'Closed' or status = 'Archived')
      order by closed_at desc nulls last, title asc
    `;
    return rows
      .filter((r) => r.outcome !== null)
      .map((r) => ({
        id: r.id,
        cnr: r.cnr,
        title: r.title,
        client: r.client,
        court: r.court,
        outcome: r.outcome as ArchivedMatter['outcome'],
        closedDate: dateOnly(r.closed_at),
      }));
  },
};
