// =============================================================================
// image-ocr — LOCAL, no-API optical character recognition for attachments.
//
// Runs tesseract.js (open-source, on-device) to pull text out of a cheque/memo
// photo. ZERO per-use cost — no vision API, no tokens. The extracted text is then
// mapped to fields by the DETERMINISTIC rule extractor, so the whole attachment
// path is free.
//
// Honest limits: local OCR is weaker than a cloud vision model on skewed / low-
// light phone photos. When it can't read a value cleanly the field simply stays
// "still needed" and the advocate types it — the same graceful fallback the rest
// of the intake loop uses. Accuracy is best on flat, well-lit, high-contrast
// scans.
//
// A single worker is created lazily and reused across requests (worker startup +
// language-data load is the expensive part; recognition itself is cheap). The
// English trained data is bundled by tesseract.js and loaded from disk/CDN cache
// on first use.
// =============================================================================

import { createWorker, type Worker } from 'tesseract.js';
import { logger } from '../logger';

let workerPromise: Promise<Worker> | null = null;

/** Lazily create (once) and reuse the OCR worker. */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng').catch((err) => {
      // Reset so a later call can retry a fresh worker rather than reusing a
      // rejected promise forever.
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export type OcrResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * OCR an image buffer to plain text. Never throws — returns `{ ok: false }` with
 * a reason so the caller can fall back to asking the advocate to type the value.
 */
export async function ocrImage(buffer: Buffer): Promise<OcrResult> {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    const text = (data.text ?? '').trim();
    if (!text) return { ok: false, error: 'no text recognised in the image' };
    return { ok: true, text };
  } catch (err) {
    logger.warn({ err }, 'image OCR failed');
    return { ok: false, error: err instanceof Error ? err.message : 'OCR failed' };
  }
}

/** Tear the worker down (tests / graceful shutdown). Safe to call when none. */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // ignore
  } finally {
    workerPromise = null;
  }
}
