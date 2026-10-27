import { db } from '../db/client';
import { logger } from '../logger';
import { isHttpError, BadRequestError, ConflictError, HttpError, NotFoundError } from '../lib/errors';
import type { Court } from '../lib/ecourts/types';
import { jobs } from './jobs.service';
import {
  CNR_RE,
  EcourtsRecordNotFoundError,
  syncCaseFromEcourts,
  type SyncResult,
} from './case-sync.service';
import { lookupByCnr, searchByCaseNumber } from './ecourts.service';

// =============================================================================
// ecourts-link.service
//
// Keeps every matter connected to eCourts no matter how it was created, and
// no matter whether eCourts happens to be up at that moment.
//
//   - Added from an eCourts search, or manually with a real CNR
//       -> queued for a background link (`ecourts.case.link`) the moment it's
//          saved. If eCourts is down, pg-boss retries with backoff; the 09:00
//          / 19:00 scheduled runs also sweep up anything still pending.
//   - Added manually WITHOUT a CNR (TEMP-… placeholder)
//       -> stays 'unlinked' until the advocate links it, either by entering
//          the CNR or by case type + number + year (resolved to a CNR here).
//
// Link status lives on the case row (migration 0085) so the UI can show it:
//   unlinked   no usable CNR yet
//   pending    has a CNR, waiting for a successful fetch (eCourts unreachable
//              or not yet attempted)
//   linked     fetched successfully at least once; ecourts_synced_at says when
//   not_found  eCourts answered on both tiers and has no such CNR
//   error      a non-transient failure (bad data on our side); see last_error
// =============================================================================

export type EcourtsLinkStatus = 'unlinked' | 'pending' | 'linked' | 'not_found' | 'error';

/** How a sync failure should be treated. Only 'upstream' is worth retrying. */
export type SyncFailureKind = 'upstream' | 'not_found' | 'case';

export function normaliseCnr(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return CNR_RE.test(v) ? v : null;
}

/**
 * Anything from the eCourts transport layer - timeouts, 5xx, WAF blocks, a
 * maintenance HTML page, a JWT bootstrap failure, a garbled body - means
 * "eCourts is unreachable right now", not "this case is wrong". Our own
 * HttpErrors (no CNR, case deleted, …) are case problems that a retry won't
 * fix. Unknown errors default to upstream: retrying a case that was going to
 * fail anyway costs one call; NOT retrying a case that hit a transient blip
 * leaves the advocate with stale data until the next scheduled run.
 */
