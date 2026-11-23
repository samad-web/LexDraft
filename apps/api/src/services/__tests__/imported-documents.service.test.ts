// import-edit-document — acceptance criteria 3-6 and 9 of
// build-docs/features/import-edit-document.md (engine side: lexdraft-engine
// tests/service/test_user_docx.py). DB-less: documents/drafts/storage/engine mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentRecord, SavedDraft } from '@lexdraft/types';
// vi.mock calls below are hoisted above these imports.
import { importedDocumentsService as svc, detectKind, pdfLines, ImportError } from '../imported-documents.service';
import { engineClient } from '../engine-client.service';
import { documentsService } from '../documents.service';
import { draftsService } from '../drafts.service';
import { convertDocToDocx } from '../document-render.service';
import { extractText } from '../../lib/text-extraction';

const docs = new Map<string, DocumentRecord & { body?: Buffer }>();
const drafts = new Map<string, SavedDraft>();
let n = 0;

vi.mock('../../db/client', () => ({ db: () => null }));
vi.mock('../engine-client.service', () => ({
  engineClient: { readDocx: vi.fn(), applyEdits: vi.fn(), composeDocx: vi.fn() },
}));
vi.mock('../document-render.service', () => ({ convertDocToDocx: vi.fn() }));
vi.mock('../../lib/text-extraction', () => ({ extractText: vi.fn() }));
vi.mock('../storage.service', () => ({
  storage: () => ({ getObject: async (key: string) => ({ body: docs.get(key)?.body ?? Buffer.alloc(0) }) }),
}));
vi.mock('../documents.service', () => ({
  documentsService: {
    get: vi.fn(async (id: string, firmId: string | null) => (firmId === 'firm-1' ? docs.get(id) : undefined)),
    getStorageKey: vi.fn(async (id: string, firmId: string | null) =>
      firmId === 'firm-1' && docs.get(id)?.body ? { key: id, fileMime: 'x' } : null),
    create: vi.fn(async (input: DocumentRecord & { fileBase64?: string }) => {
      const id = `doc-${++n}`;
      const rec = { ...input, id, kind: 'document' as const, hasFile: true, body: Buffer.from(input.fileBase64 ?? '', 'base64') };
      docs.set(id, rec);
      return rec;
    }),
    replaceFile: vi.fn(async (id: string, _f: string, file: { body: Buffer }) => {
      docs.set(id, { ...docs.get(id)!, body: file.body });
      return docs.get(id);
    }),
    update: vi.fn(async (id: string, _f: string, patch: Partial<DocumentRecord>) => {
      docs.set(id, { ...docs.get(id)!, ...patch });
      return docs.get(id);
    }),
    remove: vi.fn(async (id: string) => docs.delete(id)),
  },
}));
vi.mock('../drafts.service', () => ({
  draftsService: {
    get: vi.fn(async (id: string) => drafts.get(id) ?? null),
    create: vi.fn(async (req: Partial<SavedDraft>) => {
      const d = { ...req, id: `draft-${++n}`, editedDocumentId: null, sourceDocumentId: req.sourceDocumentId ?? null } as SavedDraft;
      drafts.set(d.id, d);
      return d;
    }),
    setEditedDocument: vi.fn(async (id: string, docId: string) => {
      drafts.set(id, { ...drafts.get(id)!, editedDocumentId: docId });
    }),
    setMatter: vi.fn(async (id: string, matter: string) => {
      const d = drafts.get(id);
      if (!d) return null;
      drafts.set(id, { ...d, matter });
      return drafts.get(id);
    }),
  },
}));


const ctx = { userId: 'u1', firmId: 'firm-1' };
const DOCX = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('word file')]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.7 ...');
const b64 = (b: Buffer) => b.toString('base64');
const blocks = [{ key: 'p0', text: 'IN THE COURT', align: 'center', bold: true }, { key: 'p1', text: '1. Facts.' }];

