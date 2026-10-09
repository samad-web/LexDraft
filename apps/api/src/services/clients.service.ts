import type { Client } from '@lexdraft/types';
import { db } from '../db/client';
import { logger } from '../logger';

interface Row {
  id: string;
  name: string;
  type: Client['type'];
  status: Client['status'];
  last_contact: string | Date | null;
  matters_open: number;
  email: string | null;
  portal_enabled?: boolean;
}

function fromRow(r: Row): Client {
  const lc = r.last_contact instanceof Date
    ? r.last_contact.toISOString().slice(0, 10)
    : (r.last_contact ?? '');
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    lastContact: lc,
    mattersOpen: Number(r.matters_open ?? 0),
    portalEnabled: !!r.portal_enabled,
    ...(r.email ? { email: r.email } : {}),
  };
}

export const clientsService = {
  async list(firmId: string | null): Promise<Client[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select c.id, c.name, c.type, c.status, c.last_contact, c.email, c.portal_enabled,
             coalesce(m.open_count, 0) as matters_open
      from clients c
      left join (
        select client, count(*) as open_count
        from cases
        where firm_id = ${firmId}::uuid and status = 'Active' and kind = 'matter'
        group by client
      ) m on m.client = c.name
      where c.firm_id = ${firmId}::uuid
      order by c.name
    `;
    return rows.map(fromRow);
  },

  async findById(id: string, firmId: string | null): Promise<Client | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;
    const rows = await sql<Row[]>`
      select c.id, c.name, c.type, c.status, c.last_contact, c.email, c.portal_enabled,
             coalesce(m.open_count, 0) as matters_open
      from clients c
      left join (
        select client, count(*) as open_count
        from cases
        where firm_id = ${firmId}::uuid and status = 'Active' and kind = 'matter'
        group by client
      ) m on m.client = c.name
      where c.id = ${id}::uuid and c.firm_id = ${firmId}::uuid
      limit 1
    `;
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  /**
   * Ensure a client row exists for this firm with the given name, creating a
   * minimal one (Individual, active) if none matches case-insensitively. Called
   * when a case is saved with a client name, so the client always appears in the
   * register — the cases/clients join is by name, but nothing else populated the
   * register from case creation. Idempotent and no-throw: a blank/placeholder
   * name (empty, "—") is ignored, and any failure is swallowed so it can never
   * break case saving. There is no unique (firm_id, name) constraint, so we
   * check-then-insert rather than rely on ON CONFLICT.
   */
  async ensureByName(name: string | null | undefined, firmId: string | null): Promise<void> {
    if (!firmId) return;
    const trimmed = (name ?? '').trim();
    // Ignore blanks and the em-dash placeholder used for client-less matters.
    if (!trimmed || trimmed === '—' || trimmed === '-') return;
    const sql = db();
    if (!sql) return;
    try {
      const existing = await sql<{ id: string }[]>`
        select id from clients
        where firm_id = ${firmId}::uuid and lower(name) = lower(${trimmed})
        limit 1
      `;
      if (existing.length > 0) return;
      await sql`
        insert into clients (firm_id, name, type, status)
        values (${firmId}::uuid, ${trimmed}, 'Individual', 'active')
      `;
    } catch (err) {
      // Never let client-register bookkeeping break the case write.
      logger.warn({ err, name: trimmed }, 'clients.ensureByName failed');
    }
  },

  async create(input: Omit<Client, 'id' | 'mattersOpen'>, firmId: string | null): Promise<Client> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create client'), { status: 422 });
    }
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into clients (firm_id, name, type, status, last_contact, email)
      values (${firmId}::uuid, ${input.name}, ${input.type}, ${input.status},
              ${input.lastContact || null}, ${input.email?.toLowerCase() || null})
      returning id, name, type, status, last_contact, email, portal_enabled, 0 as matters_open
    `;
    return fromRow(rows[0]!);
  },

  /**
   * Partially update a client. All fields are optional — only those present
   * on the input are written. Tenant safety: the row is keyed by both `id`
   * and `firm_id`, so a cross-tenant update is impossible at the DB layer.
   */
  async update(
    id: string,
    input: Partial<Omit<Client, 'id' | 'mattersOpen' | 'portalEnabled'>>,
    firmId: string | null,
  ): Promise<Client | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;
    const rows = await sql<Row[]>`
      update clients
      set
        name         = coalesce(${input.name ?? null}::text,          name),
        type         = coalesce(${input.type ?? null}::client_type,   type),
        status       = coalesce(${input.status ?? null}::client_status, status),
        last_contact = coalesce(${input.lastContact ?? null}::date,   last_contact),
        email        = coalesce(${input.email?.toLowerCase() ?? null}::text, email)
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning id, name, type, status, last_contact, email, portal_enabled,
        coalesce((
          select count(*) from cases
          where firm_id = ${firmId}::uuid
            and kind = 'matter'
            and status = 'Active'
            and client = clients.name
        ), 0) as matters_open
    `;
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  /**
   * Hard-delete a client. Cases referencing the client by free-text name are
   * not cascaded — the strings simply stop matching, so `mattersOpen`
   * counters drop to zero on the affected case rows. Use carefully; this
   * is meant for typo fixes and trial-data cleanup, not real client offboard
   * (which should flip `status = 'inactive'` instead).
   */
  async remove(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (!sql) return false;
    const rows = await sql<{ id: string }[]>`
      delete from clients
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning id
    `;
    return rows.length > 0;
  },
};
