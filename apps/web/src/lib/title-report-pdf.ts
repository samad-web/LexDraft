/**
 * Title-report PDF export — formal Indian TIR layout via jsPDF text mode.
 *
 * Replaces the earlier html2canvas screenshot approach (which produced
 * "screenshots of a webpage stitched together"). Now we lay out the report
 * directly with jsPDF primitives:
 *
 *   - Times (serif) typography matching Indian legal-pleading convention.
 *   - Cover page: TITLE INVESTIGATION REPORT, report number, applicant, bank.
 *   - Section headings numbered 1..N, in small-caps style.
 *   - Continuous page header (report number) + footer (Page X of Y).
 *   - Tables drawn with horizontal/vertical rules and word-wrapped cells.
 *   - Signature block on the final page.
 *
 * No new dependencies — uses only the jspdf already in the workspace.
 */

import { jsPDF } from 'jspdf';
import type { TitleReportFull } from '@lexdraft/types';

// ---- Layout constants -----------------------------------------------------

const PAGE = { w: 210, h: 297 }; // A4 mm
const MARGIN = { top: 25, bottom: 22, left: 22, right: 22 };
const CONTENT_W = PAGE.w - MARGIN.left - MARGIN.right;
const CONTENT_BOTTOM = PAGE.h - MARGIN.bottom;

const FONT_BODY = 'times';
const SIZE = {
  cover_title:    20,
  cover_sub:      11,
  section:        12,
  body:           10.5,
  table_header:    9,
  table_cell:      9,
  caption:         8.5,
  footer:          8,
} as const;

const LH = {
  body:        5.0,
  section:     6.5,
  table:       4.6,
} as const;

// ---- Verdict + jurisdiction labels (mirrors what the on-screen wizard renders) ----

const VERDICT_LABEL: Record<string, string> = {
  pending:               'Pending',
  clear:                 'Clear and marketable',
  clear_with_conditions: 'Clear, subject to conditions',
  not_clear:             'Not clear',
};

const JURISDICTION_LABEL: Record<string, string> = {
  TN: 'Tamil Nadu', KA: 'Karnataka', MH: 'Maharashtra', TG: 'Telangana',
  AP: 'Andhra Pradesh', DL: 'Delhi', UP: 'Uttar Pradesh', GJ: 'Gujarat',
  RJ: 'Rajasthan', WB: 'West Bengal', KL: 'Kerala', PB: 'Punjab',
  HR: 'Haryana', MP: 'Madhya Pradesh', CG: 'Chhattisgarh', OR: 'Odisha',
  JH: 'Jharkhand', BR: 'Bihar', AS: 'Assam', OTHER: 'Other / UT',
};

const DOC_TYPE_LABEL: Record<string, string> = {
  sale_deed: 'Sale Deed', gift_deed: 'Gift Deed', partition_deed: 'Partition Deed',
  will: 'Will', patta: 'Patta', chitta: 'Chitta', adangal: 'Adangal',
  khata: 'Khata', rtc: 'RTC / Pahani', seven_twelve: '7/12 Extract',
  ec: 'Encumbrance Certificate', mutation: 'Mutation Entry',
  dc_conversion: 'DC / Land Conversion', building_plan: 'Building Plan',
  oc: 'Occupancy Certificate', cc: 'Completion Certificate', noc: 'NOC',
  rera: 'RERA Registration', property_tax_receipt: 'Property Tax Receipt',
  death_certificate: 'Death Certificate',
  legal_heir_certificate: 'Legal Heir Certificate',
  family_tree_affidavit: 'Family Tree Affidavit', other: 'Other',
};

const LINK_TYPE_LABEL: Record<string, string> = {
  sale: 'Sale Deed', gift: 'Gift Deed', partition: 'Partition Deed',
  settlement: 'Settlement Deed', will: 'Will / Testament',
  inheritance: 'Inheritance (intestate)', decree: 'Court Decree',
  lease: 'Lease', mortgage_release: 'Mortgage Release', other: 'Other',
};

const SEARCH_TYPE_LABEL: Record<string, string> = {
  sro: 'Sub-Registrar Office',
  revenue: 'Revenue records',
  municipal: 'Municipal records',
  litigation_hc: 'High Court litigation',
  litigation_dc: 'District Court litigation',
  litigation_drt: 'Debts Recovery Tribunal',
  litigation_nclt: 'National Company Law Tribunal',
  gst: 'GST', ibbi: 'IBBI', mca: 'MCA',
  attachment: 'Attachment search', other: 'Other',
};

