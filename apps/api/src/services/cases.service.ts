import type { Case } from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_CASES } from '../data/seed';
import { clientsService } from './clients.service';
import { ConflictError } from '../lib/errors';

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
  visible_to_client?: boolean;
}

/** Detail-only row shape — includes the eCourts identity columns added in
 *  migration 0053. List queries deliberately skip these to keep the payload
 *  thin for case-grid views. */
interface CaseDetailRow extends CaseRow {
  est_code: string | null;
  court_code: number | null;
  district_code: number | null;
  state_code: number | null;
  filing_no: string | null;
  efil_no: string | null;
  judge: string | null;
  fir_no: string | null;
  fir_year: number | null;
  police_st_code: number | null;
  fir_details: string | null;
  ecourts_synced_at: string | Date | null;
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
    visibleToClient: r.visible_to_client ?? false,
  };
}

function tsToIso(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function fromDetailRow(r: CaseDetailRow): Case {
  return {
    ...fromRow(r),
    estCode:        r.est_code,
    courtCode:      r.court_code,
    districtCode:   r.district_code,
    stateCode:      r.state_code,
    filingNo:       r.filing_no,
    efilNo:         r.efil_no,
    judge:          r.judge,
    firNo:          r.fir_no,
    firYear:        r.fir_year,
    policeStCode:   r.police_st_code,
    firDetails:     r.fir_details,
    ecourtsSyncedAt: tsToIso(r.ecourts_synced_at),
  };
}

// In-memory fallback (used only when DATABASE_URL is blank).
const memory: Case[] = [...SEED_CASES];

interface ListFilter {
  firmId: string | null;
  type?: string;
  q?: string;
}

/**
 * All read paths require `firmId`. When the caller has no firm attachment we
 * return an empty list - never the global table - so cross-tenant data
 * leakage is impossible (cf. spec §10 tenant isolation).
 */
export const casesService = {
  async list(filter: ListFilter): Promise<Case[]> {
    if (!filter.firmId) return [];
    const sql = db();
    if (sql) {
      const rows = await sql<CaseRow[]>`
        select id, cnr, title, court, stage, client, status, next_hearing, type, visible_to_client
        from cases
        where firm_id = ${filter.firmId}::uuid
          and deleted_at is null
          -- Hide sandbox / quick-study cases from the canonical matters list.
          -- They live in the same table but are managed by matter-intel UI.
          and kind = 'matter'
          and (${filter.type ?? null}::text is null or ${filter.type ?? null}::text = 'all'
               or lower(type) = lower(${filter.type ?? null}::text))
          and (${filter.q ?? null}::text is null
               or title ilike '%' || ${filter.q ?? null}::text || '%'
               or cnr   ilike '%' || ${filter.q ?? null}::text || '%')
        order by next_hearing nulls last, title
      `;
      return rows.map(fromRow);
    }
    let out = memory;
    if (filter.type && filter.type !== 'all') out = out.filter((c) => c.type.toLowerCase() === filter.type!.toLowerCase());
    if (filter.q) {
      const q = filter.q.toLowerCase();
      out = out.filter((c) => c.title.toLowerCase().includes(q) || c.cnr.toLowerCase().includes(q));
    }
    return out;
  },

  async get(id: string, firmId: string | null): Promise<Case | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (sql) {
      // Detail path: pull the eCourts identity columns too. List path stays
      // lean (see `list` above) so per-row payloads on the grid don't bloat.
      const rows = await sql<CaseDetailRow[]>`
        select id, cnr, title, court, stage, client, status, next_hearing, type, visible_to_client,
               est_code, court_code, district_code, state_code, filing_no, efil_no, judge,
               fir_no, fir_year, police_st_code, fir_details, ecourts_synced_at
        from cases where id::text = ${id} and firm_id = ${firmId}::uuid and deleted_at is null
        limit 1
      `;
      const row = rows[0];
      return row ? fromDetailRow(row) : undefined;
    }
    return memory.find((c) => c.id === id);
  },

  async create(input: Omit<Case, 'id'>, firmId: string | null): Promise<Case> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create case'), { status: 422 });
    }
    const sql = db();
    if (sql) {
      let rows: CaseRow[];
      try {
        rows = await sql<CaseRow[]>`
          insert into cases (firm_id, cnr, title, court, stage, client, status, next_hearing, type)
          values (${firmId}::uuid, ${input.cnr}, ${input.title}, ${input.court}, ${input.stage},
                  ${input.client}, ${input.status}, ${input.next || null}, ${input.type})
          returning id, cnr, title, court, stage, client, status, next_hearing, type, visible_to_client
        `;
      } catch (err) {
        // A case with this CNR already exists for the firm (cases_firm_cnr_uq)
        // - e.g. clicking "Add to my cases" twice on the same eCourts result.
        // Surface a clear, actionable 409 instead of a raw 500 "Internal
        // Server Error" with no explanation.
        if (input.cnr && (err as { code?: string }).code === '23505') {
          throw new ConflictError(`A case with CNR ${input.cnr} is already in your matters.`, { code: 'duplicate_cnr' });
        }
        throw err;
      }
      const created = fromRow(rows[0]!);
      // Register the client so it appears in the Clients directory. The
      // cases/clients join is by name; without this a case's client never
      // shows up in the register. No-throw and idempotent.
      await clientsService.ensureByName(created.client, firmId);
      return created;
    }
    const c: Case = { ...input, id: `c${memory.length + 1}` };
    memory.push(c);
    return c;
  },

  async update(id: string, patch: Partial<Case>, firmId: string | null): Promise<Case | undefined> {
    if (!firmId) return undefined;
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
        where id::text = ${id} and firm_id = ${firmId}::uuid and deleted_at is null
        returning id, cnr, title, court, stage, client, status, next_hearing, type, visible_to_client
      `;
      const row = rows[0];
      if (row) {
        // Keep the client register in step when a case's client is (re)named.
        await clientsService.ensureByName(row.client, firmId);
      }
      return row ? fromRow(row) : undefined;
    }
    const i = memory.findIndex((c) => c.id === id);
    if (i === -1) return undefined;
    memory[i] = { ...memory[i]!, ...patch, id };
    return memory[i];
  },

  /**
   * SOFT-delete a matter: mark it deleted (hidden from lists) but keep the row
   * for 30 days so an accidental deletion can be undone. Returns true if a live
   * row was marked. Idempotent — deleting an already-deleted row returns false.
   */
  async remove(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (sql) {
      const rows = await sql`
        update cases set deleted_at = now()
        where id::text = ${id} and firm_id = ${firmId}::uuid and deleted_at is null
        returning id
      `;
      return rows.length > 0;
    }
    const i = memory.findIndex((c) => c.id === id);
    if (i === -1) return false;
    memory.splice(i, 1);
    return true;
  },

  /** Restore a soft-deleted matter within the retention window. */
  async restore(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (!sql) return false;
    const rows = await sql`
      update cases set deleted_at = null
      where id::text = ${id} and firm_id = ${firmId}::uuid and deleted_at is not null
      returning id
    `;
    return rows.length > 0;
  },

  /** List a firm's soft-deleted matters (the "Recently deleted" / trash view),
   *  newest deletion first, with the deletion timestamp for the 30-day countdown. */
  async listDeleted(firmId: string | null): Promise<Array<Case & { deletedAt: string }>> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Array<CaseRow & { deleted_at: string | Date }>>`
      select id, cnr, title, court, stage, client, status, next_hearing, type, visible_to_client, deleted_at
      from cases
      where firm_id = ${firmId}::uuid and kind = 'matter' and deleted_at is not null
      order by deleted_at desc
    `;
    return rows.map((r) => ({
      ...fromRow(r),
      deletedAt: r.deleted_at instanceof Date ? r.deleted_at.toISOString() : r.deleted_at,
    }));
  },

  /** Permanently remove matters soft-deleted more than `days` ago (default 30).
   *  Called by a scheduled purge job; returns how many rows were purged. */
  async purgeExpired(days = 30): Promise<number> {
    const sql = db();
    if (!sql) return 0;
    const rows = await sql<{ id: string }[]>`
      delete from cases
      where deleted_at is not null and deleted_at < now() - (${days} || ' days')::interval
      returning id
    `;
    return rows.length;
  },
};
