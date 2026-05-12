/**
 * Client-side text extraction for contract uploads.
 *
 * Supports:
 *   - .pdf   via pdfjs-dist
 *   - .docx  via mammoth (already used by ImportClausesModal)
 *   - .txt / .md and anything with a text/* MIME type — plain FileReader
 *
 * Returns the extracted text. Throws `UnsupportedFileError` if the file kind
 * isn't one of the above so callers can render a paste-instead hint.
 *
 * Why client-side: keeps the API contract (`POST /api/review`) JSON-only —
 * no multipart, no server-side parser deps. Mirrors how the clauses importer
 * already converts DOCX in the browser.
 */

import mammoth from 'mammoth';

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const DOCX_EXTENSIONS = new Set(['.docx']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

async function extractText(file: File): Promise<string> {
  return file.text();
}

async function extractDocx(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  // extractRawText keeps the prose linear — we don't need the HTML structure
  // mammoth emits via convertToHtml. The model wants the contract as a
  // continuous text body.
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  return value;
}

/** pdfjs-dist v4 ships as an ESM module. We import lazily so the ~600KB
 *  bundle only loads when the user actually opens a PDF. */
async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  // Without a worker, pdfjs falls back to running on the main thread — slower
  // but functional. We point it at the bundled worker so big PDFs don't
  // freeze the UI. Vite resolves `?url` to a stable build URL.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => (typeof (it as { str?: unknown }).str === 'string' ? (it as { str: string }).str : ''))
      .filter(Boolean)
      .join(' ');
    pages.push(line);
  }
  return pages.join('\n\n');
}

export async function extractDocumentText(file: File): Promise<string> {
  const ext = extensionOf(file.name);
  const mime = file.type.toLowerCase();

  if (DOCX_EXTENSIONS.has(ext) || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(file);
  }
  if (PDF_EXTENSIONS.has(ext) || mime === 'application/pdf') {
    return extractPdf(file);
  }
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/')) {
    return extractText(file);
  }
  throw new UnsupportedFileError(
    `Cannot extract text from "${file.name}". Supported formats: PDF, DOCX, TXT/MD. Paste the contract text directly to continue.`,
  );
}