// ---- Render context -------------------------------------------------------

interface RenderCtx {
  pdf: jsPDF;
  y: number;
  page: number;
  report: TitleReportFull;
  headerLeft: string;
  headerRight: string;
}

function newPdf(): jsPDF {
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
}

function formatINRDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return iso; }
}

function formatINRCurrency(n: number | null): string {
  if (n == null) return '—';
  // Indian numbering grouping (lakhs / crores).
  return '₹ ' + n.toLocaleString('en-IN') + '/-';
}

// Push the cursor to a new page, redraw the header, reset y to the top margin.
function nextPage(ctx: RenderCtx): void {
  ctx.pdf.addPage();
  ctx.page += 1;
  drawPageHeader(ctx);
  ctx.y = MARGIN.top + 4;
}

// Ensure room for `needed` mm of content; new-page if not.
function ensure(ctx: RenderCtx, needed: number): void {
  if (ctx.y + needed > CONTENT_BOTTOM) nextPage(ctx);
}

function drawPageHeader(ctx: RenderCtx): void {
  const { pdf } = ctx;
  pdf.setFont(FONT_BODY, 'normal');
  pdf.setFontSize(SIZE.caption);
  pdf.setTextColor(110);
  pdf.text(ctx.headerLeft, MARGIN.left, MARGIN.top - 8);
  pdf.text(ctx.headerRight, PAGE.w - MARGIN.right, MARGIN.top - 8, { align: 'right' });
  // Header rule.
  pdf.setDrawColor(200);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN.left, MARGIN.top - 5, PAGE.w - MARGIN.right, MARGIN.top - 5);
  pdf.setTextColor(20);
}

function drawPageFooter(pdf: jsPDF, pageNo: number, totalPages: number, reportNumber: string): void {
  pdf.setFont(FONT_BODY, 'normal');
  pdf.setFontSize(SIZE.footer);
  pdf.setTextColor(110);
  // Left: report number; centre: confidentiality notice; right: page X of Y.
  pdf.text(reportNumber, MARGIN.left, PAGE.h - 10);
  pdf.text(
    'Strictly confidential — prepared for the addressee bank/NBFC',
    PAGE.w / 2, PAGE.h - 10, { align: 'center' },
  );
  pdf.text(`Page ${pageNo} of ${totalPages}`, PAGE.w - MARGIN.right, PAGE.h - 10, { align: 'right' });
  pdf.setTextColor(20);
}

// ---- Primitive renderers --------------------------------------------------

function renderCoverPage(ctx: RenderCtx): void {
  const { pdf, report } = ctx;
  pdf.setFont(FONT_BODY, 'bold');
  pdf.setFontSize(SIZE.cover_title);
  pdf.text('TITLE INVESTIGATION REPORT', PAGE.w / 2, 70, { align: 'center' });

  pdf.setFont(FONT_BODY, 'italic');
  pdf.setFontSize(SIZE.cover_sub);
  pdf.text(
    'Prepared in accordance with Indian conveyancing practice',
    PAGE.w / 2, 78, { align: 'center' },
  );

  // Hair-line below title.
  pdf.setDrawColor(120);
  pdf.setLineWidth(0.3);
  pdf.line(PAGE.w / 2 - 35, 84, PAGE.w / 2 + 35, 84);

  // Identity block.
  pdf.setFont(FONT_BODY, 'normal');
  pdf.setFontSize(SIZE.body);
  const rows: Array<[string, string]> = [
    ['Report No.',     report.reportNumber],
    ['Date',           formatINRDate(new Date().toISOString())],
    ['Applicant',      `${report.applicantName} (${report.applicantType})`],
    ['Addressed to',   report.bankName ? `${report.bankName}${report.bankBranch ? ', ' + report.bankBranch : ''}` : '(Applicant)'],
    ['Loan reference', report.loanReference ?? '—'],
    ['Jurisdiction',   JURISDICTION_LABEL[report.jurisdictionState] ?? report.jurisdictionState],
    ['Search window',  `${report.searchPeriodFrom ?? '—'}  to  ${report.searchPeriodTo ?? '—'}`],
    ['Verdict',        VERDICT_LABEL[report.opinionVerdict] ?? report.opinionVerdict],
  ];
  let y = 110;
  for (const [k, v] of rows) {
    pdf.setFont(FONT_BODY, 'bold');
    pdf.text(`${k}:`, MARGIN.left + 8, y);
    pdf.setFont(FONT_BODY, 'normal');
    const wrapped = pdf.splitTextToSize(v, CONTENT_W - 50);
    pdf.text(wrapped, MARGIN.left + 50, y);
    y += LH.body * Math.max(1, wrapped.length);
  }

  // Footer note on the cover.
  pdf.setFont(FONT_BODY, 'italic');
  pdf.setFontSize(SIZE.caption);
  pdf.setTextColor(110);
  pdf.text(
    'This report is rendered on the basis of documents and searches as on the date hereof. ' +
    'It is to be read together with the annexures, the title chain, and the searches conducted.',
    MARGIN.left, PAGE.h - 30, { maxWidth: CONTENT_W },
  );
  pdf.setTextColor(20);
}

