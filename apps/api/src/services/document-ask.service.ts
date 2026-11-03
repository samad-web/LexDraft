// =============================================================================
// document-ask.service — "Ask this document" in the Draft composer.
//
// The advocate uploads an FIR, an order or the other side's pleading and asks
// questions about it. Two calls, nothing stored:
//
//   read()  file (base64, the same shape intake attachments use) -> the text,
//           PAGE BY PAGE. Local only: pdf-parse for a PDF's text layer, the
//           tesseract OCR fallback for a scanned PDF, tesseract for an image,
//           mammoth for .docx. No model call, no quota. The pages go back to the
//           browser, which holds them for the session — the server keeps nothing.
//   ask()   the pages + a question -> an answer grounded ONLY in those pages,
//           with the quotes it relies on, each tagged page + paragraph.
//
// Grounding is enforced by code, not trusted from the model: every quote must
// actually occur in the document (whitespace/punctuation-insensitive). A quote
// that doesn't is dropped; an answer left with no real quote is replaced by
// "not stated in the document". The model never sees anything but the document
// and the question, and is told to say so when the answer isn't there.
// =============================================================================

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../logger';
import { complete, parseJsonLoose, providerModel, resolveProvider, type Provider } from '../lib/llm-drafting';
import { aiQuotaService } from './ai-quota.service';
import { aiUsageService } from './ai-usage.service';

/** Upper bound on document text kept per session (~30k tokens). */
export const MAX_DOC_CHARS = 120_000;
export const MAX_ASK_PAGES = 400;

export interface DocFile {
  fileName: string;
  mime: string;
  dataBase64: string;
}

/** One page of the read document. `page` is null when the format has no pages
 *  (.docx / text). */
export interface DocPage {
  page: number | null;
  text: string;
}

export interface ReadDocResult {
  fileName: string;
  kind: 'pdf' | 'image' | 'docx' | 'text';
  /** True when the text came from OCR (scanned PDF / photo) — expect misreads. */
  ocr: boolean;
  pages: DocPage[];
  chars: number;
  /** True when the document was longer than MAX_DOC_CHARS and cut. */
  truncated: boolean;
}

export interface AskRequest {
  fileName: string;
  pages: DocPage[];
  question: string;
  /** Earlier turns, for follow-ups ("and the date of that?"). */
  history?: Array<{ question: string; answer: string }>;
  provider?: 'xai' | 'anthropic';
}

export interface AskQuote {
  page: number | null;
  /** 1-based paragraph within the page (or the whole document when page is null). */
  paragraph: number;
  text: string;
}

export interface AskResult {
  /** False when the document does not answer the question. */
  found: boolean;
  answer: string;
  quotes: AskQuote[];
}

export class DocumentReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentReadError';
  }
}

export class AskUnavailableError extends Error {
  constructor(message = 'AI is not configured') {
    super(message);
    this.name = 'AskUnavailableError';
  }
}

export const NOT_IN_DOCUMENT = 'The document does not say this.';

// ---- Reading -----------------------------------------------------------------

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'heic']);
const extOf = (name: string) => {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
};

