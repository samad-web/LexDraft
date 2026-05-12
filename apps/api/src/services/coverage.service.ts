/**
 * Coverage swap board service.
 *
 * Tenant model: every read/write is firm-scoped via `firm_id`. Callers
 * resolve the caller's firm via `firmIdForUser(req.user.id)` and pass it in;
 * a null firmId means "no tenant" and we short-circuit to an empty result
 * rather than skipping the WHERE clause (cf. tenant.ts contract).
 *
 * Claim race-safety: `claim()` is an atomic UPDATE WHERE status='open'.
 * Two users hitting "Claim" simultaneously can't both succeed — the loser
 * sees 0 rows updated and receives a 409 ConflictError. We do NOT issue a
 * `select ... for update` first because that would still be racy under a
 * permissive isolation level and adds a round-trip.
 *
 * Denormalisation: when `hearingId` is supplied at create time we copy the
 * hearing's case/court/date/time/purpose into the coverage row so the card
 * survives later edits/deletes of the hearing. The caller may override these
 * by passing explicit values alongside `hearingId`.
 */

import { db } from '../db/client';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from '../lib/errors';
import type {
  CoverageRequest,
  CoverageStatus,
  CreateCoverageRequestInput,
  ListCoverageFilter,
} from '../types/coverage.types';

interface CoverageRow {
  id: string;
  firm_id: string;
  hearing_id: string | null;
  case_id: string | null;
  case_label: string;
  court: string;
  hearing_date: string | Date;
  hearing_time: string;
  purpose: string;
  brief_url: string | null;
  brief_notes: string | null;
  status: CoverageStatus;
  requested_by: string;
  requested_by_name: string | null;
  claimed_by: string | null;
  claimed_by_name: string | null;
  created_at: Date;
  claimed_at: Date | null;
  completed_at: Date | null;
}

