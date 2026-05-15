import type {
  Clause, CreateClauseRequest, ImportClausesResult, UpdateClauseRequest,
} from '@lexdraft/types';
import { db } from '../db/client';

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

// In-memory fallback when DATABASE_URL is blank. Keyed by firm so dev demos
// across multiple tenants don't bleed into one shared library.
const memClauses = new Map<string, Map<string, Clause>>();
function memBucket(firmId: string): Map<string, Clause> {
  let b = memClauses.get(firmId);
  if (!b) { b = new Map(); memClauses.set(firmId, b); }
  return b;
}

interface ListFilter {
  firmId: string | null;
  category?: string;
  q?: string;
}

/**
 * All read/write paths require `firmId`. When the caller has no firm
 * attachment we return empty / no-op rather than touching the global table -
 * the clause library is firm-private (cf. spec §10 tenant isolation).
 */
export const clausesService = {
  async list(filter: ListFilter): Promise<Clause[]> {
    if (!filter.firmId) return [];
    const sql = db();
    if (sql) {
      const rows = await sql<ClauseRow[]>`
        select id, firm_id, category, title, description, body, uses, created_at, updated_at
        from clauses
        where firm_id = ${filter.firmId}::uuid
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
    return Array.from(memBucket(filter.firmId).values()).filter((c) =>
      (!filter.category || c.category === filter.category) &&
      (!filter.q || c.title.toLowerCase().includes(filter.q.toLowerCase())),
    );
  },

  async create(input: CreateClauseRequest, firmId: string | null): Promise<Clause> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create clause'), { status: 422 });
    }
    const sql = db();
    if (sql) {
      const rows = await sql<ClauseRow[]>`
        insert into clauses (firm_id, category, title, description, body)
        values (${firmId}::uuid, ${input.category}, ${input.title}, ${input.description}, ${input.body})
        returning id, firm_id, category, title, description, body, uses, created_at, updated_at
      `;
      return rowToClause(rows[0]!);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const c: Clause = { id, ...input, uses: 0, createdAt: now, updatedAt: now };
    memBucket(firmId).set(id, c);
    return c;
  },

  async update(id: string, patch: UpdateClauseRequest, firmId: string | null): Promise<Clause | null> {
    if (!firmId) return null;
    const sql = db();
    if (sql) {
      const rows = await sql<ClauseRow[]>`
        update clauses set
          category    = coalesce(${patch.category ?? null}, category),
          title       = coalesce(${patch.title ?? null}, title),
          description = coalesce(${patch.description ?? null}, description),
          body        = coalesce(${patch.body ?? null}, body),
          updated_at  = now()
        where id = ${id}::uuid and firm_id = ${firmId}::uuid
        returning id, firm_id, category, title, description, body, uses, created_at, updated_at
      `;
      return rows[0] ? rowToClause(rows[0]) : null;
    }
    const bucket = memBucket(firmId);
    const c = bucket.get(id);
    if (!c) return null;
    const updated = { ...c, ...patch, updatedAt: new Date().toISOString() };
    bucket.set(id, updated);
    return updated;
  },

  async remove(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (sql) {
      const rows = await sql<{ id: string }[]>`
        delete from clauses where id = ${id}::uuid and firm_id = ${firmId}::uuid returning id
      `;
      return rows.length > 0;
    }
    return memBucket(firmId).delete(id);
  },

  async incrementUses(id: string, firmId: string | null): Promise<void> {
    if (!firmId) return;
    const sql = db();
    if (sql) {
      await sql`update clauses set uses = uses + 1 where id = ${id}::uuid and firm_id = ${firmId}::uuid`;
      return;
    }
    const bucket = memBucket(firmId);
    const c = bucket.get(id);
    if (c) bucket.set(id, { ...c, uses: c.uses + 1 });
  },

  async importMany(items: CreateClauseRequest[], firmId: string | null): Promise<ImportClausesResult> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot import clauses'), { status: 422 });
    }
    const sql = db();
    let inserted = 0;
    let skipped = 0;
    const sane = items.filter((it) => it && it.category?.trim() && it.title?.trim());
    skipped += items.length - sane.length;
    if (sql && sane.length > 0) {
      // Skip rows where (firm_id, category, title) already exists - case-insensitive title match.
      await sql.begin(async (tx) => {
        for (const it of sane) {
          const existing = await tx<{ id: string }[]>`
            select id from clauses
            where firm_id = ${firmId}::uuid
              and category = ${it.category}
              and lower(title) = lower(${it.title})
            limit 1
          `;
          if (existing.length > 0) { skipped += 1; continue; }
          await tx`
            insert into clauses (firm_id, category, title, description, body)
            values (${firmId}::uuid, ${it.category}, ${it.title}, ${it.description ?? ''}, ${it.body ?? ''})
          `;
          inserted += 1;
        }
      });
      return { inserted, skipped };
    }
    // memory fallback
    const bucket = memBucket(firmId);
    for (const it of sane) {
      const dup = Array.from(bucket.values()).some(
        (c) => c.category === it.category && c.title.toLowerCase() === it.title.toLowerCase(),
      );
      if (dup) { skipped += 1; continue; }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      bucket.set(id, { id, ...it, description: it.description ?? '', body: it.body ?? '', uses: 0, createdAt: now, updatedAt: now });
      inserted += 1;
    }
    return { inserted, skipped };
  },
};