function sectionHeading(ctx: RenderCtx, no: number, title: string): void {
  ensure(ctx, LH.section * 2.5);
  ctx.pdf.setFont(FONT_BODY, 'bold');
  ctx.pdf.setFontSize(SIZE.section);
  ctx.pdf.text(`${no}.  ${title.toUpperCase()}`, MARGIN.left, ctx.y);
  // Underline.
  ctx.pdf.setDrawColor(180);
  ctx.pdf.setLineWidth(0.25);
  ctx.pdf.line(MARGIN.left, ctx.y + 1.2, MARGIN.left + CONTENT_W, ctx.y + 1.2);
  ctx.y += LH.section + 1;
  ctx.pdf.setFont(FONT_BODY, 'normal');
  ctx.pdf.setFontSize(SIZE.body);
}

function paragraph(ctx: RenderCtx, text: string, opts: { italic?: boolean; indent?: number } = {}): void {
  const { pdf } = ctx;
  pdf.setFont(FONT_BODY, opts.italic ? 'italic' : 'normal');
  pdf.setFontSize(SIZE.body);
  const indent = opts.indent ?? 0;
  const lines = pdf.splitTextToSize(text, CONTENT_W - indent) as string[];
  for (const line of lines) {
    ensure(ctx, LH.body);
    pdf.text(line, MARGIN.left + indent, ctx.y);
    ctx.y += LH.body;
  }
  ctx.y += 1.2;
}

function bulletList(ctx: RenderCtx, items: string[]): void {
  if (items.length === 0) {
    paragraph(ctx, '(Nil)', { italic: true });
    return;
  }
  for (const item of items) {
    const wrapped = ctx.pdf.splitTextToSize(item, CONTENT_W - 8) as string[];
    for (let i = 0; i < wrapped.length; i += 1) {
      const line = wrapped[i];
      if (line == null) continue;
      ensure(ctx, LH.body);
      if (i === 0) ctx.pdf.text('•', MARGIN.left + 2, ctx.y);
      ctx.pdf.text(line, MARGIN.left + 8, ctx.y);
      ctx.y += LH.body;
    }
    ctx.y += 0.6;
  }
  ctx.y += 0.8;
}

