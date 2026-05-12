/**
 * Engagement-letter automation — Firm-tier feature.
 *
 * Owns CRUD over `engagement_templates` (firm-scoped) plus a stateless
 * `generate()` that resolves the template + case context, interpolates the
 * supported placeholders, and returns the rendered letter as plain text.
 *
 * Tenant isolation:
 *   - every read/write requires `firmId`; callers that arrive without a firm
 *     attachment get an empty result or a 404 rather than a leak.
 *   - the routes layer is responsible for gating on `engagement.letters`
 *     (Firm-tier only). This service does not assume the caller is entitled.
 *
 * Default invariant:
 *   - at most one template per (firm_id, matter_type) carries `is_default`.
 *     Enforced by a partial unique index in migration 0024; the create/update
 *     paths also clear any prior default in the same transaction so the UI
 *     can promote a template without first demoting the existing one.
 *
 * When `DATABASE_URL` is not configured the service degrades to a per-firm
 * in-memory store. Same surface, same invariants — keeps dev-mode demos
 * working without a Postgres.
 */

import { db } from '../db/client';
import { NotFoundError, UnprocessableEntityError } from '../lib/errors';
import { casesService } from './cases.service';
import type {
  CreateEngagementTemplateRequest,
  EngagementTemplate,
  EngagementTemplateGroup,
  GenerateEngagementLetterResponse,
  ListEngagementTemplatesResponse,
  UpdateEngagementTemplateRequest,
} from '../types/engagement.types';

interface TemplateRow {
  id: string;
  firm_id: string;
  matter_type: string;
  scope_clauses: string;
  fee_clauses: string;
  retainer_inr: string | number | null;
  notes: string | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
}

function rowToTemplate(r: TemplateRow): EngagementTemplate {
  return {
    id: r.id,
    firmId: r.firm_id,
    matterType: r.matter_type,
    scopeClauses: r.scope_clauses,
    feeClauses: r.fee_clauses,
    retainerInr: r.retainer_inr === null ? null : Number(r.retainer_inr),
    notes: r.notes,
    isDefault: r.is_default,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    createdBy: r.created_by,
  };
}

// In-memory fallback (used only when DATABASE_URL is blank). Keyed by firm so
// the dev demo across multiple tenants stays isolated.
const memTemplates = new Map<string, Map<string, EngagementTemplate>>();
function memBucket(firmId: string): Map<string, EngagementTemplate> {
  let b = memTemplates.get(firmId);
  if (!b) { b = new Map(); memTemplates.set(firmId, b); }
  return b;
}

function groupByMatterType(items: EngagementTemplate[]): EngagementTemplateGroup[] {
  const map = new Map<string, EngagementTemplate[]>();
  for (const t of items) {
    const arr = map.get(t.matterType) ?? [];
    arr.push(t);
    map.set(t.matterType, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([matterType, templates]) => ({ matterType, templates }));
}

// ---------- Placeholder interpolation ---------------------------------------

const INR_FORMATTER = new Intl.NumberFormat('en-IN');

function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return INR_FORMATTER.format(Math.round(value));
}

function today(): string {
  // YYYY-MM-DD in local time. The generated letter is human-formatted in the
  // header block; this value also flows into the {{date.today}} placeholder
  // for callers that want it inline.
  return new Date().toISOString().slice(0, 10);
}

interface PlaceholderContext {
  firm: { name: string; address: string };
  client: { name: string; address: string };
  matter: { title: string; cnr: string; court: string; client: string };
  retainer: { inr: string };
  date: { today: string };
}

/**
 * Replace `{{path.like.this}}` tokens in `body` from the context tree.
 * Unknown tokens are left in place so authors notice typos at preview time
 * rather than getting silently blanked.
 */
function interpolate(body: string, ctx: PlaceholderContext): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, path: string) => {
    const parts = path.split('.');
    let cur: unknown = ctx;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return match; // unknown — leave the placeholder visible
      }
    }
    return cur === null || cur === undefined ? '' : String(cur);
  });
}

interface BuildLetterArgs {
  ctx: PlaceholderContext;
  scope: string;
  fee: string;
  retainerInr: number | null;
}

/**
 * Standard engagement-letter wrapper. The body of the scope / fee sections is
 * authored per-firm in the template; everything around them — header block,
 * salutation, numbering, sign-off — is generated here so every letter the
 * firm sends has the same skeleton.
 */
