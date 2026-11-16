import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Secure share links, web side (features/secure-share-link.md).
const h = vi.hoisted(() => ({
  posts: [] as Array<{ url: string; body: unknown; headers: Record<string, string> }>,
}));

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  apiClient: {
    post: (url: string, body: unknown, config: { headers: Record<string, string> }) => {
      h.posts.push({ url, body, headers: config.headers });
      return Promise.resolve({ data: { id: 'l1', token: 'T'.repeat(43), expiresAt: '2026-11-23T10:00:00.000Z' } });
    },
  },
}));

const { createShareLink, fetchShareMeta, linkNote, linkStatus, openShare, shareUrl } = await import('../share-link');

beforeEach(() => {
  h.posts = [];
  vi.stubGlobal('window', { location: { origin: 'https://difai.sirahdigital.in' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('Secure share link (web)', () => {
  it('uploads the file with name, expiry and password headers and returns the client URL', async () => {
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
    const link = await createShareLink(pdf, 'Bail Petition – முருகன்.pdf', 7, '482913');
    const p = h.posts[0]!;
    expect(p.url).toBe('/api/share-links');
    expect(p.body).toBe(pdf);
    expect(p.headers['Content-Type']).toBe('application/pdf');
    expect(p.headers['X-Share-Name']).toBe(encodeURIComponent('Bail Petition – முருகன்.pdf'));
    expect(p.headers['X-Share-Days']).toBe('7');
    expect(p.headers['X-Share-Password']).toBe('482913');
    // Token after #: browsers never send it to a server, so no access log records it.
    expect(link.url).toBe(`https://difai.sirahdigital.in/s#${'T'.repeat(43)}`);
  });

  it('sends no password header when the link has no password', async () => {
    await createShareLink(new Blob(['x']), 'a.pdf', 1);
    expect(h.posts[0]!.headers).not.toHaveProperty('X-Share-Password');
  });

  it('WhatsApp note carries the link and expiry, never the password', () => {
    const note = linkNote('Dear Sir/Madam,', 'https://x/s/abc', '2026-11-23T10:00:00.000Z', true);
    expect(note).toContain('https://x/s/abc');
    expect(note).toContain('23 Nov 2026');
    expect(note).toContain('I will send you the password separately');
    expect(note).not.toMatch(/482913/);
    expect(linkNote('Hi', 'u', '2026-11-23T10:00:00.000Z', false)).not.toContain('password');
  });

  it('labels links active, expired or cancelled', () => {
    const now = Date.parse('2026-11-16T00:00:00Z');
    expect(linkStatus({ revokedAt: null, expiresAt: '2026-11-20T00:00:00Z' }, now)).toBe('active');
    expect(linkStatus({ revokedAt: null, expiresAt: '2026-11-10T00:00:00Z' }, now)).toBe('expired');
    expect(linkStatus({ revokedAt: '2026-11-15T00:00:00Z', expiresAt: '2026-11-20T00:00:00Z' }, now)).toBe('revoked');
  });

  it('builds the URL from the site origin', () => {
    expect(shareUrl('abc', 'https://difai.sirahdigital.in')).toBe('https://difai.sirahdigital.in/s#abc');
  });

  it("public page shows the server's message and status for a dead or wrong-password link", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Wrong password' }), { status: 401 })));
    await expect(openShare('tok', 'nope')).rejects.toMatchObject({ message: 'Wrong password', status: 401 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 404 })));
    await expect(fetchShareMeta('tok')).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/not available/) });
  });

  it('public open posts token and password as JSON, never in the URL', async () => {
    const f = vi.fn(async () => new Response(new Blob(['%PDF']), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await openShare('tok', '482913');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/s/open');
    expect(url).not.toContain('tok');
    expect(JSON.parse(String(init.body))).toEqual({ token: 'tok', password: '482913' });
  });
});