function savedDraft(over: Partial<SavedDraft> = {}): SavedDraft {
  const d: SavedDraft = {
    id: `draft-${++n}`, title: 'Ravi petition', docType: 'Petition', language: 'EN', tone: 'Professional',
    fields: {}, editedHtml: '<p>x</p>', bodyText: 'x', draftDate: null, matter: 'Ravi v. State',
    sourceDocumentId: null, editedDocumentId: null, createdAt: '', updatedAt: '', ...over,
  };
  drafts.set(d.id, d);
  return d;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return e instanceof ImportError ? e.code : String(e);
  }
}

beforeEach(() => {
  docs.clear();
  drafts.clear();
  vi.clearAllMocks();
  vi.mocked(engineClient.readDocx).mockResolvedValue({ blocks, warnings: ['header_footer'] });
  vi.mocked(engineClient.applyEdits).mockImplementation(async (_src, paras) => b64(Buffer.concat([DOCX, Buffer.from(` merged:${paras.join('|')}`)])));
  vi.mocked(engineClient.composeDocx).mockImplementation(async (paras) => ({
    docxBase64: b64(Buffer.concat([DOCX, Buffer.from(` composed:${paras.join('|')}`)])),
    blocks: paras.map((text, i) => ({ key: `p${i}`, text })),
  }));
});

const original = (over: Partial<DocumentRecord & { body: Buffer }> = {}) => {
  const rec = { id: 'orig', name: 'Ravi petition (original)', type: 'Petition', case: 'Ravi v. State', updated: '', fileName: 'r.docx', body: DOCX, ...over };
  docs.set(rec.id, rec);
  return rec;
};

describe('detectKind (file type from its bytes)', () => {
  it('knows docx, doc, pdf; refuses an OLE ".docx" (password-protected) and anything else', () => {
    expect(detectKind(DOCX, 'a.docx')).toBe('docx');
    expect(detectKind(OLE, 'old.DOC')).toBe('doc');
    expect(detectKind(PDF, 'scan.pdf')).toBe('pdf');
    expect(() => detectKind(OLE, 'locked.docx')).toThrow('encrypted_or_doc');
    expect(() => detectKind(Buffer.from('MZ...'), 'virus.docx')).toThrow('unsupported');
    expect(() => detectKind(PDF.subarray(0, 3), 'x.pdf')).toThrow('unsupported');
  });

  it('pdfLines: paragraphs when blank-line separated, else printed lines', () => {
    expect(pdfLines('a\nb\n\nc\n\nd')).toEqual(['a b', 'c', 'd']);
    expect(pdfLines('line one\nline two')).toEqual(['line one', 'line two']);
  });
});

