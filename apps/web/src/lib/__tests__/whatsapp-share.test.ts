import { afterEach, describe, expect, it, vi } from 'vitest';

const shareFile = vi.fn();
vi.mock('../native', () => ({ shareFile: (...a: unknown[]) => shareFile(...a) }));

const { caseUpdateMessage, documentNote, hearingMessage, invoiceMessage, openWhatsAppText, shareFileOnWhatsApp } = await import('../whatsapp-share');

afterEach(() => { vi.restoreAllMocks(); shareFile.mockReset(); });

describe('message builders print only client-safe fields', () => {
  it('case update: listed fields, empty ones skipped, no internal fields', () => {
    const c = { title: 'Rajan v. State', cnr: 'TNCH010012342024', court: 'Madras High Court', judge: 'Justice A', stage: 'Arguments', next: '20 Nov 2026', notes: 'SECRET NOTE', fee: 50000 };
    const msg = caseUpdateMessage(c, 'Adv. Priya');
    expect(msg).toBe('Case update: Rajan v. State\nCase no. / CNR: TNCH010012342024\nCourt: Madras High Court, Justice A\nStage: Arguments\nNext hearing: 20 Nov 2026\n\nRegards,\nAdv. Priya');
    expect(msg).not.toContain('SECRET');
    expect(msg).not.toContain('50000');
  });
  it('case update without CNR / court / next date', () => {
    expect(caseUpdateMessage({ title: 'Draft matter', cnr: '-', court: '', stage: null, next: '' }))
      .toBe('Case update: Draft matter\nNext hearing: not listed yet');
  });
  it('hearing reminder', () => {
    expect(hearingMessage({ case: 'Rajan v. State', date: 'Friday, 20 November 2026', time: '10:30', court: 'Court 5', purpose: 'Hearing' }, 'Priya'))
      .toBe('Hearing reminder: Rajan v. State\nDate: Friday, 20 November 2026 at 10:30\nCourt: Court 5\nListed for: Hearing\n\nRegards,\nPriya');
    expect(hearingMessage({ case: 'X', date: 'Mon', time: '' })).toBe('Hearing reminder: X\nDate: Mon');
  });
  it('invoice: due date while unpaid, thank-you once paid', () => {
    expect(invoiceMessage({ invoiceNo: 'INV-7', amount: '₹25,000', issued: '1 Nov 2026', due: '15 Nov 2026' }))
      .toBe('Invoice INV-7: ₹25,000\nIssued: 1 Nov 2026\nDue: 15 Nov 2026');
    expect(invoiceMessage({ invoiceNo: 'INV-7', amount: '₹25,000', due: '15 Nov 2026', paid: true })).toContain('Status: paid');
  });
  it('document note names the matter unless it is a placeholder', () => {
    expect(documentNote('Vakalat', 'Rajan v. State')).toContain('Please find attached Vakalat in Rajan v. State.');
    expect(documentNote('Vakalat', '-')).toContain('Please find attached Vakalat.');
  });
});

// Node test environment (no DOM): stub just what the helpers touch.
function stubBrowser() {
  const open = vi.fn();
  const click = vi.fn();
  vi.stubGlobal('window', { open });
  vi.stubGlobal('document', {
    createElement: () => ({ click, remove: vi.fn(), set href(_v: string) {}, set download(_v: string) {} }),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
  return { open, click };
}

describe('sending', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('opens wa.me with the text encoded and capped', () => {
    const { open } = stubBrowser();
    openWhatsAppText('Hi & bye');
    expect(open).toHaveBeenCalledWith('https://wa.me/?text=Hi%20%26%20bye', '_blank', 'noopener,noreferrer');
    openWhatsAppText('x'.repeat(70_000));
    expect(decodeURIComponent(String(open.mock.calls[1]![0]).split('text=')[1]!)).toHaveLength(60_000);
  });
  it('share sheet result is passed through; no share sheet -> download + WhatsApp with the note', async () => {
    const { open, click } = stubBrowser();
    const blob = new Blob(['%PDF'], { type: 'application/pdf' });
    shareFile.mockResolvedValueOnce('shared');
    expect(await shareFileOnWhatsApp(blob, 'a.pdf', 'note')).toBe('shared');
    expect(open).not.toHaveBeenCalled();
    shareFile.mockResolvedValueOnce('cancelled');
    expect(await shareFileOnWhatsApp(blob, 'a.pdf', 'note')).toBe('cancelled');
    expect(open).not.toHaveBeenCalled();

    shareFile.mockResolvedValueOnce('fallback');
    expect(await shareFileOnWhatsApp(blob, 'a.pdf', 'note')).toBe('downloaded');
    expect(click).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith('https://wa.me/?text=note', '_blank', 'noopener,noreferrer');
  });
});
