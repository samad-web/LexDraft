/**
 * Lightweight client-side document export.
 *
 * - PDF: renders the document HTML into a hidden iframe, snapshots it with
 *   html2canvas, packs the snapshot into a multi-page A4 PDF via jsPDF, and
 *   triggers a direct file download. Same UX as DOCX — no print dialog.
 *
 * - DOCX: wraps the document HTML with the Office Open XML mso-style preamble
 *   and saves it as a .doc file. Word and LibreOffice open these natively.
 *   This is not a true .docx zip package, but it is a valid Word document and
 *   keeps headings, lists, bold/italic, alignment, and paragraphs intact.
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useAuthStore } from '@/store/auth';
import { renderLetterheadHtml } from './letterhead-templates';
import { resolveEffectiveLetterhead, type ResolvedLetterhead } from './letterhead-resolve';

export const AI_DISCLAIMER_HTML = `
<div style="margin-top:32px;padding:16px;border:1px solid #999;border-radius:8px;color:#444;font-size:11px;line-height:1.55;background:#f7f7f7;">
  <strong style="color:#222;">AI-GENERATED DOCUMENT — VERIFY BEFORE SENDING.</strong>
  This draft was produced with AI assistance and may contain factual,
  legal, or citation errors. It must be reviewed and verified by a
  qualified advocate before being filed, served, or relied upon.
</div>`;

export interface ExportAdvocate {
  name: string;
  /** Role / position rendered under the name (e.g. "Solo Advocate",
   *  "Managing Partner"). Optional — falls back to a blank second line. */
  role?: string | null;
  /** Firm name rendered as a third line. Optional. */
  firm?: string | null;
}

interface ExportPayload {
  title: string;
  bodyHtml: string;
  /** Date stamp shown above the document body. ISO yyyy-mm-dd or already-formatted string. */
  dated?: string;
  /**
   * Footer banner HTML. Defaults to the AI disclaimer (intended for the
   * drafting flow). Pass `null` to omit the footer entirely (e.g. when
   * exporting reports that aren't AI-generated).
   */
  disclaimerHtml?: string | null;
  /** Page orientation when printed. Reports often need landscape. Default 'portrait'. */
  orientation?: 'portrait' | 'landscape';
  /**
   * Signature block rendered between the body and the disclaimer.
   *  - `undefined` (default) — auto-detect the current signed-in advocate
   *    from the auth store. Every export carries the originator by default.
   *  - `null` — explicitly suppress the signature block (e.g. anonymous
   *    or system-generated exports).
   *  - explicit object — override (e.g. when generating on someone else's
   *    behalf during impersonation).
   */
  advocate?: ExportAdvocate | null;
  /**
   * Letterhead rendered at the very top of the document, replacing the
   * default centered title block.
   *  - `undefined` (default) — auto-resolve the user's effective default
   *    (personal beats firm). When neither exists, falls through to the
   *    plain centered title.
   *  - `null` — explicitly suppress letterhead even if the user has a
   *    default (e.g. internal scratch exports).
   *  - explicit object — use this specific letterhead (e.g. when the
   *    export dialog has a picker).
   */
  letterhead?: ResolvedLetterhead | null;
}

/** Pull the current signed-in advocate from the auth store. Returns null if
 *  no session — exports still render, just without a signature line. */
function currentAdvocate(): ExportAdvocate | null {
  const user = useAuthStore.getState().user;
  if (!user) return null;
  return {
    name: user.name,
    role: user.role ?? null,
    firm: user.firm ?? null,
  };
}

function buildSignatureHtml(advocate: ExportAdvocate): string {
  const name = escapeHtml(advocate.name);
  const role = advocate.role ? escapeHtml(advocate.role) : '';
  const firm = advocate.firm ? escapeHtml(advocate.firm) : '';
  return `
    <div style="margin-top:48px;page-break-inside:avoid;">
      <div style="border-top:1px solid #999;width:280px;margin-bottom:6px;"></div>
      <div style="font-weight:600;font-size:12pt;color:#111;">${name}</div>
      ${role ? `<div style="font-size:11pt;color:#444;">${role}</div>` : ''}
      ${firm ? `<div style="font-size:11pt;color:#444;">${firm}</div>` : ''}
    </div>`;
}

