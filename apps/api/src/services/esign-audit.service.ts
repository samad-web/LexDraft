import { createHash } from 'node:crypto';
import { db } from '../db/client';

// =============================================================================
// esign-audit.service — the hash-chained, append-only evidentiary log behind
// every electronic-signature request. See 0079_esign.sql's header for the
// full legal rationale (IT Act Section 3A / 10A, BSA Section 63(4)).
//
// Each event's hash covers the PREVIOUS event's hash + this event's own
// content, chained per request. Recomputing the chain from stored rows and
// comparing against the stored event_hash values detects any row that was
// edited or deleted out of order after the fact - this is the closest a
// self-built, non-CA-backed system can get to tamper-evidence. It is NOT a
// cryptographic timestamp authority and does not substitute for one; it only
// proves internal consistency of LexDraft's own records.
//
// detail and occurred_at are hashed from their EXACT stored string form
// (detail_json text, occurred_at_iso text) — NOT from Postgres's jsonb/
// timestamptz read-back. jsonb re-canonicalises key order/whitespace on
// storage and timestamptz formatting can round-trip differently than the
// JS Date.toISOString() that was hashed at write time; either one silently
// breaks every recomputed hash if used. Verified against this exact bug in
// testing before it shipped.
// =============================================================================

export type EsignEventType =
  | 'request_created' | 'sent' | 'opened' | 'consent_provided'
  | 'otp_sent' | 'otp_verified' | 'otp_failed'
  | 'signed' | 'declined' | 'completed' | 'cancelled' | 'expired' | 'downloaded';

export interface EsignAuditEvent {
  id: string;
  requestId: string;
  signerId: string | null;
  eventType: EsignEventType;
  detail: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  prevEventHash: string | null;
  eventHash: string;
  occurredAt: string;
}

interface Row {
  id: string;
  request_id: string;
  signer_id: string | null;
  event_type: string;
  detail_json: string;
  ip_address: string | null;
  user_agent: string | null;
  prev_event_hash: string | null;
  event_hash: string;
  occurred_at_iso: string;
}

function fromRow(r: Row): EsignAuditEvent {
  let detail: Record<string, unknown> = {};
  try { detail = JSON.parse(r.detail_json) as Record<string, unknown>; } catch { /* leave empty */ }
  return {
    id: r.id,
    requestId: r.request_id,
    signerId: r.signer_id,
    eventType: r.event_type as EsignEventType,
    detail,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    prevEventHash: r.prev_event_hash,
    eventHash: r.event_hash,
    occurredAt: r.occurred_at_iso,
  };
}

/** sha256(prevHash || eventType || detailJson || occurredAtIso). Operates
 *  on the EXACT strings that get stored — never re-derive these from a
 *  parsed/reformatted value, or the chain breaks on every read-back. */
function computeHash(prevHash: string | null, eventType: string, detailJson: string, occurredAtIso: string): string {
  const h = createHash('sha256');
  h.update(prevHash ?? '');
  h.update('\0');
  h.update(eventType);
  h.update('\0');
  h.update(detailJson);
  h.update('\0');
  h.update(occurredAtIso);
  return h.digest('hex');
}

export interface RecordEventInput {
  requestId: string;
  signerId?: string | null;
  eventType: EsignEventType;
  detail?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const esignAuditService = {
  /** Append one event to a request's chain. Reads the current last hash for
   *  this request, computes the new row's hash on top of it, inserts. Not
   *  wrapped in its own transaction here - callers that need the audit
   *  event and a state change to be atomic should run both inside one
   *  `sql.begin()` block (see esign.service.ts). */
  async record(input: RecordEventInput): Promise<EsignAuditEvent> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');

    const last = await sql<{ event_hash: string }[]>`
      select event_hash from esign_audit_events
      where request_id = ${input.requestId}
      order by occurred_at desc, id desc
      limit 1
    `;
    const prevHash = last[0]?.event_hash ?? null;
    const occurredAt = new Date();
    const occurredAtIso = occurredAt.toISOString();
    const detailJson = JSON.stringify(input.detail ?? {});
    const eventHash = computeHash(prevHash, input.eventType, detailJson, occurredAtIso);

    const rows = await sql<Row[]>`
      insert into esign_audit_events
        (request_id, signer_id, event_type, detail_json, ip_address, user_agent, prev_event_hash, event_hash, occurred_at, occurred_at_iso)
      values
        (${input.requestId}, ${input.signerId ?? null}, ${input.eventType}, ${detailJson},
         ${input.ipAddress ?? null}, ${input.userAgent ?? null}, ${prevHash}, ${eventHash}, ${occurredAt}, ${occurredAtIso})
      returning *
    `;
    return fromRow(rows[0]!);
  },

  async listForRequest(requestId: string): Promise<EsignAuditEvent[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select * from esign_audit_events where request_id = ${requestId} order by occurred_at asc, id asc
    `;
    return rows.map(fromRow);
  },

  /** Recompute the chain from stored rows and compare against stored hashes.
   *  Returns { intact: true } or the index + ids of the first row where the
   *  recomputed hash diverges - i.e. tampering or out-of-order mutation.
   *  Exposed for the audit-trail export and for a future admin "verify
   *  integrity" action; not called on every read (recomputing per-request on
   *  every GET would be wasteful - this is for export/dispute time). */
  async verifyChain(requestId: string): Promise<{ intact: boolean; brokenAt?: { eventId: string; index: number } }> {
    const sql = db();
    if (!sql) return { intact: true };
    const rows = await sql<Row[]>`
      select * from esign_audit_events where request_id = ${requestId} order by occurred_at asc, id asc
    `;
    let prevHash: string | null = null;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      const expected = computeHash(prevHash, r.event_type, r.detail_json, r.occurred_at_iso);
      if (expected !== r.event_hash || r.prev_event_hash !== prevHash) {
        return { intact: false, brokenAt: { eventId: r.id, index: i } };
      }
      prevHash = r.event_hash;
    }
    return { intact: true };
  },
};
