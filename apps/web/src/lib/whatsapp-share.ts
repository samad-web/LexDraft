/**
 * Share things from DifAi on WhatsApp (build-docs/features/whatsapp-share.md).
 * DifAi never sends anything itself: WhatsApp opens with the text ready (or
 * the device share sheet with the file) and the advocate picks the chat.
 * Message builders print only client-safe fields - never notes or internal data.
 */
import { shareFile } from './native';

// WhatsApp caps a message at 65,536 characters.
const MAX_TEXT = 60_000;

export function openWhatsAppText(text: string): void {
  window.open(`https://wa.me/?text=${encodeURIComponent(text.slice(0, MAX_TEXT))}`, '_blank', 'noopener,noreferrer');
}

/** Send a file: device share sheet when it can carry files, else download it and
 *  open WhatsApp with the note so the advocate attaches it. */
export async function shareFileOnWhatsApp(blob: Blob, fileName: string, note: string): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const r = await shareFile(blob, fileName, note);
  if (r !== 'fallback') return r;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  openWhatsAppText(note);
  return 'downloaded';
}

const lines = (...parts: Array<string | null | undefined | false>): string =>
  parts.filter((p): p is string => !!p && !!p.trim()).join('\n');
const signOff = (from?: string | null) => (from?.trim() ? `\nRegards,\n${from.trim()}` : null);

export function documentNote(docName: string, matter?: string | null, from?: string | null): string {
  return lines(
    'Dear Sir/Madam,',
    '',
    `Please find attached ${docName}${matter && matter !== '-' ? ` in ${matter}` : ''}.`,
    signOff(from),
  );
}

export function caseUpdateMessage(c: {
  title: string; cnr?: string | null; court?: string | null; judge?: string | null; stage?: string | null; next?: string | null;
}, from?: string | null): string {
  const cnr = c.cnr && !/^(-|tbd|na|n\/a)$/i.test(c.cnr.trim()) ? c.cnr : null;
  return lines(
    `Case update: ${c.title}`,
    cnr && `Case no. / CNR: ${cnr}`,
    c.court && `Court: ${c.court}${c.judge ? `, ${c.judge}` : ''}`,
    c.stage && `Stage: ${c.stage}`,
    `Next hearing: ${c.next?.trim() && c.next.trim() !== '-' ? c.next.trim() : 'not listed yet'}`,
    signOff(from),
  );
}

export function hearingMessage(h: {
  case: string; date: string; time?: string | null; court?: string | null; judge?: string | null; purpose?: string | null;
}, from?: string | null): string {
  return lines(
    `Hearing reminder: ${h.case}`,
    `Date: ${h.date}${h.time ? ` at ${h.time}` : ''}`,
    h.court && `Court: ${h.court}${h.judge ? `, ${h.judge}` : ''}`,
    h.purpose && `Listed for: ${h.purpose}`,
    signOff(from),
  );
}

export function invoiceMessage(inv: {
  invoiceNo: string; amount: string; issued?: string | null; due?: string | null; paid?: boolean;
}, from?: string | null): string {
  return lines(
    `Invoice ${inv.invoiceNo}: ${inv.amount}`,
    inv.issued && `Issued: ${inv.issued}`,
    inv.paid ? 'Status: paid - thank you.' : inv.due && `Due: ${inv.due}`,
    signOff(from),
  );
}