export function classifySyncError(err: unknown): SyncFailureKind {
  if (err instanceof EcourtsRecordNotFoundError) return 'not_found';
  if (isHttpError(err)) return 'case';
  return 'upstream';
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

/**
 * Persist a failed attempt. An upstream failure on a case that is already
 * linked leaves it 'linked' - its last good data is still valid, just not
 * refreshed - while an unlinked/pending case stays 'pending' for the retry.
 */
export async function recordSyncFailure(caseId: string, kind: SyncFailureKind, err: unknown): Promise<void> {
  const sql = db();
  if (!sql) return;
  const nextStatus: EcourtsLinkStatus | null =
    kind === 'not_found' ? 'not_found' : kind === 'case' ? 'error' : null;
  try {
    await sql`
      update cases set
        ecourts_link_status = case
          when ${nextStatus}::text is not null then ${nextStatus}::text
          when ecourts_link_status = 'linked' then 'linked'
          else 'pending'
        end,
        ecourts_last_attempt_at = now(),
        ecourts_last_error = ${errorMessage(err)},
        ecourts_fail_count = ecourts_fail_count + 1
      where id::text = ${caseId}
    `;
  } catch (writeErr) {
    logger.warn({ err: writeErr, caseId }, 'ecourts-link: could not record sync failure');
  }
}

/** Set link status from the case's CNR without contacting eCourts: a usable
 *  CNR means 'pending' (a link job / scheduled run will fetch it), anything
 *  else 'unlinked'. Returns the status written. */
export async function resetLinkState(caseId: string, firmId: string): Promise<EcourtsLinkStatus | null> {
  const sql = db();
  if (!sql) return null;
  const rows = await sql<Array<{ ecourts_link_status: EcourtsLinkStatus }>>`
    update cases set
      ecourts_link_status = case
        when upper(trim(cnr)) ~ '^[A-Z]{4}[A-Z0-9]{12}$' then 'pending'
        else 'unlinked'
      end,
      ecourts_last_error = null,
      ecourts_fail_count = 0,
      -- A new CNR may be on the other tier; let the next sync rediscover it.
      ecourts_court_tier = null
    where id::text = ${caseId} and firm_id = ${firmId}::uuid and deleted_at is null
    returning ecourts_link_status
  `;
  return rows[0]?.ecourts_link_status ?? null;
}

// ---------------------------------------------------------------------------
// Background link job
// ---------------------------------------------------------------------------

export interface LinkJobPayload {
  caseId: string;
  firmId: string;
}

/** pg-boss retry policy for a link attempt that hit an unreachable eCourts:
 *  5, 10, 20, 40, 80, 160 min (~5h). The scheduled runs pick up anything
 *  still pending after that. */
const LINK_RETRY = { retryLimit: 6, retryDelay: 300, retryBackoff: true } as const;

/**
 * Mark the case pending and queue a background fetch. Fire-and-forget from
 * the caller's point of view: case creation must never fail because eCourts
 * is down, and a queueing failure is caught by the next scheduled run anyway.
 */
export async function queueLink(caseId: string, firmId: string): Promise<EcourtsLinkStatus | null> {
  const status = await resetLinkState(caseId, firmId);
  if (status !== 'pending') return status;
  try {
    await jobs.enqueue<LinkJobPayload>('ecourts.case.link', { caseId, firmId }, {
      singletonKey: `ecourts-link:${caseId}`,
      ...LINK_RETRY,
    });
  } catch (err) {
    logger.warn({ err, caseId }, 'ecourts-link: enqueue failed; scheduled run will pick it up');
  }
  return status;
}

/**
 * Job handler. Throws ONLY on an upstream failure, so pg-boss retries
 * exactly the cases that are worth retrying.
 */
export async function runLinkJob(data: LinkJobPayload): Promise<void> {
  const sql = db();
  if (!sql) return;
  const [row] = await sql<Array<{ cnr: string; ecourts_link_status: EcourtsLinkStatus; title: string; created_by_user_id: string | null }>>`
    select cnr, ecourts_link_status, title, created_by_user_id
    from cases
    where id::text = ${data.caseId} and firm_id = ${data.firmId}::uuid and deleted_at is null
    limit 1
  `;
  // Deleted, re-pointed to a placeholder, or already linked by a manual
  // sync / scheduled run in the meantime: nothing to do.
  if (!row || !normaliseCnr(row.cnr) || row.ecourts_link_status === 'linked') return;

  const { notify } = await import('./notifications.service');
  try {
    const result = await syncCaseFromEcourts(data.caseId, data.firmId);
    await notify.ecourtsCaseLinked(data.firmId, {
      caseId: data.caseId,
      matterTitle: result.caseRow.title || row.title,
      cnr: row.cnr.trim().toUpperCase(),
      hearings: result.hearingsReplaced,
      ownerUserId: row.created_by_user_id,
    });
    // The hearings just came from eCourts - remind now if the next one is
    // close, rather than at tomorrow's 09:00 run. Best-effort.
    try {
      const { materializeCaseHearings } = await import('./hearings.service');
      await materializeCaseHearings(data.firmId, data.caseId);
      const { sendUpcomingHearingReminders } = await import('./case-sync.service');
      await sendUpcomingHearingReminders({ caseId: data.caseId });
    } catch (err) {
      logger.warn({ caseId: data.caseId, err: errorMessage(err) }, 'ecourts-link: reminder after link failed');
    }
  } catch (err) {
    const kind = classifySyncError(err);
    await recordSyncFailure(data.caseId, kind, err);
    if (kind === 'upstream') {
      logger.info({ caseId: data.caseId, err: errorMessage(err) }, 'ecourts-link: eCourts unreachable, will retry');
      throw err;
    }
    if (kind === 'not_found') {
      await notify.ecourtsCaseNotFound(data.firmId, {
        caseId: data.caseId,
        matterTitle: row.title,
        cnr: row.cnr.trim().toUpperCase(),
        ownerUserId: row.created_by_user_id,
      });
    }
    logger.warn({ caseId: data.caseId, kind, err: errorMessage(err) }, 'ecourts-link: link failed (not retrying)');
  }
}

// ---------------------------------------------------------------------------
// Advocate-initiated linking (manual matters)
// ---------------------------------------------------------------------------

export interface CaseNumberLinkInput {
  court?: Court;
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  caseType: string | number;
  regNo: string | number;
  year: number;
}

export interface CnrCandidate {
  cino: string;
  title: string;
  establishment: string | null;
  caseNo: string | null;
}

export type LinkOutcome =
  | { status: 'linked'; cnr: string; sync: SyncResult }
  | { status: 'pending'; cnr: string; reason: string }
  | { status: 'choose'; candidates: CnrCandidate[] };

/** Pull every case row out of the verified case-search response shape: an
 *  object keyed by establishment index, each { establishment_name, caseNos }. */
export function extractCnrCandidates(payload: unknown): CnrCandidate[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const out: CnrCandidate[] = [];
  for (const [key, est] of Object.entries(payload as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || !est || typeof est !== 'object') continue;
    const e = est as { establishment_name?: string; caseNos?: unknown };
    const rows = Array.isArray(e.caseNos) ? e.caseNos : [];
    for (const r of rows as Array<Record<string, unknown>>) {
      const cino = normaliseCnr(typeof r.cino === 'string' ? r.cino : null);
      if (!cino) continue;
      const pet = String(r.pet_name ?? '').trim();
      const res = String(r.res_name ?? '').trim();
      out.push({
        cino,
        title: pet || res ? `${pet || '?'} v. ${res || '?'}` : cino,
        establishment: e.establishment_name ?? null,
        caseNo: r.case_no != null ? String(r.case_no) : null,
      });
    }
  }
  // Same case can appear under more than one establishment entry.
  return [...new Map(out.map((c) => [c.cino, c])).values()];
}

async function setCnr(caseId: string, firmId: string, cnr: string): Promise<void> {
  const sql = db();
  if (!sql) throw new BadRequestError('Linking requires DATABASE_URL to be configured');
  try {
    const rows = await sql<Array<{ id: string }>>`
      update cases set cnr = ${cnr}, updated_at = now()
      where id::text = ${caseId} and firm_id = ${firmId}::uuid and deleted_at is null
      returning id
    `;
    if (rows.length === 0) throw new NotFoundError('Case not found');
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError(`Another matter in your firm already has CNR ${cnr}.`, { code: 'duplicate_cnr' });
    }
    throw err;
  }
  await resetLinkState(caseId, firmId);
}

