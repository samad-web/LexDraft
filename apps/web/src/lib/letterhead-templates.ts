/**
 * Letterhead template catalog.
 *
 * Each template is the same triple:
 *   - metadata for the picker UI (name, description)
 *   - `defaultFields` — the slot values pre-populated when the user first
 *     drops in this template (mostly placeholder strings so the preview
 *     looks "real" before the user types)
 *   - `render(fields, logoUrl) → HTML` — used both by the live preview
 *     in the editor AND by the exporter at PDF/DOCX generation time
 *
 * Why HTML strings (not React): the exporter renders into an off-screen
 * iframe + html2canvas, which doesn't ride the React tree. Producing
 * portable HTML strings lets the same renderer drive screen previews and
 * print output. Inline styles only — every rule must survive html2canvas
 * snapshotting, which doesn't follow class references back to the host
 * page's stylesheets.
 *
 * Sizing assumption: the renderer assumes an A4 portrait page minus 0.75"
 * margins — a content width of about 7 inches (~672px at 96dpi). The
 * preview component shrinks the result to fit its container, but the HTML
 * itself targets the print width so what-you-see-is-what-you-print.
 */

import type { LetterheadFields, LetterheadTemplateKey } from '@/hooks/useLetterheads';

export interface LetterheadTemplate {
  key: LetterheadTemplateKey;
  name: string;
  description: string;
  defaultFields: LetterheadFields;
  /** Returns an HTML fragment — no <html>/<body>, no <style>. The caller
   *  is responsible for wrapping. */
  render(fields: LetterheadFields, logoUrl: string | null): string;
}

// ---------- Shared helpers --------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;'
      : c === '<' ? '&lt;'
      : c === '>' ? '&gt;'
      : c === '"' ? '&quot;'
      : '&#39;',
  );
}

function maybe(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return s.length === 0 ? '' : s;
}

function addressBlock(lines: ReadonlyArray<string> | undefined, sep = ' · '): string {
  if (!lines) return '';
  const cleaned = lines.map((l) => maybe(l)).filter(Boolean);
  if (cleaned.length === 0) return '';
  return cleaned.map(escapeHtml).join(sep);
}

function addressStack(lines: ReadonlyArray<string> | undefined): string {
  if (!lines) return '';
  const cleaned = lines.map((l) => maybe(l)).filter(Boolean);
  if (cleaned.length === 0) return '';
  return cleaned.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
}

function logoImg(logoUrl: string | null, maxWidth: number, maxHeight: number): string {
  if (!logoUrl) return '';
  return `<img src="${escapeHtml(logoUrl)}" alt="" style="max-width:${maxWidth}px;max-height:${maxHeight}px;object-fit:contain;display:block;" crossorigin="anonymous"/>`;
}

function safeColor(c: string | null | undefined, fallback = '#111'): string {
  if (!c) return fallback;
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : fallback;
}

// ---------- Templates -------------------------------------------------------

const classicCentered: LetterheadTemplate = {
  key: 'classic-centered',
  name: 'Classic centered',
  description: 'Logo above the firm name, address line in mono — formal and balanced.',
  defaultFields: {
    firmName: 'Your firm name',
    addressLines: ['Address line 1', 'City, State 000000'],
    phone: '+91 00000 00000',
    email: 'hello@yourfirm.in',
  },
  render(fields, logoUrl) {
    const contact = [
      maybe(fields.phone),
      maybe(fields.email),
      maybe(fields.website),
    ].filter(Boolean).map(escapeHtml).join(' · ');
    return `
      <div style="text-align:center;border-bottom:1px solid #999;padding-bottom:12px;margin-bottom:18px;font-family:'Calibri','Helvetica',sans-serif;color:#111;">
        ${logoUrl ? `<div style="margin-bottom:8px;display:flex;justify-content:center;">${logoImg(logoUrl, 200, 60)}</div>` : ''}
        ${fields.firmName ? `<div style="font-size:18pt;font-weight:600;letter-spacing:0.02em;">${escapeHtml(fields.firmName)}</div>` : ''}
        ${fields.tagline ? `<div style="font-size:10pt;color:#555;margin-top:2px;">${escapeHtml(fields.tagline)}</div>` : ''}
        ${addressBlock(fields.addressLines) ? `<div style="font-size:10pt;color:#555;margin-top:6px;">${addressBlock(fields.addressLines)}</div>` : ''}
        ${contact ? `<div style="font-size:10pt;color:#555;margin-top:2px;font-family:'Consolas','Menlo',monospace;">${contact}</div>` : ''}
        ${fields.regNumber ? `<div style="font-size:9pt;color:#777;margin-top:4px;">${escapeHtml(fields.regNumber)}</div>` : ''}
      </div>`;
  },
};

