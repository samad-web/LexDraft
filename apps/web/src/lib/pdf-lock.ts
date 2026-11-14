/**
 * Password-protected PDF (build-docs/features/protected-pdf.md).
 * The server stamps a "Confidential" watermark and locks the file (AES-256).
 * The password is never stored; it travels once, in a header the API keeps out
 * of its logs. The advocate sends it to the client separately.
 */
import { apiClient } from './api';

/** 6 random digits (not the client's mobile: anyone the file is forwarded to sees that). */
export function randomPin(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0]! % 1_000_000).padStart(6, '0');
}

export function validPdfPassword(pw: string): boolean {
  return pw.length >= 4 && pw.length <= 64 && !/[\r\n]/.test(pw);
}

export function confidentialMark(forWhom?: string | null, date = new Date()): string {
  const day = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return ['Confidential', forWhom?.trim() ? `for ${forWhom.trim()}` : null, day].filter(Boolean).join(' - ');
}

/** Same note the advocate sends, plus a line that the password follows separately. */
export function lockedNote(note: string): string {
  return `${note}\n\nThe file is password protected. I will send you the password separately.`;
}

export async function lockPdf(pdf: Blob, password: string, watermark: string): Promise<Blob> {
  try {
    const res = await apiClient.post('/api/documents/protect-pdf', pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'X-Pdf-Password': password,
        'X-Pdf-Watermark': encodeURIComponent(watermark),
      },
      responseType: 'blob',
    });
    return new Blob([res.data as Blob], { type: 'application/pdf' });
  } catch (err) {
    // With responseType 'blob' the server's { error } arrives as a Blob: read it for a clear message.
    const data = (err as { response?: { data?: unknown } }).response?.data;
    if (data instanceof Blob) {
      const msg = await data.text().then((t) => (JSON.parse(t) as { error?: string }).error).catch(() => undefined);
      if (msg) throw new Error(msg);
    }
    throw new Error('Could not lock the PDF');
  }
}
