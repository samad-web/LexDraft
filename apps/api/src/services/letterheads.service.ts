/**
 * Letterheads - firm + per-user library backing the Settings → Letterhead
 * designer and the export-time header renderer.
 *
 * Tenant isolation: every read/write is firm-scoped via firm_id. Personal
 * letterheads add a second predicate on owner_user_id so a sibling member
 * of the same firm can't read or mutate another user's personal designs.
 *
 * Default invariants:
 *   - At most one firm default per firm (where owner_user_id IS NULL).
 *   - At most one personal default per user.
 *   Both enforced by partial unique indexes in migration 0029; the create /
 *   update paths also demote the prior default in the same transaction so a
 *   concurrent toggle can't trip the index.
 *
 * Effective default resolution: when the exporter asks "what letterhead
 * should this user's export carry?", the answer is the user's personal
 * default if one exists, else the firm default, else null. Surfaced as
 * `effectiveDefault` in the list response so the client doesn't have to
 * compute it.
 *
 * In-memory fallback (no DATABASE_URL): a per-firm Map mirrors the table
 * surface so dev demos work without Postgres.
 */

import { db } from '../db/client';
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from '../lib/errors';
import type {
  CreateLetterheadRequest,
  Letterhead,
  LetterheadFields,
  LetterheadTemplateKey,
  ListLetterheadsResponse,
  UpdateLetterheadRequest,
} from '../types/letterhead.types';

interface Row {
  id: string;
  firm_id: string;
  owner_user_id: string | null;
  name: string;
  template_key: string;
  fields_json: LetterheadFields | string | null;
  logo_key: string | null;
  is_default: boolean;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function parseFields(raw: Row['fields_json']): LetterheadFields {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as LetterheadFields; } catch { return {}; }
  }
  return raw;
}

