import { db } from '../db/client';
import { logger } from '../logger';
import { jobs } from './jobs.service';
import { humanizeChanges, syncCaseFromEcourts } from './case-sync.service';
import { classifySyncError, recordSyncFailure } from './ecourts-link.service';

// =============================================================================
// ecourts-sync-runs.service
//
// The scheduled eCourts refresh: 09:00 IST (so advocates start the day with
// today's listings) and 19:00 IST (after courts post the day's business).
//
// eCourts goes down often, so a run is built to survive that rather than
// assume it away:
//
//   - CIRCUIT BREAKER. BREAKER_THRESHOLD consecutive "eCourts unreachable"
//     failures stop the run - hammering a server that is down only gets us
//     throttled harder once it comes back. Remaining cases are 'deferred'.
//   - AUTOMATIC RETRY. If anything was unreachable or deferred, the same slot
//     is retried every RETRY_DELAY_SEC (up to MAX_ATTEMPTS in total, ~3h).
//     A retry only touches cases the slot hasn't successfully synced yet.
//   - ONE SUMMARY PER ADVOCATE PER SLOT. After every attempt each advocate
//     gets an in-app summary of their matters; retries update the same
//     notification (dedupe key) instead of stacking new ones, so the bell
//     shows the latest truth: "3 updated, 2 still unreachable - retrying" ->
//     "all 14 up to date".
//   - Counts come from the cases table (synced/changed/attempted since the
//     slot's FIRST attempt started), not in-memory tallies, so a retry's
//     summary covers the whole slot, not just the retry's leftovers.
// =============================================================================

export type SyncSlot = 'morning' | 'evening' | 'manual';

const THROTTLE_MS = 1_500;
/** Extra pause after an upstream failure - eCourts' WAF throttles bursts. */
const UPSTREAM_BACKOFF_MS = 5_000;
const BREAKER_THRESHOLD = 5;
export const MAX_ATTEMPTS = 7; // first run + 6 retries
export const RETRY_DELAY_SEC = 30 * 60;
/** A run row stuck in 'running' longer than this is a crashed worker. */
const STALE_RUN_HOURS = 4;
/** How long to keep re-queuing a run that found another run in progress. */
const MAX_BUSY_DEFERRALS = 12;
const BUSY_DEFER_SEC = 10 * 60;
export const RUN_EXPIRE_SEC = STALE_RUN_HOURS * 3600;

export interface RunOptions {
  slot: SyncSlot;
  attempt?: number;
  /** yyyy-mm-dd (IST) the slot belongs to; retries carry the original's. */
  runDate?: string;
  /** Times this attempt was re-queued because another run held the lock. */
  busyDeferrals?: number;
}

export interface RunSummary {
  runId: string | null;
  slot: SyncSlot;
  attempt: number;
  status: 'completed' | 'partial' | 'upstream_down' | 'skipped';
  scanned: number;
  synced: number;
  changed: number;
  notFound: number;
  failed: number;
  deferred: number;
  retryScheduled: boolean;
}

export function istDate(d: Date = new Date()): string {
  // en-CA formats as yyyy-mm-dd.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
}

// ---------------------------------------------------------------------------
// Missed-run recovery
//
// pg-boss fires the 09:00 / 19:00 cron only if an API process is up at that
// minute, and never catches up afterwards. A laptop that was asleep, a
// deploy, or a restart at 08:59 silently cost advocates that day's update -
// someone had to trigger it by hand. Instead, the latest slot that SHOULD
// have run is checked at startup and every 15 minutes (jobs.service.ts), and
// run straight away if ecourts_sync_runs has no record of it.
// ---------------------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Leave the real cron this long to fire before treating a slot as missed. */
const CATCHUP_GRACE_MS = 10 * 60 * 1000;

export interface DueSlot {
  slot: 'morning' | 'evening';
  /** yyyy-mm-dd (IST) the slot belongs to. */
  runDate: string;
  /** When the slot was due (UTC instant). */
  dueAt: Date;
}

