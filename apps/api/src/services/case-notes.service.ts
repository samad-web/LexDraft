import type {
  CaseNote,
  CaseNoteSource,
  CaseNoteVisibility,
  CaseNoteExtractionStatus,
} from '@lexdraft/types';
import { db } from '../db/client';
import { storage } from './storage.service';
import { extractText } from '../lib/text-extraction';
import { logger } from '../logger';

// =============================================================================
// case-notes.service - matter-scoped notes used (a) as a working memory for
// advocates and (b) as optional context for AI drafting.
//
// Visibility model
//   shared   - any firm member with matter.notes.view sees the note
//   private  - only the author sees the note; firm_id is still set so the
//              row is firm-scoped at the storage layer
//
// Write authority
//   author_user_id is the only field that may edit / delete a note. Firm
//   admins cannot override - the value of the visibility model would be
//   undermined otherwise.
//
// Source
//   typed    - body is the user's typed text
//   uploaded - body is text-extracted from a stored blob (storage_key)
// =============================================================================

interface NoteRow {
  id: string;
  case_id: string;
  author_user_id: string;
  author_name: string | null;
  visibility: CaseNoteVisibility;
  source: CaseNoteSource;
  title: string | null;
  body: string;
  storage_key: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | string | null;
  extraction_status: CaseNoteExtractionStatus | null;
  extraction_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function iso(v: Date | string | null | undefined): string {
  if (!v) return '';
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function rowToNote(r: NoteRow): CaseNote {
  const note: CaseNote = {
    id: r.id,
    caseId: r.case_id,
    authorId: r.author_user_id,
    authorName: r.author_name ?? '',
    visibility: r.visibility,
    source: r.source,
    body: r.body,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
  if (r.title) note.title = r.title;
  if (r.source === 'uploaded' && r.storage_key) {
    note.file = {
      name: r.file_name ?? '',
      mime: r.file_mime ?? '',
      size: r.file_size != null ? Number(r.file_size) : 0,
      storageKey: r.storage_key,
      extractionStatus: r.extraction_status ?? 'failed',
      ...(r.extraction_error ? { extractionError: r.extraction_error } : {}),
    };
  }
  return note;
}

const SELECT_WITH_AUTHOR = `
  select n.id, n.case_id, n.author_user_id, u.name as author_name,
         n.visibility, n.source, n.title, n.body,
         n.storage_key, n.file_name, n.file_mime, n.file_size,
         n.extraction_status, n.extraction_error,
         n.created_at, n.updated_at
  from case_notes n
  left join users u on u.id = n.author_user_id
`;

export interface NoteAccessCtx {
  firmId: string;
  viewerUserId: string;
}

export interface CreateTypedNoteInput {
  caseId: string;
  title?: string | undefined;
  body: string;
  visibility?: CaseNoteVisibility | undefined;
}

export interface FinalizeUploadedNoteInput {
  caseId: string;
  title?: string | undefined;
  visibility?: CaseNoteVisibility | undefined;
  storageKey: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
}

export interface UpdateNoteInput {
  title?: string | undefined;
  body?: string | undefined;
  visibility?: CaseNoteVisibility | undefined;
}

async function caseBelongsToFirm(caseId: string, firmId: string): Promise<boolean> {
  const sql = db();
  if (!sql) throw new Error('case-notes service requires DATABASE_URL');
  const rows = await sql<Array<{ id: string }>>`
    select id from cases where id::text = ${caseId} and firm_id = ${firmId}::uuid limit 1
  `;
  return rows.length > 0;
}

export const caseNotesService = {
  /**
   * List notes the viewer is allowed to see on this case:
   *   - All shared notes (firm-scoped via firm_id)
   *   - Their own private notes
   * Ordered newest-first.
   */
  async list(caseId: string, ctx: NoteAccessCtx): Promise<CaseNote[]> {
    const sql = db();
    if (!sql) return [];
    if (!(await caseBelongsToFirm(caseId, ctx.firmId))) return [];

    const rows = await sql<NoteRow[]>`
      ${sql.unsafe(SELECT_WITH_AUTHOR)}
      where n.firm_id = ${ctx.firmId}::uuid
        and n.case_id = ${caseId}::uuid
        and (
          n.visibility = 'shared'
          or n.author_user_id = ${ctx.viewerUserId}::uuid
        )
      order by n.created_at desc
    `;
    return rows.map(rowToNote);
  },

  /**
   * Fetch a single note. Returns undefined when the note doesn't exist or
   * the viewer isn't allowed to see it (private notes by other authors).
   * Callers should return 404 for both - we don't disclose existence.
   */
  async get(noteId: string, ctx: NoteAccessCtx): Promise<CaseNote | undefined> {
    const sql = db();
    if (!sql) return undefined;
    const rows = await sql<NoteRow[]>`
      ${sql.unsafe(SELECT_WITH_AUTHOR)}
      where n.id::text = ${noteId}
        and n.firm_id = ${ctx.firmId}::uuid
        and (
          n.visibility = 'shared'
          or n.author_user_id = ${ctx.viewerUserId}::uuid
        )
      limit 1
    `;
    return rows[0] ? rowToNote(rows[0]) : undefined;
  },

  /**
   * Bulk fetch by ids - used by the drafting integration when a request
   * specifies an explicit noteIds whitelist. Access rules are identical to
   * `list` (shared OR author === viewer), so a request for someone else's
   * private note id silently drops it from the result.
   */
  async getByIds(noteIds: string[], caseId: string, ctx: NoteAccessCtx): Promise<CaseNote[]> {
    if (noteIds.length === 0) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<NoteRow[]>`
      ${sql.unsafe(SELECT_WITH_AUTHOR)}
      where n.firm_id = ${ctx.firmId}::uuid
        and n.case_id = ${caseId}::uuid
        and n.id::text = any(${noteIds}::text[])
        and (
          n.visibility = 'shared'
          or n.author_user_id = ${ctx.viewerUserId}::uuid
        )
      order by n.created_at desc
    `;
    return rows.map(rowToNote);
  },

  async createTyped(
    input: CreateTypedNoteInput,
    ctx: NoteAccessCtx,
  ): Promise<CaseNote | undefined> {
    const sql = db();
    if (!sql) throw new Error('case-notes service requires DATABASE_URL');
    if (!(await caseBelongsToFirm(input.caseId, ctx.firmId))) return undefined;

    const visibility = input.visibility ?? 'shared';
    const rows = await sql<Array<{ id: string }>>`
      insert into case_notes (
        firm_id, case_id, author_user_id, visibility, source, title, body
      ) values (
        ${ctx.firmId}::uuid, ${input.caseId}::uuid, ${ctx.viewerUserId}::uuid,
        ${visibility}::case_note_visibility, 'typed'::case_note_source,
        ${input.title ?? null}, ${input.body}
      )
      returning id
    `;
    return this.get(rows[0]!.id, ctx);
  },

  /**
   * Create an uploaded note. The client has already PUT the file to
   * storage; we record metadata, fetch the bytes back, run extraction,
   * and store the extracted text on the row. Extraction failure is NOT
   * fatal - the note persists with extraction_status='failed' so the
   * advocate can still see the file, just without AI-readable text.
   */
  async finalizeUpload(
    input: FinalizeUploadedNoteInput,
    ctx: NoteAccessCtx,
  ): Promise<CaseNote | undefined> {
    const sql = db();
    if (!sql) throw new Error('case-notes service requires DATABASE_URL');
    if (!(await caseBelongsToFirm(input.caseId, ctx.firmId))) return undefined;

    const visibility = input.visibility ?? 'shared';

    // Run extraction BEFORE the insert so we can write the body and status
    // atomically. Failed extraction yields an empty body + status='failed'.
    let body = '';
    let extractionStatus: CaseNoteExtractionStatus = 'pending';
    let extractionError: string | null = null;
    try {
      const obj = await storage().getObject(input.storageKey);
      if (!obj) {
        extractionStatus = 'failed';
        extractionError = 'Uploaded file could not be read from storage';
      } else {
        const result = await extractText({
          body: obj.body,
          mime: input.fileMime,
          fileName: input.fileName,
        });
        if (result.ok) {
          body = result.text;
          extractionStatus = 'ok';
        } else {
          extractionStatus = 'failed';
          extractionError = result.error;
        }
      }
    } catch (err) {
      logger.warn({ err, storageKey: input.storageKey }, 'note extraction wrapper failed');
      extractionStatus = 'failed';
      extractionError = err instanceof Error ? err.message : 'Extraction failed';
    }

    const rows = await sql<Array<{ id: string }>>`
      insert into case_notes (
        firm_id, case_id, author_user_id, visibility, source, title, body,
        storage_key, file_name, file_mime, file_size,
        extraction_status, extraction_error
      ) values (
        ${ctx.firmId}::uuid, ${input.caseId}::uuid, ${ctx.viewerUserId}::uuid,
        ${visibility}::case_note_visibility, 'uploaded'::case_note_source,
        ${input.title ?? null}, ${body},
        ${input.storageKey}, ${input.fileName}, ${input.fileMime}, ${input.fileSize},
        ${extractionStatus}::case_note_extraction_status, ${extractionError}
      )
      returning id
    `;
    return this.get(rows[0]!.id, ctx);
  },

  /**
   * Update author-owned fields. The note's source/file metadata is
   * immutable - to "change" an uploaded note's text the user deletes
   * and re-uploads.
   *
   * Returns undefined when the note doesn't exist OR the viewer isn't
   * the author. Callers should return 404 (uniform with `get`) so
   * a permission failure doesn't reveal which note exists.
   */
  async update(
    noteId: string,
    patch: UpdateNoteInput,
    ctx: NoteAccessCtx,
  ): Promise<CaseNote | undefined> {
    const sql = db();
    if (!sql) throw new Error('case-notes service requires DATABASE_URL');
    const rows = await sql<Array<{ id: string }>>`
      update case_notes set
        title      = coalesce(${patch.title ?? null}, title),
        body       = coalesce(${patch.body ?? null}, body),
        visibility = coalesce(${(patch.visibility ?? null) as string | null}::case_note_visibility, visibility)
      where id::text = ${noteId}
        and firm_id = ${ctx.firmId}::uuid
        and author_user_id = ${ctx.viewerUserId}::uuid
      returning id
    `;
    return rows[0] ? this.get(rows[0].id, ctx) : undefined;
  },

  async delete(noteId: string, ctx: NoteAccessCtx): Promise<boolean> {
    const sql = db();
    if (!sql) throw new Error('case-notes service requires DATABASE_URL');
    // Read storage_key first so we can clean up the blob after the row is
    // gone. We only delete the row if the viewer is the author.
    const rows = await sql<Array<{ storage_key: string | null }>>`
      delete from case_notes
      where id::text = ${noteId}
        and firm_id = ${ctx.firmId}::uuid
        and author_user_id = ${ctx.viewerUserId}::uuid
      returning storage_key
    `;
    const storageKey = rows[0]?.storage_key;
    if (storageKey) {
      // Storage cleanup is best-effort; a failure here leaves orphan bytes
      // but doesn't undo the row deletion. Logged so an operator can sweep.
      try {
        await storage().delete(storageKey);
      } catch (err) {
        logger.warn({ err, storageKey }, 'note storage cleanup failed');
      }
    }
    return rows.length > 0;
  },

  /**
   * Drafting-flow helper: returns the body text of accessible notes for the
   * case, ready to fold into the LLM user message. Honors the same access
   * rules as `list` (shared + own-private) and the optional id whitelist.
   * Returns an empty array when the case has no readable notes - caller
   * decides whether to render the banner.
   */
  async contextForDrafting(
    caseId: string,
    ctx: NoteAccessCtx,
    opts: { noteIds?: string[] } = {},
  ): Promise<Array<{ id: string; title: string; body: string }>> {
    const notes = opts.noteIds && opts.noteIds.length > 0
      ? await this.getByIds(opts.noteIds, caseId, ctx)
      : await this.list(caseId, ctx);
    return notes
      .filter((n) => n.body.trim().length > 0)
      .map((n) => ({
        id: n.id,
        title: n.title ?? '(untitled)',
        body: n.body,
      }));
  },
};