function rowToLetterhead(r: Row): Letterhead {
  return {
    id: r.id,
    firmId: r.firm_id,
    ownerUserId: r.owner_user_id,
    name: r.name,
    templateKey: r.template_key as LetterheadTemplateKey,
    fields: parseFields(r.fields_json),
    logoKey: r.logo_key,
    isDefault: r.is_default,
    createdBy: r.created_by,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

// ---------- Memory fallback (no DATABASE_URL) ------------------------------

const memStore = new Map<string, Letterhead[]>(); // firmId → list
function memBucket(firmId: string): Letterhead[] {
  let b = memStore.get(firmId);
  if (!b) { b = []; memStore.set(firmId, b); }
  return b;
}

function memSort(items: Letterhead[]): Letterhead[] {
  return [...items].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

// ---------- Service ---------------------------------------------------------

interface Ctx {
  firmId: string;
  userId: string;
}

/** Compute the caller's effective default - personal beats firm. */
function pickEffectiveDefault(
  firm: Letterhead[],
  personal: Letterhead[],
): Letterhead | null {
  const personalDefault = personal.find((l) => l.isDefault);
  if (personalDefault) return personalDefault;
  const firmDefault = firm.find((l) => l.isDefault);
  return firmDefault ?? null;
}

export const letterheadsService = {
  async list(ctx: Ctx): Promise<ListLetterheadsResponse> {
    const sql = db();
    if (sql) {
      const rows = await sql<Row[]>`
        select id, firm_id, owner_user_id, name, template_key, fields_json,
               logo_key, is_default, created_by, created_at, updated_at
        from letterheads
        where firm_id = ${ctx.firmId}::uuid
          and (owner_user_id is null or owner_user_id = ${ctx.userId}::uuid)
        order by is_default desc, updated_at desc
      `;
      const all = rows.map(rowToLetterhead);
      const firmItems = all.filter((l) => l.ownerUserId === null);
      const personalItems = all.filter((l) => l.ownerUserId === ctx.userId);
      return {
        firmItems,
        personalItems,
        effectiveDefault: pickEffectiveDefault(firmItems, personalItems),
      };
    }
    const all = memSort(memBucket(ctx.firmId));
    const firmItems = all.filter((l) => l.ownerUserId === null);
    const personalItems = all.filter((l) => l.ownerUserId === ctx.userId);
    return {
      firmItems,
      personalItems,
      effectiveDefault: pickEffectiveDefault(firmItems, personalItems),
    };
  },

  /** Internal - used by the exporter (and by `list` callers that already
   *  have the data). Returned in the same shape `list()` returns. */
  async effectiveDefault(ctx: Ctx): Promise<Letterhead | null> {
    const { effectiveDefault } = await this.list(ctx);
    return effectiveDefault;
  },

  async get(id: string, ctx: Ctx): Promise<Letterhead> {
    const sql = db();
    if (sql) {
      const rows = await sql<Row[]>`
        select id, firm_id, owner_user_id, name, template_key, fields_json,
               logo_key, is_default, created_by, created_at, updated_at
        from letterheads
        where id = ${id}::uuid
          and firm_id = ${ctx.firmId}::uuid
          and (owner_user_id is null or owner_user_id = ${ctx.userId}::uuid)
        limit 1
      `;
      const row = rows[0];
      if (!row) throw new NotFoundError('Letterhead not found');
      return rowToLetterhead(row);
    }
    const found = memBucket(ctx.firmId).find(
      (l) => l.id === id && (l.ownerUserId === null || l.ownerUserId === ctx.userId),
    );
    if (!found) throw new NotFoundError('Letterhead not found');
    return found;
  },

  async create(input: CreateLetterheadRequest, ctx: Ctx): Promise<Letterhead> {
    if (!input.name || input.name.trim().length === 0) {
      throw new UnprocessableEntityError('Letterhead name is required');
    }
    if (input.name.length > 120) {
      throw new UnprocessableEntityError('Letterhead name is too long (120 char max)');
    }
    const ownerUserId = input.scope === 'personal' ? ctx.userId : null;
    const sql = db();
    if (sql) {
      // If the new row claims default-ness, demote any sibling default in
      // the same scope before inserting. Both statements run in one tx so a
      // concurrent toggle can't slip between them and trip the partial
      // unique index.
      const row = await sql.begin(async (tx) => {
        if (input.isDefault) {
          if (ownerUserId === null) {
            await tx`
              update letterheads set is_default = false
              where firm_id = ${ctx.firmId}::uuid
                and owner_user_id is null
                and is_default = true
            `;
          } else {
            await tx`
              update letterheads set is_default = false
              where firm_id = ${ctx.firmId}::uuid
                and owner_user_id = ${ownerUserId}::uuid
                and is_default = true
            `;
          }
        }
        const inserted = await tx<Row[]>`
          insert into letterheads
            (firm_id, owner_user_id, name, template_key, fields_json, logo_key,
             is_default, created_by)
          values
            (${ctx.firmId}::uuid,
             ${ownerUserId},
             ${input.name.trim()},
             ${input.templateKey},
             ${JSON.stringify(input.fields ?? {})}::jsonb,
             ${input.logoKey ?? null},
             ${input.isDefault ?? false},
             ${ctx.userId}::uuid)
          returning id, firm_id, owner_user_id, name, template_key, fields_json,
                    logo_key, is_default, created_by, created_at, updated_at
        `;
        return inserted[0]!;
      });
      return rowToLetterhead(row);
    }
    // Memory fallback - re-enforce the default invariant manually.
    const bucket = memBucket(ctx.firmId);
    if (input.isDefault) {
      for (let i = 0; i < bucket.length; i++) {
        const item = bucket[i]!;
        if (item.ownerUserId === ownerUserId && item.isDefault) {
          bucket[i] = { ...item, isDefault: false, updatedAt: new Date().toISOString() };
        }
      }
    }
    const now = new Date().toISOString();
    const created: Letterhead = {
      id: `mem-${Date.now()}-${bucket.length + 1}`,
      firmId: ctx.firmId,
      ownerUserId,
      name: input.name.trim(),
      templateKey: input.templateKey,
      fields: input.fields ?? {},
      logoKey: input.logoKey ?? null,
      isDefault: input.isDefault ?? false,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
    };
    bucket.push(created);
    return created;
  },

  async update(id: string, patch: UpdateLetterheadRequest, ctx: Ctx): Promise<Letterhead> {
    if (patch.name !== undefined) {
      if (!patch.name || patch.name.trim().length === 0) {
        throw new UnprocessableEntityError('Letterhead name cannot be empty');
      }
      if (patch.name.length > 120) {
        throw new UnprocessableEntityError('Letterhead name is too long (120 char max)');
      }
    }
    const current = await this.get(id, ctx); // tenant + ownership gate
    // Editing a firm-scoped letterhead is allowed for any caller in the firm
    // who has the feature key. We don't add a stricter check here - that's
    // the routes layer's job. Personal letterheads are already gated by the
    // owner_user_id predicate in `get()`.
    if (current.ownerUserId !== null && current.ownerUserId !== ctx.userId) {
      // Defence in depth - `get()` already filters these out.
      throw new ForbiddenError('Cannot edit a letterhead owned by another user');
    }

    const sql = db();
    if (sql) {
      const row = await sql.begin(async (tx) => {
        if (patch.isDefault === true) {
          if (current.ownerUserId === null) {
            await tx`
              update letterheads set is_default = false
              where firm_id = ${current.firmId}::uuid
                and owner_user_id is null
                and is_default = true
                and id <> ${current.id}::uuid
            `;
          } else {
            await tx`
              update letterheads set is_default = false
              where firm_id = ${current.firmId}::uuid
                and owner_user_id = ${current.ownerUserId}::uuid
                and is_default = true
                and id <> ${current.id}::uuid
            `;
          }
        }
        const updated = await tx<Row[]>`
          update letterheads set
            name         = ${patch.name ?? current.name},
            template_key = ${patch.templateKey ?? current.templateKey},
            fields_json  = ${JSON.stringify(patch.fields ?? current.fields)}::jsonb,
            logo_key     = ${patch.logoKey === undefined ? current.logoKey : patch.logoKey},
            is_default   = ${patch.isDefault ?? current.isDefault}
          where id = ${current.id}::uuid
            and firm_id = ${current.firmId}::uuid
          returning id, firm_id, owner_user_id, name, template_key, fields_json,
                    logo_key, is_default, created_by, created_at, updated_at
        `;
        const row = updated[0];
        if (!row) throw new NotFoundError('Letterhead not found');
        return row;
      });
      return rowToLetterhead(row);
    }
    // Memory path
    const bucket = memBucket(ctx.firmId);
    const idx = bucket.findIndex((l) => l.id === current.id);
    if (idx === -1) throw new NotFoundError('Letterhead not found');
    if (patch.isDefault === true) {
      for (let i = 0; i < bucket.length; i++) {
        const item = bucket[i]!;
        if (i !== idx && item.ownerUserId === current.ownerUserId && item.isDefault) {
          bucket[i] = { ...item, isDefault: false, updatedAt: new Date().toISOString() };
        }
      }
    }
    const next: Letterhead = {
      ...current,
      name: patch.name ?? current.name,
      templateKey: patch.templateKey ?? current.templateKey,
      fields: patch.fields ?? current.fields,
      logoKey: patch.logoKey === undefined ? current.logoKey : patch.logoKey,
      isDefault: patch.isDefault ?? current.isDefault,
      updatedAt: new Date().toISOString(),
    };
    bucket[idx] = next;
    return next;
  },

  async remove(id: string, ctx: Ctx): Promise<void> {
    const current = await this.get(id, ctx);
    if (current.ownerUserId !== null && current.ownerUserId !== ctx.userId) {
      throw new ForbiddenError('Cannot delete a letterhead owned by another user');
    }
    const sql = db();
    if (sql) {
      const rows = await sql<{ id: string }[]>`
        delete from letterheads
        where id = ${id}::uuid and firm_id = ${ctx.firmId}::uuid
        returning id
      `;
      if (rows.length === 0) throw new NotFoundError('Letterhead not found');
      return;
    }
    const bucket = memBucket(ctx.firmId);
    const idx = bucket.findIndex((l) => l.id === id);
    if (idx === -1) throw new NotFoundError('Letterhead not found');
    bucket.splice(idx, 1);
  },
};

