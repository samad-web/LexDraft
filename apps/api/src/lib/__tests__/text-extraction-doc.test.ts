// save-as-case-note AC5/AC6: an old Word .doc is read (LibreOffice -> .docx ->
// mammoth); other types are unchanged. LibreOffice and mammoth are mocked here;
// the real conversion is covered by the import-edit-document local end-to-end run.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractText, SUPPORTED_NOTE_MIME_TYPES } from '../text-extraction';
import { convertDocToDocx } from '../../services/document-render.service';
import mammoth from 'mammoth';

vi.mock('../../services/document-render.service', () => ({ convertDocToDocx: vi.fn() }));
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn() } }));

const DOC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]);
const DOCX = Buffer.from('converted docx');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(convertDocToDocx).mockResolvedValue(DOCX);
  vi.mocked(mammoth.extractRawText).mockImplementation(async (input) => ({
    value: (input as { buffer: Buffer }).buffer.equals(DOCX) ? 'Text of the old .doc' : 'Text of a docx',
    messages: [],
  }));
});

describe('extractText: old Word .doc', () => {
  it('converts by mime or by .doc name, then reads the text', async () => {
    expect(await extractText({ body: DOC, mime: 'application/msword', fileName: 'notice' })).toEqual({ ok: true, text: 'Text of the old .doc' });
    expect(await extractText({ body: DOC, mime: 'application/octet-stream', fileName: 'Notice.DOC' })).toEqual({ ok: true, text: 'Text of the old .doc' });
    expect(convertDocToDocx).toHaveBeenCalledTimes(2);
  });

  it('a .doc LibreOffice cannot convert is reported, not thrown', async () => {
    vi.mocked(convertDocToDocx).mockRejectedValueOnce(new Error('soffice exited 1'));
    const r = await extractText({ body: DOC, mime: 'application/msword', fileName: 'bad.doc' });
    expect(r.ok).toBe(false);
  });

  it('a .docx still goes straight to mammoth (no conversion)', async () => {
    expect(await extractText({
      body: Buffer.from('PK'), mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'a.docx',
    })).toEqual({ ok: true, text: 'Text of a docx' });
    expect(convertDocToDocx).not.toHaveBeenCalled();
  });

  it('notes accept application/msword; unknown types are still refused', async () => {
    expect(SUPPORTED_NOTE_MIME_TYPES).toContain('application/msword');
    const r = await extractText({ body: Buffer.from('x'), mime: 'image/png', fileName: 'a.png' });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toContain('DOC, DOCX');
  });
});
