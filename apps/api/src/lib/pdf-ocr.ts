// =============================================================================
// pdf-ocr — OCR fallback for IMAGE/scanned PDFs.
//
// pdf-parse only reads a PDF's TEXT LAYER. A scanned or image-exported PDF has no
// text layer, so pdf-parse returns ~nothing and the document's content never reaches
// the extractor — the exact reason an attached scanned notice/agreement produced an
// empty draft. This rasterises each page with pdfjs-dist + @napi-rs/canvas and runs
// the same on-device tesseract OCR the image-attachment path already uses, so a scanned
// PDF becomes readable text like any other document.
//
// Local + no API. Slower than a text-layer read (rendering + OCR per page), so it is a
// FALLBACK — only invoked when pdf-parse yields too little text to be real content.
// =============================================================================

import { createWorker, type Worker } from 'tesseract.js';
import { logger } from '../logger';

// Cap pages OCR'd so a huge scan can't hang an attach; the affidavit/notice matters
// we care about are a few pages. Logged when we stop early so nothing is silently lost.
const MAX_OCR_PAGES = 15;
const RENDER_SCALE = 2; // 2x gives tesseract enough resolution without ballooning memory

let workerPromise: Promise<Worker> | null = null;
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export type PdfOcrResult = { ok: true; text: string; pages: number } | { ok: false; error: string };

/** Rasterise a PDF and OCR each page. Returns the concatenated page text. */
export async function ocrPdf(buffer: Buffer): Promise<PdfOcrResult> {
  try {
    // Legacy build + disabled worker: required for a Node (non-browser) context.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');

    // Cast: disableWorker/isEvalSupported are valid runtime options for the Node
    // (non-browser) path but aren't in the published DocumentInitParameters type.
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableWorker: true,
      isEvalSupported: false,
    } as never).promise;

    const worker = await getWorker();
    const pageCount = Math.min(doc.numPages, MAX_OCR_PAGES);
    const parts: string[] = [];
    for (let n = 1; n <= pageCount; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');
      // pdfjs needs a canvas + context; @napi-rs/canvas is API-compatible enough.
      await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
      const png = canvas.toBuffer('image/png');
      const { data } = await worker.recognize(png);
      if (data.text?.trim()) parts.push(data.text);
    }
    if (doc.numPages > MAX_OCR_PAGES) {
      logger.warn({ total: doc.numPages, ocrd: MAX_OCR_PAGES }, 'pdf-ocr: page cap reached; later pages not OCRd');
    }
    const text = parts.join('\n\n');
    if (!text.trim()) return { ok: false, error: 'OCR produced no text' };
    return { ok: true, text, pages: pageCount };
  } catch (err) {
    logger.warn({ err }, 'pdf-ocr failed');
    return { ok: false, error: (err as Error)?.message ?? 'pdf OCR failed' };
  }
}