// Width-weighted table with word-wrapped cells, ruled top/bottom and per-row separators.
interface TableColumn { header: string; w: number; align?: 'left' | 'right' | 'center' }
function renderTable(ctx: RenderCtx, cols: TableColumn[], rows: string[][]): void {
  const { pdf } = ctx;
  if (cols.length === 0) return;
  const colXs: number[] = [];
  let x = MARGIN.left;
  for (const c of cols) { colXs.push(x); x += c.w; }
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  // Pre-wrap rows so we know each row's height.
  const wrappedRows: string[][][] = rows.map((row) =>
    row.map((cell, i) => pdf.splitTextToSize(cell ?? '', (cols[i]?.w ?? 30) - 2) as string[]),
  );
  const rowHeights = wrappedRows.map((row) => Math.max(...row.map((cell) => cell.length)) * LH.table + 1.5);
  const headerH = LH.table + 2;

  // Header.
  ensure(ctx, headerH + (rowHeights[0] ?? 0));
  pdf.setFillColor(240, 240, 240);
  pdf.rect(MARGIN.left, ctx.y - 0.4, totalW, headerH, 'F');
  pdf.setDrawColor(180);
  pdf.setLineWidth(0.2);
  pdf.line(MARGIN.left, ctx.y - 0.4, MARGIN.left + totalW, ctx.y - 0.4);
  pdf.line(MARGIN.left, ctx.y - 0.4 + headerH, MARGIN.left + totalW, ctx.y - 0.4 + headerH);
  pdf.setFont(FONT_BODY, 'bold');
  pdf.setFontSize(SIZE.table_header);
  cols.forEach((c, i) => {
    const cx = colXs[i] ?? 0;
    const tx = c.align === 'right' ? cx + c.w - 1 :
               c.align === 'center' ? cx + c.w / 2 : cx + 1;
    pdf.text(c.header, tx, ctx.y + 3.5, { align: c.align ?? 'left' });
  });
  ctx.y += headerH;

  pdf.setFont(FONT_BODY, 'normal');
  pdf.setFontSize(SIZE.table_cell);
  wrappedRows.forEach((row, ri) => {
    const h = rowHeights[ri] ?? 0;
    if (ctx.y + h > CONTENT_BOTTOM) {
      // Page break — redraw the header on the new page.
      nextPage(ctx);
      // Re-render header band.
      pdf.setFillColor(240, 240, 240);
      pdf.rect(MARGIN.left, ctx.y - 0.4, totalW, headerH, 'F');
      pdf.setDrawColor(180);
      pdf.setLineWidth(0.2);
      pdf.line(MARGIN.left, ctx.y - 0.4, MARGIN.left + totalW, ctx.y - 0.4);
      pdf.line(MARGIN.left, ctx.y - 0.4 + headerH, MARGIN.left + totalW, ctx.y - 0.4 + headerH);
      pdf.setFont(FONT_BODY, 'bold');
      pdf.setFontSize(SIZE.table_header);
      cols.forEach((c, i) => {
        const cx = colXs[i] ?? 0;
        const tx = c.align === 'right' ? cx + c.w - 1 :
                   c.align === 'center' ? cx + c.w / 2 : cx + 1;
        pdf.text(c.header, tx, ctx.y + 3.5, { align: c.align ?? 'left' });
      });
      ctx.y += headerH;
      pdf.setFont(FONT_BODY, 'normal');
      pdf.setFontSize(SIZE.table_cell);
    }
    // Cell text.
    row.forEach((lines, i) => {
      const col = cols[i];
      const cx = colXs[i] ?? 0;
      if (!col) return;
      const tx = col.align === 'right' ? cx + col.w - 1 :
                 col.align === 'center' ? cx + col.w / 2 : cx + 1;
      lines.forEach((line, li) => {
        pdf.text(line, tx, ctx.y + 3 + li * LH.table, { align: col.align ?? 'left' });
      });
    });
    // Bottom rule.
    pdf.setDrawColor(220);
    pdf.line(MARGIN.left, ctx.y + h - 0.2, MARGIN.left + totalW, ctx.y + h - 0.2);
    ctx.y += h;
  });
  // Vertical rules.
  pdf.setDrawColor(180);
  let xx = MARGIN.left;
  for (let i = 0; i <= cols.length; i += 1) {
    pdf.line(xx, ctx.y - rowHeights.reduce((s, h) => s + h, 0) - headerH, xx, ctx.y);
    xx += cols[i]?.w ?? 0;
  }
  ctx.y += 2;
}

// ---- Section renderers ----------------------------------------------------

function renderInstructions(ctx: RenderCtx): void {
  const r = ctx.report;
  sectionHeading(ctx, 1, 'Instructions and purpose');
  const instructions =
    `The undersigned has been instructed by ${r.bankName ?? r.applicantName} to investigate the title to the schedule property described herein, ` +
    `for the purpose of ${r.applicantType === 'borrower' ? 'creation of security by way of equitable mortgage' : r.applicantType === 'buyer' ? 'acquisition by purchase' : 'verification of marketable title'}. ` +
    `The investigation covers the period from ${r.searchPeriodFrom ?? '(not specified)'} to ${r.searchPeriodTo ?? '(not specified)'}.`;
  paragraph(ctx, instructions);
}