describe('openUpload (Draft page "Open a document")', () => {
  it('ac1/ac4: reads the docx, then keeps the original untouched as "<name> (original)" in the case', async () => {
    const out = await svc.openUpload({ fileName: 'Ravi petition.docx', fileBase64: b64(DOCX), matter: 'Ravi v. State', docType: 'Petition' }, ctx);
    expect(out).toMatchObject({ kind: 'docx', title: 'Ravi petition', docType: 'Petition', matter: 'Ravi v. State', blocks, warnings: ['header_footer'] });
    expect(out.docxBase64).toBe(b64(DOCX));
    const original = docs.get(out.sourceDocumentId)!;
    expect(original).toMatchObject({ name: 'Ravi petition (original)', type: 'Petition', case: 'Ravi v. State' });
    expect(original.body!.equals(DOCX)).toBe(true);
  });

  it('"No case" files under the Documents list\'s "-" label', async () => {
    const out = await svc.openUpload({ fileName: 'Firm template.docx', fileBase64: b64(DOCX), matter: '', docType: 'Other' }, ctx);
    expect(out.matter).toBe('');
    expect(docs.get(out.sourceDocumentId)!.case).toBe('-');
  });

  it('ac3: a .doc is converted to .docx by LibreOffice; the stored original stays the .doc', async () => {
    vi.mocked(convertDocToDocx).mockResolvedValue(DOCX);
    const out = await svc.openUpload({ fileName: 'old.doc', fileBase64: b64(OLE), matter: '', docType: 'Notice' }, ctx);
    expect(out.docxBase64).toBe(b64(DOCX));
    expect(docs.get(out.sourceDocumentId)!.body!.equals(OLE)).toBe(true);
    expect(vi.mocked(documentsService.create).mock.calls[0]![0]).toMatchObject({ fileMime: 'application/msword' });
  });

  it('ac3: a PDF opens as text only ("layout not kept"), laid out as a real house-style .docx', async () => {
    vi.mocked(extractText).mockResolvedValue({ ok: true, text: 'Para one\n\nPara two\n\nPara three' });
    const out = await svc.openUpload({ fileName: 'order.pdf', fileBase64: b64(PDF), matter: '', docType: 'Other' }, ctx);
    expect(out).toMatchObject({ kind: 'pdf', warnings: ['pdf_text_only'] });
    expect(out.blocks.map((b) => b.text)).toEqual(['Para one', 'Para two', 'Para three']);
    expect(Buffer.from(out.docxBase64!, 'base64').toString()).toContain('composed:Para one|Para two|Para three');
    // engine down: still opens, as plain text with no Word file behind it
    vi.mocked(engineClient.composeDocx).mockRejectedValueOnce(new Error('down'));
    const plain = await svc.openUpload({ fileName: 'order.pdf', fileBase64: b64(PDF), matter: '', docType: 'Other' }, ctx);
    expect(plain.docxBase64).toBeNull();
  });

  it('ac9: a refused file stores nothing', async () => {
    vi.mocked(engineClient.readDocx).mockResolvedValue({ error: 'tracked_changes' });
    expect(await code(svc.openUpload({ fileName: 'a.docx', fileBase64: b64(DOCX), matter: '', docType: 'Other' }, ctx))).toBe('tracked_changes');
    vi.mocked(convertDocToDocx).mockRejectedValue(new Error('soffice timed out'));
    expect(await code(svc.openUpload({ fileName: 'a.doc', fileBase64: b64(OLE), matter: '', docType: 'Other' }, ctx))).toBe('convert_failed');
    vi.mocked(extractText).mockResolvedValue({ ok: false, error: 'x' });
    expect(await code(svc.openUpload({ fileName: 'a.pdf', fileBase64: b64(PDF), matter: '', docType: 'Other' }, ctx))).toBe('pdf_unreadable');
    expect(await code(svc.openUpload({ fileName: 'a.docx', fileBase64: b64(OLE), matter: '', docType: 'Other' }, ctx))).toBe('encrypted_or_doc');
    expect(await code(svc.openUpload({ fileName: 'a.docx', fileBase64: '', matter: '', docType: 'Other' }, ctx))).toBe('empty');
    expect(documentsService.create).not.toHaveBeenCalled();
  });

  it('ac9: over 8 MB is refused with 413', async () => {
    const big = Buffer.concat([DOCX, Buffer.alloc(8 * 1024 * 1024)]);
    const err = await svc.openUpload({ fileName: 'a.docx', fileBase64: b64(big), matter: '', docType: 'Other' }, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err).toMatchObject({ code: 'too_large', status: 413 });
  });
});

