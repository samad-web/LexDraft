import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

// Password-protected PDF (build-docs/features/protected-pdf.md):
// stamp a "Confidential" watermark on every page, then lock the file with
// AES-256 via qpdf. The password is never logged or stored, and never put on
// the qpdf command line (other processes could read it): it goes in a qpdf
// argument file inside a private temp dir that is removed afterwards.

export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export class PdfProtectError extends Error {
  constructor(message: string, readonly status: 400 | 503) {
    super(message);
  }
}

export type QpdfRunner = (argFile: string) => Promise<void>;

const runQpdf: QpdfRunner = (argFile) =>
  new Promise((resolve, reject) => {
    execFile(process.env.QPDF_PATH || 'qpdf', [`@${argFile}`], { timeout: 60_000 }, (err) => {
      if (!err) return resolve();
      // qpdf exit 3 = warnings only; the output file is still written.
      if ((err as { code?: unknown }).code === 3) return resolve();
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(new PdfProtectError('Password lock is not available on this server', 503));
      }
      reject(new PdfProtectError('Could not lock this PDF', 400));
    });
  });

export function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 4 || pw.length > 64) {
    throw new PdfProtectError('Password must be 4 to 64 characters', 400);
  }
  // qpdf reads one argument per line: a newline would split it.
  if (/[\r\n\0]/.test(pw)) throw new PdfProtectError('Password cannot contain line breaks', 400);
  return pw;
}

async function watermark(pdf: Buffer, text: string): Promise<Buffer> {
  try {
    return await stamp(pdf, text);
  } catch (err) {
    if (err instanceof PdfProtectError) throw err;
    if ((err as Error).name === 'EncryptedPDFError') throw new PdfProtectError('This PDF is already password protected', 400);
    // pdf-lib parses broken files leniently and fails later: any error here means unreadable.
    throw new PdfProtectError('This file is not a readable PDF', 400);
  }
}

async function stamp(pdf: Buffer, text: string): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  if (doc.getPageCount() === 0) throw new PdfProtectError('This file is not a readable PDF', 400);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  // Standard fonts are WinAnsi only: drop anything they can't draw (e.g. Tamil).
  const safe = text.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Confidential';
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(40, (width * 1.1) / Math.max(10, safe.length * 0.55));
    page.drawText(safe, {
      x: width * 0.12,
      y: height * 0.3,
      size,
      font,
      color: rgb(0.6, 0.6, 0.6),
      opacity: 0.18,
      rotate: degrees(35),
    });
    page.drawText(safe, { x: 24, y: 14, size: 8, font, color: rgb(0.45, 0.45, 0.45), opacity: 0.8 });
  }
  return Buffer.from(await doc.save());
}

export async function protectPdf(
  pdf: Buffer,
  password: string,
  watermarkText: string,
  run: QpdfRunner = runQpdf,
): Promise<Buffer> {
  if (!pdf.length) throw new PdfProtectError('Empty file', 400);
  if (pdf.length > MAX_PDF_BYTES) throw new PdfProtectError('PDF is larger than 25 MB', 400);
  if (pdf.subarray(0, 1024).indexOf('%PDF-') === -1) throw new PdfProtectError('Only PDF files can be locked', 400);
  validatePassword(password);

  const marked = await watermark(pdf, watermarkText);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'difai-lock-'));
  try {
    await fs.chmod(dir, 0o700);
    const inFile = path.join(dir, 'in.pdf');
    const outFile = path.join(dir, 'out.pdf');
    const argFile = path.join(dir, 'args');
    await fs.writeFile(inFile, marked, { mode: 0o600 });
    // Owner password: random, so nobody (not even DifAi) can lift the restrictions.
    const owner = randomBytes(24).toString('base64url');
    await fs.writeFile(
      argFile,
      ['--encrypt', `--user-password=${password}`, `--owner-password=${owner}`, '--bits=256', '--', inFile, outFile].join('\n'),
      { mode: 0o600 },
    );
    await run(argFile);
    const out = await fs.readFile(outFile).catch(() => null);
    if (!out?.length) throw new PdfProtectError('Could not lock this PDF', 400);
    return out;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
