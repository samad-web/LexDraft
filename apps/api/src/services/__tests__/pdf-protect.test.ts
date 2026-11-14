import fs from 'node:fs/promises';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { PdfProtectError, protectPdf, type QpdfRunner } from '../pdf-protect.service';

// Password-protected PDF (features/protected-pdf.md). qpdf itself is faked here
// (not installed on dev machines); the real AES-256 lock is verified inside the
// api container after the build (see TESTING.md).

async function makePdf(pages = 2): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage().drawText(`Page ${i + 1} of the brief`, { x: 50, y: 700, font, size: 12 });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Records the qpdf argument file and copies in -> out like a successful run. */
function fakeQpdf(seen: { args?: string[]; argFile?: string }): QpdfRunner {
  return async (argFile) => {
    seen.argFile = argFile;
    seen.args = (await fs.readFile(argFile, 'utf8')).split('\n');
    const [inFile, outFile] = seen.args.slice(-2) as [string, string];
    await fs.copyFile(inFile, outFile);
  };
}

const tmpLeftovers = async () => (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('difai-lock-'));

describe('Lock PDF with password', () => {
  it('asks qpdf for AES-256 with the advocate password and a random owner password', async () => {
    const seen: { args?: string[] } = {};
    await protectPdf(await makePdf(), '482913', 'Confidential - for R. Kumar - 14 Nov 2026', fakeQpdf(seen));
    expect(seen.args).toContain('--encrypt');
    expect(seen.args).toContain('--bits=256');
    expect(seen.args).toContain('--user-password=482913');
    const owner = seen.args!.find((a) => a.startsWith('--owner-password='))!;
    expect(owner.length).toBeGreaterThan('--owner-password='.length + 20);
    expect(owner).not.toContain('482913');
  });

  it('gives the password to qpdf only through a private file, never the command line', async () => {
    const seen: { argFile?: string } = {};
    await protectPdf(await makePdf(), 'secret-pin', 'Confidential', fakeQpdf(seen));
    // The runner receives only the arg-file path; the file is gone afterwards.
    expect(seen.argFile).not.toContain('secret-pin');
    await expect(fs.access(seen.argFile!)).rejects.toThrow();
  });

  it('stamps the watermark on every page and keeps the page count', async () => {
    const out = await protectPdf(await makePdf(3), '4829', 'Confidential - for R. Kumar', fakeQpdf({}));
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    // pdf-lib writes drawText as hex strings inside each page's (compressed) content stream.
    const hex = Buffer.from('Confidential - for R. Kumar').toString('hex').toUpperCase();
    for (const page of doc.getPages()) {
      const c = page.node.Contents()!;
      const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
      const text = streams
        .map((st) => Buffer.from(decodePDFRawStream(st as PDFRawStream).decode()).toString('latin1'))
        .join('\n');
      expect(text.split(hex).length - 1).toBe(2); // centre + footer
    }
    expect(out.length).toBeGreaterThan((await makePdf(3)).length);
  });

  it('drops characters the PDF font cannot draw instead of failing (e.g. Tamil client name)', async () => {
    await expect(protectPdf(await makePdf(), '4829', 'Confidential - for முருகன்', fakeQpdf({}))).resolves.toBeInstanceOf(Buffer);
  });

  it.each([
    ['too short', '123'],
    ['too long', 'x'.repeat(65)],
    ['a line break', '12\n34'],
    ['not text', 1234 as unknown as string],
  ])('refuses a password that is %s', async (_label, pw) => {
    await expect(protectPdf(await makePdf(), pw, 'Confidential', fakeQpdf({}))).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a file that is not a PDF', async () => {
    await expect(protectPdf(Buffer.from('PK\x03\x04 word file'), '4829', 'x', fakeQpdf({}))).rejects.toThrow(/Only PDF/);
  });

  it('refuses an empty file and one over 25 MB', async () => {
    await expect(protectPdf(Buffer.alloc(0), '4829', 'x', fakeQpdf({}))).rejects.toThrow(/Empty/);
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(25 * 1024 * 1024)]);
    await expect(protectPdf(big, '4829', 'x', fakeQpdf({}))).rejects.toThrow(/25 MB/);
  });

  it('refuses a corrupt PDF with a clear message', async () => {
    await expect(protectPdf(Buffer.from('%PDF-1.7\ngarbage'), '4829', 'x', fakeQpdf({}))).rejects.toThrow(/not a readable PDF/);
  });

  it('reports 503 when qpdf is not installed, and leaves no temp files', async () => {
    const before = await tmpLeftovers();
    const missing: QpdfRunner = async () => {
      throw new PdfProtectError('Password lock is not available on this server', 503);
    };
    await expect(protectPdf(await makePdf(), '4829', 'x', missing)).rejects.toMatchObject({ status: 503 });
    expect(await tmpLeftovers()).toEqual(before);
  });

  it('fails cleanly if qpdf writes no output', async () => {
    const noOutput: QpdfRunner = async () => {};
    await expect(protectPdf(await makePdf(), '4829', 'x', noOutput)).rejects.toThrow(/Could not lock/);
  });
});