describe('openDocument (Case -> Documents "Edit in DifAi", reopen)', () => {
  it('opens a firm document without creating anything; an existing case file opens as "<name> (edited)"', async () => {
    docs.set('case-doc', { id: 'case-doc', name: 'Plaint', type: 'Plaint', case: 'Ravi v. State', updated: '', fileName: 'Plaint.docx', body: DOCX });
    const out = await svc.openDocument('case-doc', ctx);
    expect(out).toMatchObject({ sourceDocumentId: 'case-doc', title: 'Plaint (edited)', matter: 'Ravi v. State', docType: 'Plaint' });
    docs.set('orig', { id: 'orig', name: 'Ravi petition (original)', type: 'Petition', case: '-', updated: '', fileName: 'r.docx', body: DOCX });
    expect((await svc.openDocument('orig', ctx)).title).toBe('Ravi petition');
    expect(documentsService.create).not.toHaveBeenCalled();
  });

  it('ac9: another firm\'s document, or a row with no file, is 404', async () => {
    docs.set('x', { id: 'x', name: 'n', type: 't', case: '-', updated: '', body: DOCX });
    expect(await code(svc.openDocument('x', { userId: 'u2', firmId: 'firm-2' }))).toBe('document_not_found');
    docs.set('empty', { id: 'empty', name: 'n', type: 't', case: '-', updated: '' });
    expect(await code(svc.openDocument('empty', ctx))).toBe('no_file');
  });
});

describe('saveEditedFile (the edited Word copy in Documents)', () => {
  it('ac2/ac4: edits go into the original .docx; first save creates the row, later saves replace its file - still one row', async () => {
    original();
    const d = savedDraft({ sourceDocumentId: 'orig' });
    const first = await svc.saveEditedFile(d.id, ['IN THE COURT', '1. Facts edited.'], ctx);
    expect(first).toMatchObject({ name: 'Ravi petition', type: 'Petition', case: 'Ravi v. State' });
    expect(vi.mocked(engineClient.applyEdits).mock.calls[0]![0]).toBe(b64(DOCX)); // into the advocate's own file
    expect(drafts.get(d.id)!.editedDocumentId).toBe(first.id);
    for (let i = 0; i < 4; i++) await svc.saveEditedFile(d.id, ['IN THE COURT', `v${i}`], ctx);
    expect(documentsService.create).toHaveBeenCalledTimes(1);
    expect(documentsService.replaceFile).toHaveBeenCalledTimes(4);
    expect(docs.get(first.id!)!.body!.toString()).toContain('merged:IN THE COURT|v3'); // always the latest save
    expect(docs.get('orig')!.body!.equals(DOCX)).toBe(true); // the original is never changed
  });

  it('a .doc original is converted before the edits go in', async () => {
    vi.mocked(convertDocToDocx).mockResolvedValue(DOCX);
    original({ fileName: 'old.doc', body: OLE });
    await svc.saveEditedFile(savedDraft({ sourceDocumentId: 'orig' }).id, ['x'], ctx);
    expect(convertDocToDocx).toHaveBeenCalled();
    expect(vi.mocked(engineClient.applyEdits).mock.calls[0]![0]).toBe(b64(DOCX));
  });

  it('falls back to a house-style .docx when the edit cannot be mapped, the original is a PDF, or it was deleted', async () => {
    original();
    vi.mocked(engineClient.applyEdits).mockResolvedValueOnce(null);
    const a = await svc.saveEditedFile(savedDraft({ sourceDocumentId: 'orig' }).id, ['new text'], ctx);
    expect(docs.get(a.id!)!.body!.toString()).toContain('composed:new text');
    original({ id: 'pdf', fileName: 'o.pdf', body: PDF });
    const b = await svc.saveEditedFile(savedDraft({ sourceDocumentId: 'pdf' }).id, ['pdf text'], ctx);
    expect(docs.get(b.id!)!.body!.toString()).toContain('composed:pdf text');
    // original deleted (FK nulled the source) but the edited copy exists: still saves
    docs.set('ed', { id: 'ed', name: 'e', type: 't', case: '-', updated: '', body: DOCX });
    const c = await svc.saveEditedFile(savedDraft({ sourceDocumentId: null, editedDocumentId: 'ed' }).id, ['still'], ctx);
    expect(c.id).toBe('ed');
    expect(docs.get('ed')!.body!.toString()).toContain('composed:still');
  });

  it('a "No case" draft files its edited copy under "-"', async () => {
    original();
    expect((await svc.saveEditedFile(savedDraft({ sourceDocumentId: 'orig', matter: '' }).id, ['x'], ctx)).case).toBe('-');
  });

  it("refuses a draft that was not imported, empty text, and someone else's draft", async () => {
    expect(await code(svc.saveEditedFile(savedDraft().id, ['x'], ctx))).toBe('not_imported');
    expect(await code(svc.saveEditedFile(savedDraft({ sourceDocumentId: 'orig' }).id, ['  '], ctx))).toBe('empty');
    expect(await code(svc.saveEditedFile('nope', ['x'], ctx))).toBe('draft_not_found');
  });
});

