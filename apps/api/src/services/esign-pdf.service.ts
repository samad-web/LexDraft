import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { EsignAuditEvent } from './esign-audit.service';

// =============================================================================
// esign-pdf.service — appends a signature/audit summary page to the signed
// document. This is NOT a cryptographic signature embedded in the PDF
// structure (that would need a PKI certificate this system doesn't have —
// see 0079_esign.sql's header). It's a human-readable record, printed INTO
// the document itself, of who signed, when, and the evidence captured —
// so the summary travels with the file even outside DifAI, and so
// opening the PDF doesn't require trusting a separate system to see what
// happened.
// =============================================================================

export interface SignerSummary {
  name: string;
  email: string;
  signedAt: string | null;
  ipAddress: string | null;
  consentText: string | null;
}

export interface AppendAuditPageInput {
  sourcePdf: Buffer;
  requestId: string;
  requestTitle: string;
  sourceSha256: string;
  signers: SignerSummary[];
  auditEvents: EsignAuditEvent[];
  /** Hash of the final chain's last event — printed so a reader can
   *  independently ask DifAI to verify the chain against this value. */
  finalChainHash: string | null;
}

const PAGE_MARGIN = 54;

export async function appendAuditSummaryPage(input: AppendAuditPageInput): Promise<Buffer> {
  const doc = await PDFDocument.load(input.sourcePdf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const PAGE_SIZE: [number, number] = [595.28, 841.89]; // A4
  let page = doc.addPage(PAGE_SIZE);
  let y = page.getHeight() - PAGE_MARGIN;
  const left = PAGE_MARGIN;
  const lineHeight = 14;

  const newPage = () => {
    page = doc.addPage(PAGE_SIZE);
    y = page.getHeight() - PAGE_MARGIN;
  };

  const draw = (text: string, opts: { font?: typeof font; size?: number; gap?: number } = {}) => {
    if (y < PAGE_MARGIN) newPage();
    page.drawText(text, {
      x: left,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? font,
      color: rgb(0.13, 0.12, 0.1),
    });
    y -= (opts.gap ?? lineHeight);
  };

  const rule = () => {
    if (y < PAGE_MARGIN) newPage();
    page.drawLine({
      start: { x: left, y },
      end: { x: page.getWidth() - PAGE_MARGIN, y },
      thickness: 0.5,
      color: rgb(0.8, 0.78, 0.72),
    });
    y -= 12;
  };

  draw('ELECTRONIC SIGNATURE RECORD', { font: bold, size: 14, gap: 20 });
  draw(
    'This page is a human-readable record appended by DifAI at the time every signer completed',
    { size: 8.5, gap: 11 },
  );
  draw(
    'signing. It is NOT a Section 3 digital signature certificate or Aadhaar eSign — it is a Section 3A',
    { size: 8.5, gap: 11 },
  );
  draw(
    'electronic signature. Its legal weight if challenged depends on this record and DifAI\'s audit',
    { size: 8.5, gap: 11 },
  );
  draw('log, not a Certifying Authority certificate.', { size: 8.5, gap: 18 });
  rule();

  draw(`Document: ${input.requestTitle}`, { font: bold, gap: 16 });
  draw(`Request ID: ${input.requestId}`, { font: mono, size: 9, gap: 14 });
  draw(`Source document SHA-256: ${input.sourceSha256}`, { font: mono, size: 8, gap: 14 });
  if (input.finalChainHash) {
    draw(`Audit chain hash (last event): ${input.finalChainHash}`, { font: mono, size: 8, gap: 18 });
  } else {
    y -= 4;
  }

  rule();
  draw('SIGNERS', { font: bold, gap: 16 });
  for (const s of input.signers) {
    draw(`${s.name}  <${s.email}>`, { font: bold, gap: 13 });
    draw(`  Signed: ${s.signedAt ?? 'not yet signed'}`, { size: 9, gap: 12 });
    draw(`  IP address at signing: ${s.ipAddress ?? 'n/a'}`, { size: 9, gap: 12 });
    if (s.consentText) {
      draw(`  Consent: "${s.consentText}"`, { size: 8.5, gap: 16 });
    } else {
      y -= 4;
    }
  }

  rule();
  draw('AUDIT TRAIL', { font: bold, gap: 16 });
  for (const e of input.auditEvents) {
    // draw() starts a fresh page on its own when the trail runs past the
    // bottom margin — no special-casing needed here.
    const line = `${e.occurredAt}  ${e.eventType}${e.ipAddress ? `  (${e.ipAddress})` : ''}`;
    draw(line, { font: mono, size: 8, gap: 11 });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
