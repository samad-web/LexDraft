// review-copy (build-docs/features/review-copy.md).
//
// A frozen PDF copy of a draft or case document that the advocate marks up with
// a pen and margin notes. The source is never changed. Marks are vectors in
// page-relative units (0-1). "Save to Documents" draws them into the PDF (+ a
// numbered notes page) as one Documents row per review. No model calls here.
import type { DocumentRecord } from '@lexdraft/types';
import crypto from 'node:crypto';
import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';
import { db } from '../db/client';
import { convertToPdf } from './document-render.service';
import { documentsService } from './documents.service';
import { draftsService } from './drafts.service';
import { assertMatter, detectKind, fileOf, ImportError, NO_CASE } from './imported-documents.service';
import { storage } from './storage.service';
import { appendBlankPage, blankPdf, imageKind, imageToPdf, mergePdfs } from './review-pages';

export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024; // JSON body limit is 16 MB (base64)
const MAX_STROKES = 5000;
const MAX_POINTS = 2000;
const MAX_NOTES = 200;
const MAX_NOTE_CHARS = 2000;

export const INK = { black: [0.07, 0.07, 0.07], blue: [0.1, 0.3, 0.85], red: [0.85, 0.1, 0.1], yellow: [1, 0.85, 0.1] } as const;
type Ink = keyof typeof INK;

export interface Stroke { tool: 'pen' | 'hl'; color: Ink; w: number; pts: Array<[number, number]> }
export interface Marks { pages: Array<{ strokes: Stroke[] }> }
export interface ReviewNote { id: string; page: number; x: number; y: number; text: string; excerpt: string }

interface Ctx { userId: string; firmId: string | null }

interface Row {
  id: string; user_id: string | null; case_label: string; title: string; source: 'draft' | 'document';
  draft_id: string | null; source_document_id: string | null; source_updated_at: Date | string | null;
  snapshot_key: string; page_count: number; marks: Marks; notes: ReviewNote[];
  result_document_id: string | null; created_at: Date | string; updated_at: Date | string;
  draft_updated_at?: Date | string | null;
}

export class ReviewError extends ImportError {}

/** Any file a review can be made of, as PDF: PDF as is; Word via LibreOffice;
 *  JPEG / PNG photos as upright A4-wide pages; WebP / TIFF via LibreOffice.
 *  iPhone HEIC can't be read here (the upload picker asks iOS for JPEG). */
async function asPdf(body: Buffer, name: string): Promise<Buffer> {
  const img = imageKind(body);
  if (img === 'heic') throw new ReviewError('heic');
  try {
    if (img === 'jpeg' || img === 'png') return await imageToPdf(body, img);
    if (img === 'webp' || img === 'tiff') return await convertToPdf(body, img);
  } catch {
    throw new ReviewError('convert_failed');
  }
  const kind = detectKind(body, name);
  if (kind === 'pdf') return body;
  try {
    return await convertToPdf(body, kind);
  } catch {
    throw new ReviewError('convert_failed');
  }
}

const iso = (v: Date | string | null | undefined) => (v == null ? null : v instanceof Date ? v.toISOString() : v);
const clamp01 = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Keep only well-formed marks within the caps; refuse if over them. */
export function cleanMarks(input: unknown, pageCount: number): Marks {
  const pages = Array.isArray((input as Marks)?.pages) ? (input as Marks).pages : [];
  let total = 0;
  const out: Marks = { pages: [] };
  for (let p = 0; p < Math.min(pages.length, pageCount); p++) {
    const strokes = Array.isArray(pages[p]?.strokes) ? pages[p]!.strokes : [];
    total += strokes.length;
    if (total > MAX_STROKES) throw new ReviewError('too_many_marks', 413);
    out.pages.push({
      strokes: strokes.flatMap((s): Stroke[] => {
        if (!s || !(s.tool === 'pen' || s.tool === 'hl') || !(s.color in INK) || !Array.isArray(s.pts)) return [];
        if (s.pts.length > MAX_POINTS) throw new ReviewError('stroke_too_long', 413);
        const pts = s.pts.filter((q) => Array.isArray(q)).map((q): [number, number] => [clamp01(q[0]), clamp01(q[1])]);
        const w = typeof s.w === 'number' && Number.isFinite(s.w) ? Math.min(0.05, Math.max(0.0005, s.w)) : 0.002;
        return pts.length ? [{ tool: s.tool, color: s.color, w, pts }] : [];
      }),
    });
  }
  return out;
}