function buildLetter({ ctx, scope, fee, retainerInr }: BuildLetterArgs): string {
  const lines: string[] = [];
  lines.push('ENGAGEMENT LETTER');
  lines.push(ctx.firm.name);
  if (ctx.firm.address) lines.push(ctx.firm.address);
  lines.push('');
  lines.push(`Date: ${ctx.date.today}`);
  lines.push('');
  lines.push(`To: ${ctx.client.name}`);
  if (ctx.client.address) lines.push(`    ${ctx.client.address}`);
  lines.push('');
  lines.push(`Subject: Engagement for ${ctx.matter.title}`);
  lines.push('');
  lines.push(`Dear ${ctx.client.name},`);
  lines.push('');
  lines.push('This letter confirms the terms of our engagement in respect of the above-referenced matter.');
  lines.push('');
  lines.push('1. SCOPE OF ENGAGEMENT');
  lines.push(interpolate(scope, ctx).trim());
  lines.push('');
  lines.push('2. FEES AND PAYMENT TERMS');
  lines.push(interpolate(fee, ctx).trim());
  if (retainerInr !== null && retainerInr !== undefined) {
    lines.push('');
    lines.push(`Retainer: ₹${formatInr(retainerInr)}`);
  }
  lines.push('');
  lines.push('3. CONFLICTS AND CONFIDENTIALITY');
  lines.push('We confirm that no conflict of interest is presently known to us in respect of this engagement. All communications and documents exchanged in the course of this engagement will be treated as confidential save where disclosure is required by law or by the rules of the court.');
  lines.push('');
  lines.push('4. ACCEPTANCE');
  lines.push('Please countersign a copy of this letter at the space provided below to confirm your acceptance of these terms. The engagement takes effect upon receipt of the signed counterpart and clearance of the retainer noted above.');
  lines.push('');
  lines.push('Yours faithfully,');
  lines.push('');
  lines.push(`for ${ctx.firm.name}`);
  lines.push('');
  lines.push('________________________');
  lines.push('Authorised signatory');
  lines.push('');
  lines.push(`Accepted by ${ctx.client.name}:`);
  lines.push('');
  lines.push('________________________   Date: ____________');
  return lines.join('\n');
}

// ---------- Public service --------------------------------------------------

interface CreateArgs extends CreateEngagementTemplateRequest {
  firmId: string;
  createdBy: string | null;
}

interface FirmRow { id: string; name: string }
interface ClientRow { id: string; name: string; email: string | null }

