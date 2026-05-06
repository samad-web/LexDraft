import type {
  AdminCreateTemplateRequest,
  AdminUpdateTemplateRequest,
  DocumentTemplate,
  TemplateScope,
} from '@lexdraft/types';
import { db } from '../db/client';
import { auditService } from './audit.service';

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  scope: TemplateScope;
  firm_id: string | null;
  body: string;
  updated_at: Date;
}

function rowToTemplate(r: TemplateRow): DocumentTemplate {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    scope: r.scope,
    firmId: r.firm_id,
    body: r.body,
    updatedAt: r.updated_at.toISOString(),
  };
}

export const templatesService = {
  async list(scope?: TemplateScope, firmId?: string): Promise<DocumentTemplate[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<TemplateRow[]>`
      select id, name, slug, scope, firm_id, body, updated_at
      from document_templates
      where (${scope ?? null}::text is null or scope = ${scope ?? null}::template_scope)
        and (${firmId ?? null}::uuid is null or firm_id = ${firmId ?? null}::uuid)
      order by updated_at desc
    `;
    return rows.map(rowToTemplate);
  },

  async get(id: string): Promise<DocumentTemplate | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<TemplateRow[]>`
      select id, name, slug, scope, firm_id, body, updated_at
      from document_templates where id = ${id}::uuid limit 1
    `;
    return rows[0] ? rowToTemplate(rows[0]) : null;
  },

  async create(input: AdminCreateTemplateRequest, actor: { id: string; email: string }): Promise<DocumentTemplate> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    if (input.scope === 'firm' && !input.firmId) {
      throw Object.assign(new Error('firmId required for firm-scoped templates'), { status: 400 });
    }
    if (input.scope === 'platform' && input.firmId) {
      throw Object.assign(new Error('firmId must be null for platform templates'), { status: 400 });
    }
    const rows = await sql<TemplateRow[]>`
      insert into document_templates (name, slug, scope, firm_id, body)
      values (${input.name}, ${input.slug}, ${input.scope}::template_scope,
              ${input.firmId ?? null}::uuid, ${input.body})
      returning id, name, slug, scope, firm_id, body, updated_at
    `;
    const created = rowToTemplate(rows[0]!);
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'template.create', targetType: 'template', targetId: created.id,
      payload: { name: created.name, slug: created.slug, scope: created.scope },
    });
    return created;
  },

  async update(id: string, patch: AdminUpdateTemplateRequest, actor: { id: string; email: string }): Promise<DocumentTemplate> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<TemplateRow[]>`
      update document_templates set
        name = coalesce(${patch.name ?? null}, name),
        body = coalesce(${patch.body ?? null}, body),
        updated_at = now()
      where id = ${id}::uuid
      returning id, name, slug, scope, firm_id, body, updated_at
    `;
    const r = rows[0];
    if (!r) throw Object.assign(new Error('Template not found'), { status: 404 });
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'template.update', targetType: 'template', targetId: id, payload: patch,
    });
    return rowToTemplate(r);
  },

  async remove(id: string, actor: { id: string; email: string }): Promise<void> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    await sql`delete from document_templates where id = ${id}::uuid`;
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'template.delete', targetType: 'template', targetId: id, payload: null,
    });
  },
};
