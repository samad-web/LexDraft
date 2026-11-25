// import-edit-document (build-docs/features/import-edit-document.md).
//
// An advocate's OWN file (drafted outside DifAi) opened in the Draft editor, for a
// case, several cases (separate copies — owner's Option A) or no case. No model
// call anywhere here: reading is the engine (.docx), LibreOffice (.doc -> .docx)
// or pdf-parse/OCR (PDF, text only). The upload is kept untouched as
// "<name> (original)"; the edited Word copy is one Documents row per draft,
// replaced on every save.
import type { DocumentRecord, SavedDraft } from '@lexdraft/types';
import { db } from '../db/client';
import { extractText } from '../lib/text-extraction';
import { convertDocToDocx } from './document-render.service';
import { documentsService } from './documents.service';
import { draftsService } from './drafts.service';
import { engineClient, type EngineBlock } from './engine-client.service';
import { storage } from './storage.service';

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_PDF_LINES = 5000;
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME = { docx: DOCX_MIME, doc: 'application/msword', pdf: 'application/pdf' } as const;
export const NO_CASE = '-'; // the Documents list's existing "unfiled" label

export class ImportError extends Error {
  constructor(public code: string, public status = 422) {
    super(code);
  }
}

type Kind = keyof typeof MIME;
interface Ctx { userId: string; firmId: string | null }

export interface OpenResult {
  blocks: EngineBlock[];
  /** The .docx edits are written back into; null for a PDF (text only). */
  docxBase64: string | null;
  kind: 'docx' | 'pdf';
  warnings: string[];
  sourceDocumentId: string;
  title: string;
  docType: string;
  matter: string;
}

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // a zip, as every .docx is
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** File type from its bytes (the name only tells .doc from an encrypted .docx). */
export function detectKind(buf: Buffer, fileName: string): Kind {
  if (buf.subarray(0, 4).equals(ZIP)) return 'docx';
  if (buf.subarray(0, 8).equals(OLE)) {
    if (/\.doc$/i.test(fileName)) return 'doc';
    throw new ImportError('encrypted_or_doc'); // a password-protected .docx is OLE too
  }
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  throw new ImportError('unsupported');
}

/** PDF text as editor lines: paragraphs when the text has blank lines between
 *  them, else one line per printed line. */
export function pdfLines(text: string): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
  return paras.length >= 3 ? paras : text.split('\n').map((l) => l.trim()).filter(Boolean);
}

async function read(buf: Buffer, kind: Kind, fileName: string): Promise<Omit<OpenResult, 'sourceDocumentId' | 'title' | 'docType' | 'matter'>> {
  if (kind === 'pdf') {
    const r = await extractText({ body: buf, mime: MIME.pdf, fileName, maxChars: 2_000_000 });
    const lines = r.ok ? pdfLines(r.text) : [];
    if (!lines.length) throw new ImportError('pdf_unreadable');
    if (lines.length > MAX_PDF_LINES) throw new ImportError('too_long');
    // The text laid out as a house-style Word file, so the download is a real
    // .docx too. Text only either way: the PDF's own layout can't be kept.
    const composed = await engineClient.composeDocx(lines).catch(() => null);
    return composed
      ? { blocks: composed.blocks, docxBase64: composed.docxBase64, kind: 'pdf', warnings: ['pdf_text_only'] }
      : { blocks: lines.map((text, i) => ({ key: `p${i}`, text })), docxBase64: null, kind: 'pdf', warnings: ['pdf_text_only'] };
  }
  const b64 = (await asDocx(buf, kind)).toString('base64');
  const out = await engineClient.readDocx(b64);
  if ('error' in out) throw new ImportError(out.error);
  return { blocks: out.blocks, docxBase64: b64, kind: 'docx', warnings: out.warnings };
}

async function asDocx(buf: Buffer, kind: 'docx' | 'doc'): Promise<Buffer> {
  if (kind === 'docx') return buf;
  try {
    return await convertDocToDocx(buf);
  } catch {
    throw new ImportError('convert_failed');
  }
}

/** The .docx an imported draft's edits go back into: its original (a .doc
 *  converted), or null when the original is a PDF or was deleted. */
