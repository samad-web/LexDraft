import { PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, StandardFonts, rgb, type PDFFont, type PDFRef } from 'pdf-lib';
import { db } from '../db/client';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { EFILING_MAX_UPLOAD_BYTES } from '../lib/efiling/readiness';
import { logger } from '../logger';
import { documentsService } from './documents.service';
import { recordFilingEvent } from './efiling-filings.service';
import { storage } from './storage.service';

// =============================================================================
// efiling-bundle.service
//
// Builds the single upload-ready PDF the portal's "Pleading Upload" takes:
// every document on the filing, in order, behind an index page that lists
// each one with its page range, plus a PDF bookmark per document so the
// registry can jump straight to it (the portal's own "Indexing" tab asks for
// exactly these page ranges - they are returned so the advocate can copy
// them across).
//
// Size is checked against EFILING_MAX_UPLOAD_BYTES; an oversize bundle is
// still saved (the advocate may want to split it), but flagged.
// =============================================================================

type Sql = NonNullable<ReturnType<typeof db>>;

export interface BundleIndexEntry {
  label: string;
  fromPage: number;
  toPage: number;
}

export interface BundleResult {
  pages: number;
  sizeBytes: number;
  oversize: boolean;
  index: BundleIndexEntry[];
}

const INDEX_LINES_PER_PAGE = 32;

async function loadSourcePdf(sql: Sql, firmId: string, kind: 'draft_render' | 'document', sourceId: string, label: string): Promise<Buffer> {
  let key: string | null = null;
  if (kind === 'document') {
    const ref = await documentsService.getStorageKey(sourceId, firmId);
    if (ref && ref.fileMime !== 'application/pdf') {
      throw new BadRequestError(`"${label}" is not a PDF (${ref.fileMime}). Convert it to PDF first. The portal accepts PDF only.`);
    }
    key = ref?.key ?? null;
  } else {
    const [r] = await sql<Array<{ pdf_key: string | null }>>`
      select pdf_key from draft_renders where id::text = ${sourceId} and firm_id = ${firmId}::uuid
    `;
    key = r?.pdf_key ?? null;
  }
  if (!key) throw new BadRequestError(`"${label}" has no stored PDF.`);
  const obj = await storage().getObject(key);
  if (!obj) throw new BadRequestError(`"${label}": the stored file is missing.`);
  return obj.body;
}

/** Standard fonts are WinAnsi-only; a Devanagari/Tamil label can't be drawn
 *  on the index page (bookmarks keep the full Unicode label). */
function drawable(font: PDFFont, text: string): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return text.replace(/[^\x20-\x7E]/g, '?');
  }
}

function addOutline(pdf: PDFDocument, entries: Array<{ title: string; pageRef: PDFRef }>): void {
  if (entries.length === 0) return;
  const ctx = pdf.context;
  const outlinesRef = ctx.nextRef();
  const itemRefs = entries.map(() => ctx.nextRef());
  entries.forEach((e, i) => {
    const item = ctx.obj({});
    item.set(PDFName.of('Title'), PDFHexString.fromText(e.title));
    item.set(PDFName.of('Parent'), outlinesRef);
    item.set(PDFName.of('Dest'), ctx.obj([e.pageRef, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    if (i > 0) item.set(PDFName.of('Prev'), itemRefs[i - 1]!);
    if (i < entries.length - 1) item.set(PDFName.of('Next'), itemRefs[i + 1]!);
    ctx.assign(itemRefs[i]!, item);
  });
  const outlines = ctx.obj({});
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlines.set(PDFName.of('First'), itemRefs[0]!);
  outlines.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1]!);
  outlines.set(PDFName.of('Count'), PDFNumber.of(entries.length));
  ctx.assign(outlinesRef, outlines);
  pdf.catalog.set(PDFName.of('Outlines'), outlinesRef);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Pure-ish core, exported for tests: merge buffers behind an index page. */
export async function assembleBundle(
  title: string,
  docs: Array<{ label: string; pdf: Buffer }>,
): Promise<{ bytes: Uint8Array; pages: number; index: BundleIndexEntry[] }> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setProducer('LexDraft');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);

  const sources: PDFDocument[] = [];
  for (const d of docs) {
    try {
      sources.push(await PDFDocument.load(d.pdf));
    } catch (err) {
      const msg = err instanceof Error && /encrypt/i.test(err.message)
        ? 'is password-protected or encrypted. Remove the protection and upload it again.'
        : 'could not be read as a PDF.';
      throw new BadRequestError(`"${d.label}" ${msg}`);
    }
  }

  const indexPages = Math.max(1, Math.ceil(docs.length / INDEX_LINES_PER_PAGE));
  const index: BundleIndexEntry[] = [];
  let next = indexPages + 1;
  for (let i = 0; i < docs.length; i++) {
    const n = sources[i]!.getPageCount();
    index.push({ label: docs[i]!.label, fromPage: next, toPage: next + n - 1 });
    next += n;
  }

  // Index page(s).
  for (let p = 0; p < indexPages; p++) {
    const page = out.addPage([595.28, 841.89]); // A4
    const { height } = page.getSize();
    let y = height - 60;
    page.drawText(drawable(bold, p === 0 ? 'INDEX' : 'INDEX (contd.)'), { x: 260, y, size: 14, font: bold });
    y -= 22;
    if (p === 0) {
      page.drawText(drawable(font, title).slice(0, 90), { x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
      y -= 26;
    }
    page.drawText('Sl.', { x: 50, y, size: 10, font: bold });
    page.drawText('Particulars', { x: 80, y, size: 10, font: bold });
    page.drawText('Pages', { x: 480, y, size: 10, font: bold });
    y -= 16;
    for (const [i, e] of index.slice(p * INDEX_LINES_PER_PAGE, (p + 1) * INDEX_LINES_PER_PAGE).entries()) {
      const sl = p * INDEX_LINES_PER_PAGE + i + 1;
      page.drawText(String(sl), { x: 50, y, size: 10, font });
      page.drawText(drawable(font, e.label).slice(0, 70), { x: 80, y, size: 10, font });
      page.drawText(e.fromPage === e.toPage ? String(e.fromPage) : `${e.fromPage} - ${e.toPage}`, { x: 480, y, size: 10, font });
      y -= 18;
    }
  }

  const bookmarks: Array<{ title: string; pageRef: PDFRef }> = [{ title: 'Index', pageRef: out.getPage(0).ref }];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]!;
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((pg) => out.addPage(pg));
    bookmarks.push({ title: docs[i]!.label, pageRef: copied[0]!.ref });
  }
  addOutline(out, bookmarks);

  // Page numbers, bottom centre, across the whole bundle (registries ask for
  // continuous pagination matching the index).
  const total = out.getPageCount();
  out.getPages().forEach((pg, i) => {
    const { width } = pg.getSize();
    const label = `${i + 1}`;
    pg.drawText(label, { x: width / 2 - font.widthOfTextAtSize(label, 9) / 2, y: 18, size: 9, font, color: rgb(0.35, 0.35, 0.35) });
  });

  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, pages: total, index };
}