describe('copyToMatter (Option A: a separate copy per case)', () => {
  it('ac5: copies the draft and BOTH files into the other case; nothing is shared', async () => {
    docs.set('orig', { id: 'orig', name: 'Ravi petition (original)', type: 'Petition', case: 'Ravi v. State', updated: '', fileName: 'r.docx', body: DOCX });
    docs.set('edited', { id: 'edited', name: 'Ravi petition', type: 'Petition', case: 'Ravi v. State', updated: '', fileName: 'r.docx', body: DOCX });
    const d = savedDraft({ sourceDocumentId: 'orig', editedDocumentId: 'edited' });
    const copy = await svc.copyToMatter(d.id, 'Kumar v. State', ctx);
    expect(copy.id).not.toBe(d.id);
    expect(copy.matter).toBe('Kumar v. State');
    expect(copy.sourceDocumentId).not.toBe('orig');
    expect(copy.editedDocumentId).not.toBe('edited');
    expect(docs.get(copy.sourceDocumentId!)!.case).toBe('Kumar v. State');
    expect(docs.get(copy.editedDocumentId!)!.case).toBe('Kumar v. State');
    // the source case keeps its own files, unchanged
    expect(docs.get('orig')!.case).toBe('Ravi v. State');
    expect(drafts.get(d.id)!.matter).toBe('Ravi v. State');
  });

  it('needs a case, and rolls back the files it made when a later step fails', async () => {
    const d = savedDraft();
    expect(await code(svc.copyToMatter(d.id, '', ctx))).toBe('case_required');
    docs.set('orig', { id: 'orig', name: 'o', type: 't', case: 'A', updated: '', fileName: 'r.docx', body: DOCX });
    const d2 = savedDraft({ sourceDocumentId: 'orig' });
    vi.mocked(draftsService.create).mockRejectedValueOnce(new Error('db down'));
    expect(await code(svc.copyToMatter(d2.id, 'B', ctx))).toContain('db down');
    expect(documentsService.remove).toHaveBeenCalledTimes(1);
    expect([...docs.values()].filter((x) => x.case === 'B')).toHaveLength(0);
  });
});

describe('moveToMatter ("Add to a case")', () => {
  it('ac6: moves the draft, its edited file and an unfiled original into the case', async () => {
    docs.set('orig', { id: 'orig', name: 'o', type: 't', case: '-', updated: '' });
    docs.set('edited', { id: 'edited', name: 'e', type: 't', case: '-', updated: '' });
    const d = savedDraft({ matter: '', sourceDocumentId: 'orig', editedDocumentId: 'edited' });
    await svc.moveToMatter(d.id, 'Ravi v. State', ctx);
    expect(drafts.get(d.id)!.matter).toBe('Ravi v. State');
    expect(docs.get('edited')!.case).toBe('Ravi v. State');
    expect(docs.get('orig')!.case).toBe('Ravi v. State');
  });

  it('leaves an original that lives in another case\'s file where it is', async () => {
    docs.set('orig', { id: 'orig', name: 'o', type: 't', case: 'Case A', updated: '' });
    const d = savedDraft({ matter: 'Case A', sourceDocumentId: 'orig' });
    await svc.moveToMatter(d.id, 'Case B', ctx);
    expect(docs.get('orig')!.case).toBe('Case A');
  });
});
