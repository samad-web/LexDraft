import { beforeEach, describe, expect, it, vi } from 'vitest';

// Password-protected PDF, web side (features/protected-pdf.md).
const h = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; body: unknown; config: { headers: Record<string, string>; responseType: string } }>,
  reply: null as null | (() => Promise<{ data: Blob }>),
}));

vi.mock('../api', () => ({
  apiClient: {
    post: (url: string, body: unknown, config: { headers: Record<string, string>; responseType: string }) => {
      h.calls.push({ url, body, config });
      return h.reply ? h.reply() : Promise.resolve({ data: new Blob(['%PDF-locked']) });
    },
  },
}));

const { confidentialMark, lockPdf, lockedNote, randomPin, validPdfPassword } = await import('../pdf-lock');

beforeEach(() => {
  h.calls = [];
  h.reply = null;
});

describe('Lock PDF with password (web)', () => {
  it('suggests a random 6-digit PIN, different each time', () => {
    const pins = new Set(Array.from({ length: 50 }, randomPin));
    for (const p of pins) expect(p).toMatch(/^\d{6}$/);
    expect(pins.size).toBeGreaterThan(40);
  });

  it('accepts 4-64 character passwords without line breaks', () => {
    expect(validPdfPassword('4829')).toBe(true);
    expect(validPdfPassword('123')).toBe(false);
    expect(validPdfPassword('x'.repeat(65))).toBe(false);
    expect(validPdfPassword('12\n34')).toBe(false);
  });

  it('watermark names the client and date', () => {
    expect(confidentialMark('R. Kumar', new Date(2026, 10, 14))).toBe('Confidential - for R. Kumar - 14 Nov 2026');
    expect(confidentialMark(null, new Date(2026, 10, 14))).toBe('Confidential - 14 Nov 2026');
  });

  it('covering note says the password comes separately and never contains it', () => {
    const note = lockedNote('Dear Sir/Madam,\n\nPlease find attached the draft.');
    expect(note).toMatch(/password protected\. I will send you the password separately\.$/);
    expect(note).not.toMatch(/\d{4,}/);
  });

  it('sends the PDF bytes with the password and watermark in headers and returns a PDF', async () => {
    const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    const out = await lockPdf(pdf, '482913', 'Confidential - for முருகன்');
    expect(h.calls).toHaveLength(1);
    const c = h.calls[0]!;
    expect(c.url).toBe('/api/documents/protect-pdf');
    expect(c.body).toBe(pdf);
    expect(c.config.headers['Content-Type']).toBe('application/pdf');
    expect(c.config.headers['X-Pdf-Password']).toBe('482913');
    // Non-ASCII names must be encoded: raw Tamil in a header would make the browser throw.
    expect(c.config.headers['X-Pdf-Watermark']).toBe(encodeURIComponent('Confidential - for முருகன்'));
    expect(c.config.responseType).toBe('blob');
    expect(out.type).toBe('application/pdf');
  });

  it("shows the server's reason when locking fails", async () => {
    h.reply = () => Promise.reject({ response: { data: new Blob([JSON.stringify({ error: 'This PDF is already password protected' })]) } });
    await expect(lockPdf(new Blob(['%PDF']), '4829', 'x')).rejects.toThrow('This PDF is already password protected');
  });

  it('falls back to a plain message when the failure has no reason', async () => {
    h.reply = () => Promise.reject(new Error('Network Error'));
    await expect(lockPdf(new Blob(['%PDF']), '4829', 'x')).rejects.toThrow('Could not lock the PDF');
  });
});