export const efilingBundleService = {
  async build(filingId: string, firmId: string, userId: string): Promise<BundleResult> {
    const sql = db();
    if (!sql) throw new BadRequestError('eFiling requires DATABASE_URL to be configured');
    const [filing] = await sql<Array<{ id: string; title: string; status: string }>>`
      select id, title, status from efiling_filings where id::text = ${filingId} and firm_id = ${firmId}::uuid
    `;
    if (!filing) throw new NotFoundError('Filing not found');
    const docs = await sql<Array<{ id: string; label: string; source_kind: 'draft_render' | 'document'; source_id: string }>>`
      select id, label, source_kind, source_id from efiling_documents where filing_id::text = ${filingId} order by position
    `;
    if (docs.length === 0) throw new BadRequestError('Add documents to the filing first.');

    const loaded: Array<{ label: string; pdf: Buffer }> = [];
    for (const d of docs) {
      const pdf = await loadSourcePdf(sql, firmId, d.source_kind, d.source_id, d.label);
      loaded.push({ label: d.label, pdf });
    }
    const { bytes, pages, index } = await assembleBundle(filing.title, loaded);

    const key = `efiling/${firmId}/${filingId}/bundle-${Date.now()}.pdf`;
    await storage().putObject({ key, body: Buffer.from(bytes), contentType: 'application/pdf' });

    // Per-document page counts for the UI (and the portal's Indexing tab).
    await sql.begin(async (tx) => {
      for (let i = 0; i < docs.length; i++) {
        const e = index[i]!;
        await tx`
          update efiling_documents set page_count = ${e.toPage - e.fromPage + 1}, size_bytes = ${loaded[i]!.pdf.length}
          where id = ${docs[i]!.id}::uuid
        `;
      }
      await tx`
        update efiling_filings set bundle_key = ${key}, bundle_pages = ${pages}, bundle_size_bytes = ${bytes.length},
          bundle_built_at = now(), updated_at = now()
        where id::text = ${filingId}
      `;
    });
    const oversize = bytes.length > EFILING_MAX_UPLOAD_BYTES;
    await recordFilingEvent(sql, {
      filingId, firmId, source: 'advocate', actorUserId: userId,
      note: `Bundle built: ${pages} pages, ${(bytes.length / (1024 * 1024)).toFixed(1)} MB${oversize ? ' (over the upload limit)' : ''}`,
    });
    logger.info({ filingId, pages, size: bytes.length }, 'efiling bundle built');
    return { pages, sizeBytes: bytes.length, oversize, index };
  },

  async download(filingId: string, firmId: string): Promise<{ body: Buffer; filename: string }> {
    const sql = db();
    if (!sql) throw new BadRequestError('eFiling requires DATABASE_URL to be configured');
    const [f] = await sql<Array<{ bundle_key: string | null; efiling_no: string | null; title: string }>>`
      select bundle_key, efiling_no, title from efiling_filings where id::text = ${filingId} and firm_id = ${firmId}::uuid
    `;
    if (!f) throw new NotFoundError('Filing not found');
    if (!f.bundle_key) throw new NotFoundError('No bundle has been built for this filing yet.');
    const obj = await storage().getObject(f.bundle_key);
    if (!obj) throw new NotFoundError('The bundle file is missing. Build it again.');
    const base = (f.efiling_no || f.title).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
    return { body: obj.body, filename: `${base}-bundle.pdf` };
  },
};
