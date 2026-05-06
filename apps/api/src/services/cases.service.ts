import type { Case } from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_CASES } from '../data/seed';

interface CaseRow {
  id: string;
  cnr: string;
  title: string;
  court: string;
  stage: string;
  client: string;
  status: Case['status'];
  next_hearing: string | Date | null;
  type: string;
}

function fromRow(r: CaseRow): Case {
  const next =
    r.next_hearing instanceof Date
      ? r.next_hearing.toISOString().slice(0, 10)
      : (r.next_hearing ?? '');
  return {
    id: r.id,
    cnr: r.cnr,
    title: r.title,
    court: r.court,
    stage: r.stage,
    client: r.client,
    status: r.status,
    next,
    type: r.type,
  };
}

// In-memory fallback (used only when DATABASE_URL is blank).
const memory: Case[] = [...SEED_CASES];

export const casesService = {
  async list(filter?: { type?: string; q?: string }): Promise<Case[]> {
    const sql = db();
    if (sql) {
      const rows = await sql<CaseRow[]>`
        select id, cnr, title, court, stage, client, status, next_hearing, type
        from cases
        where (${filter?.type ?? null}::text is null or ${filter?.type ?? null}::text = 'all'
               or lower(type) = lower(${filter?.type ?? null}::text))
          and (${filter?.q ?? null}::text is null
               or title ilike '%' || ${filter?.q ?? null}::text || '%'
               or cnr   ilike '%' || ${filter?.q ?? null}::text || '%')
        order by next_hearing nulls last, title
      `;
      return rows.map(fromRow);
    }
    let out = memory;
    if (filter?.type && filter.type !== 'all') out = out.filter((c) => c.type.toLowerCase() === filter.type!.toLowerCase());
    if (filter?.q) {
      const q = filter.q.toLowerCase();
      out = out.filter((c) => c.title.toLowerCase().includes(q) || c.cnr.toLowerCase().includes(q));
    }
    return out;
  },

  async get(id: string): Promise<Case | undefined> {
    const sql = db();
    if (sql) {
      const rows = await sql<CaseRow[]>`
        select id, cnr, title, court, stage, client, status, next_hearing, type
        from cases where id::text = ${id}
        limit 1
      `;
      const row = rows[0];
      return row ? fromRow(row) : undefined;
    }
    return memory.find((c) => c.id === id);
  },

  async create(input: Omit<Case, 'id'>): Promise<Case> {
    const sql = db();
    if (sql) {
      const rows = await sql<CaseRow[]>`
        insert into cases (cnr, title, court, stage, client, status, next_hearing, type)
        values (${input.cnr}, ${input.title}, ${input.court}, ${input.stage},
                ${input.client}, ${input.status}, ${input.next || null}, ${input.type})
        returning id, cnr, title, court, stage, client, status, next_hearing, type
      `;
      return fromRow(rows[0]!);
    }
    const c: Case = { ...input, id: `c${memory.length + 1}` };
    memory.push(c);
    return c;
  },

  async update(id: string, patch: Partial<Case>): Promise<Case | undefined> {
    const sql = db();
    if (sql) {
      const rows = await sql<CaseRow[]>`
        update cases set
          cnr           = coalesce(${patch.cnr ?? null}, cnr),
          title         = coalesce(${patch.title ?? null}, title),
          court         = coalesce(${patch.court ?? null}, court),
          stage         = coalesce(${patch.stage ?? null}, stage),
          client        = coalesce(${patch.client ?? null}, client),
          status        = coalesce(${(patch.status ?? null) as string | null}, status),
          next_hearing  = coalesce(${patch.next ?? null}, next_hearing),
          type          = coalesce(${patch.type ?? null}, type)
        where id::text = ${id}
        returning id, cnr, title, court, stage, client, status, next_hearing, type
      `;
      const row = rows[0];
      return row ? fromRow(row) : undefined;
    }
    const i = memory.findIndex((c) => c.id === id);
    if (i === -1) return undefined;
    memory[i] = { ...memory[i]!, ...patch, id };
    return memory[i];
  },

  async remove(id: string): Promise<boolean> {
    const sql = db();
    if (sql) {
      const rows = await sql`delete from cases where id::text = ${id} returning id`;
      return rows.length > 0;
    }
    const i = memory.findIndex((c) => c.id === id);
    if (i === -1) return false;
    memory.splice(i, 1);
    return true;
  },
};