/** The most recent 09:00 / 19:00 IST slot at or before `now`. */
export function latestDueSlot(now: Date = new Date()): DueSlot {
  const ist = new Date(now.getTime() + IST_OFFSET_MS); // IST wall clock, read via UTC getters
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const h = ist.getUTCHours();
  const at = (day: number, hour: number) => new Date(Date.UTC(y, m, day, hour) - IST_OFFSET_MS);
  if (h >= 19) return { slot: 'evening', runDate: istDate(at(d, 19)), dueAt: at(d, 19) };
  if (h >= 9) return { slot: 'morning', runDate: istDate(at(d, 9)), dueAt: at(d, 9) };
  return { slot: 'evening', runDate: istDate(at(d - 1, 19)), dueAt: at(d - 1, 19) };
}

/**
 * The latest due slot, if it has NOT run yet and its grace period is over.
 * Any run row for that slot+date counts - its own retries handle the rest.
 */
export async function missedSlot(now: Date = new Date()): Promise<DueSlot | null> {
  const due = latestDueSlot(now);
  if (now.getTime() < due.dueAt.getTime() + CATCHUP_GRACE_MS) return null;
  const sql = db();
  if (!sql) return null;
  const [row] = await sql<Array<{ id: string }>>`
    select id from ecourts_sync_runs where slot = ${due.slot} and run_date = ${due.runDate}::date limit 1
  `;
  return row ? null : due;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptySummary(opts: RunOptions, attempt: number): RunSummary {
  return {
    runId: null, slot: opts.slot, attempt, status: 'skipped',
    scanned: 0, synced: 0, changed: 0, notFound: 0, failed: 0, deferred: 0, retryScheduled: false,
  };
}

export interface RetryPayload {
  slot: SyncSlot;
  runDate: string;
  attempt: number;
  busyDeferrals?: number;
}

async function enqueueRetry(payload: RetryPayload, delaySec: number): Promise<boolean> {
  try {
    await jobs.enqueue<RetryPayload>('ecourts.sync.retry', payload, {
      delaySec,
      expireInSeconds: RUN_EXPIRE_SEC,
      singletonKey: `ecourts-retry:${payload.slot}:${payload.runDate}:${payload.attempt}:${payload.busyDeferrals ?? 0}`,
    });
    return true;
  } catch (err) {
    logger.error({ err, payload }, 'ecourts sync: could not schedule retry');
    return false;
  }
}

export async function runScheduledSync(opts: RunOptions): Promise<RunSummary> {
  const attempt = opts.attempt ?? 1;
  const runDate = opts.runDate ?? istDate();
  const sql = db();
  if (!sql) {
    logger.warn('ecourts scheduled sync skipped: no DATABASE_URL');
    return emptySummary(opts, attempt);
  }

  // ---- Overlap guard ------------------------------------------------------
  // Two runs at once would double the load on eCourts and race each other's
  // per-case writes. A crashed worker can leave a row 'running' forever, so
  // anything older than STALE_RUN_HOURS is closed out first.
  await sql`
    update ecourts_sync_runs set status = 'failed', finished_at = now()
    where status = 'running' and started_at <= now() - make_interval(hours => ${STALE_RUN_HOURS})
  `;
  const busy = await sql<Array<{ id: string }>>`
    select id from ecourts_sync_runs where status = 'running' limit 1
  `;
  if (busy.length > 0) {
    const deferrals = (opts.busyDeferrals ?? 0) + 1;
    if (deferrals <= MAX_BUSY_DEFERRALS) {
      await enqueueRetry({ slot: opts.slot, runDate, attempt, busyDeferrals: deferrals }, BUSY_DEFER_SEC);
    }
    logger.warn({ slot: opts.slot, attempt, deferrals }, 'ecourts sync: another run in progress, deferred');
    return emptySummary(opts, attempt);
  }

  const [run] = await sql<Array<{ id: string; started_at: Date }>>`
    insert into ecourts_sync_runs (slot, run_date, attempt)
    values (${opts.slot}, ${runDate}::date, ${attempt})
    returning id, started_at
  `;
  if (!run) return emptySummary(opts, attempt);

  // The slot's window opens when its FIRST attempt started. Retries only
  // pick up what hasn't succeeded since then.
  let cutoff: Date = run.started_at;
  if (attempt > 1) {
    const [first] = await sql<Array<{ started_at: Date }>>`
      select started_at from ecourts_sync_runs
      where slot = ${opts.slot} and run_date = ${runDate}::date and attempt = 1
      order by started_at asc limit 1
    `;
    if (first) cutoff = first.started_at;
  }

  const summary: RunSummary = {
    runId: run.id, slot: opts.slot, attempt, status: 'completed',
    scanned: 0, synced: 0, changed: 0, notFound: 0, failed: 0, deferred: 0, retryScheduled: false,
  };

  try {
    // Every live matter with a usable CNR, whatever its link status - a
    // 'not_found' CNR is re-checked too, because a freshly registered case
    // can take a day or two to appear on eCourts. On a retry, skip what this
    // slot already synced, or already got a definitive answer for.
    const rows = await sql<Array<{ id: string; firm_id: string; cnr: string; title: string; created_by_user_id: string | null }>>`
      select id, firm_id, upper(trim(cnr)) as cnr, title, created_by_user_id
      from cases
      where deleted_at is null
        and status in ('Active', 'Pending')
        and upper(trim(cnr)) ~ '^[A-Z]{4}[A-Z0-9]{12}$'
        and (
          ${attempt === 1}
          or (
            (ecourts_synced_at is null or ecourts_synced_at < ${cutoff})
            and not (ecourts_link_status in ('not_found', 'error') and ecourts_last_attempt_at >= ${cutoff})
          )
        )
      order by coalesce(ecourts_synced_at, 'epoch'::timestamptz) asc
    `;
    summary.scanned = rows.length;

    const { notify } = await import('./notifications.service');
    let consecutiveUpstream = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      try {
        const result = await syncCaseFromEcourts(row.id, row.firm_id);
        summary.synced += 1;
        consecutiveUpstream = 0;
        const notable = humanizeChanges(result.changes);
        if (notable.length > 0) {
          summary.changed += 1;
          await notify.caseUpdatedFromEcourts(row.firm_id, {
            matterTitle: result.caseRow.title || row.title,
            cnr: row.cnr,
            changes: notable,
            ownerUserId: row.created_by_user_id,
            caseId: row.id,
            runDate,
          });
        }
      } catch (err) {
        const kind = classifySyncError(err);
        await recordSyncFailure(row.id, kind, err);
        if (kind === 'not_found') {
          summary.notFound += 1;
          consecutiveUpstream = 0;
        } else if (kind === 'case') {
          summary.failed += 1;
          consecutiveUpstream = 0;
          logger.warn({ err, caseId: row.id }, 'ecourts sync: case failed');
        } else {
          summary.failed += 1;
          consecutiveUpstream += 1;
          if (consecutiveUpstream >= BREAKER_THRESHOLD) {
            summary.deferred = rows.length - i - 1;
            summary.status = 'upstream_down';
            logger.warn(
              { slot: opts.slot, attempt, synced: summary.synced, deferred: summary.deferred },
              'ecourts sync: eCourts unreachable, circuit breaker tripped',
            );
            break;
          }
          await sleep(UPSTREAM_BACKOFF_MS);
        }
      }
      await sleep(THROTTLE_MS);
    }
    if (summary.status === 'completed' && summary.failed > 0) summary.status = 'partial';
  } catch (err) {
    // Our own failure (DB, etc.) - close the run row so the guard doesn't
    // block the next slot, then let the job runner log it.
    await sql`update ecourts_sync_runs set status = 'failed', finished_at = now() where id = ${run.id}`;
    throw err;
  }

  await sql`
    update ecourts_sync_runs set
      status = ${summary.status}, finished_at = now(),
      scanned = ${summary.scanned}, synced = ${summary.synced}, changed = ${summary.changed},
      not_found = ${summary.notFound}, failed = ${summary.failed}, deferred = ${summary.deferred}
    where id = ${run.id}
  `;

  // Retry anything eCourts couldn't answer. Case-level failures ('case',
  // 'not_found') are excluded by the retry's own row filter.
  const stillUnreachable = await countUnreachable(cutoff);
  const willRetry = stillUnreachable > 0 && attempt < MAX_ATTEMPTS;
  if (willRetry) {
    summary.retryScheduled = await enqueueRetry({ slot: opts.slot, runDate, attempt: attempt + 1 }, RETRY_DELAY_SEC);
  }

  await sendRunSummaries(opts.slot, runDate, cutoff, { retrying: summary.retryScheduled, finalAttempt: !willRetry });

  logger.info(summary, 'ecourts scheduled sync complete');
  return summary;
}

