import { createHash, randomBytes, randomInt } from 'node:crypto';
import { db } from '../db/client';
import { env } from '../env';
import { storage } from './storage.service';
import { documentRenderService } from './document-render.service';
import { documentsService } from './documents.service';
import { emailService } from './email.service';
import { esignAuditService, type EsignAuditEvent } from './esign-audit.service';
import { appendAuditSummaryPage } from './esign-pdf.service';
import { HttpError } from '../lib/errors';

// =============================================================================
// esign.service — self-built electronic-signature workflow. See
// 0079_esign.sql's header for the full legal scope (this is a Section 3A
// "electronic signature", not a Section 3 digital signature / Aadhaar
// eSign — those require a licensed Certifying Authority this product does
// not have).
//
// Lifecycle: draft -> sent -> (per signer: viewed -> consent -> OTP -> signed)
// -> completed (once every signer has signed) -> a new signed PDF is written
// back to `documents`, with an audit-summary page appended.
// =============================================================================

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const CONSENT_DISCLOSURE =
  'I agree to sign this document electronically. I understand this is an electronic signature under ' +
  'Section 3A of the Information Technology Act, 2000 — not a Certifying-Authority-issued digital ' +
  'signature or Aadhaar eSign — and that my IP address, device, and the time of signing will be recorded.';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface EsignSigner {
  id: string;
  requestId: string;
  userId: string | null;
  name: string;
  email: string;
  order: number;
  status: string;
  consentAt: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface EsignRequest {
  id: string;
  firmId: string;
  caseId: string | null;
  requestedBy: string;
  title: string;
  sourceDocumentId: string;
  sourceSha256: string;
  signedDocumentId: string | null;
  signedSha256: string | null;
  status: string;
  documentTypeHint: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  createdAt: string;
  signers: EsignSigner[];
}

interface RequestRow {
  id: string;
  firm_id: string;
  case_id: string | null;
  requested_by: string;
  title: string;
  source_document_id: string;
  source_sha256: string;
  signed_document_id: string | null;
  signed_sha256: string | null;
  status: string;
  document_type_hint: string | null;
  expires_at: Date | string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
}

interface SignerRow {
  id: string;
  request_id: string;
  user_id: string | null;
  name: string;
  email: string;
  order: number;
  status: string;
  token: string;
  consent_text: string | null;
  consent_at: Date | string | null;
  signed_at: Date | string | null;
  signed_ip: string | null;
  created_at: Date | string;
}

function isoOrNull(v: Date | string | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function signerFromRow(r: SignerRow): EsignSigner {
  return {
    id: r.id,
    requestId: r.request_id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    order: r.order,
    status: r.status,
    consentAt: isoOrNull(r.consent_at),
    signedAt: isoOrNull(r.signed_at),
    createdAt: isoOrNull(r.created_at) ?? new Date().toISOString(),
  };
}

async function loadSigners(requestId: string): Promise<EsignSigner[]> {
  const sql = db();
  if (!sql) return [];
  const rows = await sql<SignerRow[]>`
    select * from esign_signers where request_id = ${requestId} order by "order" asc, created_at asc
  `;
  return rows.map(signerFromRow);
}

async function requestFromRow(r: RequestRow): Promise<EsignRequest> {
  return {
    id: r.id,
    firmId: r.firm_id,
    caseId: r.case_id,
    requestedBy: r.requested_by,
    title: r.title,
    sourceDocumentId: r.source_document_id,
    sourceSha256: r.source_sha256,
    signedDocumentId: r.signed_document_id,
    signedSha256: r.signed_sha256,
    status: r.status,
    documentTypeHint: r.document_type_hint,
    expiresAt: isoOrNull(r.expires_at),
    completedAt: isoOrNull(r.completed_at),
    createdAt: isoOrNull(r.created_at) ?? new Date().toISOString(),
    signers: await loadSigners(r.id),
  };
}

function signingLink(token: string): string {
  return `${env.webPublicBaseUrl}/sign/${token}`;
}

export interface CreateEsignRequestInput {
  firmId: string;
  requestedBy: string;
  caseId?: string | null;
  title: string;
  sourceDocumentId: string;
  documentTypeHint?: string | null;
  expiresInDays?: number;
  signers: Array<{ name: string; email: string; userId?: string | null; order?: number }>;
}

export const esignService = {
  async create(input: CreateEsignRequestInput): Promise<EsignRequest> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    if (input.signers.length === 0) {
      throw new HttpError(422, 'At least one signer is required');
    }

    const sourceDoc = await documentsService.get(input.sourceDocumentId, input.firmId);
    if (!sourceDoc || !sourceDoc.hasFile) {
      throw new HttpError(404, 'Source document not found or has no file attached');
    }
    const key = sourceDoc.storageKey;
    if (!key) throw new HttpError(422, 'Source document has no storage key');
    const obj = await storage().getObject(key);
    if (!obj) throw new HttpError(404, 'Source document file is missing from storage');
    const sourceSha256 = sha256(obj.body);

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;

    const created = await sql.begin(async (tx) => {
      const [row] = await tx<RequestRow[]>`
        insert into esign_requests
          (firm_id, case_id, requested_by, title, source_document_id, source_sha256, document_type_hint, expires_at)
        values
          (${input.firmId}::uuid, ${input.caseId ?? null}::uuid, ${input.requestedBy}::uuid, ${input.title},
           ${input.sourceDocumentId}::uuid, ${sourceSha256}, ${input.documentTypeHint ?? null}, ${expiresAt})
        returning *
      `;
      const requestId = row!.id;

      for (const [i, s] of input.signers.entries()) {
        await tx`
          insert into esign_signers (request_id, user_id, name, email, "order", token)
          values (${requestId}::uuid, ${s.userId ?? null}, ${s.name}, ${s.email.toLowerCase().trim()}, ${s.order ?? i + 1}, ${generateToken()})
        `;
      }
      return row!;
    });

    await esignAuditService.record({
      requestId: created.id,
      eventType: 'request_created',
      detail: { title: input.title, signerCount: input.signers.length, sourceSha256 },
    });

    return requestFromRow(created);
  },

  /** Email every signer their signing link, in order. For now all signers
   *  are notified at once (parallel signing) — sequential-order enforcement
   *  (don't notify signer 2 until signer 1 completes) is a reasonable future
   *  refinement, not required for a legally valid signature today. */
  async send(requestId: string, firmId: string): Promise<EsignRequest> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const [row] = await sql<RequestRow[]>`
      select * from esign_requests where id = ${requestId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    if (!row) throw new HttpError(404, 'Request not found');
    if (row.status !== 'draft') throw new HttpError(409, `Cannot send a request in status '${row.status}'`);

    const signers = await loadSigners(requestId);
    await sql`update esign_requests set status = 'sent', updated_at = now() where id = ${requestId}::uuid`;

    for (const s of signers) {
      const link = signingLink((await sql<{ token: string }[]>`select token from esign_signers where id = ${s.id}::uuid`)[0]!.token);
      await emailService.send({
        to: s.email,
        subject: `Signature requested: ${row.title}`,
        body:
          `${s.name}, you've been asked to electronically sign "${row.title}".\n\n` +
          `Open this link to review and sign: ${link}\n\n` +
          `This link is unique to you — do not forward it.`,
      });
    }

    await esignAuditService.record({ requestId, eventType: 'sent', detail: { signerCount: signers.length } });
    const [updated] = await sql<RequestRow[]>`select * from esign_requests where id = ${requestId}::uuid`;
    return requestFromRow(updated!);
  },

  /** Resolve a signer's token into (request, signer) without exposing
   *  anything to a signer who doesn't hold the token. Returns null on any
   *  mismatch — callers should render a generic "link invalid or expired"
   *  rather than distinguishing why. */
  async resolveToken(token: string): Promise<{ request: EsignRequest; signer: EsignSigner } | null> {
    const sql = db();
    if (!sql) return null;
    const [signerRow] = await sql<SignerRow[]>`select * from esign_signers where token = ${token} limit 1`;
    if (!signerRow) return null;
    const [reqRow] = await sql<RequestRow[]>`select * from esign_requests where id = ${signerRow.request_id}::uuid`;
    if (!reqRow) return null;
    if (reqRow.expires_at && new Date(reqRow.expires_at) < new Date()) {
      return null;
    }
    const request = await requestFromRow(reqRow);
    return { request, signer: signerFromRow(signerRow) };
  },

  async recordOpened(signerId: string, requestId: string, ip: string | null, userAgent: string | null): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`
      update esign_signers set status = case when status = 'pending' then 'viewed' else status end, updated_at = now()
      where id = ${signerId}::uuid
    `;
    await esignAuditService.record({ requestId, signerId, eventType: 'opened', ipAddress: ip, userAgent });
  },

  async provideConsent(signerId: string, requestId: string, ip: string | null, userAgent: string | null): Promise<void> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    await sql`
      update esign_signers set consent_text = ${CONSENT_DISCLOSURE}, consent_at = now(), updated_at = now()
      where id = ${signerId}::uuid
    `;
    await esignAuditService.record({
      requestId, signerId, eventType: 'consent_provided',
      detail: { consentText: CONSENT_DISCLOSURE }, ipAddress: ip, userAgent,
    });
  },

  async requestOtp(signerId: string, requestId: string, ip: string | null, userAgent: string | null): Promise<void> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const [signer] = await sql<SignerRow[]>`select * from esign_signers where id = ${signerId}::uuid`;
    if (!signer) throw new HttpError(404, 'Signer not found');
    if (!signer.consent_at) throw new HttpError(409, 'Consent must be given before requesting an OTP');

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
    await sql`
      insert into esign_otp_challenges (signer_id, code_hash, sent_to_email, expires_at)
      values (${signerId}::uuid, ${hashOtp(code)}, ${signer.email}, ${expiresAt})
    `;
    await emailService.send({
      to: signer.email,
      subject: 'Your signing code',
      body: `Your one-time code to sign this document is: ${code}\n\nIt expires in ${OTP_TTL_MINUTES} minutes. Do not share this code.`,
    });
    await sql`update esign_signers set status = 'otp_sent', updated_at = now() where id = ${signerId}::uuid`;
    await esignAuditService.record({
      requestId, signerId, eventType: 'otp_sent', detail: { sentTo: signer.email }, ipAddress: ip, userAgent,
    });
  },

  async verifyOtp(signerId: string, requestId: string, code: string, ip: string | null, userAgent: string | null): Promise<boolean> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const [challenge] = await sql<{ id: string; code_hash: string; expires_at: Date; attempts: number; verified_at: Date | null }[]>`
      select id, code_hash, expires_at, attempts, verified_at from esign_otp_challenges
      where signer_id = ${signerId}::uuid order by created_at desc limit 1
    `;
    if (!challenge || challenge.verified_at) {
      await esignAuditService.record({ requestId, signerId, eventType: 'otp_failed', detail: { reason: 'no_active_challenge' }, ipAddress: ip, userAgent });
      return false;
    }
    if (new Date(challenge.expires_at) < new Date() || challenge.attempts >= OTP_MAX_ATTEMPTS) {
      await esignAuditService.record({ requestId, signerId, eventType: 'otp_failed', detail: { reason: 'expired_or_too_many_attempts' }, ipAddress: ip, userAgent });
      return false;
    }
    await sql`update esign_otp_challenges set attempts = attempts + 1 where id = ${challenge.id}::uuid`;
    if (hashOtp(code) !== challenge.code_hash) {
      await esignAuditService.record({ requestId, signerId, eventType: 'otp_failed', detail: { reason: 'wrong_code' }, ipAddress: ip, userAgent });
      return false;
    }
    await sql`update esign_otp_challenges set verified_at = now() where id = ${challenge.id}::uuid`;
    await sql`update esign_signers set status = 'otp_verified', updated_at = now() where id = ${signerId}::uuid`;
    await esignAuditService.record({ requestId, signerId, eventType: 'otp_verified', ipAddress: ip, userAgent });
    return true;
  },

  /** The actual signing act. Requires consent + a verified OTP to have
   *  already happened (checked against esign_signers.status, not re-derived
   *  here, so the state machine lives in one place). Completes the whole
   *  request (renders the final signed PDF) once every signer has signed. */
  async sign(signerId: string, requestId: string, ip: string | null, userAgent: string | null): Promise<EsignRequest> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const [signer] = await sql<SignerRow[]>`select * from esign_signers where id = ${signerId}::uuid`;
    if (!signer) throw new HttpError(404, 'Signer not found');
    if (signer.status !== 'otp_verified') {
      throw new HttpError(409, 'OTP must be verified immediately before signing');
    }

    await sql`
      update esign_signers set status = 'signed', signed_at = now(), signed_ip = ${ip}, signed_user_agent = ${userAgent}, updated_at = now()
      where id = ${signerId}::uuid
    `;
    await esignAuditService.record({ requestId, signerId, eventType: 'signed', ipAddress: ip, userAgent });

    const remaining = await sql<{ count: string }[]>`
      select count(*)::text as count from esign_signers where request_id = ${requestId}::uuid and status != 'signed'
    `;
    const allSigned = Number(remaining[0]?.count ?? '1') === 0;

    if (allSigned) {
      await this.complete(requestId);
    } else {
      await sql`update esign_requests set status = 'partially_signed', updated_at = now() where id = ${requestId}::uuid`;
    }

    const [row] = await sql<RequestRow[]>`select * from esign_requests where id = ${requestId}::uuid`;
    return requestFromRow(row!);
  },

  /** Render the final signed artifact: fetch the source document bytes,
   *  convert to PDF if needed, append the audit-summary page, hash the
   *  result, and write it back as a new `documents` row. Internal — called
   *  by sign() once every signer is done. */
  async complete(requestId: string): Promise<void> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const [row] = await sql<RequestRow[]>`select * from esign_requests where id = ${requestId}::uuid`;
    if (!row) throw new HttpError(404, 'Request not found');

    const sourceDoc = await documentsService.get(row.source_document_id, row.firm_id);
    if (!sourceDoc?.storageKey) throw new HttpError(422, 'Source document missing');
    const obj = await storage().getObject(sourceDoc.storageKey);
    if (!obj) throw new HttpError(422, 'Source document file missing from storage');

    const isPdf = obj.contentType === 'application/pdf' || sourceDoc.fileName?.toLowerCase().endsWith('.pdf');
    const basePdf = isPdf ? obj.body : await documentRenderService.convertBase64ToPdf(obj.body.toString('base64'));

    // Raw rows, not the summarized EsignSigner type, so the PDF summary gets
    // the actual signed_ip / consent_text captured at signing time.
    const signerRows = await sql<SignerRow[]>`
      select * from esign_signers where request_id = ${requestId}::uuid order by "order" asc, created_at asc
    `;
    const auditEvents = await esignAuditService.listForRequest(requestId);
    const finalChainHash = auditEvents.length > 0 ? auditEvents[auditEvents.length - 1]!.eventHash : null;

    const signed = await appendAuditSummaryPage({
      sourcePdf: basePdf,
      requestId,
      requestTitle: row.title,
      sourceSha256: row.source_sha256,
      signers: signerRows.map((s) => ({
        name: s.name,
        email: s.email,
        signedAt: isoOrNull(s.signed_at),
        ipAddress: s.signed_ip,
        consentText: s.consent_text,
      })),
      auditEvents,
      finalChainHash,
    });

    const signedSha256 = sha256(signed);
    const signedKey = `esign/${requestId}/signed-${Date.now()}.pdf`;
    await storage().putObject({ key: signedKey, body: signed, contentType: 'application/pdf' });

    const signedDoc = await documentsService.create(
      {
        name: `${row.title} (signed).pdf`,
        type: 'Signed Document',
        case: sourceDoc.case,
        updated: 'just now',
        fileName: `${row.title}-signed.pdf`,
        fileMime: 'application/pdf',
        fileSize: signed.length,
        storageKey: signedKey,
      },
      row.firm_id,
    );

    await sql`
      update esign_requests
      set status = 'completed', signed_document_id = ${signedDoc.id}::uuid, signed_sha256 = ${signedSha256},
          completed_at = now(), updated_at = now()
      where id = ${requestId}::uuid
    `;
    await esignAuditService.record({
      requestId, eventType: 'completed', detail: { signedDocumentId: signedDoc.id, signedSha256 },
    });
  },

  async get(requestId: string, firmId: string): Promise<EsignRequest | null> {
    const sql = db();
    if (!sql) return null;
    const [row] = await sql<RequestRow[]>`
      select * from esign_requests where id = ${requestId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    return row ? requestFromRow(row) : null;
  },

  async list(firmId: string, caseId?: string | null): Promise<EsignRequest[]> {
    const sql = db();
    if (!sql) return [];
    const rows = caseId
      ? await sql<RequestRow[]>`select * from esign_requests where firm_id = ${firmId}::uuid and case_id = ${caseId}::uuid order by created_at desc`
      : await sql<RequestRow[]>`select * from esign_requests where firm_id = ${firmId}::uuid order by created_at desc`;
    return Promise.all(rows.map(requestFromRow));
  },

  async decline(signerId: string, requestId: string, reason: string | null, ip: string | null, userAgent: string | null): Promise<void> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    await sql`
      update esign_signers set status = 'declined', declined_reason = ${reason}, updated_at = now() where id = ${signerId}::uuid
    `;
    await sql`update esign_requests set status = 'declined', updated_at = now() where id = ${requestId}::uuid`;
    await esignAuditService.record({ requestId, signerId, eventType: 'declined', detail: { reason }, ipAddress: ip, userAgent });
  },

  async cancel(requestId: string, firmId: string): Promise<void> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const res = await sql`
      update esign_requests set status = 'cancelled', updated_at = now()
      where id = ${requestId}::uuid and firm_id = ${firmId}::uuid and status not in ('completed', 'cancelled')
    `;
    if (res.count === 0) throw new HttpError(404, 'Request not found or already final');
    await esignAuditService.record({ requestId, eventType: 'cancelled' });
  },

  async auditTrail(requestId: string, firmId: string): Promise<EsignAuditEvent[]> {
    const sql = db();
    if (!sql) return [];
    const [row] = await sql<{ id: string }[]>`select id from esign_requests where id = ${requestId}::uuid and firm_id = ${firmId}::uuid`;
    if (!row) return [];
    return esignAuditService.listForRequest(requestId);
  },
};