function renderProperty(ctx: RenderCtx): void {
  const p = ctx.report.property;
  sectionHeading(ctx, 2, 'Schedule of property (Schedule A)');
  if (!p) {
    paragraph(ctx, '(Property block not yet recorded.)', { italic: true });
    return;
  }
  paragraph(ctx, p.scheduleA ?? p.address);

  ensure(ctx, LH.body * 6);
  const meta: Array<[string, string]> = [
    ['Address',      p.address],
    ['Survey No.',   p.surveyNo ?? '—'],
    ['Sub-division', p.subDivision ?? '—'],
    ['Extent',       p.extentValue != null ? `${p.extentValue} ${p.extentUnit ?? ''}`.trim() : '—'],
    ['Boundaries',   `North: ${p.boundaryNorth ?? '—'} ; South: ${p.boundarySouth ?? '—'} ; East: ${p.boundaryEast ?? '—'} ; West: ${p.boundaryWest ?? '—'}`],
  ];
  ctx.pdf.setFont(FONT_BODY, 'normal');
  ctx.pdf.setFontSize(SIZE.body);
  for (const [k, v] of meta) {
    const lines = ctx.pdf.splitTextToSize(v, CONTENT_W - 42) as string[];
    ensure(ctx, LH.body * lines.length);
    ctx.pdf.setFont(FONT_BODY, 'bold');
    ctx.pdf.text(`${k}`, MARGIN.left, ctx.y);
    ctx.pdf.setFont(FONT_BODY, 'normal');
    ctx.pdf.text(lines, MARGIN.left + 42, ctx.y);
    ctx.y += LH.body * Math.max(1, lines.length);
  }
  // Jurisdiction-specific fields.
  const js = Object.entries(p.jurisdictionSpecific ?? {}).filter(([, v]) => v != null && String(v).trim() !== '');
  if (js.length > 0) {
    ctx.y += 2;
    ctx.pdf.setFont(FONT_BODY, 'italic');
    ctx.pdf.setFontSize(SIZE.body);
    ctx.pdf.text(`Jurisdiction-specific revenue references (${JURISDICTION_LABEL[ctx.report.jurisdictionState] ?? ctx.report.jurisdictionState}):`, MARGIN.left, ctx.y);
    ctx.y += LH.body;
    ctx.pdf.setFont(FONT_BODY, 'normal');
    for (const [k, v] of js) {
      ensure(ctx, LH.body);
      ctx.pdf.text(`• ${k.replace(/_/g, ' ')}: ${v}`, MARGIN.left + 6, ctx.y);
      ctx.y += LH.body;
    }
    ctx.y += 1;
  }
  ctx.y += 2;
}

function renderDocumentsExamined(ctx: RenderCtx): void {
  sectionHeading(ctx, 3, 'Documents examined');
  if (ctx.report.documents.length === 0) {
    paragraph(ctx, 'No documents have been recorded for examination.', { italic: true });
    return;
  }
  renderTable(ctx,
    [
      { header: 'Sl.',          w: 12, align: 'center' },
      { header: 'Type',         w: 38 },
      { header: 'Parties',      w: 50 },
      { header: 'Date',         w: 22, align: 'center' },
      { header: 'Reg. no.',     w: 25 },
      { header: 'Copy',         w: 19 },
    ],
    ctx.report.documents.map((d, i) => [
      String(i + 1),
      DOC_TYPE_LABEL[d.documentType] ?? d.documentType,
      d.parties ?? '—',
      d.documentDate ? formatINRDate(d.documentDate) : '—',
      d.registrationNo ?? '—',
      d.copyType ? d.copyType.replace(/_/g, ' ') : '—',
    ]),
  );
}

function renderChain(ctx: RenderCtx): void {
  sectionHeading(ctx, 4, 'Chain of title');
  const links = [...ctx.report.chainLinks].sort((a, b) => a.sequenceNo - b.sequenceNo);
  if (links.length === 0) {
    paragraph(ctx, 'The chain of title has not yet been recorded.', { italic: true });
    return;
  }
  // Narrative line per link.
  for (const l of links) {
    const sentence =
      `Link #${l.sequenceNo}. By ${LINK_TYPE_LABEL[l.linkType] ?? l.linkType} ` +
      `${l.documentDate ? `dated ${formatINRDate(l.documentDate)} ` : ''}` +
      `${l.documentNo ? `(Doc. No. ${l.documentNo}${l.sroOffice ? ', ' + l.sroOffice : ''}` +
        `${l.bookNo ? ', Book ' + l.bookNo : ''}${l.volumeNo ? ', Vol. ' + l.volumeNo : ''}` +
        `${l.pages ? ', Pp. ' + l.pages : ''}) ` : ''}` +
      `${l.transferor || '(transferor)'} conveyed the schedule property to ${l.transferee || '(transferee)'}` +
      `${l.consideration != null ? ` for a consideration of ${formatINRCurrency(l.consideration)}` : ''}` +
      `${l.stampDutyPaid != null ? `; stamp duty paid: ${formatINRCurrency(l.stampDutyPaid)}` : ''}.`;
    paragraph(ctx, sentence);
  }
  ctx.y += 1.5;
  // Tabular summary.
  renderTable(ctx,
    [
      { header: '#',           w: 9,  align: 'center' },
      { header: 'Type',        w: 32 },
      { header: 'From → To',   w: 52 },
      { header: 'Date',        w: 24, align: 'center' },
      { header: 'Doc. no.',    w: 26 },
      { header: 'SRO',         w: 23 },
    ],
    links.map((l) => [
      String(l.sequenceNo),
      LINK_TYPE_LABEL[l.linkType] ?? l.linkType,
      `${l.transferor || '—'} → ${l.transferee || '—'}`,
      l.documentDate ? formatINRDate(l.documentDate) : '—',
      l.documentNo ?? '—',
      l.sroOffice ?? '—',
    ]),
  );
}

