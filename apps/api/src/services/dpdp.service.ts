/**
 * DPDP Act 2023 compliance service.
 *
 * Backs the `/api/me/dpdp/*` data-principal endpoints — export, deletion
 * request, deletion cancellation, and the consent ledger. Also exposes two
 * background-job handlers (`purgeDueDeletions`, `purgeExpiredAuditEntries`)
 * that the orchestrator wires into pg-boss on a daily cron.
 *
 * Soft-delete semantics:
 *   - Calling `requestDeletion` sets `deleted_at = now()` on the user row
 *     AND on every row the user authored (drafts), then sets
 *     `scheduled_purge_at = now() + retention`. The user is also moved to
 *     status='deactivated' so they can't sign back in.
 *   - Tenant-owned data (clients, cases, etc.) is firm-scoped and NOT
 *     soft-deleted just because one user wants to leave — that would purge
 *     the firm's case files. Only the user's personal artefacts (drafts,
 *     consent entries, the user row itself) are flagged.
 *   - `cancelDeletion` clears both flags as long as `scheduled_purge_at` is
 *     still in the future.
 *   - `purgeDueDeletions` hard-deletes anything whose `scheduled_purge_at`
 *     has passed. Runs daily.
 */

import type { AuditAction, AuditTargetType } from '@lexdraft/types';
import { db } from '../db/client';
import { logger } from '../logger';
import { auditService } from './audit.service';
import { firmIdForUser, invalidateTenantCache } from './tenant';
import { NotFoundError, ConflictError, UnprocessableEntityError } from '../lib/errors';
import type {
  ConsentRecord,
  DeletionRequest,
  ExportedUser,
  RecordConsentInput,
  UserDataExport,
} from '../types/dpdp.types';

interface ConsentRow {
  id: string;
  user_id: string | null;
  firm_id: string | null;
  consent_type: string;
  consent_version: string;
  granted: boolean;
  ip: string | null;
  user_agent: string | null;
  created_at: Date;
}

function consentRowToRecord(r: ConsentRow): ConsentRecord {
  return {
    id: r.id,
    userId: r.user_id,
    firmId: r.firm_id,
    consentType: r.consent_type,
    consentVersion: r.consent_version,
    granted: r.granted,
    ip: r.ip,
    userAgent: r.user_agent,
    createdAt: r.created_at.toISOString(),
  };
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string | null;
  firm_id: string | null;
  created_at: Date;
  last_seen_at: Date | null;
  deleted_at: Date | null;
  scheduled_purge_at: Date | null;
}

function userRowToExported(r: UserRow): ExportedUser {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    firmId: r.firm_id,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
  };
}

/** Maximum retention window the data principal can request. One year is more
 *  than enough head-room for accidental-deletion recovery; longer means rows
 *  that are conceptually "deleted" linger in the operational database. */
const MAX_RETENTION_DAYS = 365;
/** DPDP doesn't fix a number — 30 days is industry standard for SaaS and
 *  matches our internal SLA for honouring a recovery request. */
const DEFAULT_RETENTION_DAYS = 30;

/** Cast helper for DPDP-specific audit actions. The packages/types
 *  AuditAction union doesn't yet include these — we're intentionally not
 *  mutating that file (orchestrator owns it). */
function dpdpAction(name: string): AuditAction {
  return name as AuditAction;
}

function dpdpTarget(name: string): AuditTargetType {
  return name as AuditTargetType;
}

/** Best-effort row dump. Falls back to an empty array if the table doesn't
 *  exist in the current DB revision — the export should still succeed even
 *  on a partially-migrated dev box. The `query` callback returns whatever the
 *  postgres-js template tag returns (a thenable that resolves to a row array);
 *  we don't constrain it here so the SQL stays readable at the call site. */
async function safeQuery(
  query: () => unknown,
  tableName: string,
): Promise<unknown[]> {
  try {
    const out = (await query()) as unknown;
    return Array.isArray(out) ? out : [];
  } catch (err) {
    logger.warn({ err, table: tableName }, 'dpdp export: table dump skipped');
    return [];
  }
}

