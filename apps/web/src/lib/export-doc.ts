/**
 * Lightweight client-side document export.
 *
 * - PDF: opens a print window with the document HTML and triggers the browser
 *   print dialog. The user picks "Save as PDF" — no library required, and the
 *   output uses the browser's high-quality vector PDF renderer.
 *
 * - DOCX: wraps the document HTML with the Office Open XML mso-style preamble
 *   and saves it as a .doc file. Word and LibreOffice open these natively.
 *   This is not a true .docx zip package, but it is a valid Word document and
 *   keeps headings, lists, bold/italic, alignment, and paragraphs intact.
 */

export const AI_DISCLAIMER_HTML = `
<div style="margin-top:32px;padding:16px;border:1px solid #999;border-radius:8px;color:#444;font-size:11px;line-height:1.55;background:#f7f7f7;">
  <strong style="color:#222;">AI-GENERATED DOCUMENT — VERIFY BEFORE SENDING.</strong>
  This draft was produced with AI assistance and may contain factual,
  legal, or citation errors. It must be reviewed and verified by a
  qualified advocate before being filed, served, or relied upon.
</div>`;

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
}

function buildDocumentHtml({
  title,
  bodyHtml,
  dated,
  disclaimerHtml,
  orientation = 'portrait',
}: ExportPayload): string {
  const safeTitle = escapeHtml(title);
  const datedRow = dated
    ? `<div style="text-align:right;color:#444;font-size:12px;margin-bottom:24px;">Dated: ${escapeHtml(dated)}</div>`
    : '';
  const footer = disclaimerHtml === null ? '' : (disclaimerHtml ?? AI_DISCLAIMER_HTML);
  const maxWidth = orientation === 'landscape' ? '10in' : '7in';
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
  <div class="doc-title">${safeTitle}</div>
  ${datedRow}
  <div class="doc-body">${bodyHtml}</div>
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

export function exportPdf(payload: ExportPayload): void {
  const html = buildDocumentHtml(payload);
  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1100');
  if (!win) {
    throw new Error('Pop-up blocked. Allow pop-ups for this site to save as PDF.');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Wait for fonts/images so print preview is fully laid out.
  const trigger = () => {
    win.focus();
    win.print();
  };
  if (win.document.readyState === 'complete') {
    setTimeout(trigger, 50);
  } else {
    win.addEventListener('load', () => setTimeout(trigger, 50));
  }
}

export function exportDocx(payload: ExportPayload): void {
  const html = buildDocumentHtml(payload);
  const blob = new Blob(['﻿', html], {
    type: 'application/msword;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeFilename(payload.title)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
