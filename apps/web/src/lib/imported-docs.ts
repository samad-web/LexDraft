// import-edit-document: what the advocate is told about their own file.
// Codes come from POST /drafting/document/open and the engine's read-docx.

export const IMPORT_ACCEPT = '.docx,.doc,.pdf';
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

export const DOC_TYPES = ['Petition', 'Plaint', 'Written statement', 'Notice', 'Affidavit', 'Agreement', 'Other'] as const;

const ERRORS: Record<string, string> = {
  unsupported: 'Only Word (.docx, .doc) and PDF files can be opened.',
  not_docx: 'This file could not be read as a Word document. Open it in Word, save it as .docx and try again.',
  encrypted_or_doc: 'This Word file is password-protected. Remove the password in Word (File → Info → Protect Document), save, and open it again.',
  macro: 'Files with macros (.docm) can’t be opened. Save it as a normal .docx in Word and try again.',
  too_large: 'This file is over 8 MB. Remove large images or split it, then try again.',
  tracked_changes: 'This file has tracked changes. In Word choose Review → Accept All Changes, save, and open it again.',
  empty: 'This document has no text to edit.',
  too_long: 'This document is too long to edit here (over 5,000 paragraphs).',
  convert_failed: 'This old .doc file could not be converted. Open it in Word, save it as .docx and try again.',
  pdf_unreadable: 'No text could be read from this PDF.',
  case_not_found: 'That case was not found in your firm.',
  case_required: 'Choose a case to copy to.',
  document_not_found: 'That document was not found.',
  no_file: 'That document has no file attached.',
  engine_unavailable: 'Couldn’t open the file right now. Please try again in a minute.',
};

export function importErrorText(code: string | undefined): string {
  return (code && ERRORS[code]) || 'Couldn’t open this file.';
}

const WARNINGS: Record<string, string> = {
  pdf_text_only: 'PDF opened as text only: its layout can’t be kept. Check every name, date and amount, especially in a scan.',
  legacy_tamil_font: 'This file uses an old Tamil font (like Bamini or Vanavil), so Tamil text may look garbled. Retype it in a Unicode Tamil font.',
  auto_numbering: 'Word’s automatic paragraph numbers don’t show here, but they stay in the downloaded file.',
  header_footer: 'Headers and footers stay in the downloaded file but can’t be edited here.',
  images: 'Images, logos and stamps stay in the downloaded file.',
  footnotes: 'Footnotes stay in the downloaded file but can’t be edited here.',
  text_boxes: 'Text inside text boxes can’t be edited here; it stays in the downloaded file.',
};

/** The warnings worth showing, worded; unknown codes are dropped. */
export function importWarnings(codes: string[] | undefined): string[] {
  return (codes ?? []).map((c) => WARNINGS[c]).filter((w): w is string => !!w);
}

/** A file the editor can open ("Edit in DifAi" on a Documents row). */
export function canEditInDifai(d: { hasFile?: boolean; fileName?: string; fileMime?: string; kind?: string; draftId?: string }): boolean {
  if (d.kind === 'draft' || d.draftId || !d.hasFile) return false;
  if (d.fileName && /\.(docx|doc|pdf)$/i.test(d.fileName)) return true;
  return /wordprocessingml|msword|application\/pdf/i.test(d.fileMime ?? '');
}