export const dpdpService = {
  /**
   * Dump every row the data principal can claim ownership of. User-personal
   * rows (drafts, consents, audit entries authored by them) are scoped by
   * `user_id`; firm-shared rows (clients, cases, …) are scoped by the user's
   * `firm_id` because under our tenancy model that's the data the user
   * legally has access to.
   */
  async exportUser(userId: string, opts: { ip?: string | null; userAgent?: string | null } = {}): Promise<UserDataExport> {
    const sql = db();
    if (!sql) {
      throw new UnprocessableEntityError('Database not configured');
    }

    const [userRow] = await sql<UserRow[]>`
      select id, email, name, role, status, firm_id, created_at, last_seen_at,
             deleted_at, scheduled_purge_at
      from users
      where id = ${userId}::uuid
      limit 1
    `;
    if (!userRow) throw new NotFoundError('User not found');

    const firmId = userRow.firm_id;

    // Per-table dumps. We intentionally `select *` then strip sensitive
    // columns (password_hash) in JS — keeps this resilient against schema
    // drift without having to maintain a column allow-list for every table.
    const drafts = await safeQuery(() => sql`
      select * from drafts where user_id = ${userId}::uuid order by created_at desc
    `, 'drafts');

    const auditEntries = await safeQuery(() => sql`
      select id, actor_user_id, actor_email, action, target_type, target_id,
             payload, created_at, retain_until
      from audit_log
      where actor_user_id = ${userId}::uuid
      order by created_at desc
      limit 5000
    `, 'audit_log');

    // Firm-scoped data. Skipped when the user isn't attached to a firm.
    let documents: unknown[] = [];
    let clients: unknown[] = [];
    let cases: unknown[] = [];
    let clauses: unknown[] = [];
    let diary: unknown[] = [];
    let tasks: unknown[] = [];
    let invoices: unknown[] = [];
    let expenses: unknown[] = [];
    let leads: unknown[] = [];
    let limitations: unknown[] = [];
    let physicalDocuments: unknown[] = [];

    if (firmId) {
      [
        documents, clients, cases, clauses, diary, tasks,
        invoices, expenses, leads, limitations, physicalDocuments,
      ] = await Promise.all([
        safeQuery(() => sql`select * from documents          where firm_id = ${firmId}::uuid`, 'documents'),
        safeQuery(() => sql`select * from clients            where firm_id = ${firmId}::uuid`, 'clients'),
        safeQuery(() => sql`select * from cases              where firm_id = ${firmId}::uuid`, 'cases'),
        safeQuery(() => sql`select * from clauses            where firm_id = ${firmId}::uuid`, 'clauses'),
        safeQuery(() => sql`select * from diary_entries      where firm_id = ${firmId}::uuid`, 'diary_entries'),
        safeQuery(() => sql`select * from tasks              where firm_id = ${firmId}::uuid`, 'tasks'),
        safeQuery(() => sql`select * from invoices           where firm_id = ${firmId}::uuid`, 'invoices'),
        safeQuery(() => sql`select * from expenses           where firm_id = ${firmId}::uuid`, 'expenses'),
        safeQuery(() => sql`select * from leads              where firm_id = ${firmId}::uuid`, 'leads'),
        safeQuery(() => sql`select * from limitations        where firm_id = ${firmId}::uuid`, 'limitations'),
        safeQuery(() => sql`select * from physical_documents where firm_id = ${firmId}::uuid`, 'physical_documents'),
      ]);
    }

    const consentRows = (await safeQuery(() => sql<ConsentRow[]>`
      select id, user_id, firm_id, consent_type, consent_version, granted, ip,
             user_agent, created_at
      from consent_log
      where user_id = ${userId}::uuid
      order by created_at desc
    `, 'consent_log')) as ConsentRow[];

    // Redact password_hash if it slipped into the user dump.
    const userOut = userRowToExported(userRow);

    const payload: UserDataExport = {
      exportedAt: new Date().toISOString(),
      user: userOut,
      drafts,
      documents,
      clients,
      cases,
      clauses,
      diary,
      tasks,
      invoices,
      expenses,
      leads,
      limitations,
      physicalDocuments,
      audit_entries: auditEntries,
      consents: consentRows.map(consentRowToRecord),
    };

    // Estimate size for the audit row — full stringify would be heavy on
    // large dumps, but a rough length is plenty for compliance reporting.
    const approxBytes = JSON.stringify({
      drafts: drafts.length,
      documents: documents.length,
      cases: cases.length,
      audit: auditEntries.length,
    }).length;

    await sql`
      insert into data_export_log (user_id, requested_at, completed_at, total_bytes, ip, user_agent)
      values (${userId}::uuid, now(), now(), ${approxBytes}, ${opts.ip ?? null}, ${opts.userAgent ?? null})
    `;

    await auditService.write({
      actorUserId: userId,
      actorEmail: userRow.email,
      action: dpdpAction('user.dpdp.export'),
      targetType: dpdpTarget('user'),
      targetId: userId,
      payload: {
        drafts: drafts.length,
        documents: documents.length,
        cases: cases.length,
        clients: clients.length,
        clauses: clauses.length,
        diary: diary.length,
        tasks: tasks.length,
        invoices: invoices.length,
        expenses: expenses.length,
        leads: leads.length,
        limitations: limitations.length,
        physicalDocuments: physicalDocuments.length,
        auditEntries: auditEntries.length,
        consents: consentRows.length,
      },
    });

    return payload;
  },

  /**
   * Soft-delete the user and schedule a hard-delete after the retention
   * window. Returns the cancellation deadline so the UI can render a
   * "you have N days to undo" banner.
   */
  async requestDeletion(
    userId: string,
    input: { retentionDays?: number },
    actor: { id: string; email: string },
  ): Promise<DeletionRequest> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');

    const retentionDays = Math.min(
      Math.max(input.retentionDays ?? DEFAULT_RETENTION_DAYS, 1),
      MAX_RETENTION_DAYS,
    );

    const [userRow] = await sql<UserRow[]>`
      select id, email, name, role, status, firm_id, created_at, last_seen_at,
             deleted_at, scheduled_purge_at
      from users
      where id = ${userId}::uuid
      limit 1
    `;
    if (!userRow) throw new NotFoundError('User not found');

    if (userRow.deleted_at) {
      // Already pending — treat the second call as idempotent. Return what
      // we have rather than throwing, since the UI might re-issue on retry.
      const scheduledIso = userRow.scheduled_purge_at?.toISOString() ?? new Date().toISOString();
      return {
        scheduledPurgeAt: scheduledIso,
        retentionDays,
        canCancelUntil: scheduledIso,
      };
    }

    let scheduledPurgeAt: string = '';

    await sql.begin(async (tx) => {
      // Flag the user row + flip status so sign-ins fail at the auth layer.
      const [updated] = await tx<{ scheduled_purge_at: Date }[]>`
        update users
        set deleted_at = now(),
            scheduled_purge_at = now() + make_interval(days => ${retentionDays}),
            status = 'deactivated',
            updated_at = now()
        where id = ${userId}::uuid
        returning scheduled_purge_at
      `;
      scheduledPurgeAt = updated!.scheduled_purge_at.toISOString();

      // Soft-delete the rows the user personally authored. Firm-shared data
      // (clients/cases/etc.) is intentionally untouched — the firm still
      // owns it after one user leaves.
      await tx`
        update drafts
        set deleted_at = now(),
            scheduled_purge_at = now() + make_interval(days => ${retentionDays})
        where user_id = ${userId}::uuid and deleted_at is null
      `;
    });

    invalidateTenantCache(userId);

    await auditService.write({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: dpdpAction('user.dpdp.deletion_requested'),
      targetType: dpdpTarget('user'),
      targetId: userId,
      payload: { retentionDays, scheduledPurgeAt },
    });

    return {
      scheduledPurgeAt,
      retentionDays,
      canCancelUntil: scheduledPurgeAt,
    };
  },

  /**
   * Reverse a pending deletion. 404s if no deletion is pending; 409s if the
   * purge deadline has already passed (data may already be gone).
   */
  async cancelDeletion(userId: string, actor: { id: string; email: string }): Promise<void> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');

    interface PendingRow {
      id: string;
      email: string;
      deleted_at: Date | null;
      scheduled_purge_at: Date | null;
    }
    const userRows = await sql<PendingRow[]>`
      select id, email, deleted_at, scheduled_purge_at
      from users
      where id = ${userId}::uuid
      limit 1
    `;
    const userRow = userRows[0];
    if (!userRow) throw new NotFoundError('User not found');
    if (!userRow.deleted_at) throw new NotFoundError('No pending deletion');
    if (userRow.scheduled_purge_at && userRow.scheduled_purge_at.getTime() <= Date.now()) {
      throw new ConflictError('Retention window has already elapsed; deletion is in progress');
    }

    await sql.begin(async (tx) => {
      await tx`
        update users
        set deleted_at = null,
            scheduled_purge_at = null,
            status = 'active',
            updated_at = now()
        where id = ${userId}::uuid
      `;
      await tx`
        update drafts
        set deleted_at = null,
            scheduled_purge_at = null
        where user_id = ${userId}::uuid and deleted_at is not null
      `;
    });

    invalidateTenantCache(userId);

    await auditService.write({
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: dpdpAction('user.dpdp.deletion_cancelled'),
      targetType: dpdpTarget('user'),
      targetId: userId,
      payload: null,
    });
  },

  /** Append a row to the consent ledger. Caller is responsible for
   *  capturing ip / user-agent off the request and passing them in. */
  async recordConsent(input: RecordConsentInput): Promise<ConsentRecord> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured');

    // Resolve firmId server-side if the caller didn't pass one explicitly.
    const firmId = input.firmId ?? (await firmIdForUser(input.userId));

    const [row] = await sql<ConsentRow[]>`
      insert into consent_log (user_id, firm_id, consent_type, consent_version, granted, ip, user_agent)
      values (
        ${input.userId}::uuid,
        ${firmId}::uuid,
        ${input.consentType},
        ${input.consentVersion},
        ${input.granted},
        ${input.ip ?? null},
        ${input.userAgent ?? null}
      )
      returning id, user_id, firm_id, consent_type, consent_version, granted, ip, user_agent, created_at
    `;
    const record = consentRowToRecord(row!);

    // Resolve the actor's email for the audit row. We do this AFTER the
    // ledger write so the consent record itself is durable even if the
    // user lookup races a concurrent purge.
    const [actorRow] = await sql<{ email: string }[]>`
      select email from users where id = ${input.userId}::uuid limit 1
    `;

    // Audit the consent so we can prove WHO recorded it, not just what was
    // stored in the ledger row.
    await auditService.write({
      actorUserId: input.userId,
      actorEmail: actorRow?.email ?? '',
      action: dpdpAction('user.dpdp.consent_recorded'),
      targetType: dpdpTarget('user'),
      targetId: input.userId,
      payload: {
        consentType: input.consentType,
        consentVersion: input.consentVersion,
        granted: input.granted,
      },
    });

    return record;
  },

  /** Read the ledger for a single user, newest first. */
  async listConsents(userId: string): Promise<ConsentRecord[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<ConsentRow[]>`
      select id, user_id, firm_id, consent_type, consent_version, granted, ip,
             user_agent, created_at
      from consent_log
      where user_id = ${userId}::uuid
      order by created_at desc
      limit 500
    `;
    return rows.map(consentRowToRecord);
  },

  /**
   * Background-job handler. Hard-deletes rows whose `scheduled_purge_at`
   * has elapsed across every user-owned table. Idempotent — re-running it
   * just deletes whatever's newly eligible.
   *
   * Tables are processed in dependency order: child rows first (drafts),
   * then the user row last. The `on delete cascade` on most FKs would
   * eventually catch stragglers, but explicit ordering keeps the audit
   * trail clean (we delete drafts as drafts, not as a side-effect).
   */
  async purgeDueDeletions(): Promise<{ purged: number }> {
    const sql = db();
    if (!sql) return { purged: 0 };

    let total = 0;

    // Soft-deleted child rows first.
    const childTables = [
      'drafts', 'documents', 'clauses', 'leads', 'invoices', 'expenses',
      'limitations', 'diary_entries', 'tasks', 'physical_documents',
      'clients', 'cases',
    ];

    for (const table of childTables) {
      try {
        const rows = await sql<{ id: string }[]>`
          delete from ${sql(table)}
          where scheduled_purge_at is not null and scheduled_purge_at <= now()
          returning id
        `;
        total += rows.length;
        if (rows.length > 0) {
          logger.info({ table, count: rows.length }, 'dpdp.purgeDueDeletions: hard-deleted rows');
        }
      } catch (err) {
        // Table may not exist on older deployments; log and continue.
        logger.warn({ err, table }, 'dpdp.purgeDueDeletions: skipped table');
      }
    }

    // Finally, the user rows themselves. We `on delete cascade` from FKs so
    // any rows we haven't already removed get swept away here.
    try {
      const userRows = await sql<{ id: string; email: string }[]>`
        delete from users
        where scheduled_purge_at is not null and scheduled_purge_at <= now()
        returning id, email
      `;
      total += userRows.length;
      for (const u of userRows) {
        invalidateTenantCache(u.id);
        await auditService.write({
          actorUserId: u.id,
          actorEmail: u.email,
          action: dpdpAction('user.dpdp.purged'),
          targetType: dpdpTarget('user'),
          targetId: u.id,
          payload: { reason: 'retention_window_elapsed' },
        });
      }
      if (userRows.length > 0) {
        logger.info({ count: userRows.length }, 'dpdp.purgeDueDeletions: hard-deleted user rows');
      }
    } catch (err) {
      logger.warn({ err }, 'dpdp.purgeDueDeletions: user purge failed');
    }

    return { purged: total };
  },

  /** Background-job handler. Drops audit rows past their `retain_until`
   *  deadline. Returns the count deleted. */
  async purgeExpiredAuditEntries(): Promise<{ purged: number }> {
    const sql = db();
    if (!sql) return { purged: 0 };
    try {
      const rows = await sql<{ id: string }[]>`
        delete from audit_log
        where retain_until is not null and retain_until <= now()
        returning id
      `;
      if (rows.length > 0) {
        logger.info({ count: rows.length }, 'dpdp.purgeExpiredAuditEntries: purged audit rows');
      }
      return { purged: rows.length };
    } catch (err) {
      logger.warn({ err }, 'dpdp.purgeExpiredAuditEntries: failed');
      return { purged: 0 };
    }
  },
};
