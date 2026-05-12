import type { AuditAction, AuditLogEntry, AuditLogQuery } from '@lexdraft/types';
import { db } from '../db/client';

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  /** Comes back as a string from `postgres` jsonb in the default config; we parse defensively. */
  payload: Record<string, unknown> | string | null;
  created_at: Date;
}

/**
 * Default retention window for audit rows. DPDP §11(1) requires data
 * fiduciaries to retain evidence of compliance; 7 years matches the standard
 * accounting / books-of-account retention under §128 of the Companies Act
 * and gives us head-room beyond any reasonable enforcement window.
 *
 * Stamped onto every audit write (via the inline `interval '7 years'` in the
 * insert below) so the daily purge job
 * (dpdpService.purgeExpiredAuditEntries) can sweep stale entries without
 * needing a separate retention-policy table.
 */

function parsePayload(raw: AuditRow['payload']): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; }
    catch { return null; }
  }
  return raw;
}

function rowToEntry(r: AuditRow): AuditLogEntry {
  return {
    id: r.id,
    actorUserId: r.actor_user_id ?? '',
    actorEmail: r.actor_email,
    action: r.action as AuditAction,
    targetType: r.target_type as AuditLogEntry['targetType'],
    targetId: r.target_id,
    payload: parsePayload(r.payload),
    createdAt: r.created_at.toISOString(),
  };
}

// In-memory fallback when DATABASE_URL is blank. Capped to last 500 entries.
const memLog: AuditRow[] = [];

interface WriteInput {
  actorUserId: string;
  actorEmail: string;
  action: AuditAction;
  targetType: AuditLogEntry['targetType'];
  targetId?: string | null;
  /** Free-form structured metadata (request patches, before/after, etc.). */
  payload?: unknown;
}

export const auditService = {
  async write(input: WriteInput): Promise<void> {
    const sql = db();
    if (sql) {
      const payloadJson = input.payload == null ? null : JSON.stringify(input.payload);
      // `retain_until` is set via sql.unsafe-ish raw fragment so the row's
      // `created_at` and the retention deadline are anchored to the same
      // statement-time `now()`. Falls back gracefully if the column doesn't
      // exist yet (pre-migration 0020) — we re-issue the insert without it.
      try {
        await sql`
          insert into audit_log (actor_user_id, actor_email, action, target_type, target_id, payload, retain_until)
          values (
            ${input.actorUserId}::uuid,
            ${input.actorEmail},
            ${input.action},
            ${input.targetType},
            ${input.targetId ?? null},
            ${payloadJson}::jsonb,
            now() + interval '7 years'
          )
        `;
      } catch (err) {
        // 42703 = undefined_column. Means migration 0020 hasn't run yet —
        // fall back to the pre-DPDP shape so the audit write still lands.
        const code = (err as { code?: string } | null)?.code;
        if (code === '42703') {
          await sql`
            insert into audit_log (actor_user_id, actor_email, action, target_type, target_id, payload)
            values (
              ${input.actorUserId}::uuid,
              ${input.actorEmail},
              ${input.action},
              ${input.targetType},
              ${input.targetId ?? null},
              ${payloadJson}::jsonb
            )
          `;
        } else {
          throw err;
        }
      }
      return;
    }
    memLog.unshift({
      id: crypto.randomUUID(),
      actor_user_id: input.actorUserId,
      actor_email: input.actorEmail,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      payload: (input.payload ?? null) as Record<string, unknown> | string | null,
      created_at: new Date(),
    });
    if (memLog.length > 500) memLog.length = 500;
  },

  async list(query: AuditLogQuery = {}): Promise<AuditLogEntry[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);

    const sql = db();
    if (sql) {
      const rows = await sql<AuditRow[]>`
        select id, actor_user_id, actor_email, action, target_type, target_id, payload, created_at
        from audit_log
        where (${query.actorUserId ?? null}::uuid is null or actor_user_id = ${query.actorUserId ?? null}::uuid)
          and (${query.targetType ?? null}::text is null or target_type = ${query.targetType ?? null})
          and (${query.targetId ?? null}::uuid is null or target_id = ${query.targetId ?? null}::uuid)
          and (${query.action ?? null}::text is null or action = ${query.action ?? null})
        order by created_at desc
        limit ${limit} offset ${offset}
      `;
      return rows.map(rowToEntry);
    }

    return memLog
      .filter((r) =>
        (!query.actorUserId || r.actor_user_id === query.actorUserId) &&
        (!query.targetType || r.target_type === query.targetType) &&
        (!query.targetId || r.target_id === query.targetId) &&
        (!query.action || r.action === query.action),
      )
      .slice(offset, offset + limit)
      .map(rowToEntry);
  },

  async recentForFirm(firmId: string, limit = 20): Promise<AuditLogEntry[]> {
    const sql = db();
    if (sql) {
      const rows = await sql<AuditRow[]>`
        select id, actor_user_id, actor_email, action, target_type, target_id, payload, created_at
        from audit_log
        where target_type = 'firm' and target_id = ${firmId}::uuid
        order by created_at desc
        limit ${limit}
      `;
      return rows.map(rowToEntry);
    }
    return memLog.filter((r) => r.target_type === 'firm' && r.target_id === firmId).slice(0, limit).map(rowToEntry);
  },

  /**
   * Tenant-scoped audit feed for the firm-admin console. Returns entries
   * authored by anyone whose `firm_id` matches the caller's firm, plus
   * platform-level actions whose direct target is the firm itself
   * (e.g. plan changes, suspensions), plus portal-client actions on this
   * firm's clients. The audit_log table has no firm_id column today so
   * scoping is via joins on `users` (firm staff) and `clients` (portal
   * clients — distinguished by `payload.actorKind = 'portal_client'`).
   */
  async listForFirm(firmId: string, query: AuditLogQuery = {}): Promise<AuditLogEntry[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const offset = Math.max(query.offset ?? 0, 0);
    const sql = db();
    if (sql) {
      const rows = await sql<AuditRow[]>`
        select a.id, a.actor_user_id, a.actor_email, a.action, a.target_type, a.target_id,
               a.payload, a.created_at
        from audit_log a
        left join users u on u.id = a.actor_user_id
        left join clients cl on cl.id = a.actor_user_id
        where (
                u.firm_id = ${firmId}::uuid
                or (a.target_type = 'firm' and a.target_id = ${firmId}::uuid)
                or cl.firm_id = ${firmId}::uuid
              )
          and (${query.actorUserId ?? null}::uuid is null or a.actor_user_id = ${query.actorUserId ?? null}::uuid)
          and (${query.targetType ?? null}::text is null or a.target_type = ${query.targetType ?? null})
          and (${query.targetId ?? null}::uuid is null or a.target_id = ${query.targetId ?? null}::uuid)
          and (${query.action ?? null}::text is null or a.action = ${query.action ?? null})
        order by a.created_at desc
        limit ${limit} offset ${offset}
      `;
      return rows.map(rowToEntry);
    }
    // In-memory fallback can't resolve actor → firm without the users table;
    // fall back to direct-target matches so dev demos still produce a feed.
    return memLog
      .filter((r) =>
        ((r.target_type === 'firm' && r.target_id === firmId)) &&
        (!query.actorUserId || r.actor_user_id === query.actorUserId) &&
        (!query.targetType || r.target_type === query.targetType) &&
        (!query.targetId || r.target_id === query.targetId) &&
        (!query.action || r.action === query.action),
      )
      .slice(offset, offset + limit)
      .map(rowToEntry);
  },
};