function renderEncumbrances(ctx: RenderCtx): void {
  sectionHeading(ctx, 5, 'Encumbrance certificate');
  const ecs = ctx.report.encumbrances;
  if (ecs.length === 0) {
    paragraph(ctx, 'The Encumbrance Certificate discloses no transactions in the search period.', { italic: true });
    return;
  }
  renderTable(ctx,
    [
      { header: 'Tx no.',      w: 24 },
      { header: 'Date',        w: 22, align: 'center' },
      { header: 'Type',        w: 28 },
      { header: 'Parties',     w: 50 },
      { header: 'Value',       w: 28, align: 'right' },
      { header: 'Status',      w: 14, align: 'center' },
    ],
    ecs.map((e) => [
      e.transactionNo ?? '—',
      e.transactionDate ? formatINRDate(e.transactionDate) : '—',
      e.transactionType ?? '—',
      e.parties ?? '—',
      formatINRCurrency(e.consideration),
      e.status === 'discharged' ? 'Discharged' : 'Subsisting',
    ]),
  );
  // Subsisting summary.
  const subsisting = ecs.filter((e) => e.status === 'subsisting' && !e.dischargeDocRef);
  if (subsisting.length > 0) {
    paragraph(ctx,
      `${subsisting.length} subsisting encumbrance(s) without a registered discharge are noted. ` +
      'These must be procured before disbursement.', { italic: true });
  }
}

function renderSearches(ctx: RenderCtx): void {
  sectionHeading(ctx, 6, 'Searches conducted');
  const ss = ctx.report.searches;
  if (ss.length === 0) {
    paragraph(ctx, 'No public-record searches have been logged.', { italic: true });
    return;
  }
  for (const s of ss) {
    const sentence =
      `${SEARCH_TYPE_LABEL[s.searchType] ?? s.searchType}` +
      `${s.searchOffice ? `, ${s.searchOffice}` : ''}` +
      `${s.searchDate ? `, conducted on ${formatINRDate(s.searchDate)}` : ''}` +
      `${s.resultNegative ? '. The search returned no adverse hits.' : (s.resultSummary ? `. ${s.resultSummary}` : '.')}`;
    paragraph(ctx, sentence);
  }
}

function renderApprovals(ctx: RenderCtx): void {
  sectionHeading(ctx, 7, 'Statutory approvals');
  const aps = ctx.report.approvals;
  if (aps.length === 0) {
    paragraph(ctx, 'No statutory approvals have been recorded.', { italic: true });
    return;
  }
  renderTable(ctx,
    [
      { header: 'Approval',    w: 38 },
      { header: 'Authority',   w: 50 },
      { header: 'Reference',   w: 38 },
      { header: 'Issued',      w: 22, align: 'center' },
      { header: 'Status',      w: 18, align: 'center' },
    ],
    aps.map((a) => [
      a.approvalType.toUpperCase().replace(/_/g, ' '),
      a.authority ?? '—',
      a.referenceNo ?? '—',
      a.issueDate ? formatINRDate(a.issueDate) : '—',
      a.status.replace(/_/g, ' '),
    ]),
  );
}

