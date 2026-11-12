import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Share the draft PDF on WhatsApp: shareFile() picks the device share sheet
// (Android app / Web Share with files) or tells the caller to fall back.
const h = vi.hoisted(() => ({
  native: false,
  nativeShares: [] as Array<{ title?: string; text?: string; files?: string[] }>,
  nativeShareError: null as Error | null,
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), exitApp: vi.fn() } }));
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile: async ({ path }: { path: string }) => ({ uri: `file:///cache/${path}` }) },
}));
vi.mock('@capacitor/share', () => ({
  Share: {
    share: async (opts: { title?: string; text?: string; files?: string[] }) => {
      if (h.nativeShareError) throw h.nativeShareError;
      h.nativeShares.push(opts);
    },
  },
}));

// Node has no FileReader (the Android WebView does); a minimal stand-in for readAsDataURL.
class FakeFileReader {
  result: string | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(blob: Blob) {
    void blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onload?.();
    });
  }
}

const { shareFile } = await import('@/lib/native');

const pdf = () => new Blob(['%PDF-1.4'], { type: 'application/pdf' });
const NOTE = 'Please find attached the draft';

beforeEach(() => {
  h.native = false;
  h.nativeShares = [];
  h.nativeShareError = null;
  vi.stubGlobal('FileReader', FakeFileReader);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubWebShare(opts: { canShare: boolean; share?: (data: ShareData) => Promise<void> }) {
  vi.stubGlobal('navigator', {
    ...navigator,
    canShare: () => opts.canShare,
    share: opts.share ?? (async () => {}),
  });
}

describe('Share PDF on WhatsApp — Android app', () => {
  it('sends the PDF file with the covering note to the native share sheet', async () => {
    h.native = true;
    expect(await shareFile(pdf(), 'Legal_Notice-2026-11-12.pdf', NOTE)).toBe('shared');
    expect(h.nativeShares).toEqual([
      { title: 'Legal_Notice-2026-11-12.pdf', text: NOTE, files: ['file:///cache/downloads/Legal_Notice-2026-11-12.pdf'] },
    ]);
  });

  it('treats a dismissed share sheet as cancelled, not an error', async () => {
    h.native = true;
    h.nativeShareError = new Error('Share canceled');
    expect(await shareFile(pdf(), 'a.pdf', NOTE)).toBe('cancelled');
  });
});

describe('Share PDF on WhatsApp — browser', () => {
  it('shares the PDF as a File with the note where the browser can share files', async () => {
    const share = vi.fn(async (_data: ShareData) => {});
    stubWebShare({ canShare: true, share });
    expect(await shareFile(pdf(), 'Draft.pdf', NOTE)).toBe('shared');
    const data = share.mock.calls[0]![0];
    const file = data.files![0]!;
    expect(data.text).toBe(NOTE);
    expect(data.files).toHaveLength(1);
    expect(file.name).toBe('Draft.pdf');
    expect(file.type).toBe('application/pdf');
  });

  it('falls back (download + wa.me) when the browser cannot share files', async () => {
    stubWebShare({ canShare: false });
    expect(await shareFile(pdf(), 'Draft.pdf', NOTE)).toBe('fallback');
  });

  it('falls back when Web Share is missing entirely', async () => {
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined });
    expect(await shareFile(pdf(), 'Draft.pdf', NOTE)).toBe('fallback');
  });

  it('returns cancelled when the advocate closes the share sheet', async () => {
    stubWebShare({ canShare: true, share: async () => { throw new DOMException('dismissed', 'AbortError'); } });
    expect(await shareFile(pdf(), 'Draft.pdf', NOTE)).toBe('cancelled');
  });

  it('falls back when the click activation expired while the PDF was being prepared', async () => {
    stubWebShare({ canShare: true, share: async () => { throw new DOMException('no activation', 'NotAllowedError'); } });
    expect(await shareFile(pdf(), 'Draft.pdf', NOTE)).toBe('fallback');
  });
});