function buildDocumentHtml({
  title,
  bodyHtml,
  dated,
  disclaimerHtml,
  orientation = 'portrait',
  advocate,
  letterhead,
}: ExportPayload): string {
  const safeTitle = escapeHtml(title);
  const datedRow = dated
    ? `<div style="text-align:right;color:#444;font-size:12px;margin-bottom:18px;">Dated: ${escapeHtml(dated)}</div>`
    : '';
  const footer = disclaimerHtml === null ? '' : (disclaimerHtml ?? AI_DISCLAIMER_HTML);
  const maxWidth = orientation === 'landscape' ? '10in' : '7in';
  // Resolve the signature block. `null` = explicit suppression; `undefined`
  // = fall back to the signed-in advocate so every existing exporter
  // automatically carries the originator without a call-site change.
  const resolvedAdvocate: ExportAdvocate | null =
    advocate === null ? null : advocate ?? currentAdvocate();
  const signatureHtml = resolvedAdvocate ? buildSignatureHtml(resolvedAdvocate) : '';
  // Letterhead replaces the centered title block when present. The title
  // is still surfaced — just rendered smaller, below the letterhead — so
  // the reader can tell whether they're looking at a notice, a brief, or
  // an invoice. When no letterhead is configured we keep the legacy
  // centered title block exactly as before, so un-branded exports look
  // identical to pre-letterhead output.
  const letterheadHtml = letterhead
    ? renderLetterheadHtml(letterhead.templateKey, letterhead.fields, letterhead.logoUrl)
    : '';
  const titleBlock = letterhead
    ? `<div style="text-align:center;font-weight:600;font-size:13pt;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px;">${safeTitle}</div>`
    : `<div class="doc-title">${safeTitle}</div>`;
  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8"/>
  <title>${safeTitle}</title>
  <style>
    @page { margin: 0.75in; size: ${orientation}; }
    body {
      font-family: 'Calibri', 'Helvetica', 'Arial', sans-serif;
      font-size: 12pt;
      line-height: 1.6;
      color: #111;
      max-width: ${maxWidth};
      margin: 0 auto;
      padding: 24px;
    }
    h1 { font-size: 18pt; margin: 0 0 8px; }
    h2 { font-size: 15pt; margin: 18px 0 8px; }
    h3 { font-size: 13pt; margin: 14px 0 6px; }
    p { margin: 0 0 10pt; }
    ul, ol { margin: 0 0 10pt 24px; }
    table { border-collapse: collapse; width: 100%; font-size: 11pt; margin: 0 0 12pt; }
    th, td { border: 1px solid #bbb; padding: 6pt 8pt; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; font-weight: 600; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .doc-title { text-align:center; font-weight:600; font-size:16pt; letter-spacing:0.04em; text-transform:uppercase; margin-bottom: 4px; }
    .meta-row { display:flex; justify-content:space-between; color:#444; font-size:11pt; margin-bottom:18px; }
  </style>
</head>
<body>
  ${letterheadHtml}
  ${titleBlock}
  ${datedRow}
  <div class="doc-body">${bodyHtml}</div>
  ${signatureHtml}
  ${footer}
</body>
</html>`;
}

export function escapeReportHtml(s: string): string {
  return escapeHtml(s);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function safeFilename(title: string): string {
  return title.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'document';
}

/** A4 portrait dimensions in pt: 595.28 × 841.89. Landscape swaps these.
 *  We capture the rendered HTML at 2× scale so text stays sharp on retina.
 *
 *  Letterhead auto-resolution: when the caller doesn't pass `letterhead` we
 *  fetch the user's effective default before rendering, so every existing
 *  exporter (drafting, invoices, expenses, …) gets letterhead support
 *  without a call-site change. Pass `letterhead: null` to opt out, or pass
 *  an explicit resolved letterhead (e.g. from a picker) to override the
 *  default. */
export async function exportPdf(payload: ExportPayload): Promise<void> {
  const resolved = await resolveLetterheadIfNeeded(payload);
  const html = buildDocumentHtml(resolved);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  // 816px is roughly 8.5" at 96dpi — close to A4 width so layout matches print.
  iframe.style.cssText = [
    'position:fixed',
    'right:0',
    'bottom:0',
    'width:816px',
    'height:0',
    'border:0',
    'visibility:hidden',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      iframe.onload = () => resolve();
      iframe.onerror = () => reject(new Error('iframe load failed'));
      iframe.srcdoc = html;
    });

    const doc = iframe.contentDocument;
    const body = doc?.body;
    if (!doc || !body) throw new Error('iframe document missing');

    // Resize iframe to fit rendered content so html2canvas captures everything.
    iframe.style.height = `${body.scrollHeight}px`;
    // Give fonts and layout one frame to settle.
    await new Promise((r) => setTimeout(r, 120));

    const canvas = await html2canvas(body, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: body.scrollWidth,
      windowHeight: body.scrollHeight,
    });

    const orientation = payload.orientation === 'landscape' ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL('image/png');

    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    // Paginate by sliding the same image upward by one page-height each loop.
    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const blob = pdf.output('blob');
    triggerBlobDownload(blob, `${safeFilename(payload.title)}.pdf`);
  } finally {
    cleanup();
  }
}

export async function exportDocx(payload: ExportPayload): Promise<void> {
  // DOCX shares the same letterhead-resolution semantics as PDF. We made
  // this async to accommodate the network call; the underlying file write
  // is still synchronous on a Blob.
  const resolved = await resolveLetterheadIfNeeded(payload);
  const html = buildDocumentHtml(resolved);
  const blob = new Blob(['﻿', html], {
    type: 'application/msword;charset=utf-8',
  });
  triggerBlobDownload(blob, `${safeFilename(payload.title)}.doc`);
}

/** Resolve the letterhead in the payload — auto-fetch the user's effective
 *  default when `letterhead` was left undefined. `null` and explicit
 *  objects pass through unchanged. */
async function resolveLetterheadIfNeeded(payload: ExportPayload): Promise<ExportPayload> {
  if (payload.letterhead !== undefined) return payload;
  const lh = await resolveEffectiveLetterhead();
  return { ...payload, letterhead: lh };
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, headers: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): void {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  // BOM lets Excel render UTF-8 ₹ / accented characters correctly.
  const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  triggerBlobDownload(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`);
}

export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
}

function icsDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ — UTC stamp.
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export function downloadIcs(filename: string, events: ReadonlyArray<IcsEvent>): void {
  const stamp = icsDate(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LexDraft//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@lexdraft`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  triggerBlobDownload(blob, filename.endsWith('.ics') ? filename : `${filename}.ics`);
}