function clean(text: string): string {
  // Same normalisation as text-extraction: drop control chars, trailing spaces,
  // collapse blank-line runs.
  return text
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** pdf-parse's own page renderer, kept per page instead of joined. */
async function renderPage(pageData: {
  getTextContent: (o: object) => Promise<{ items: Array<{ str: string; transform: number[] }> }>;
}): Promise<string> {
  const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  let lastY: number | undefined;
  let text = '';
  for (const item of content.items) {
    const y = item.transform[5];
    text += lastY === undefined || lastY === y ? item.str : `\n${item.str}`;
    lastY = y;
  }
  return text;
}

async function readPdfPages(buf: Buffer): Promise<{ pages: string[]; ocr: boolean }> {
  const pages: string[] = [];
  // pdf-parse renders pages in order, one at a time, so push order == page order.
  await pdfParse(buf, {
    pagerender: async (pageData: Parameters<typeof renderPage>[0]) => {
      const t = await renderPage(pageData);
      pages.push(t);
      return t;
    },
  });
  if (pages.join('').replace(/\s/g, '').length >= 20) return { pages, ocr: false };
  // No usable text layer: a scanned PDF. OCR the rendered pages.
  const { ocrPdf } = await import('../lib/pdf-ocr');
  const ocr = await ocrPdf(buf);
  if (ocr.ok) return { pages: ocr.pageTexts, ocr: true };
  return { pages, ocr: false };
}

/** Cap the total text, keeping whole pages where possible. */
function capPages(pages: DocPage[]): { pages: DocPage[]; truncated: boolean } {
  const out: DocPage[] = [];
  let total = 0;
  for (const p of pages) {
    if (total + p.text.length > MAX_DOC_CHARS) {
      const room = MAX_DOC_CHARS - total;
      if (room > 500) out.push({ page: p.page, text: p.text.slice(0, room) });
      return { pages: out, truncated: true };
    }
    out.push(p);
    total += p.text.length;
  }
  return { pages: out, truncated: false };
}

/** Read a document into page texts. Throws DocumentReadError when nothing
 *  readable comes out (unsupported type, blank scan). */
export async function readDocument(file: DocFile): Promise<ReadDocResult> {
  const buf = Buffer.from(file.dataBase64, 'base64');
  const mime = file.mime.toLowerCase();
  const ext = extOf(file.fileName);
  let kind: ReadDocResult['kind'];
  let ocr = false;
  let raw: DocPage[];

  try {
    if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) {
      kind = 'image';
      ocr = true;
      const { ocrImage } = await import('../lib/image-ocr');
      const r = await ocrImage(buf);
      raw = r.ok ? [{ page: 1, text: r.text }] : [];
    } else if (mime.startsWith('application/pdf') || ext === 'pdf') {
      kind = 'pdf';
      const r = await readPdfPages(buf);
      ocr = r.ocr;
      raw = r.pages.map((text, i) => ({ page: i + 1, text }));
    } else if (mime.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml') || ext === 'docx') {
      kind = 'docx';
      const r = await mammoth.extractRawText({ buffer: buf });
      raw = [{ page: null, text: r.value ?? '' }];
    } else if (mime.startsWith('text/') || ext === 'txt' || ext === 'md') {
      kind = 'text';
      raw = [{ page: null, text: buf.toString('utf8') }];
    } else {
      throw new DocumentReadError('Upload a PDF, a photo or scan, or a Word (.docx) file.');
    }
  } catch (err) {
    if (err instanceof DocumentReadError) throw err;
    // Never log the content — only that the read failed.
    logger.warn({ err, mime: file.mime }, 'document-ask: read failed');
    throw new DocumentReadError('This file could not be read. If it is a scan, try a clearer copy.');
  }

  const pages = raw.map((p) => ({ page: p.page, text: clean(p.text) })).filter((p) => p.text);
  if (!pages.length) {
    throw new DocumentReadError(
      ocr ? 'No text could be read from this scan. Try a clearer, straight, well-lit copy.' : 'This file has no readable text.',
    );
  }
  const capped = capPages(pages);
  return {
    fileName: file.fileName,
    kind,
    ocr,
    pages: capped.pages,
    chars: capped.pages.reduce((n, p) => n + p.text.length, 0),
    truncated: capped.truncated,
  };
}

// ---- Paragraphs ----------------------------------------------------------------

// A line that starts a new numbered point: "1.", "12)", "(a)", "iv.", "A."
const POINT_START = /^\s*(?:\(?\d{1,3}[.)]|\([a-z]{1,4}\)|[ivxl]{1,5}[.)]|[A-Z][.)])\s+\S/;

/** Split a page into paragraphs. Blank lines separate paragraphs when the text
 *  has them; a PDF text layer usually doesn't, so then a new paragraph starts at
 *  a numbered point, or after a line that ends a sentence and is clearly shorter
 *  than a full line. Exported for tests. */
export function segmentParagraphs(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (/\n\s*\n/.test(t)) {
    return t.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  }
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  const full = Math.max(...lines.map((l) => l.length));
  const out: string[][] = [];
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const startsNew =
      i === 0 ||
      POINT_START.test(line) ||
      (!!prev && /[.:;]["')\]]?$/.test(prev) && prev.length < full * 0.7);
    if (startsNew) out.push([line]);
    else out[out.length - 1]!.push(line);
  });
  return out.map((ls) => ls.join(' ').replace(/\s+/g, ' ').trim());
}

interface Para {
  page: number | null;
  paragraph: number;
  text: string;
}

function paragraphsOf(pages: DocPage[]): Para[] {
  const out: Para[] = [];
  let running = 0; // paragraph numbers run across "pages" when there are no pages
  for (const p of pages) {
    const paras = segmentParagraphs(p.text);
    paras.forEach((text, i) => {
      running += 1;
      out.push({ page: p.page, paragraph: p.page === null ? running : i + 1, text });
    });
  }
  return out;
}

const label = (p: { page: number | null; paragraph: number }) =>
  p.page === null ? `[para ${p.paragraph}]` : `[p.${p.page} para ${p.paragraph}]`;

// ---- Verification --------------------------------------------------------------

const normQ = (s: string) =>
  s.toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Keep only quotes that really occur in the document. A quote cited to the
 *  wrong paragraph is re-pointed to where it actually is. Exported for tests. */