function dateOnly(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function fromRow(r: CoverageRow): CoverageRequest {
  return {
    id: r.id,
    firmId: r.firm_id,
    hearingId: r.hearing_id,
    caseId: r.case_id,
    caseLabel: r.case_label,
    court: r.court,
    hearingDate: dateOnly(r.hearing_date),
    hearingTime: r.hearing_time,
    purpose: r.purpose,
    briefUrl: r.brief_url,
    briefNotes: r.brief_notes,
    status: r.status,
    requestedBy: r.requested_by,
    requestedByName: r.requested_by_name,
    claimedBy: r.claimed_by,
    claimedByName: r.claimed_by_name,
    createdAt: r.created_at.toISOString(),
    claimedAt: r.claimed_at ? r.claimed_at.toISOString() : null,
    completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  };
}

interface HearingSnapshot {
  case_id: string | null;
  case_label: string;
  court: string;
  hearing_date: string | Date | null;
  hearing_time: string;
  purpose: string;
  firm_id: string | null;
}

export const coverageService = {
  /** List recent coverage requests for the caller's firm, joined with names. */
  async list(filter: ListCoverageFilter): Promise<CoverageRequest[]> {
    if (!filter.firmId) return [];
    const sql = db();
    if (!sql) return [];
    const status = filter.status ?? null;
    const rows = await sql<CoverageRow[]>`
      select
        cr.id, cr.firm_id, cr.hearing_id, cr.case_id, cr.case_label, cr.court,
        cr.hearing_date, cr.hearing_time, cr.purpose, cr.brief_url, cr.brief_notes,
        cr.status, cr.requested_by, cr.claimed_by, cr.created_at, cr.claimed_at,
        cr.completed_at,
        ur.name as requested_by_name,
        uc.name as claimed_by_name
      from coverage_requests cr
      left join users ur on ur.id = cr.requested_by
      left join users uc on uc.id = cr.claimed_by
      where cr.firm_id = ${filter.firmId}::uuid
        and (${status}::text is null or cr.status::text = ${status})
      order by
        case cr.status
          when 'open' then 0
          when 'claimed' then 1
          when 'completed' then 2
          when 'cancelled' then 3
        end,
        cr.hearing_date asc,
        cr.created_at desc
    `;
    return rows.map(fromRow);
  },

  /** Fetch one coverage request scoped to the caller's firm. */
  async get(id: string, firmId: string | null): Promise<CoverageRequest> {
    if (!firmId) throw new NotFoundError('Coverage request not found');
    const sql = db();
    if (!sql) throw new NotFoundError('Coverage request not found');
    const rows = await sql<CoverageRow[]>`
      select
        cr.id, cr.firm_id, cr.hearing_id, cr.case_id, cr.case_label, cr.court,
        cr.hearing_date, cr.hearing_time, cr.purpose, cr.brief_url, cr.brief_notes,
        cr.status, cr.requested_by, cr.claimed_by, cr.created_at, cr.claimed_at,
        cr.completed_at,
        ur.name as requested_by_name,
        uc.name as claimed_by_name
      from coverage_requests cr
      left join users ur on ur.id = cr.requested_by
      left join users uc on uc.id = cr.claimed_by
      where cr.id = ${id}::uuid and cr.firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!rows[0]) throw new NotFoundError('Coverage request not found');
    return fromRow(rows[0]);
  },

  /**
   * Post a coverage request. If `hearingId` is supplied we denormalize the
   * hearing snapshot at create time; the caller may also pass explicit values
   * to override. We refuse to create against a hearing in a different firm —
   * that would leak matter metadata across tenants.
   */
  async create(
    input: CreateCoverageRequestInput & { firmId: string | null; requestedBy: string },
  ): Promise<CoverageRequest> {
    if (!input.firmId) {
      throw new UnprocessableEntityError('No firm attached — cannot create coverage request');
    }
    const sql = db();
    if (!sql) {
      throw new UnprocessableEntityError('Database not configured');
    }

    // Snapshot the hearing if linked. We compare its firm_id (via cases) to
    // the caller's firm — refuse on mismatch.
    let snapshot: HearingSnapshot | null = null;
    if (input.hearingId) {
      const rows = await sql<HearingSnapshot[]>`
        select
          h.case_id,
          h.case_label,
          h.court,
          h.hearing_date,
          h.hearing_time,
          h.purpose,
          c.firm_id
        from hearings h
        left join cases c on c.id = h.case_id
        where h.id = ${input.hearingId}::uuid
        limit 1
      `;
      const row = rows[0];
      if (!row) throw new NotFoundError('Hearing not found');
      if (!row.firm_id || row.firm_id !== input.firmId) {
        throw new BadRequestError('Hearing belongs to a different firm');
      }
      snapshot = row;
    }

    const caseLabel = input.caseLabel ?? snapshot?.case_label ?? '';
    const court = input.court ?? snapshot?.court ?? '';
    const hearingDate = input.hearingDate ?? (snapshot?.hearing_date ? dateOnly(snapshot.hearing_date) : '');
    const hearingTime = input.hearingTime ?? snapshot?.hearing_time ?? '';
    const purpose = input.purpose ?? snapshot?.purpose ?? '';
    const caseId = input.caseId ?? snapshot?.case_id ?? null;

    if (!caseLabel || !court || !hearingDate || !hearingTime || !purpose) {
      throw new BadRequestError('Missing required coverage details (case, court, date, time, purpose)');
    }

    // If caseId was supplied directly, sanity-check it belongs to this firm.
    if (input.caseId) {
      const owned = await sql<Array<{ id: string }>>`
        select id from cases
        where id = ${input.caseId}::uuid and firm_id = ${input.firmId}::uuid
        limit 1
      `;
      if (!owned[0]) throw new BadRequestError('Case belongs to a different firm');
    }

    const inserted = await sql<Array<{ id: string }>>`
      insert into coverage_requests (
        firm_id, hearing_id, case_id, case_label, court,
        hearing_date, hearing_time, purpose, brief_url, brief_notes,
        requested_by, status
      ) values (
        ${input.firmId}::uuid,
        ${input.hearingId ?? null},
        ${caseId},
        ${caseLabel},
        ${court},
        ${hearingDate}::date,
        ${hearingTime},
        ${purpose},
        ${input.briefUrl ?? null},
        ${input.briefNotes ?? null},
        ${input.requestedBy}::uuid,
        'open'::coverage_status
      )
      returning id
    `;
    const id = inserted[0]?.id;
    if (!id) throw new Error('Insert returned no id');
    return coverageService.get(id, input.firmId);
  },

  /**
   * Atomic claim. Sets status='claimed', claimed_by, claimed_at — but only if
   * the row is still 'open'. A losing racer gets ConflictError, not a silent
   * overwrite of the winner's claim.
   */
  async claim(id: string, claimerUserId: string, firmId: string | null): Promise<CoverageRequest> {
    if (!firmId) throw new NotFoundError('Coverage request not found');
    const sql = db();
    if (!sql) throw new NotFoundError('Coverage request not found');

    // Guard against self-claim — the requester shouldn't pick up their own
    // posting (defeats the point of the swap).
    const existing = await sql<Array<{ status: CoverageStatus; requested_by: string }>>`
      select status, requested_by from coverage_requests
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!existing[0]) throw new NotFoundError('Coverage request not found');
    if (existing[0].requested_by === claimerUserId) {
      throw new BadRequestError('You posted this request — cannot claim it yourself');
    }

    const updated = await sql<Array<{ id: string }>>`
      update coverage_requests
      set status = 'claimed'::coverage_status,
          claimed_by = ${claimerUserId}::uuid,
          claimed_at = now()
      where id = ${id}::uuid
        and firm_id = ${firmId}::uuid
        and status = 'open'::coverage_status
      returning id
    `;
    if (updated.length === 0) {
      throw new ConflictError('Already claimed');
    }
    return coverageService.get(id, firmId);
  },

  /**
   * Cancel a coverage request. Only the original requester (or a Firm Admin)
   * may cancel. We don't allow cancellation after completion — that would
   * rewrite history.
   */
  async cancel(id: string, userId: string, firmId: string | null): Promise<CoverageRequest> {
    if (!firmId) throw new NotFoundError('Coverage request not found');
    const sql = db();
    if (!sql) throw new NotFoundError('Coverage request not found');

    const rows = await sql<Array<{ requested_by: string; status: CoverageStatus }>>`
      select requested_by, status from coverage_requests
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!rows[0]) throw new NotFoundError('Coverage request not found');
    if (rows[0].status === 'completed') {
      throw new ConflictError('Cannot cancel a completed coverage request');
    }
    if (rows[0].status === 'cancelled') {
      // Idempotent — already cancelled, return current state.
      return coverageService.get(id, firmId);
    }

    if (rows[0].requested_by !== userId) {
      // Allow Firm Admins to cancel on behalf of the requester (e.g. when the
      // poster goes offline and the matter needs to be re-listed).
      const adminRows = await sql<Array<{ is_admin: boolean }>>`
        select (r.name = 'Firm Admin' and r.is_system = true) as is_admin
        from users u
        left join roles r on r.id = u.role_id
        where u.id = ${userId}::uuid
        limit 1
      `;
      if (!adminRows[0]?.is_admin) {
        throw new ForbiddenError('Only the requester or a Firm Admin can cancel this request');
      }
    }

    await sql`
      update coverage_requests
      set status = 'cancelled'::coverage_status
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
    `;
    return coverageService.get(id, firmId);
  },

  /** Only the claimer may mark the request complete. */
  async complete(id: string, userId: string, firmId: string | null): Promise<CoverageRequest> {
    if (!firmId) throw new NotFoundError('Coverage request not found');
    const sql = db();
    if (!sql) throw new NotFoundError('Coverage request not found');

    const rows = await sql<Array<{ claimed_by: string | null; status: CoverageStatus }>>`
      select claimed_by, status from coverage_requests
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!rows[0]) throw new NotFoundError('Coverage request not found');
    if (rows[0].status !== 'claimed') {
      throw new ConflictError('Only claimed coverage requests can be marked complete');
    }
    if (rows[0].claimed_by !== userId) {
      throw new ForbiddenError('Only the claimer can mark this request complete');
    }

    await sql`
      update coverage_requests
      set status = 'completed'::coverage_status,
          completed_at = now()
      where id = ${id}::uuid and firm_id = ${firmId}::uuid
    `;
    return coverageService.get(id, firmId);
  },
};

