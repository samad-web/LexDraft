import type {
  Clause, CreateClauseRequest, ImportClausesResult, UpdateClauseRequest,
} from '@lexdraft/types';
import { db } from '../db/client';

const SEED_FIRM_ID = '00000000-0000-0000-0000-000000000001';

interface ClauseRow {
  id: string;
  firm_id: string;
  category: string;
  title: string;
  description: string;
  body: string;
  uses: number;
  created_at: Date;
  updated_at: Date;
}

function rowToClause(r: ClauseRow): Clause {
  return {
    id: r.id,
    category: r.category,
    title: r.title,
    description: r.description,
    body: r.body,
    uses: Number(r.uses),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

// In-memory fallback when DATABASE_URL is blank.
const memClauses = new Map<string, Clause>();

export const clausesService = {
  async list(filter: { category?: string; q?: string } = {}): Promise<Clause[]> {
    const sql = db();
    if (sql) {
      const rows = await sql<ClauseRow[]>`
        select id, firm_id, category, title, description, body, uses, created_at, updated_at
        from clauses
        where firm_id = ${SEED_FIRM_ID}::uuid
          and (${filter.category ?? null}::text is null or category = ${filter.category ?? null})
          and (
            ${filter.q ?? null}::text is null
            or lower(title) like '%' || lower(${filter.q ?? null}) || '%'
            or lower(description) like '%' || lower(${filter.q ?? null}) || '%'
            or lower(body) like '%' || lower(${filter.q ?? null}) || '%'
          )
        order by category asc, uses desc, created_at desc
      `;
      return rows.map(rowToClause);
    }
    return Array.from(memClauses.values()).filter((c) =>
      (!filter.category || c.category === filter.category) &&
      (!filter.q || c.title.toLowerCase().includes(filter.q.toLowerCase())),
    );
  },

  async create(input: CreateClauseRequest): Promise<Clause> {
    const sql = db();
    if (sql) {
      const rows = await sql<ClauseRow[]>`
        insert into clauses (firm_id, category, title, description, body)
        values (${SEED_FIRM_ID}::uuid, ${input.category}, ${input.title}, ${input.description}, ${input.body})
        returning id, firm_id, category, title, description, body, uses, created_at, updated_at
      `;
      return rowToClause(rows[0]!);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const c: Clause = { id, ...input, uses: 0, createdAt: now, updatedAt: now };
    memClauses.set(id, c);
    return c;
  },

  async update(id: string, patch: UpdateClauseRequest): Promise<Clause | null> {
    const sql = db();
    if (sql) {
      const rows = await sql<ClauseRow[]>`
        update clauses set
          category    = coalesce(${patch.category ?? null}, category),
          title       = coalesce(${patch.title ?? null}, title),
          description = coalesce(${patch.description ?? null}, description),
          body        = coalesce(${patch.body ?? null}, body),
          updated_at  = now()
        where id = ${id}::uuid and firm_id = ${SEED_FIRM_ID}::uuid
        returning id, firm_id, category, title, description, body, uses, created_at, updated_at
      `;
      return rows[0] ? rowToClause(rows[0]) : null;
    }
    const c = memClauses.get(id);
    if (!c) return null;
    const updated = { ...c, ...patch, updatedAt: new Date().toISOString() };
    memClauses.set(id, updated);
    return updated;
  },

  async remove(id: string): Promise<boolean> {
    const sql = db();
    if (sql) {
      const rows = await sql<{ id: string }[]>`
        delete from clauses where id = ${id}::uuid and firm_id = ${SEED_FIRM_ID}::uuid returning id
      `;
      return rows.length > 0;
    }
    return memClauses.delete(id);
  },

  async incrementUses(id: string): Promise<void> {
    const sql = db();
    if (sql) {
      await sql`update clauses set uses = uses + 1 where id = ${id}::uuid and firm_id = ${SEED_FIRM_ID}::uuid`;
      return;
    }
    const c = memClauses.get(id);
    if (c) memClauses.set(id, { ...c, uses: c.uses + 1 });
  },

  async importMany(items: CreateClauseRequest[]): Promise<ImportClausesResult> {
    const sql = db();
    let inserted = 0;
    let skipped = 0;
    const sane = items.filter((it) => it && it.category?.trim() && it.title?.trim());
    skipped += items.length - sane.length;
    if (sql && sane.length > 0) {
      // Skip rows where (firm_id, category, title) already exists — case-insensitive title match.
      await sql.begin(async (tx) => {
        for (const it of sane) {
          const existing = await tx<{ id: string }[]>`
            select id from clauses
            where firm_id = ${SEED_FIRM_ID}::uuid
              and category = ${it.category}
              and lower(title) = lower(${it.title})
            limit 1
          `;
          if (existing.length > 0) { skipped += 1; continue; }
          await tx`
            insert into clauses (firm_id, category, title, description, body)
            values (${SEED_FIRM_ID}::uuid, ${it.category}, ${it.title}, ${it.description ?? ''}, ${it.body ?? ''})
          `;
          inserted += 1;
        }
      });
      return { inserted, skipped };
    }
    // memory fallback
    for (const it of sane) {
      const dup = Array.from(memClauses.values()).some(
        (c) => c.category === it.category && c.title.toLowerCase() === it.title.toLowerCase(),
      );
      if (dup) { skipped += 1; continue; }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      memClauses.set(id, { id, ...it, description: it.description ?? '', body: it.body ?? '', uses: 0, createdAt: now, updatedAt: now });
      inserted += 1;
    }
    return { inserted, skipped };
  },
};