/**
 * Link now, synchronously, so the advocate sees the result in the same
 * request - but if eCourts is unreachable, accept the CNR anyway and fall
 * back to the background retry instead of making them try again later.
 */
async function linkNowOrQueue(caseId: string, firmId: string, cnr: string, court?: Court): Promise<LinkOutcome> {
  try {
    const sync = await syncCaseFromEcourts(caseId, firmId, court ? { court } : {});
    return { status: 'linked', cnr, sync };
  } catch (err) {
    const kind = classifySyncError(err);
    if (kind !== 'upstream') {
      await recordSyncFailure(caseId, kind, err);
      throw err;
    }
    // Queue first (it resets the link state to a clean 'pending'), then
    // record why, so the case shows the upstream error until the retry lands.
    await queueLink(caseId, firmId);
    await recordSyncFailure(caseId, kind, err);
    return {
      status: 'pending',
      cnr,
      reason: 'eCourts is not responding right now. The CNR is saved and DifAI will connect this matter automatically as soon as eCourts is back.',
    };
  }
}

/**
 * Attach a CNR discovered in the background (e.g. the eFiling tracker found
 * the registered case) and queue the normal link job. Unlike linkByCnr this
 * never calls eCourts inline: callers are themselves scheduled jobs that
 * already paced their eCourts traffic.
 */