export const engagementService = {
  async list(firmId: string | null): Promise<ListEngagementTemplatesResponse> {
    if (!firmId) return { items: [], groups: [] };
    const sql = db();
    let items: EngagementTemplate[];
    if (sql) {
      const rows = await sql<TemplateRow[]>`
        select id, firm_id, matter_type, scope_clauses, fee_clauses, retainer_inr,
               notes, is_default, created_at, updated_at, created_by
        from engagement_templates
        where firm_id = ${firmId}::uuid
        order by matter_type asc, is_default desc, updated_at desc
      `;
      items = rows.map(rowToTemplate);
    } else {
      items = Array.from(memBucket(firmId).values())
        .sort((a, b) => {
          if (a.matterType !== b.matterType) return a.matterType.localeCompare(b.matterType);
          if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
          return b.updatedAt.localeCompare(a.updatedAt);
        });
    }
    return { items, groups: groupByMatterType(items) };
  },

  async get(id: string, firmId: string | null): Promise<EngagementTemplate> {
    if (!firmId) throw new NotFoundError('Engagement template not found');
    const sql = db();
    if (sql) {
      const rows = await sql<TemplateRow[]>`
        select id, firm_id, matter_type, scope_clauses, fee_clauses, retainer_inr,
               notes, is_default, created_at, updated_at, created_by
        from engagement_templates
        where id = ${id}::uuid and firm_id = ${firmId}::uuid
        limit 1
      `;
      const row = rows[0];
      if (!row) throw new NotFoundError('Engagement template not found');
      return rowToTemplate(row);
    }
    const t = memBucket(firmId).get(id);
    if (!t) throw new NotFoundError('Engagement template not found');
    return t;
  },

  async create(input: CreateArgs): Promise<EngagementTemplate> {
    if (!input.firmId) {
      throw new UnprocessableEntityError('No firm attached — cannot create engagement template');
    }
    const sql = db();
    if (sql) {
      // If the new row claims default-ness, demote any sibling first. Both
      // statements go through `sql.begin` so a concurrent toggle can't slip
      // between them and trip the partial unique index.
      const row = await sql.begin(async (tx) => {
        if (input.isDefault) {
          await tx`
            update engagement_templates set is_default = false, updated_at = now()
            where firm_id = ${input.firmId}::uuid
              and matter_type = ${input.matterType}
              and is_default = true
          `;
        }
        const inserted = await tx<TemplateRow[]>`
          insert into engagement_templates
            (firm_id, matter_type, scope_clauses, fee_clauses, retainer_inr,
             notes, is_default, created_by)
          values
            (${input.firmId}::uuid, ${input.matterType}, ${input.scopeClauses},
             ${input.feeClauses}, ${input.retainerInr ?? null},
             ${input.notes ?? null}, ${input.isDefault ?? false},
             ${input.createdBy ?? null})
          returning id, firm_id, matter_type, scope_clauses, fee_clauses, retainer_inr,
                    notes, is_default, created_at, updated_at, created_by
        `;
        return inserted[0]!;
      });
      return rowToTemplate(row);
    }
    // Memory fallback — re-enforce the default invariant manually.
    const bucket = memBucket(input.firmId);
    if (input.isDefault) {
      for (const [k, v] of bucket) {
        if (v.matterType === input.matterType && v.isDefault) {
          bucket.set(k, { ...v, isDefault: false, updatedAt: new Date().toISOString() });
        }
      }
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const t: EngagementTemplate = {
      id,
      firmId: input.firmId,
      matterType: input.matterType,
      scopeClauses: input.scopeClauses,
      feeClauses: input.feeClauses,
      retainerInr: input.retainerInr ?? null,
      notes: input.notes ?? null,
      isDefault: input.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy ?? null,
    };
    bucket.set(id, t);
    return t;
  },

  async update(
    id: string,
    patch: UpdateEngagementTemplateRequest,
    firmId: string | null,
  ): Promise<EngagementTemplate> {
    if (!firmId) throw new NotFoundError('Engagement template not found');
    const sql = db();
    if (sql) {
      const row = await sql.begin(async (tx) => {
        // Look up the row first so we know the matter type when demoting a
        // sibling default. (The patch may or may not include matterType.)
        const cur = await tx<TemplateRow[]>`
          select id, firm_id, matter_type, scope_clauses, fee_clauses, retainer_inr,
                 notes, is_default, created_at, updated_at, created_by
          from engagement_templates
          where id = ${id}::uuid and firm_id = ${firmId}::uuid
          limit 1
        `;
        const existing = cur[0];
        if (!existing) return null;

        const nextMatterType = patch.matterType ?? existing.matter_type;
        if (patch.isDefault) {
          await tx`
            update engagement_templates
            set is_default = false, updated_at = now()
            where firm_id = ${firmId}::uuid
              and matter_type = ${nextMatterType}
              and is_default = true
              and id <> ${id}::uuid
          `;
        }

        const updated = await tx<TemplateRow[]>`
          update engagement_templates set
            matter_type   = coalesce(${patch.matterType ?? null}, matter_type),
            scope_clauses = coalesce(${patch.scopeClauses ?? null}, scope_clauses),
            fee_clauses   = coalesce(${patch.feeClauses ?? null}, fee_clauses),
            retainer_inr  = ${patch.retainerInr === undefined ? existing.retainer_inr : patch.retainerInr},
            notes         = ${patch.notes === undefined ? existing.notes : patch.notes},
            is_default    = coalesce(${patch.isDefault ?? null}, is_default),
            updated_at    = now()
          where id = ${id}::uuid and firm_id = ${firmId}::uuid
          returning id, firm_id, matter_type, scope_clauses, fee_clauses, retainer_inr,
                    notes, is_default, created_at, updated_at, created_by
        `;
        return updated[0] ?? null;
      });
      if (!row) throw new NotFoundError('Engagement template not found');
      return rowToTemplate(row);
    }
    // Memory fallback.
    const bucket = memBucket(firmId);
    const cur = bucket.get(id);
    if (!cur) throw new NotFoundError('Engagement template not found');
    const nextMatterType = patch.matterType ?? cur.matterType;
    if (patch.isDefault) {
      for (const [k, v] of bucket) {
        if (k !== id && v.matterType === nextMatterType && v.isDefault) {
          bucket.set(k, { ...v, isDefault: false, updatedAt: new Date().toISOString() });
        }
      }
    }
    const next: EngagementTemplate = {
      ...cur,
      matterType: nextMatterType,
      scopeClauses: patch.scopeClauses ?? cur.scopeClauses,
      feeClauses: patch.feeClauses ?? cur.feeClauses,
      retainerInr: patch.retainerInr === undefined ? cur.retainerInr : (patch.retainerInr ?? null),
      notes: patch.notes === undefined ? cur.notes : (patch.notes ?? null),
      isDefault: patch.isDefault ?? cur.isDefault,
      updatedAt: new Date().toISOString(),
    };
    bucket.set(id, next);
    return next;
  },

  async remove(id: string, firmId: string | null): Promise<void> {
    if (!firmId) throw new NotFoundError('Engagement template not found');
    const sql = db();
    if (sql) {
      const rows = await sql<{ id: string }[]>`
        delete from engagement_templates
        where id = ${id}::uuid and firm_id = ${firmId}::uuid
        returning id
      `;
      if (rows.length === 0) throw new NotFoundError('Engagement template not found');
      return;
    }
    const ok = memBucket(firmId).delete(id);
    if (!ok) throw new NotFoundError('Engagement template not found');
  },

  /**
   * Resolve a template + case context, interpolate placeholders, and return
   * the rendered letter as plain text. Selection rules:
   *
   *   - `templateId` provided → use that template; 404 if cross-tenant or
   *      gone. We do NOT enforce that its `matterType` matches the case;
   *      authors sometimes pick an adjacent template intentionally.
   *   - no `templateId` → look up the firm's default for the case's matter
   *      type. 404 with a helpful message when no default exists yet.
   */
  async generate(args: {
    firmId: string | null;
    caseId: string;
    templateId?: string;
  }): Promise<GenerateEngagementLetterResponse> {
    if (!args.firmId) throw new NotFoundError('Case not found');

    // 1. Resolve the case via the canonical service so tenant scoping is
    //    handled exactly once.
    const matter = await casesService.get(args.caseId, args.firmId);
    if (!matter) throw new NotFoundError('Case not found');

    // 2. Resolve the template — explicit pick wins, else firm default for
    //    the matter type.
    let template: EngagementTemplate | null = null;
    if (args.templateId) {
      template = await this.get(args.templateId, args.firmId);
    } else {
      const sql = db();
      if (sql) {
        const rows = await sql<TemplateRow[]>`
          select id, firm_id, matter_type, scope_clauses, fee_clauses, retainer_inr,
                 notes, is_default, created_at, updated_at, created_by
          from engagement_templates
          where firm_id = ${args.firmId}::uuid
            and matter_type = ${matter.type}
            and is_default = true
          limit 1
        `;
        template = rows[0] ? rowToTemplate(rows[0]) : null;
      } else {
        for (const t of memBucket(args.firmId).values()) {
          if (t.matterType === matter.type && t.isDefault) { template = t; break; }
        }
      }
      if (!template) {
        throw new NotFoundError(
          `No default engagement template configured for matter type "${matter.type}"`,
        );
      }
    }

    // 3. Resolve firm + client name. firms / clients tables don't yet carry
    //    an address column — we degrade gracefully and leave that line out
    //    of the header when blank.
    const sql = db();
    let firmName = 'Your firm';
    let clientName = matter.client;
    if (sql) {
      const [firmRow] = await sql<FirmRow[]>`
        select id, name from firms where id = ${args.firmId}::uuid limit 1
      `;
      if (firmRow?.name) firmName = firmRow.name;
      // Cases store client as a freeform string. Try to resolve a matching
      // client row in the same firm to pull the canonical display name.
      const [clientRow] = await sql<ClientRow[]>`
        select id, name, email from clients
        where firm_id = ${args.firmId}::uuid and lower(name) = lower(${matter.client})
        limit 1
      `;
      if (clientRow?.name) clientName = clientRow.name;
    }

    const ctx: PlaceholderContext = {
      firm: { name: firmName, address: '' },
      client: { name: clientName, address: '' },
      matter: {
        title: matter.title,
        cnr: matter.cnr,
        court: matter.court,
        client: matter.client,
      },
      retainer: { inr: formatInr(template.retainerInr) },
      date: { today: today() },
    };

    const text = buildLetter({
      ctx,
      scope: template.scopeClauses,
      fee: template.feeClauses,
      retainerInr: template.retainerInr,
    });

    return {
      text,
      generatedAt: new Date().toISOString(),
      templateId: template.id,
      matterType: template.matterType,
    };
  },
};
