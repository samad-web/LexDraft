// =============================================================================
// text-extraction - pulls AI-consumable plaintext out of an uploaded file blob.
//
// Used by case-notes.service when an advocate uploads a file as a note. The
// extracted text becomes the note's `body` column - the LLM sees that, not the
// raw file. The original blob is still kept in storage for download.
//
// Supported types (auto-detected by mime; falls back to file extension):
//   text/plain, text/markdown       → utf-8 decode
//   application/pdf                 → pdf-parse
//   application/vnd.openxmlformats-officedocument.wordprocessingml.document
//   (i.e. .docx)                    → mammoth
//
// Anything else returns a graceful 'failed' result with a reason - the row
// still persists, just with empty body. The UI surfaces this so the advocate
// can paste a synopsis manually.
// =============================================================================

import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { logger } from '../logger';

export type ExtractionResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

// Maximum length of text we keep on the note. ~64k chars ≈ 16k tokens, well
// below Sonnet/Grok's context window once combined with the other prompt
// pieces. Anything longer is truncated with a marker.
const MAX_CHARS = 64_000;

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}\n\n[... truncated, original file is ${text.length} characters]`;
}

function normalizeWhitespace(text: string): string {
  // PDF/DOCX extractors emit lots of repeated newlines and ragged spacing.
  // Collapse runs of 3+ newlines to 2, and strip trailing spaces per line.
  //
  // Also drop NUL bytes and other C0 control chars (except tab/LF/CR). pdf-parse
  // routinely emits stray \x00 sequences from PDF binary streams; Postgres
  // `text` columns reject any UTF-8 containing 0x00 with "invalid byte
  // sequence for encoding UTF8: 0x00", which would crash the upload with a
  // 500 even though extraction itself succeeded.
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeMime(mime: string, candidates: string[]): boolean {
  const m = mime.toLowerCase();
  return candidates.some((c) => m === c || m.startsWith(c));
}

function extByName(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * Try every extractor the file could plausibly match. Returns `{ ok: false }`
 * with a human-readable reason when no extractor fits or the chosen extractor
 * throws - never throws back up to the caller.
 */
export async function extractText(input: {
  body: Buffer;
  mime: string;
  fileName: string;
}): Promise<ExtractionResult> {
  const ext = extByName(input.fileName);

  try {
    if (looksLikeMime(input.mime, ['text/plain', 'text/markdown']) || ext === 'txt' || ext === 'md') {
      const text = input.body.toString('utf8');
      return { ok: true, text: truncate(normalizeWhitespace(text)) };
    }
    if (looksLikeMime(input.mime, ['application/pdf']) || ext === 'pdf') {
      const result = await pdfParse(input.body);
      return { ok: true, text: truncate(normalizeWhitespace(result.text ?? '')) };
    }
    if (
      looksLikeMime(input.mime, [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ]) ||
      ext === 'docx'
    ) {
      const result = await mammoth.extractRawText({ buffer: input.body });
      return { ok: true, text: truncate(normalizeWhitespace(result.value ?? '')) };
    }
    return {
      ok: false,
      error: `Unsupported file type "${input.mime || ext}". Supported: PDF, DOCX, TXT, MD.`,
    };
  } catch (err) {
    logger.warn({ err, mime: input.mime, fileName: input.fileName }, 'text extraction failed');
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Extraction failed',
    };
  }
}

/** mime types the upload presigner should accept for case-note attachments. */
export const SUPPORTED_NOTE_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