const logoLeft: LetterheadTemplate = {
  key: 'logo-left',
  name: 'Logo left · firm right',
  description: 'Horizontal band with the logo anchored left and the firm name + contact details aligned right.',
  defaultFields: {
    firmName: 'Your firm name',
    tagline: 'Advocates & Solicitors',
    addressLines: ['Address line 1', 'City, State 000000'],
    phone: '+91 00000 00000',
    email: 'hello@yourfirm.in',
  },
  render(fields, logoUrl) {
    return `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:24px;border-bottom:1px solid #999;padding-bottom:12px;margin-bottom:18px;font-family:'Calibri','Helvetica',sans-serif;color:#111;">
        <div style="flex:0 0 auto;">
          ${logoUrl ? logoImg(logoUrl, 160, 80) : `<div style="font-size:9pt;color:#aaa;font-style:italic;">No logo</div>`}
        </div>
        <div style="text-align:right;">
          ${fields.firmName ? `<div style="font-size:16pt;font-weight:600;letter-spacing:0.01em;">${escapeHtml(fields.firmName)}</div>` : ''}
          ${fields.tagline ? `<div style="font-size:10pt;color:#555;margin-top:2px;">${escapeHtml(fields.tagline)}</div>` : ''}
          ${addressBlock(fields.addressLines) ? `<div style="font-size:10pt;color:#555;margin-top:6px;">${addressBlock(fields.addressLines)}</div>` : ''}
          ${fields.phone ? `<div style="font-size:10pt;color:#555;font-family:'Consolas','Menlo',monospace;">${escapeHtml(fields.phone)}</div>` : ''}
          ${fields.email ? `<div style="font-size:10pt;color:#555;font-family:'Consolas','Menlo',monospace;">${escapeHtml(fields.email)}</div>` : ''}
          ${fields.website ? `<div style="font-size:10pt;color:#555;font-family:'Consolas','Menlo',monospace;">${escapeHtml(fields.website)}</div>` : ''}
        </div>
      </div>`;
  },
};

const minimalist: LetterheadTemplate = {
  key: 'minimalist',
  name: 'Minimalist',
  description: 'Firm name in serif, a single hairline rule, no logo. Quiet and confident.',
  defaultFields: {
    firmName: 'Your firm name',
    addressLines: ['Address line 1', 'City, State 000000'],
  },
  render(fields, _logoUrl) {
    void _logoUrl;
    return `
      <div style="text-align:center;margin-bottom:24px;font-family:'Georgia','Times New Roman',serif;color:#111;">
        ${fields.firmName ? `<div style="font-size:20pt;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(fields.firmName)}</div>` : ''}
        <div style="height:1px;background:#999;margin:8px auto 8px;width:60%;"></div>
        ${addressBlock(fields.addressLines, ' · ') ? `<div style="font-size:10pt;color:#555;font-family:'Calibri','Helvetica',sans-serif;">${addressBlock(fields.addressLines, ' · ')}</div>` : ''}
        ${fields.regNumber ? `<div style="font-size:9pt;color:#777;margin-top:4px;font-family:'Calibri','Helvetica',sans-serif;">${escapeHtml(fields.regNumber)}</div>` : ''}
      </div>`;
  },
};

const twoColumn: LetterheadTemplate = {
  key: 'two-column',
  name: 'Two column',
  description: 'Logo + firm name on the left, address and contact lines on the right. Reads like a business letter.',
  defaultFields: {
    firmName: 'Your firm name',
    tagline: 'Advocates & Solicitors',
    addressLines: ['Address line 1', 'City, State 000000'],
    phone: '+91 00000 00000',
    email: 'hello@yourfirm.in',
    website: 'www.yourfirm.in',
  },
  render(fields, logoUrl) {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center;border-bottom:1px solid #999;padding-bottom:14px;margin-bottom:20px;font-family:'Calibri','Helvetica',sans-serif;color:#111;">
        <div style="display:flex;flex-direction:column;align-items:flex-start;gap:6px;">
          ${logoUrl ? logoImg(logoUrl, 120, 60) : ''}
          ${fields.firmName ? `<div style="font-size:16pt;font-weight:600;letter-spacing:0.01em;">${escapeHtml(fields.firmName)}</div>` : ''}
          ${fields.tagline ? `<div style="font-size:10pt;color:#555;">${escapeHtml(fields.tagline)}</div>` : ''}
        </div>
        <div style="text-align:right;font-size:10pt;color:#444;line-height:1.5;">
          ${addressStack(fields.addressLines)}
          ${fields.phone ? `<div style="font-family:'Consolas','Menlo',monospace;">${escapeHtml(fields.phone)}</div>` : ''}
          ${fields.email ? `<div style="font-family:'Consolas','Menlo',monospace;">${escapeHtml(fields.email)}</div>` : ''}
          ${fields.website ? `<div style="font-family:'Consolas','Menlo',monospace;">${escapeHtml(fields.website)}</div>` : ''}
          ${fields.regNumber ? `<div style="margin-top:4px;font-size:9pt;color:#777;">${escapeHtml(fields.regNumber)}</div>` : ''}
        </div>
      </div>`;
  },
};

