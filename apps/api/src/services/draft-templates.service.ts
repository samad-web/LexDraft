// draft-templates.service — the advocate's own reusable document FORMATS.
// A format is plain text (their letterhead/clauses/[placeholders]); the drafting
// agent fills it instead of the default skeleton when one is selected. All
// operations are firm-scoped: a row is keyed by (id, firm_id) so cross-tenant
// access is impossible at the DB layer.
import { db } from '../db/client';

export interface DraftFormatTemplate {
  id: string;
  name: string;
  docType: string;
  body: string;
  source: 'paste' | 'upload';
  createdAt: string;
}

interface Row {
  id: string;
  name: string;
  doc_type: string;
  body: string;
  source: string;
  created_at: string | Date;
}

function fromRow(r: Row): DraftFormatTemplate {
  const created = r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at;
  return {
    id: r.id,
    name: r.name,
    docType: r.doc_type ?? '',
    body: r.body,
    source: r.source === 'upload' ? 'upload' : 'paste',
    createdAt: created,
  };
}

const COLS = 'id, name, doc_type, body, source, created_at';
const MAX_BODY = 60_000;

export interface CreateDraftTemplateInput {
  name: string;
  docType?: string;
  body: string;
  source?: 'paste' | 'upload';
}

export const draftTemplatesService = {
  async list(firmId: string | null): Promise<DraftFormatTemplate[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select ${sql.unsafe(COLS)}
      from draft_format_templates
      where firm_id = ${firmId}::uuid
      order by created_at desc
    `;
    return rows.map(fromRow);
  },

  async get(id: string, firmId: string | null): Promise<DraftFormatTemplate | null> {
    if (!firmId) return null;
    const sql = db();
    if (!sql) return null;
    const rows = await sql<Row[]>`
      select ${sql.unsafe(COLS)}
      from draft_format_templates
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async create(
    input: CreateDraftTemplateInput,
    ctx: { firmId: string | null; userId: string },
  ): Promise<DraftFormatTemplate> {
    if (!ctx.firmId) {
      throw Object.assign(new Error('No firm attached — cannot save template'), { status: 422 });
    }
    const body = (input.body ?? '').slice(0, MAX_BODY).trim();
    if (!body) throw Object.assign(new Error('Template body is empty'), { status: 422 });
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Row[]>`
      insert into draft_format_templates (firm_id, name, doc_type, body, source, created_by)
      values (${ctx.firmId}::uuid, ${input.name.trim() || 'Untitled format'},
              ${input.docType?.trim() ?? ''}, ${body}, ${input.source ?? 'paste'}, ${ctx.userId}::uuid)
      returning ${sql.unsafe(COLS)}
    `;
    return fromRow(rows[0]!);
  },

  async update(
    id: string,
    patch: Partial<CreateDraftTemplateInput>,
    firmId: string | null,
  ): Promise<DraftFormatTemplate | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    if (!sql) return undefined;
    const body = patch.body !== undefined ? patch.body.slice(0, MAX_BODY) : null;
    const rows = await sql<Row[]>`
      update draft_format_templates set
        name     = coalesce(${patch.name ?? null}::text, name),
        doc_type = coalesce(${patch.docType ?? null}::text, doc_type),
        body     = coalesce(${body}::text, body)
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning ${sql.unsafe(COLS)}
    `;
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  async remove(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (!sql) return false;
    const rows = await sql<{ id: string }[]>`
      delete from draft_format_templates
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning id
    `;
    return rows.length > 0;
  },
};
