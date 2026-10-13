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
  detail: unknown;
  ip_address: string | null;
  user_agent: string | null;
  prev_event_hash: string | null;
  event_hash: string;
  occurred_at: string;
}

function fromRow(r: Row): EsignAuditEvent {
  return {
    id: r.id,
    requestId: r.request_id,
    signerId: r.signer_id,
    eventType: r.event_type as EsignEventType,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    prevEventHash: r.prev_event_hash,
    eventHash: r.event_hash,
    occurredAt: new Date(r.occurred_at).toISOString(),
  };
}

/** sha256(prevHash || eventType || canonical(detail) || occurredAtIso).
 *  JSON.stringify on an object with stable insertion order is sufficient
 *  here - detail objects are built fresh per call-site, not round-tripped
 *  through a source that could reorder keys. */
function computeHash(prevHash: string | null, eventType: string, detail: unknown, occurredAtIso: string): string {
  const h = createHash('sha256');
  h.update(prevHash ?? '');
  h.update('\0');
  h.update(eventType);
  h.update('\0');
  h.update(JSON.stringify(detail ?? {}));
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
    const detail = input.detail ?? {};
    const eventHash = computeHash(prevHash, input.eventType, detail, occurredAtIso);

    const rows = await sql<Row[]>`
      insert into esign_audit_events
        (request_id, signer_id, event_type, detail, ip_address, user_agent, prev_event_hash, event_hash, occurred_at)
      values
        (${input.requestId}, ${input.signerId ?? null}, ${input.eventType}, ${JSON.stringify(detail)}::jsonb,
         ${input.ipAddress ?? null}, ${input.userAgent ?? null}, ${prevHash}, ${eventHash}, ${occurredAt})
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
    const events = await this.listForRequest(requestId);
    let prevHash: string | null = null;
    for (let i = 0; i < events.length; i += 1) {
      const e = events[i]!;
      const expected = computeHash(prevHash, e.eventType, e.detail, e.occurredAt);
      if (expected !== e.eventHash || e.prevEventHash !== prevHash) {
        return { intact: false, brokenAt: { eventId: e.id, index: i } };
      }
      prevHash = e.eventHash;
    }
    return { intact: true };
  },
};
