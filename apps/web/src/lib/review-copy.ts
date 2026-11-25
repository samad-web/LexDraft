// review-copy: starting a review and what the advocate is told when it can't.
import { api } from '@/lib/api';

const ERRORS: Record<string, string> = {
  not_pdf: 'This file couldn’t be turned into pages to mark up.',
  too_large: 'This document is too large for a review copy (10 MB).',
  convert_failed: 'Couldn’t make a review copy of this file. For Word, save it again in Word; for a photo, take it again.',
  heic: 'This iPhone photo is in HEIC format. Upload it again from the iPhone (it now comes as JPEG), or set Settings → Camera → Formats → Most Compatible.',
  too_many_files: 'Mark up at most 20 files together.',
  too_many_pages: 'This review already has 200 pages. Save it to Documents and start a new one.',
  unsupported: 'Only PDF and Word files can be reviewed.',
  encrypted_or_doc: 'This Word file is password-protected. Remove the password in Word and try again.',
  draft_not_found: 'Save the draft first, then make a review copy.',
  document_not_found: 'That document was not found.',
  review_not_found: 'This review was not found. It may have been deleted.',
  not_author: 'Only the advocate who made this review can change it.',
  no_file: 'That document has no file attached.',
  too_many_marks: 'This review has too many marks. Save it to Documents and start a new review copy.',
  case_not_found: 'That case was not found in your firm.',
};

export function reviewErrorText(code: string | undefined): string {
  return (code && ERRORS[code]) || 'Something went wrong with the review copy. Please try again.';
}

/** Files a review copy can be made of. */
export function canReview(d: { hasFile?: boolean; fileName?: string; fileMime?: string; kind?: string; reviewId?: string }): boolean {
  if (d.kind === 'draft' || d.reviewId || !d.hasFile) return false;
  if (d.fileName && /\.(pdf|docx|doc|jpe?g|png|webp|tiff?)$/i.test(d.fileName)) return true;
  return /application\/pdf|wordprocessingml|msword|image\/(jpeg|png|webp|tiff)/i.test(d.fileMime ?? '');
}

export async function reviewFromDocument(documentId: string): Promise<string> {
  return (await api.post<{ id: string }>('/reviews', { documentId })).id;
}

/** Several case files (PDFs, Word, photos of paper) as one review, in order. */
export async function reviewFromDocuments(documentIds: string[]): Promise<string> {
  return (await api.post<{ id: string }>('/reviews', { documentIds })).id;
}

/** A blank A4 sheet to write on with the pen, filed with the case. */
export async function blankReview(matter: string): Promise<string> {
  return (await api.post<{ id: string }>('/reviews', { blank: true, matter })).id;
}

export async function reviewFromDraft(input: { draftId: string; title: string; matter: string; pdf: Blob }): Promise<string> {
  const buf = new Uint8Array(await input.pdf.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return (await api.post<{ id: string }>('/reviews', {
    draftId: input.draftId, title: input.title, matter: input.matter, pdfBase64: btoa(bin),
  })).id;
}