const courtFiling: LetterheadTemplate = {
  key: 'court-filing',
  name: 'Court-filing style',
  description: 'Narrow band with name, registration number, and contact in tabular columns. Designed for court submissions.',
  defaultFields: {
    firmName: 'Your firm name',
    regNumber: 'Enrolment No. KAR/0000/2020',
    phone: '+91 00000 00000',
    email: 'hello@yourfirm.in',
  },
  render(fields, logoUrl) {
    const cells: string[] = [];
    if (fields.firmName) cells.push(`<strong style="font-size:11pt;">${escapeHtml(fields.firmName)}</strong>`);
    if (fields.regNumber) cells.push(escapeHtml(fields.regNumber));
    if (fields.phone) cells.push(escapeHtml(fields.phone));
    if (fields.email) cells.push(escapeHtml(fields.email));
    return `
      <div style="border:1px solid #999;padding:8px 14px;margin-bottom:18px;font-family:'Calibri','Helvetica',sans-serif;color:#111;display:flex;align-items:center;gap:14px;font-size:10pt;">
        ${logoUrl ? `<div style="flex:0 0 auto;">${logoImg(logoUrl, 60, 36)}</div>` : ''}
        <div style="flex:1;display:flex;flex-wrap:wrap;gap:6px 14px;">
          ${cells.map((c) => `<span>${c}</span>`).join('<span style="color:#aaa;">·</span>')}
        </div>
      </div>`;
  },
};

const modernAccent: LetterheadTemplate = {
  key: 'modern-accent',
  name: 'Modern accent',
  description: 'Coloured accent bar at the top, logo and firm name below — for firms that want a touch of brand colour.',
  defaultFields: {
    firmName: 'Your firm name',
    tagline: 'Advocates & Solicitors',
    addressLines: ['Address line 1', 'City, State 000000'],
    phone: '+91 00000 00000',
    email: 'hello@yourfirm.in',
    accentColor: '#2c5282',
  },
  render(fields, logoUrl) {
    const accent = safeColor(fields.accentColor, '#2c5282');
    return `
      <div style="margin-bottom:20px;font-family:'Calibri','Helvetica',sans-serif;color:#111;">
        <div style="height:6px;background:${accent};margin-bottom:12px;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:24px;">
          <div style="display:flex;align-items:center;gap:14px;">
            ${logoUrl ? logoImg(logoUrl, 80, 56) : ''}
            <div>
              ${fields.firmName ? `<div style="font-size:16pt;font-weight:600;color:${accent};letter-spacing:0.01em;">${escapeHtml(fields.firmName)}</div>` : ''}
              ${fields.tagline ? `<div style="font-size:10pt;color:#555;">${escapeHtml(fields.tagline)}</div>` : ''}
            </div>
          </div>
          <div style="text-align:right;font-size:10pt;color:#555;line-height:1.4;">
            ${addressStack(fields.addressLines)}
            ${fields.phone ? `<div>${escapeHtml(fields.phone)}</div>` : ''}
            ${fields.email ? `<div>${escapeHtml(fields.email)}</div>` : ''}
          </div>
        </div>
      </div>`;
  },
};

// ---------- Catalog ---------------------------------------------------------

export const LETTERHEAD_TEMPLATES: ReadonlyArray<LetterheadTemplate> = [
  classicCentered,
  logoLeft,
  minimalist,
  twoColumn,
  courtFiling,
  modernAccent,
];

const TEMPLATE_INDEX: Record<LetterheadTemplateKey, LetterheadTemplate> = {
  'classic-centered': classicCentered,
  'logo-left': logoLeft,
  'minimalist': minimalist,
  'two-column': twoColumn,
  'court-filing': courtFiling,
  'modern-accent': modernAccent,
};

export function getTemplate(key: LetterheadTemplateKey): LetterheadTemplate {
  return TEMPLATE_INDEX[key] ?? classicCentered;
}

/** Render any letterhead by key + fields + resolved logo URL. */
export function renderLetterheadHtml(
  key: LetterheadTemplateKey,
  fields: LetterheadFields,
  logoUrl: string | null,
): string {
  return getTemplate(key).render(fields, logoUrl);
}