function renderLitigation(ctx: RenderCtx): void {
  sectionHeading(ctx, 8, 'Litigation search');
  const ls = ctx.report.litigation;
  if (ls.length === 0) {
    paragraph(ctx, 'No subsisting litigation has been disclosed by the searches conducted.', { italic: true });
    return;
  }
  for (const l of ls) {
    const sentence =
      `${l.court ?? '(court)'} — ${l.caseNumber ?? '(no number)'}. ` +
      `Parties: ${l.parties ?? '—'}.` +
      `${l.causeOfAction ? ` Cause of action: ${l.causeOfAction}.` : ''}` +
      `${l.stage ? ` Stage: ${l.stage}.` : ''}` +
      ` Relevance: ${l.relevance}.`;
    paragraph(ctx, sentence);
  }
}

function renderHeirs(ctx: RenderCtx): void {
  if (ctx.report.heirs.length === 0) return;
  sectionHeading(ctx, 9, 'Heirs and devolution');
  renderTable(ctx,
    [
      { header: 'Predecessor', w: 40 },
      { header: 'Date of death', w: 24, align: 'center' },
      { header: 'Heir', w: 40 },
      { header: 'Relationship', w: 30 },
      { header: 'Share', w: 20, align: 'center' },
      { header: 'Consent', w: 22, align: 'center' },
    ],
    ctx.report.heirs.map((h) => [
      h.predecessorName,
      h.predecessorDod ? formatINRDate(h.predecessorDod) : '—',
      h.heirName,
      h.relationship ?? '—',
      h.share ?? '—',
      h.consentStatus.replace(/_/g, ' '),
    ]),
  );
}

function renderDefects(ctx: RenderCtx, sectionNo: number): void {
  sectionHeading(ctx, sectionNo, 'Defects and observations');
  const defects = ctx.report.defects.filter((d) => !d.dismissed && d.severity !== 'info');
  if (defects.length === 0) {
    paragraph(ctx, 'No material defects subsist in the title as on the date hereof.', { italic: true });
    return;
  }
  defects.forEach((d, i) => {
    ensure(ctx, LH.body * 4);
    ctx.pdf.setFont(FONT_BODY, 'bold');
    ctx.pdf.setFontSize(SIZE.body);
    ctx.pdf.text(
      `${i + 1}. ${d.category.replace(/_/g, ' ').toUpperCase()}  [${d.severity.toUpperCase()}]`,
      MARGIN.left, ctx.y,
    );
    ctx.y += LH.body;
    ctx.pdf.setFont(FONT_BODY, 'normal');
    paragraph(ctx, d.description, { indent: 6 });
    if (d.recommendation) {
      ctx.pdf.setFont(FONT_BODY, 'italic');
      paragraph(ctx, `Recommendation: ${d.recommendation}`, { italic: true, indent: 6 });
    }
  });
}

function renderOpinion(ctx: RenderCtx, sectionNo: number): void {
  sectionHeading(ctx, sectionNo, 'Opinion on marketability');
  ctx.pdf.setFont(FONT_BODY, 'bold');
  ctx.pdf.text(`Verdict: ${VERDICT_LABEL[ctx.report.opinionVerdict] ?? ctx.report.opinionVerdict}`, MARGIN.left, ctx.y);
  ctx.y += LH.body + 1;
  ctx.pdf.setFont(FONT_BODY, 'normal');
  if (ctx.report.opinionSummary && ctx.report.opinionSummary.trim()) {
    // Preserve paragraph breaks from the on-screen editor.
    const paragraphs = ctx.report.opinionSummary.split(/\n\s*\n/);
    for (const p of paragraphs) {
      paragraph(ctx, p.replace(/\n/g, ' ').trim());
    }
  } else {
    paragraph(ctx, '(The marketability opinion has not yet been recorded.)', { italic: true });
  }
}

function renderOriginalsList(ctx: RenderCtx, sectionNo: number): void {
  sectionHeading(ctx, sectionNo, 'List of original documents to be deposited');
  const originals = ctx.report.documents.filter((d) => d.copyType === 'original');
  if (originals.length === 0) {
    paragraph(ctx, '(To be confirmed prior to deposit.)', { italic: true });
    return;
  }
  bulletList(ctx, originals.map((d, i) => `${i + 1}. ${d.documentLabel} (${DOC_TYPE_LABEL[d.documentType] ?? d.documentType})`));
}

