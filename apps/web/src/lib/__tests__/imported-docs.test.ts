import { describe, expect, it } from 'vitest';
import { canEditInDifai, importErrorText, importWarnings } from '../imported-docs';

// import-edit-document: what the advocate sees about their own file.
describe('imported-docs', () => {
  it('ac9: every refusal the server sends has plain advice; unknown codes get a safe default', () => {
    for (const code of ['unsupported', 'not_docx', 'encrypted_or_doc', 'macro', 'too_large', 'tracked_changes',
      'empty', 'too_long', 'convert_failed', 'pdf_unreadable', 'case_not_found', 'engine_unavailable']) {
      expect(importErrorText(code)).not.toBe('Couldn’t open this file.');
    }
    expect(importErrorText('tracked_changes')).toContain('Accept All Changes');
    expect(importErrorText('encrypted_or_doc')).toContain('password');
    expect(importErrorText('something_new')).toBe('Couldn’t open this file.');
    expect(importErrorText(undefined)).toBe('Couldn’t open this file.');
  });

  it('words the warnings (legacy Tamil font, PDF text-only) and drops unknown codes', () => {
    const w = importWarnings(['legacy_tamil_font', 'pdf_text_only', 'unknown']);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain('Tamil');
    expect(w[1]).toContain('layout');
    expect(importWarnings(undefined)).toEqual([]);
  });

  it('"Edit in DifAi" only on stored Word/PDF files, never on drafts or edited copies', () => {
    expect(canEditInDifai({ hasFile: true, fileName: 'Plaint.DOCX' })).toBe(true);
    expect(canEditInDifai({ hasFile: true, fileName: 'old.doc' })).toBe(true);
    expect(canEditInDifai({ hasFile: true, fileName: 'order.pdf' })).toBe(true);
    expect(canEditInDifai({ hasFile: true, fileMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(true);
    expect(canEditInDifai({ hasFile: true, fileName: 'photo.jpg', fileMime: 'image/jpeg' })).toBe(false);
    expect(canEditInDifai({ hasFile: false, fileName: 'x.docx' })).toBe(false);
    expect(canEditInDifai({ kind: 'draft', hasFile: true, fileName: 'x.docx' })).toBe(false);
    expect(canEditInDifai({ hasFile: true, fileName: 'x.docx', draftId: 'd1' })).toBe(false);
  });
});
