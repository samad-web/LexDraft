// review-copy pages: photos of paper documents, several files in one review,
// and blank sheets to write on (case-markup, build-docs/features/case-markup.md).
// pdf-lib only (JPEG / PNG embed as they are); other image types go through
// LibreOffice in the caller. No model calls.
import { PDFDocument, degrees } from 'pdf-lib';

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'tiff' | 'heic';

/** Image type from the bytes (names and mime types lie). */
export function imageKind(b: Buffer): ImageKind | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  const t = b.subarray(0, 4).toString('latin1');
  if (t === 'II*\0' || t === 'MM\0*') return 'tiff';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(b.subarray(8, 12).toString('latin1'))) return 'heic';
  return null;
}

/** The EXIF orientation of a phone photo (1 = upright; 3 / 6 / 8 = turned
 *  180 / 90 clockwise / 90 anticlockwise). Mirrored values count as their turn. */
export function jpegOrientation(b: Buffer): number {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker === 0xe1 && b.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
      const t = i + 10;
      const le = b.subarray(t, t + 2).toString('latin1') === 'II';
      const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
      const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
      const ifd = t + u32(t + 4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (e + 10 > b.length) break;
        if (u16(e) === 0x0112) return ({ 2: 1, 4: 3, 5: 6, 7: 8 } as Record<number, number>)[u16(e + 8)] ?? u16(e + 8);
      }
      return 1;
    }
    if (marker === 0xda) break; // image data: no EXIF after this
    i += 2 + len;
  }
  return 1;
}

const A4_W = 595;

/** A JPEG / PNG photo as one page the width of A4, turned upright. */
export async function imageToPdf(b: Buffer, kind: 'jpeg' | 'png'): Promise<Buffer> {
  const doc = await PDFDocument.create();
  // A copy that owns its memory: pdf-lib reads the underlying ArrayBuffer, and a
  // small Node Buffer shares a pooled one (it would see the wrong bytes).
  const own = new Uint8Array(b);
  const img = kind === 'jpeg' ? await doc.embedJpg(own) : await doc.embedPng(own);
  const o = kind === 'jpeg' ? jpegOrientation(b) : 1;
  const turned = o === 6 || o === 8;
  const scale = A4_W / (turned ? img.height : img.width);
  const w = img.width * scale;
  const h = img.height * scale;
  const page = doc.addPage(turned ? [h, w] : [w, h]);
  // drawImage turns about the image's bottom-left corner; place it so the
  // turned photo fills the page (worked through in review-pages.test).
  if (o === 6) page.drawImage(img, { x: 0, y: w, width: w, height: h, rotate: degrees(-90) });
  else if (o === 8) page.drawImage(img, { x: h, y: 0, width: w, height: h, rotate: degrees(90) });
  else if (o === 3) page.drawImage(img, { x: w, y: h, width: w, height: h, rotate: degrees(180) });
  else page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  return Buffer.from(await doc.save());
}

/** Several PDFs as one, pages in order. */
export async function mergePdfs(parts: Buffer[]): Promise<Buffer> {
  if (parts.length === 1) return parts[0]!;
  const out = await PDFDocument.create();
  for (const p of parts) {
    const src = await PDFDocument.load(p, { ignoreEncryption: true });
    (await out.copyPages(src, src.getPageIndices())).forEach((pg) => out.addPage(pg));
  }
  return Buffer.from(await out.save());
}

/** A blank A4 sheet to write on. */
export async function blankPdf(pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([A4_W, 842]);
  return Buffer.from(await doc.save());
}

/** One more blank A4 page at the end (marks on earlier pages stay put). */
export async function appendBlankPage(pdf: Buffer): Promise<{ pdf: Buffer; pageCount: number }> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  doc.addPage([A4_W, 842]);
  return { pdf: Buffer.from(await doc.save()), pageCount: doc.getPageCount() };
}