async function sourceDocx(documentId: string | null | undefined, firmId: string | null): Promise<Buffer | null> {
  if (!documentId) return null;
  const src = await fileOf(documentId, firmId).catch(() => null);
  if (!src) return null;
  const kind = detectKind(src.body, src.rec.fileName ?? src.rec.name);
  return kind === 'pdf' ? null : asDocx(src.body, kind).catch(() => null);
}

/** '' or a case title of this firm; anything else is refused. */
export async function assertMatter(matter: string, firmId: string | null): Promise<string> {
  const m = matter.trim();
  if (!m || m === NO_CASE) return '';
  const sql = db();
  if (!sql) return m;
  const rows = await sql<Array<{ one: number }>>`
    select 1 as one from cases where firm_id = ${firmId}::uuid and title = ${m} limit 1
  `;
  if (!rows.length) throw new ImportError('case_not_found', 404);
  return m;
}

export async function fileOf(documentId: string, firmId: string | null): Promise<{ rec: DocumentRecord; body: Buffer }> {
  const rec = await documentsService.get(documentId, firmId);
  if (!rec) throw new ImportError('document_not_found', 404);
  const key = await documentsService.getStorageKey(documentId, firmId);
  const obj = key ? await storage().getObject(key.key) : null;
  if (!obj || !obj.body.length) throw new ImportError('no_file', 404);
  return { rec, body: obj.body };
}

const baseName = (fileName: string) => fileName.replace(/\.[a-z0-9]{1,5}$/i, '').trim().slice(0, 150) || 'Document';