async function countUnreachable(cutoff: Date): Promise<number> {
  const sql = db();
  if (!sql) return 0;
  const [r] = await sql<Array<{ n: number }>>`
    select count(*)::int as n from cases
    where deleted_at is null
      and status in ('Active', 'Pending')
      and upper(trim(cnr)) ~ '^[A-Z]{4}[A-Z0-9]{12}$'
      and (ecourts_synced_at is null or ecourts_synced_at < ${cutoff})
      and not (ecourts_link_status in ('not_found', 'error') and ecourts_last_attempt_at >= ${cutoff})
  `;
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Per-advocate summary
// ---------------------------------------------------------------------------

export interface AdvocateSyncTally {
  total: number;
  synced: number;
  changed: number;
  notFound: number;
  errored: number;
  unreachable: number;
  changedTitles: string[];
}

async function sendRunSummaries(
  slot: SyncSlot,
  runDate: string,
  cutoff: Date,
  state: { retrying: boolean; finalAttempt: boolean },
): Promise<void> {
  const sql = db();
  if (!sql) return;
  const groups = await sql<Array<{
    firm_id: string; created_by_user_id: string | null;
    total: number; synced: number; changed: number; not_found: number; errored: number;
    changed_titles: string[] | null;
  }>>`
    select firm_id, created_by_user_id,
      count(*)::int as total,
      count(*) filter (where ecourts_synced_at >= ${cutoff})::int as synced,
      count(*) filter (where ecourts_last_changed_at >= ${cutoff})::int as changed,
      count(*) filter (where ecourts_link_status = 'not_found' and ecourts_last_attempt_at >= ${cutoff})::int as not_found,
      count(*) filter (where ecourts_link_status = 'error' and ecourts_last_attempt_at >= ${cutoff})::int as errored,
      (array_agg(title order by ecourts_last_changed_at desc)
         filter (where ecourts_last_changed_at >= ${cutoff}))[1:3] as changed_titles
    from cases
    where deleted_at is null
      and status in ('Active', 'Pending')
      and upper(trim(cnr)) ~ '^[A-Z]{4}[A-Z0-9]{12}$'
    group by firm_id, created_by_user_id
  `;

  const { notify, resolveCaseRecipients } = await import('./notifications.service');

  // Owner-less matters fall back to firm admins, so one admin can receive
  // several groups - merge them into a single tally per user.
  const perUser = new Map<string, { firmId: string; tally: AdvocateSyncTally }>();
  for (const g of groups) {
    const recipients = await resolveCaseRecipients(g.firm_id, g.created_by_user_id);
    for (const r of recipients) {
      const entry = perUser.get(r.id) ?? {
        firmId: g.firm_id,
        tally: { total: 0, synced: 0, changed: 0, notFound: 0, errored: 0, unreachable: 0, changedTitles: [] },
      };
      const t = entry.tally;
      t.total += g.total;
      t.synced += g.synced;
      t.changed += g.changed;
      t.notFound += g.not_found;
      t.errored += g.errored;
      t.unreachable += Math.max(0, g.total - g.synced - g.not_found - g.errored);
      for (const title of g.changed_titles ?? []) {
        if (t.changedTitles.length < 3) t.changedTitles.push(title);
      }
      perUser.set(r.id, entry);
    }
  }

  for (const [userId, { firmId, tally }] of perUser) {
    await notify.ecourtsSyncSummary(firmId, userId, { slot, runDate, tally, ...state });
  }
}

// ---------------------------------------------------------------------------
// On-demand sync of ONE firm's matters ("Sync from eCourts" on Hearings).
// Same per-case work as the scheduled run - hearings, next date, orders,
// parties replaced from eCourts, change notifications - without touching the
// slot bookkeeping. Skips matters synced in the last FRESH_MIN minutes so a
// repeated click doesn't hammer eCourts; capped per click.
// ---------------------------------------------------------------------------

const FIRM_SYNC_FRESH_MIN = 30;
const FIRM_SYNC_MAX = 60;

export interface FirmSyncSummary {
  scanned: number;
  synced: number;
  changed: number;
  notFound: number;
  failed: number;
  upstreamDown: boolean;
}

/** due / total = open matters with a real CNR (the ones a sync refreshes);
 *  closed = matters with a real CNR that are closed or disposed, which the
 *  sync deliberately leaves alone - so the UI can say why nothing synced. */
export async function countFirmSyncCandidates(firmId: string): Promise<{ due: number; total: number; closed: number }> {
  const sql = db();
  if (!sql) return { due: 0, total: 0, closed: 0 };
  const [r] = await sql<Array<{ due: number; total: number; closed: number }>>`
    select
      count(*) filter (where status in ('Active', 'Pending')
        and (ecourts_synced_at is null or ecourts_synced_at < now() - make_interval(mins => ${FIRM_SYNC_FRESH_MIN})))::int as due,
      count(*) filter (where status in ('Active', 'Pending'))::int as total,
      count(*) filter (where status not in ('Active', 'Pending'))::int as closed
    from cases
    where firm_id = ${firmId}::uuid
      and deleted_at is null
      and upper(trim(cnr)) ~ '^[A-Z]{4}[A-Z0-9]{12}$'
  `;
  return { due: Math.min(r?.due ?? 0, FIRM_SYNC_MAX), total: r?.total ?? 0, closed: r?.closed ?? 0 };
}

export async function syncFirmCases(firmId: string): Promise<FirmSyncSummary> {
  const summary: FirmSyncSummary = { scanned: 0, synced: 0, changed: 0, notFound: 0, failed: 0, upstreamDown: false };
  const sql = db();
  if (!sql) return summary;
  const rows = await sql<Array<{ id: string; cnr: string; title: string; created_by_user_id: string | null }>>`
    select id, upper(trim(cnr)) as cnr, title, created_by_user_id
    from cases
    where firm_id = ${firmId}::uuid
      and deleted_at is null
      and status in ('Active', 'Pending')
      and upper(trim(cnr)) ~ '^[A-Z]{4}[A-Z0-9]{12}$'
      and (ecourts_synced_at is null or ecourts_synced_at < now() - make_interval(mins => ${FIRM_SYNC_FRESH_MIN}))
    order by next_hearing asc nulls last, coalesce(ecourts_synced_at, 'epoch'::timestamptz) asc
    limit ${FIRM_SYNC_MAX}
  `;
  summary.scanned = rows.length;
  const { notify } = await import('./notifications.service');
  const runDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  let consecutiveUpstream = 0;

  for (const row of rows) {
    try {
      const result = await syncCaseFromEcourts(row.id, firmId);
      summary.synced += 1;
      consecutiveUpstream = 0;
      const notable = humanizeChanges(result.changes);
      if (notable.length > 0) {
        summary.changed += 1;
        await notify.caseUpdatedFromEcourts(firmId, {
          matterTitle: result.caseRow.title || row.title,
          cnr: row.cnr,
          changes: notable,
          ownerUserId: row.created_by_user_id,
          caseId: row.id,
          runDate,
        });
      }
    } catch (err) {
      const kind = classifySyncError(err);
      await recordSyncFailure(row.id, kind, err);
      if (kind === 'not_found') {
        summary.notFound += 1;
        consecutiveUpstream = 0;
      } else {
        summary.failed += 1;
        if (kind === 'upstream') {
          consecutiveUpstream += 1;
          if (consecutiveUpstream >= BREAKER_THRESHOLD) { summary.upstreamDown = true; break; }
          await sleep(UPSTREAM_BACKOFF_MS);
        } else {
          consecutiveUpstream = 0;
        }
      }
    }
    await sleep(THROTTLE_MS);
  }

  // Dates eCourts set become hearing rows, and anything due soon reminds now.
  const { materializeCaseHearings } = await import('./hearings.service');
  await materializeCaseHearings(firmId, undefined, { force: true });
  const { sendUpcomingHearingReminders } = await import('./case-sync.service');
  await sendUpcomingHearingReminders({ firmId });
  logger.info({ firmId, ...summary }, 'ecourts firm sync complete');
  return summary;
}