export function cleanNotes(input: unknown, pageCount: number): ReviewNote[] {
  const notes = Array.isArray(input) ? input : [];
  if (notes.length > MAX_NOTES) throw new ReviewError('too_many_notes', 413);
  return notes.flatMap((n): ReviewNote[] => {
    if (!n || typeof n.text !== 'string' || !Number.isInteger(n.page) || n.page < 0 || n.page >= pageCount) return [];
    if (n.text.length > MAX_NOTE_CHARS) throw new ReviewError('note_too_long', 413);
    return [{
      id: typeof n.id === 'string' ? n.id.slice(0, 40) : crypto.randomUUID(),
      page: n.page, x: clamp01(n.x), y: clamp01(n.y), text: n.text,
      excerpt: typeof n.excerpt === 'string' ? n.excerpt.slice(0, 300) : '',
    }];
  });
}

/** A display point (0-1, top-left origin, page as shown) -> PDF user space with a
 *  top-left origin (for drawSvgPath), allowing for the page's /Rotate. */
export function toUserSpace(u: number, v: number, w: number, h: number, rotate: number): [number, number] {
  switch (((rotate % 360) + 360) % 360) {
    case 90: return [v * w, h - u * h];
    case 180: return [w - u * w, h - v * h];
    case 270: return [w - v * w, u * h];
    default: return [u * w, v * h];
  }
}

