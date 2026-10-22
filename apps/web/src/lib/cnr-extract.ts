// Pulling eCourts CNR numbers (4 letters + 12 letters/digits) out of free
// text - a scanned QR code, the eCourts app's backup file, a CSV or a pasted
// list. A CNR standing alone (between non-alphanumerics) is preferred over
// one carved out of a longer token.

const STANDALONE = /(?:^|[^A-Z0-9])([A-Z]{4}[A-Z0-9]{12})(?![A-Z0-9])/;
const STANDALONE_G = new RegExp(STANDALONE.source, 'g');
const ANYWHERE = /[A-Z]{4}[A-Z0-9]{12}/;

/** The CNR in a QR code's text (bare CNR, a URL or a sentence), or null. */
export function cnrFromQrText(text: string): string | null {
  const upper = text.toUpperCase();
  return STANDALONE.exec(upper)?.[1] ?? ANYWHERE.exec(upper)?.[0] ?? null;
}

/** Every distinct standalone CNR in a block of text, in order. */
export function extractCnrs(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.toUpperCase().matchAll(STANDALONE_G)) seen.add(m[1]!);
  return [...seen];
}
