import { describe, expect, it, vi } from 'vitest';

// Share several case documents on WhatsApp (features/multi-share.md).
vi.mock('../api', () => ({ api: { get: vi.fn() }, apiClient: { post: vi.fn() } }));

const { MAX_SHARE_FILES, filesNote, linksMessage, prepareFiles, prepareLinks, shareProblem } = await import('../multi-share');

const pdf = (id: string) => ({ id, name: `Doc ${id}`, fileName: `${id}.pdf`, mime: 'application/pdf' });
const docx = (id: string) => ({ id, name: `Doc ${id}`, fileName: `${id}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
const blob = (s: string) => new Blob([s], { type: 'application/pdf' });

describe('Share selected files on WhatsApp', () => {
  it('needs at least one file and at most the limit', () => {
    expect(shareProblem([], 'link', '482913')).toMatch(/at least one/);
    const many = Array.from({ length: MAX_SHARE_FILES + 1 }, (_, i) => pdf(String(i)));
    expect(shareProblem(many, 'link', '482913')).toMatch(/up to 10/);
    expect(shareProblem(many.slice(0, MAX_SHARE_FILES), 'link', '482913')).toBeNull();
  });

  it('rejects a weak password', () => {
    expect(shareProblem([pdf('a')], 'link', '12')).toMatch(/4 to 64/);
  });

  it('never sends a Word or image file unlocked when a password is set (files mode)', () => {
    const p = shareProblem([pdf('a'), docx('b')], 'files', '482913');
    expect(p).toMatch(/Only PDFs can be locked/);
    expect(p).toContain('b.docx');
    expect(p).toMatch(/Secure link/);
  });

  it('allows Word files as secure links with a password, and as files without one', () => {
    expect(shareProblem([docx('b')], 'link', '482913')).toBeNull();
    expect(shareProblem([docx('b')], 'files', null)).toBeNull();
  });

  it('files mode locks EVERY PDF with the same password before sharing', async () => {
    const lock = vi.fn(async (b: Blob, pw: string, _mark: string) => new Blob([`locked(${pw}):`, b]));
    const out = await prepareFiles([pdf('a'), pdf('b')], '482913', 'Anitha S. v. Karthik R.', {
      getBlob: async (id) => blob(id), lock,
    });
    expect(lock).toHaveBeenCalledTimes(2);
    for (const call of lock.mock.calls) {
      expect(call[1]).toBe('482913');
      expect(call[2]).toContain('Confidential - for Anitha S. v. Karthik R.');
    }
    expect(out.map((f) => f.fileName)).toEqual(['a.pdf', 'b.pdf']);
    expect(await out[0]!.blob.text()).toMatch(/^locked\(482913\):/);
  });

  it('files mode without a password does not lock', async () => {
    const lock = vi.fn();
    await prepareFiles([pdf('a')], null, null, { getBlob: async (id) => blob(id), lock });
    expect(lock).not.toHaveBeenCalled();
  });

  it('links mode makes one password link per file with the same password', async () => {
    const link = vi.fn(async (_b: Blob, name: string, _days: number, _pw?: string) => ({ id: name, token: 't', url: `https://x/s#${name}`, expiresAt: '2026-11-23T10:00:00.000Z' }));
    const out = await prepareLinks([pdf('a'), docx('b')], 7, '482913', { getBlob: async (id) => blob(id), link });
    expect(link).toHaveBeenCalledTimes(2);
    for (const call of link.mock.calls) {
      expect(call[2]).toBe(7);
      expect(call[3]).toBe('482913');
    }
    expect(out.map((l) => l.url)).toEqual(['https://x/s#a.pdf', 'https://x/s#b.docx']);
  });

  it('stops at the first failure, names the file, and sends nothing', async () => {
    const link = vi.fn(async () => ({ id: '1', token: 't', url: 'u', expiresAt: '2026-11-23T10:00:00.000Z' }));
    const getBlob = vi.fn(async (id: string) => {
      if (id === 'b') throw new Error('HTTP 404');
      return blob(id);
    });
    await expect(prepareLinks([pdf('a'), pdf('b'), pdf('c')], 7, '482913', { getBlob, link }))
      .rejects.toThrow('Could not prepare "b.pdf". Nothing was sent.');
    expect(getBlob).not.toHaveBeenCalledWith('c');
  });

  it('refuses before touching any file when the rules are broken', async () => {
    const getBlob = vi.fn();
    await expect(prepareFiles([docx('b')], '482913', null, { getBlob })).rejects.toThrow(/Only PDFs/);
    expect(getBlob).not.toHaveBeenCalled();
  });

  it('one message lists every file with its link and never includes the password', () => {
    const msg = linksMessage([
      { name: 'Petition', url: 'https://x/s#1', expiresAt: '2026-11-23T10:00:00.000Z' },
      { name: 'Order', url: 'https://x/s#2', expiresAt: '2026-11-23T10:00:00.000Z' },
    ], true, 'Adv. Sayed');
    expect(msg).toContain('2 documents');
    expect(msg).toContain('1. Petition\nhttps://x/s#1');
    expect(msg).toContain('2. Order\nhttps://x/s#2');
    expect(msg).toContain('23 Nov 2026');
    expect(msg).toContain('I will send you the password separately');
    expect(msg).toContain('Regards,\nAdv. Sayed');
    expect(msg).not.toMatch(/482913/);
  });

  it('files note mentions the separate password only when there is one', () => {
    expect(filesNote(3, true)).toMatch(/3 documents[\s\S]*password separately/);
    expect(filesNote(1, false)).not.toMatch(/password/);
  });
});