function drawStroke(page: PDFPage, s: Stroke) {
  const { width, height } = page.getSize();
  const rot = page.getRotation().angle;
  const shown = rot % 180 === 0 ? width : height; // displayed width: stroke widths are relative to it
  const path = s.pts.map(([u, v], i) => {
    const [x, y] = toUserSpace(u, v, width, height, rot);
    return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ') + (s.pts.length === 1 ? ' l0.01 0' : '');
  const [r, g, b] = INK[s.color];
  page.drawSvgPath(path, {
    x: 0, y: height, borderColor: rgb(r, g, b), borderWidth: s.w * shown,
    borderOpacity: s.tool === 'hl' ? 0.35 : 1, borderLineCap: LineCapStyle.Round,
  });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The notes page as HTML; LibreOffice turns it into PDF with Noto fonts, so
 *  Tamil / Hindi notes print (pdf-lib's built-in fonts can't). */
export function notesHtml(title: string, notes: ReviewNote[]): string {
  const items = notes.map((n, i) =>
    `<p><b>${i + 1}.</b> Page ${n.page + 1}${n.excerpt ? ` <i>("${esc(n.excerpt.slice(0, 80))}")</i>` : ''}: ${esc(n.text).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:"Noto Sans","Noto Sans Tamil","Noto Sans Devanagari",sans-serif;font-size:12pt}p{margin:0 0 8pt}</style></head>`
    + `<body><h2>Review notes: ${esc(title)}</h2>${items}</body></html>`;
}

/** Snapshot + marks + note pins (+ notes page when it can be made). */
export async function flatten(snapshot: Buffer, marks: Marks, notes: ReviewNote[], title: string): Promise<{ pdf: Buffer; notesPage: boolean }> {
  const doc = await PDFDocument.load(snapshot, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  marks.pages.forEach((p, i) => { if (pages[i]) p.strokes.forEach((s) => drawStroke(pages[i]!, s)); });
  notes.forEach((n, i) => {
    const page = pages[n.page];
    if (!page) return;
    const { width, height } = page.getSize();
    const [x, yDown] = toUserSpace(n.x, n.y, width, height, page.getRotation().angle);
    const y = height - yDown;
    page.drawCircle({ x, y, size: 8, color: rgb(1, 1, 1), borderColor: rgb(0.07, 0.07, 0.07), borderWidth: 1.2 });
    const label = String(i + 1);
    page.drawText(label, { x: x - font.widthOfTextAtSize(label, 8) / 2, y: y - 3, size: 8, font, color: rgb(0.07, 0.07, 0.07) });
  });
  let notesPage = notes.length === 0;
  if (notes.length) {
    try {
      const extra = await PDFDocument.load(await convertToPdf(Buffer.from(notesHtml(title, notes), 'utf8'), 'html'));
      (await doc.copyPages(extra, extra.getPageIndices())).forEach((p) => doc.addPage(p));
      notesPage = true;
    } catch {
      // LibreOffice unavailable: the marked pages are still saved, without the list.
    }
  }
  return { pdf: Buffer.from(await doc.save()), notesPage };
}

async function pdfPages(buf: Buffer): Promise<number> {
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ReviewError('not_pdf');
  try {
    return (await PDFDocument.load(buf, { ignoreEncryption: true })).getPageCount();
  } catch {
    throw new ReviewError('not_pdf');
  }
}

function toDto(r: Row, viewer: string) {
  const changed = r.source === 'draft' && r.draft_updated_at && r.source_updated_at
    && new Date(r.draft_updated_at).getTime() > new Date(r.source_updated_at).getTime() + 1000;
  return {
    id: r.id, title: r.title, source: r.source, case: r.case_label, draftId: r.draft_id,
    sourceDocumentId: r.source_document_id, pageCount: r.page_count, marks: r.marks, notes: r.notes,
    resultDocumentId: r.result_document_id, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    canEdit: r.user_id === viewer, draftChanged: !!changed,
  };
}
export type ReviewDto = ReturnType<typeof toDto>;

function sqlOrThrow() {
  const sql = db();
  if (!sql) throw new ReviewError('database_required', 503);
  return sql;
}

async function insert(ctx: Ctx, snapshot: Buffer, row: {
  title: string; caseLabel: string; source: 'draft' | 'document'; draftId?: string | null;
  sourceDocumentId?: string | null; sourceUpdatedAt?: string | null; pageCount: number;
}): Promise<ReviewDto> {
  if (!ctx.firmId) throw new ReviewError('no_firm');
  const sql = sqlOrThrow();
  const id = crypto.randomUUID();
  const key = `reviews/${ctx.firmId}/${id}/snapshot.pdf`;
  await storage().putObject({ key, body: snapshot, contentType: 'application/pdf' });
  try {
    const rows = await sql<Row[]>`
      insert into document_reviews (id, firm_id, user_id, case_label, title, source, draft_id, source_document_id,
                                    source_updated_at, snapshot_key, page_count)
      values (${id}::uuid, ${ctx.firmId}::uuid, ${ctx.userId}::uuid, ${row.caseLabel}, ${row.title.slice(0, 200)}, ${row.source},
              ${row.draftId ?? null}, ${row.sourceDocumentId ?? null}, ${row.sourceUpdatedAt ?? null}, ${key}, ${row.pageCount})
      returning *`;
    return toDto(rows[0]!, ctx.userId);
  } catch (err) {
    await storage().delete(key).catch(() => {});
    throw err;
  }
}

async function load(id: string, ctx: Ctx): Promise<Row> {
  const sql = sqlOrThrow();
  const rows = await sql<Row[]>`
    select r.*, d.updated_at as draft_updated_at
    from document_reviews r left join drafts d on d.id = r.draft_id
    where r.id::text = ${id} and r.firm_id = ${ctx.firmId}::uuid limit 1`;
  if (!rows[0]) throw new ReviewError('review_not_found', 404);
  return rows[0];
}

function own(r: Row, ctx: Ctx) {
  if (r.user_id !== ctx.userId) throw new ReviewError('not_author', 403);
}

export const reviewsService = {
  /** From the Draft page: its own PDF (the same one as Download PDF). */
  async fromDraft(input: { draftId: string; title: string; matter: string; pdfBase64: string }, ctx: Ctx): Promise<ReviewDto> {
    const buf = Buffer.from(input.pdfBase64, 'base64');
    if (buf.length > MAX_SNAPSHOT_BYTES) throw new ReviewError('too_large', 413);
    const pageCount = await pdfPages(buf);
    const draft = await draftsService.get(input.draftId, { userId: ctx.userId });
    if (!draft) throw new ReviewError('draft_not_found', 404);
    const matter = await assertMatter(input.matter || draft.matter || '', ctx.firmId);
    return insert(ctx, buf, {
      title: input.title.trim() || draft.title, caseLabel: matter || NO_CASE, source: 'draft',
      draftId: draft.id, sourceUpdatedAt: draft.updatedAt, pageCount,
    });
  },

  /** From a case document (PDF copied; Word converted by LibreOffice). */
  async fromDocument(documentId: string, ctx: Ctx): Promise<ReviewDto> {
    return this.fromDocuments([documentId], ctx);
  },

  /** One or more case files (PDF, Word, photos of paper) as one review, pages in
   *  the order given (case-markup: "Mark up together"). */
  async fromDocuments(documentIds: string[], ctx: Ctx): Promise<ReviewDto> {
    if (!documentIds.length || documentIds.length > 20) throw new ReviewError('too_many_files');
    const parts: Buffer[] = [];
    const recs: DocumentRecord[] = [];
    for (const id of documentIds) {
      const { rec, body } = await fileOf(id, ctx.firmId);
      parts.push(await asPdf(body, rec.fileName ?? rec.name));
      recs.push(rec);
    }
    const pdf = await mergePdfs(parts);
    if (pdf.length > MAX_SNAPSHOT_BYTES * 2) throw new ReviewError('too_large', 413);
    const first = recs[0]!.name.replace(/ \(original\)$/, '');
    return insert(ctx, pdf, {
      title: recs.length > 1 ? `${first} + ${recs.length - 1} more` : first,
      caseLabel: recs[0]!.case || NO_CASE, source: 'document',
      sourceDocumentId: documentIds[0]!, pageCount: await pdfPages(pdf),
    });
  },

  /** A blank A4 sheet to write on with the pen (a handwritten note for a case). */
  async blank(matterIn: string, ctx: Ctx): Promise<ReviewDto> {
    const matter = await assertMatter(matterIn, ctx.firmId);
    const dated = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    return insert(ctx, await blankPdf(), {
      title: `Handwritten note, ${dated}`, caseLabel: matter || NO_CASE, source: 'document', pageCount: 1,
    });
  },

  /** One more blank page at the end of any review (more paper). Author only. */
  async addPage(id: string, ctx: Ctx): Promise<ReviewDto> {
    const r = await load(id, ctx);
    own(r, ctx);
    if (r.page_count >= 200) throw new ReviewError('too_many_pages', 413);
    const { pdf, pageCount } = await appendBlankPage(await this.snapshot(id, ctx));
    const sql = sqlOrThrow();
    await storage().putObject({ key: r.snapshot_key, body: pdf, contentType: 'application/pdf' });
    await sql`update document_reviews set page_count = ${pageCount} where id = ${r.id}::uuid and firm_id = ${ctx.firmId}::uuid`;
    return this.get(id, ctx);
  },

  async get(id: string, ctx: Ctx): Promise<ReviewDto> {
    return toDto(await load(id, ctx), ctx.userId);
  },

  async snapshot(id: string, ctx: Ctx): Promise<Buffer> {
    const r = await load(id, ctx);
    const obj = await storage().getObject(r.snapshot_key);
    if (!obj?.body.length) throw new ReviewError('no_file', 404);
    return obj.body;
  },

  async list(filter: { draftId?: string }, ctx: Ctx): Promise<ReviewDto[]> {
    const sql = sqlOrThrow();
    const rows = await sql<Row[]>`
      select r.*, d.updated_at as draft_updated_at
      from document_reviews r left join drafts d on d.id = r.draft_id
      where r.firm_id = ${ctx.firmId}::uuid ${filter.draftId ? sql`and r.draft_id::text = ${filter.draftId}` : sql``}
      order by r.updated_at desc limit 50`;
    return rows.map((r) => toDto(r, ctx.userId));
  },

  /** Exported review PDFs in Documents -> their review (for "Open review"). */
  async byResultDocument(firmId: string | null): Promise<Map<string, string>> {
    const sql = db();
    if (!sql || !firmId) return new Map();
    const rows = await sql<Array<{ id: string; result_document_id: string }>>`
      select id, result_document_id from document_reviews
      where firm_id = ${firmId}::uuid and result_document_id is not null`;
    return new Map(rows.map((r) => [r.result_document_id, r.id]));
  },

  async save(id: string, body: { marks?: unknown; notes?: unknown }, ctx: Ctx): Promise<ReviewDto> {
    const r = await load(id, ctx);
    own(r, ctx);
    const marks = body.marks === undefined ? r.marks : cleanMarks(body.marks, r.page_count);
    const notes = body.notes === undefined ? r.notes : cleanNotes(body.notes, r.page_count);
    const sql = sqlOrThrow();
    await sql`update document_reviews set marks = ${sql.json(marks as never)}, notes = ${sql.json(notes as never)}
              where id = ${r.id}::uuid and firm_id = ${ctx.firmId}::uuid`;
    return this.get(id, ctx);
  },

  /** Marks drawn into the PDF -> one Documents row per review, replaced on re-save. */
  async exportToDocuments(id: string, ctx: Ctx): Promise<{ documentId: string; notesPage: boolean }> {
    const r = await load(id, ctx);
    own(r, ctx);
    const snap = await this.snapshot(id, ctx);
    const { pdf, notesPage } = await flatten(snap, r.marks, r.notes, r.title);
    const dated = new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const name = `${r.title} (review, ${dated})`;
    const fileName = `${r.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120)} - review.pdf`;
    const existing = r.result_document_id ? await documentsService.get(r.result_document_id, ctx.firmId) : undefined;
    if (existing?.id) {
      await documentsService.replaceFile(existing.id, ctx.firmId, { fileName, fileMime: 'application/pdf', body: pdf });
      return { documentId: existing.id, notesPage };
    }
    const doc = await documentsService.create({
      name, type: 'Review', case: r.case_label, updated: 'just now',
      fileName, fileMime: 'application/pdf', fileSize: pdf.length, fileBase64: pdf.toString('base64'),
    }, ctx.firmId);
    const sql = sqlOrThrow();
    await sql`update document_reviews set result_document_id = ${doc.id!}::uuid where id = ${r.id}::uuid`;
    return { documentId: doc.id!, notesPage };
  },

  /** The review goes; a PDF already saved to Documents stays (it's a document now). */
  async remove(id: string, ctx: Ctx): Promise<void> {
    const r = await load(id, ctx);
    own(r, ctx);
    const sql = sqlOrThrow();
    await sql`delete from document_reviews where id = ${r.id}::uuid and firm_id = ${ctx.firmId}::uuid`;
    await storage().delete(r.snapshot_key).catch(() => {});
  },
};
