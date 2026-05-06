import type { SavedDraft, SaveDraftRequest } from '@lexdraft/types';
import { db } from '../db/client';

interface Row {
  id: string;
  title: string;
  doc_type: string;
  language: SavedDraft['language'];
  tone: string;
  fields_json: Record<string, string> | string;
  edited_html: string;
  body_text: string;
  draft_date: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  return v;
}
function toDateOnly(v: string | Date | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function fromRow(r: Row): SavedDraft {
  const fields =
    typeof r.fields_json === 'string'
      ? (JSON.parse(r.fields_json) as Record<string, string>)
      : (r.fields_json ?? {});
  return {
    id: r.id,
    title: r.title,
    docType: r.doc_type,
    language: r.language,
    tone: r.tone,
    fields,
    editedHtml: r.edited_html,
    bodyText: r.body_text,
    draftDate: toDateOnly(r.draft_date),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/** In-memory fallback used when DATABASE_URL is blank (dev without Postgres). */
const memory = new Map<string, SavedDraft>();
let memCounter = 0;

interface UserCtx {
  userId: string;
}

function deriveTitle(req: SaveDraftRequest): string {
  if (req.title && req.title.trim()) return req.title.trim();
  const first = req.bodyText.split('\n').find((l) => l.trim());
  if (first && first.length <= 80) return first.trim();
  if (first) return first.slice(0, 77).trim() + '…';
  return req.docType;
}

export const draftsService = {
  async list(ctx: UserCtx): Promise<SavedDraft[]> {
    const sql = db();
    if (!sql) {
      return Array.from(memory.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    const rows = await sql<Row[]>`
      select id, title, doc_type, language, tone, fields_json, edited_html,
             body_text, draft_date, created_at, updated_at
      from drafts
      where user_id = ${ctx.userId}
      order by updated_at desc
      limit 200
    `;
    return rows.map(fromRow);
  },

  async get(id: string, ctx: UserCtx): Promise<SavedDraft | null> {
    const sql = db();
    if (!sql) return memory.get(id) ?? null;
    const rows = await sql<Row[]>`
      select id, title, doc_type, language, tone, fields_json, edited_html,
             body_text, draft_date, created_at, updated_at
      from drafts
      where id = ${id} and user_id = ${ctx.userId}
      limit 1
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async create(req: SaveDraftRequest, ctx: UserCtx): Promise<SavedDraft> {
    const title = deriveTitle(req);
    const sql = db();
    if (!sql) {
      memCounter += 1;
      const now = new Date().toISOString();
      const draft: SavedDraft = {
        id: `mem-${memCounter}`,
        title,
        docType: req.docType,
        language: req.language,
        tone: req.tone,
        fields: req.fields,
        editedHtml: req.editedHtml,
        bodyText: req.bodyText,
        draftDate: req.draftDate ?? null,
        createdAt: now,
        updatedAt: now,
      };
      memory.set(draft.id, draft);
      return draft;
    }
    const rows = await sql<Row[]>`
      insert into drafts
        (user_id, title, doc_type, language, tone, fields_json, edited_html, body_text, draft_date)
      values
        (${ctx.userId}, ${title}, ${req.docType}, ${req.language}, ${req.tone},
         ${sql.json(req.fields)}, ${req.editedHtml}, ${req.bodyText},
         ${req.draftDate ?? null})
      returning id, title, doc_type, language, tone, fields_json, edited_html,
                body_text, draft_date, created_at, updated_at
    `;
    return fromRow(rows[0]!);
  },

  async update(id: string, req: SaveDraftRequest, ctx: UserCtx): Promise<SavedDraft | null> {
    const title = deriveTitle(req);
    const sql = db();
    if (!sql) {
      const cur = memory.get(id);
      if (!cur) return null;
      const updated: SavedDraft = {
        ...cur,
        title,
        docType: req.docType,
        language: req.language,
        tone: req.tone,
        fields: req.fields,
        editedHtml: req.editedHtml,
        bodyText: req.bodyText,
        draftDate: req.draftDate ?? null,
        updatedAt: new Date().toISOString(),
      };
      memory.set(id, updated);
      return updated;
    }
    const rows = await sql<Row[]>`
      update drafts set
        title = ${title},
        doc_type = ${req.docType},
        language = ${req.language},
        tone = ${req.tone},
        fields_json = ${sql.json(req.fields)},
        edited_html = ${req.editedHtml},
        body_text = ${req.bodyText},
        draft_date = ${req.draftDate ?? null}
      where id = ${id} and user_id = ${ctx.userId}
      returning id, title, doc_type, language, tone, fields_json, edited_html,
                body_text, draft_date, created_at, updated_at
    `;
    return rows[0] ? fromRow(rows[0]) : null;
  },

  async remove(id: string, ctx: UserCtx): Promise<boolean> {
    const sql = db();
    if (!sql) return memory.delete(id);
    const rows = await sql<{ id: string }[]>`
      delete from drafts where id = ${id} and user_id = ${ctx.userId} returning id
    `;
    return rows.length > 0;
  },
};