export const importedDocumentsService = {
  /** A firm document already in DifAi (Case -> Documents "Edit in DifAi", or a
   *  saved imported draft being reopened). Creates nothing. */
  async openDocument(documentId: string, ctx: Ctx): Promise<OpenResult> {
    const { rec, body } = await fileOf(documentId, ctx.firmId);
    const name = rec.fileName ?? rec.name;
    const read_ = await read(body, detectKind(body, name), name);
    const title = rec.name.endsWith(' (original)') ? rec.name.slice(0, -' (original)'.length) : `${rec.name} (edited)`;
    return { ...read_, sourceDocumentId: documentId, title, docType: rec.type, matter: rec.case === NO_CASE ? '' : rec.case };
  },

  /** A new upload: read it first (a bad file stores nothing), then keep the
   *  original, untouched, in Documents. */
  async openUpload(
    input: { fileName: string; fileBase64: string; matter: string; docType: string },
    ctx: Ctx,
  ): Promise<OpenResult> {
    const buf = Buffer.from(input.fileBase64, 'base64');
    if (!buf.length) throw new ImportError('empty');
    if (buf.length > MAX_IMPORT_BYTES) throw new ImportError('too_large', 413);
    const matter = await assertMatter(input.matter, ctx.firmId);
    const kind = detectKind(buf, input.fileName);
    const out = await read(buf, kind, input.fileName);
    const title = baseName(input.fileName);
    const original = await documentsService.create({
      name: `${title} (original)`, type: input.docType, case: matter || NO_CASE, updated: 'just now',
      fileName: input.fileName, fileMime: MIME[kind], fileSize: buf.length, fileBase64: input.fileBase64,
    }, ctx.firmId);
    return { ...out, sourceDocumentId: original.id!, title, docType: input.docType, matter };
  },

  /** Save the edited Word copy into Documents: the edited lines written into
   *  the advocate's own .docx (their layout kept), else laid out in house style
   *  (a PDF original, or one deleted since). One row per draft, its file
   *  replaced on every save, filed with the draft's case. */
  async saveEditedFile(draftId: string, paragraphs: string[], ctx: Ctx): Promise<DocumentRecord> {
    const draft = await draftsService.get(draftId, { userId: ctx.userId });
    if (!draft) throw new ImportError('draft_not_found', 404);
    if (!draft.sourceDocumentId && !draft.editedDocumentId) throw new ImportError('not_imported', 409);
    const lines = paragraphs.filter((p) => p.trim());
    if (!lines.length) throw new ImportError('empty');
    const src = await sourceDocx(draft.sourceDocumentId, ctx.firmId);
    const merged = src ? await engineClient.applyEdits(src.toString('base64'), lines) : null;
    const docxBase64 = merged ?? (await engineClient.composeDocx(lines)).docxBase64;
    const buf = Buffer.from(docxBase64, 'base64');
    const file = { fileName: `${baseName(draft.title)}.docx`, fileMime: DOCX_MIME, body: buf };
    const meta = { name: draft.title, type: draft.docType, case: draft.matter || NO_CASE };
    const existing = draft.editedDocumentId ? await documentsService.get(draft.editedDocumentId, ctx.firmId) : undefined;
    if (existing?.id) {
      await documentsService.replaceFile(existing.id, ctx.firmId, file);
      return (await documentsService.update(existing.id, ctx.firmId, meta)) ?? existing;
    }
    const created = await documentsService.create({
      ...meta, updated: 'just now', fileName: file.fileName, fileMime: DOCX_MIME,
      fileSize: buf.length, fileBase64: docxBase64,
    }, ctx.firmId);
    await draftsService.setEditedDocument(draftId, created.id!, { userId: ctx.userId });
    return created;
  },

  /** Option A: an independent copy (draft + its original + its edited file) in
   *  another case. Nothing is shared with the source, so editing one never
   *  changes the other. Rolls back the files it made if a later step fails. */
  async copyToMatter(draftId: string, matterIn: string, ctx: Ctx): Promise<SavedDraft> {
    const matter = await assertMatter(matterIn, ctx.firmId);
    if (!matter) throw new ImportError('case_required');
    const draft = await draftsService.get(draftId, { userId: ctx.userId });
    if (!draft) throw new ImportError('draft_not_found', 404);
    const made: string[] = [];
    const copyDoc = async (id: string | null | undefined, name?: string): Promise<string | undefined> => {
      if (!id) return undefined;
      const src = await fileOf(id, ctx.firmId).catch(() => null);
      if (!src) return undefined; // the original was deleted: the copy just has no layout file
      const c = await documentsService.create({
        name: name ?? src.rec.name, type: src.rec.type, case: matter, updated: 'just now',
        fileName: src.rec.fileName ?? `${baseName(src.rec.name)}.docx`, fileMime: src.rec.fileMime ?? DOCX_MIME,
        fileSize: src.body.length, fileBase64: src.body.toString('base64'),
      }, ctx.firmId);
      made.push(c.id!);
      return c.id!;
    };
    try {
      const sourceDocumentId = await copyDoc(draft.sourceDocumentId);
      const editedId = await copyDoc(draft.editedDocumentId, draft.title);
      const copy = await draftsService.create({
        title: draft.title, docType: draft.docType, language: draft.language,
        tone: draft.tone as 'Professional', fields: draft.fields, editedHtml: draft.editedHtml,
        bodyText: draft.bodyText, ...(draft.draftDate ? { draftDate: draft.draftDate } : {}), matter,
        ...(sourceDocumentId ? { sourceDocumentId } : {}),
      }, { userId: ctx.userId });
      if (editedId) await draftsService.setEditedDocument(copy.id, editedId, { userId: ctx.userId });
      return { ...copy, editedDocumentId: editedId ?? null };
    } catch (err) {
      await Promise.all(made.map((id) => documentsService.remove(id, ctx.firmId).catch(() => false)));
      throw err;
    }
  },

  /** "Add to a case": the draft and its edited file move to the case. The
   *  original moves too only when it was unfiled — an original that lives in
   *  another case's file stays there. */
  async moveToMatter(draftId: string, matterIn: string, ctx: Ctx): Promise<SavedDraft> {
    const matter = await assertMatter(matterIn, ctx.firmId);
    const moved = await draftsService.setMatter(draftId, matter, { userId: ctx.userId });
    if (!moved) throw new ImportError('draft_not_found', 404);
    const label = matter || NO_CASE;
    if (moved.editedDocumentId) await documentsService.update(moved.editedDocumentId, ctx.firmId, { case: label });
    if (moved.sourceDocumentId) {
      const src = await documentsService.get(moved.sourceDocumentId, ctx.firmId);
      if (src?.case === NO_CASE) await documentsService.update(moved.sourceDocumentId, ctx.firmId, { case: label });
    }
    return moved;
  },
};