function renderCertification(ctx: RenderCtx, sectionNo: number): void {
  sectionHeading(ctx, sectionNo, 'Certification and signature');
  paragraph(ctx,
    `The undersigned hereby certifies that, on a perusal of the documents furnished and the searches ` +
    `conducted as recorded above, the title to the schedule property has been investigated to the best ` +
    `of professional knowledge and ability. This opinion is rendered on the basis of documents and ` +
    `searches available as on ${formatINRDate(new Date().toISOString())}.`);

  // Signature block.
  ensure(ctx, 40);
  ctx.y = Math.min(ctx.y + 6, CONTENT_BOTTOM - 35);
  ctx.pdf.setFont(FONT_BODY, 'normal');
  ctx.pdf.setFontSize(SIZE.body);
  ctx.pdf.text('Yours faithfully,', PAGE.w - MARGIN.right, ctx.y, { align: 'right' });
  ctx.y += LH.body * 4;
  ctx.pdf.setDrawColor(40);
  ctx.pdf.setLineWidth(0.3);
  ctx.pdf.line(PAGE.w - MARGIN.right - 70, ctx.y, PAGE.w - MARGIN.right, ctx.y);
  ctx.y += LH.body * 0.8;
  ctx.pdf.setFont(FONT_BODY, 'bold');
  ctx.pdf.text('(Advocate)', PAGE.w - MARGIN.right, ctx.y, { align: 'right' });
  ctx.y += LH.body;
  ctx.pdf.setFont(FONT_BODY, 'normal');
  ctx.pdf.text('Bar Council Enrolment No.: ______________', PAGE.w - MARGIN.right, ctx.y, { align: 'right' });
  ctx.y += LH.body;
  ctx.pdf.text(`Place: ____________________`, PAGE.w - MARGIN.right - 56, ctx.y, { align: 'left' });
  ctx.pdf.text(`Date: ${formatINRDate(new Date().toISOString())}`, PAGE.w - MARGIN.right, ctx.y, { align: 'right' });
}

// ---- Public API -----------------------------------------------------------

/**
 * Build a formatted Indian title report PDF and trigger download. Returns the
 * generated Blob so the caller can record the export's byte size.
 *
 * The `_node` parameter is kept for backwards-compat with the on-screen
 * preview path but is no longer captured; the layout is laid out directly
 * with jsPDF primitives.
 */
export async function exportTitleReportPdf(
  _node: HTMLElement | TitleReportFull,
  fileName: string,
  reportArg?: TitleReportFull,
): Promise<Blob> {
  // Backwards-compat: the original signature was (node, fileName). Callers
  // that still pass a DOM node also supply the report via the third arg or
  // (preferred) pass the report directly as the first arg.
  const report: TitleReportFull | null =
    reportArg
    ?? (typeof _node === 'object' && _node !== null && 'reportNumber' in (_node as object)
          ? (_node as TitleReportFull)
          : null);
  if (!report) {
    throw new Error('exportTitleReportPdf: pass the TitleReportFull as the first or third argument');
  }

  const pdf = newPdf();
  const headerLeft = `Title Investigation Report  ·  ${report.reportNumber}`;
  const headerRight = `${report.applicantName}${report.bankName ? '  →  ' + report.bankName : ''}`;

  const ctx: RenderCtx = {
    pdf, y: MARGIN.top + 4, page: 1, report, headerLeft, headerRight,
  };

  // ---- Cover page ---------------------------------------------------------
  renderCoverPage(ctx);

  // ---- Body sections ------------------------------------------------------
  ctx.pdf.addPage();
  ctx.page = 2;
  drawPageHeader(ctx);
  ctx.y = MARGIN.top + 4;

  renderInstructions(ctx);
  renderProperty(ctx);
  renderDocumentsExamined(ctx);
  renderChain(ctx);
  renderEncumbrances(ctx);
  renderSearches(ctx);
  renderApprovals(ctx);
  renderLitigation(ctx);
  if (ctx.report.heirs.length > 0) renderHeirs(ctx);

  // The section numbering after #8/#9 depends on whether heirs rendered.
  const baseN = ctx.report.heirs.length > 0 ? 10 : 9;
  renderDefects(ctx, baseN);
  renderOpinion(ctx, baseN + 1);
  renderOriginalsList(ctx, baseN + 2);
  renderCertification(ctx, baseN + 3);

  // ---- Footers (drawn last, when total page count is known) --------------
  const total = ctx.pdf.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    ctx.pdf.setPage(p);
    drawPageFooter(ctx.pdf, p, total, report.reportNumber);
  }

  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return blob;
}
