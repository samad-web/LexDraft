// case-markup: photos of paper documents become upright pages; several files
// become one review; blank sheets and extra pages.
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { appendBlankPage, blankPdf, imageKind, imageToPdf, jpegOrientation, mergePdfs } from '../review-pages';
import { JPEG_TURNED, JPEG_UPRIGHT, PNG } from './fixtures/photos';

const size = async (pdf: Buffer, i = 0) => {
  const p = (await PDFDocument.load(pdf)).getPage(i);
  return [Math.round(p.getWidth()), Math.round(p.getHeight())];
};

describe('imageKind: from the bytes, not the name', () => {
  it('knows JPEG, PNG, WebP, TIFF and iPhone HEIC; not a PDF', () => {
    expect(imageKind(JPEG_UPRIGHT)).toBe('jpeg');
    expect(imageKind(PNG)).toBe('png');
    expect(imageKind(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('webp');
    expect(imageKind(Buffer.from('II*\0rest', 'latin1'))).toBe('tiff');
    expect(imageKind(Buffer.from('\0\0\0\x18ftypheic\0\0', 'latin1'))).toBe('heic');
    expect(imageKind(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('phone photos are upright', () => {
  it('reads the EXIF orientation (1 upright, 6 turned), 1 when there is none', () => {
    expect(jpegOrientation(JPEG_UPRIGHT)).toBe(1);
    expect(jpegOrientation(JPEG_TURNED)).toBe(6);
    expect(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
  });

  it('an upright 40x20 photo is an A4-wide landscape page; a turned one is portrait', async () => {
    expect(await size(await imageToPdf(JPEG_UPRIGHT, 'jpeg'))).toEqual([595, 298]);
    expect(await size(await imageToPdf(JPEG_TURNED, 'jpeg'))).toEqual([595, 1190]);
    expect(await size(await imageToPdf(PNG, 'png'))).toEqual([595, 298]);
  });
});

describe('several files, blank sheets, more paper', () => {
  it('merges files into one set of pages, in order', async () => {
    const two = await mergePdfs([await imageToPdf(JPEG_UPRIGHT, 'jpeg'), await blankPdf(2)]);
    const doc = await PDFDocument.load(two);
    expect(doc.getPageCount()).toBe(3);
    expect(await size(two, 0)).toEqual([595, 298]);
    expect(await size(two, 2)).toEqual([595, 842]);
  });

  it('a blank sheet is A4; Add page appends one more and keeps the others', async () => {
    expect(await size(await blankPdf())).toEqual([595, 842]);
    const photo = await imageToPdf(JPEG_UPRIGHT, 'jpeg');
    const out = await appendBlankPage(photo);
    expect(out.pageCount).toBe(2);
    expect(await size(out.pdf, 0)).toEqual([595, 298]);
    expect(await size(out.pdf, 1)).toEqual([595, 842]);
  });
});