export function verifyQuotes(
  quotes: unknown,
  pages: DocPage[],
): AskQuote[] {
  if (!Array.isArray(quotes)) return [];
  const paras = paragraphsOf(pages).map((p) => ({ ...p, n: normQ(p.text) }));
  const out: AskQuote[] = [];
  const seen = new Set<string>();
  for (const q of quotes as Array<{ page?: unknown; para?: unknown; paragraph?: unknown; text?: unknown }>) {
    if (!q || typeof q.text !== 'string') continue;
    const text = q.text.replace(/\s+/g, ' ').replace(/^["'“‘]+|["'”’]+$/g, '').trim();
    const n = normQ(text);
    if (n.length < 4) continue;
    const page = typeof q.page === 'number' ? q.page : null;
    const paraNo = typeof q.para === 'number' ? q.para : typeof q.paragraph === 'number' ? q.paragraph : null;
    const cited = paras.find((p) => p.page === page && p.paragraph === paraNo && p.n.includes(n));
    const hit = cited ?? paras.find((p) => p.n.includes(n));
    if (!hit) continue;
    const key = `${hit.page}|${hit.paragraph}|${n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ page: hit.page, paragraph: hit.paragraph, text: text.length > 600 ? `${text.slice(0, 599)}…` : text });
  }
  return out.slice(0, 6);
}

// ---- Asking --------------------------------------------------------------------

const SYSTEM = `You answer an Indian advocate's questions about ONE document (an FIR, an order, a pleading, a notice or similar). The document is given as labelled paragraphs, e.g. [p.3 para 2] = page 3, paragraph 2.

Return ONLY a JSON object:
{"found":true|false,"answer":"...","quotes":[{"page":3,"para":2,"text":"exact words copied from that paragraph"}]}

Rules:
- Use ONLY the document. No outside facts, no law the document does not state, no guesses.
- Every statement in the answer must be supported by a quote. Quotes are copied word for word from the document (a short exact extract, not a paraphrase), with the page and para of the label they come from. Use "page": null when the label has no page.
- If the document does not answer the question, return {"found":false,"answer":"<one sentence on what the document does and does not say about it>","quotes":[]}. Never fill the gap.
- Names, dates, numbers and sections exactly as the document writes them. If the text looks garbled (OCR), say so rather than guess.
- Keep the answer short and plain: a sentence or a few bullet-like lines. Mention the page/para in the answer, e.g. "(p.3 para 2)" — or "(para 2)" when the labels have no page.`;

function documentBlock(pages: DocPage[]): string {
  return paragraphsOf(pages).map((p) => `${label(p)} ${p.text}`).join('\n');
}

export const documentAskService = {
  read: readDocument,

  async ask(req: AskRequest, ctx: { firmId: string | null; userId: string }): Promise<AskResult> {
    const provider: Provider = resolveProvider(req.provider);
    if (provider === 'none') throw new AskUnavailableError();

    // May throw AiQuotaExceededError -> route maps to 429.
    await aiQuotaService.assertCanGenerate(ctx.firmId, ctx.userId);

    const { pages } = capPages(req.pages.filter((p) => p && typeof p.text === 'string' && p.text.trim()));
    const history = (req.history ?? []).slice(-4)
      .map((h) => `Q: ${h.question.slice(0, 1_000)}\nA: ${h.answer.slice(0, 1_500)}`).join('\n\n');
    // The document rides in the SYSTEM block, which is prompt-cached: each
    // follow-up question about the same document re-reads it at the cache rate.
    const system = `${SYSTEM}\n\nDOCUMENT: ${req.fileName}\n\n${documentBlock(pages)}`;
    const user =
      (history ? `EARLIER QUESTIONS (for context only; answer from the document):\n${history}\n\n` : '') +
      `QUESTION: ${req.question.trim()}`;

    const result = await complete(provider, system, user, 1500);
    aiUsageService.recordAsync({
      firmId: ctx.firmId, userId: ctx.userId, feature: 'drafting',
      provider, model: providerModel(provider),
      tokensIn: result.tokensIn, tokensOut: result.tokensOut,
      cacheReadTokens: result.cacheRead, cacheWriteTokens: result.cacheWrite,
    });

    const raw = parseJsonLoose<{ found?: unknown; answer?: unknown; quotes?: unknown }>(result.text);
    if (!raw) {
      logger.warn('document-ask: unparseable JSON');
      return { found: false, answer: 'The answer could not be read. Try asking again.', quotes: [] };
    }
    // A document read without pages is cited "[para N]"; the model sometimes still
    // writes "(p.null para 4)" — drop the empty page.
    const answer = typeof raw.answer === 'string' ? raw.answer.replace(/\bp\.\s*null\s*/gi, '').trim() : '';
    if (raw.found !== true) {
      // The model's one line on what the document does say; long text here would
      // be an answer it was told not to give.
      return { found: false, answer: answer && answer.length <= 400 ? answer : NOT_IN_DOCUMENT, quotes: [] };
    }
    const quotes = verifyQuotes(raw.quotes, pages);
    // An answer with nothing real to stand on is not an answer from the document.
    if (!quotes.length || !answer) {
      return { found: false, answer: `${NOT_IN_DOCUMENT} No passage in it supports an answer.`, quotes: [] };
    }
    return { found: true, answer, quotes };
  },
};