export async function attachCnrAndQueue(caseId: string, firmId: string, rawCnr: string): Promise<EcourtsLinkStatus | null> {
  const cnr = normaliseCnr(rawCnr);
  if (!cnr) throw new BadRequestError('Invalid CNR', { code: 'invalid_cnr' });
  await setCnr(caseId, firmId, cnr);
  return queueLink(caseId, firmId);
}

export async function linkByCnr(caseId: string, firmId: string, rawCnr: string, court?: Court): Promise<LinkOutcome> {
  const cnr = normaliseCnr(rawCnr);
  if (!cnr) throw new BadRequestError('CNR must be 16 characters: 4 letters followed by 12 letters/digits.', { code: 'invalid_cnr' });

  // Verify BEFORE saving. Saving first (as this used to) let a typo replace a
  // matter's working CNR - found live 2026-10-20 when a test CNR overwrote a
  // linked case and left it "not found". lookupByCnr is memoised, so the
  // sync below reuses this answer instead of calling eCourts again.
  let reachable = true;
  try {
    const tiers: Court[] = court ? [court] : ['DC', 'HC'];
    let found = false;
    for (const t of tiers) {
      if (await lookupByCnr(cnr, t)) { found = true; break; }
    }
    if (!found) throw new EcourtsRecordNotFoundError(cnr);
  } catch (err) {
    if (classifySyncError(err) !== 'upstream') throw err; // not found / bad input: nothing changed
    reachable = false;
  }

  if (!reachable) {
    // Can't verify while eCourts is down. Fine for a matter with no working
    // CNR yet (save it, retry in the background) - but never re-point an
    // already-connected matter to an unverified CNR.
    const sql = db();
    const [cur] = sql
      ? await sql<Array<{ cnr: string; ecourts_link_status: EcourtsLinkStatus }>>`
          select cnr, ecourts_link_status from cases
          where id::text = ${caseId} and firm_id = ${firmId}::uuid and deleted_at is null limit 1`
      : [];
    if (cur && cur.ecourts_link_status === 'linked' && normaliseCnr(cur.cnr) && normaliseCnr(cur.cnr) !== cnr) {
      throw new HttpError(
        503,
        'eCourts is not responding, so the new CNR can\'t be checked. This matter is already connected with its current CNR; try changing it again once eCourts is back.',
        { code: 'ecourts_unavailable', expose: true },
      );
    }
  }

  await setCnr(caseId, firmId, cnr);
  return linkNowOrQueue(caseId, firmId, cnr, court);
}

/**
 * Resolve a CNR from case type + registration number + year, then link.
 * Several matches (same number in more than one establishment of the
 * complex) are returned for the advocate to choose from rather than guessed.
 * An unreachable eCourts here is a plain error: unlike linkByCnr there is no
 * CNR to save yet, so there is nothing to retry in the background.
 */
export async function linkByCaseNumber(caseId: string, firmId: string, input: CaseNumberLinkInput): Promise<LinkOutcome> {
  let payload: unknown;
  try {
    payload = await searchByCaseNumber({ ...input, regNo: input.regNo, court: input.court ?? 'DC' });
  } catch (err) {
    if (classifySyncError(err) === 'upstream') {
      throw new HttpError(
        503,
        'eCourts is not responding right now, so the case number could not be looked up. Try again in a few minutes, or link with the CNR instead (it will connect automatically when eCourts is back).',
        { code: 'ecourts_unavailable', expose: true },
      );
    }
    throw err;
  }
  const candidates = extractCnrCandidates(payload);
  if (candidates.length === 0) {
    throw new BadRequestError('eCourts has no case with that type, number and year in the selected court.', { code: 'ecourts_not_found' });
  }
  if (candidates.length > 1) return { status: 'choose', candidates };
  const only = candidates[0]!;
  await setCnr(caseId, firmId, only.cino);
  return linkNowOrQueue(caseId, firmId, only.cino, input.court);
}
