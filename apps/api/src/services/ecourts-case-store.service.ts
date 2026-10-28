import { db } from '../db/client';
import { logger } from '../logger';
import type { CaseHistory, Court, FilingCaseHistory } from '../lib/ecourts/types';
import { jobs } from './jobs.service';

// =============================================================================
// ecourts-case-store.service
//
// Case records from eCourts, served the way the 09:00 / 19:00 sync serves
// matters: from DifAi's own store first, eCourts second.
//
//   stored + fresh   -> returned instantly
//   stored + stale   -> returned instantly, refreshed in the background
//   not stored       -> fetched live once (through the rate limiter below);
//                       if eCourts is down/busy the fetch is QUEUED as a job
//                       that retries with backoff and sends the advocate an
//                       in-app notification when the case is ready
//
// Live calls go through one small rate limiter shared by every interactive
// lookup. Without it a 12-row search result fired 12 parallel "status" calls
// at once and tripped eCourts' firewall (HTTP 405) for everyone.
//
// Storage is the ecourts_case_store table (migration 0088). Until that
// migration is applied it falls back to process memory, so nothing breaks;
// it just doesn't survive a restart.
// =============================================================================

export type StoreKind = 'history' | 'filing';
type DataFor<K extends StoreKind> = K extends 'history' ? CaseHistory : FilingCaseHistory;

/** Older than this, a stored record is shown but refreshed in the background. */
const FRESH_MS = 6 * 60 * 60 * 1000;
/** "eCourts has no such case" answers are re-checked sooner. */
const NOT_FOUND_FRESH_MS = 30 * 60 * 1000;

// ---- storage (DB, with in-memory fallback) -----------------------------------

interface Stored {
  data: unknown | null;
  fetchedAt: Date;
}

const memStore = new Map<string, Stored>();
let tableMissing = false;
const key = (kind: StoreKind, cnr: string, court: Court) => `${kind}:${court}:${cnr}`;

function isMissingTable(err: unknown): boolean {
  return (err as { code?: string })?.code === '42P01';
}

function noteMissing(err: unknown): void {
  if (!tableMissing) logger.warn({ err }, 'ecourts_case_store table missing (run migration 0088); using in-memory store');
  tableMissing = true;
  missingCheckedAt = Date.now();
}

// Probe for the table with to_regclass (which never errors) rather than
// letting a query fail: a failed statement aborts whatever transaction the
// caller is in. A missing table is re-checked every few minutes, so applying
// migration 0088 takes effect without a restart.
let missingCheckedAt = 0;
const MISSING_RECHECK_MS = 5 * 60 * 1000;

async function hasTable(sql: NonNullable<ReturnType<typeof db>>): Promise<boolean> {
  if (tableMissing && Date.now() - missingCheckedAt < MISSING_RECHECK_MS) return false;
  if (!tableMissing && missingCheckedAt === -1) return true;
  try {
    const [r] = await sql<Array<{ t: string | null }>>`select to_regclass('public.ecourts_case_store')::text as t`;
    if (r?.t) {
      tableMissing = false;
      missingCheckedAt = -1;
      return true;
    }
    noteMissing(null);
    return false;
  } catch (err) {
    logger.warn({ err }, 'ecourts case store: table check failed');
    return false;
  }
}

export async function readStored(kind: StoreKind, cnr: string, court: Court): Promise<Stored | null> {
  const sql = db();
  if (!sql || !(await hasTable(sql))) return memStore.get(key(kind, cnr, court)) ?? null;
  try {
    const [r] = await sql<Array<{ data: unknown; fetched_at: Date }>>`
      select data, fetched_at from ecourts_case_store where kind = ${kind} and cnr = ${cnr} and court = ${court}
    `;
    return r ? { data: r.data, fetchedAt: r.fetched_at } : null;
  } catch (err) {
    if (isMissingTable(err)) { noteMissing(err); return memStore.get(key(kind, cnr, court)) ?? null; }
    throw err;
  }
}

/** Write-through, called after every successful live fetch (including the
 *  scheduled sync's, via ecourts.service). Never throws into the caller. */
export async function writeStored(kind: StoreKind, cnr: string, court: Court, data: unknown | null): Promise<void> {
  memStore.set(key(kind, cnr, court), { data, fetchedAt: new Date() });
  const sql = db();
  if (!sql || !(await hasTable(sql))) return;
  try {
    await sql`
      insert into ecourts_case_store (kind, cnr, court, data, fetched_at)
      values (${kind}, ${cnr}, ${court}, ${data == null ? null : sql.json(data as never)}, now())
      on conflict (kind, cnr, court) do update set data = excluded.data, fetched_at = now()
    `;
  } catch (err) {
    if (isMissingTable(err)) noteMissing(err);
    else logger.warn({ err, kind, cnr }, 'ecourts case store write failed');
  }
}

async function markViewed(kind: StoreKind, cnr: string, court: Court): Promise<void> {
  const sql = db();
  if (!sql || !(await hasTable(sql))) return;
  await sql`
    update ecourts_case_store set viewed_at = now() where kind = ${kind} and cnr = ${cnr} and court = ${court}
  `.catch((err) => { if (isMissingTable(err)) noteMissing(err); });
}

// ---- rate limiter for live calls ------------------------------------------------

const MAX_CONCURRENT = 2;
const MIN_GAP_MS = 400;
let active = 0;
let lastStart = 0;
const waiting: Array<() => void> = [];

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  const gap = lastStart + MIN_GAP_MS - Date.now();
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastStart = Date.now();
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

// ---- circuit breaker -----------------------------------------------------------
// After eCourts fails (down, or its firewall throttling us), interactive
// lookups stop calling it for a short while and answer from the store or the
// queue instead - every extra request while it is blocking us only prolongs
// the block. The queued-fetch job and the scheduled refresh bypass this; they
// have their own retry/backoff.

const BREAKER_MS = 60_000;
let upstreamDownUntil = 0;

export function upstreamPaused(): boolean {
  return Date.now() < upstreamDownUntil;
}

/** Visible for tests. */
export const __testing = { resetBreaker: (): void => { upstreamDownUntil = 0; } };

class UpstreamPausedError extends Error {}

async function fetchLive(kind: StoreKind, cnr: string, court: Court, opts: { force?: boolean } = {}): Promise<unknown | null> {
  if (!opts.force && upstreamPaused()) throw new UpstreamPausedError('eCourts paused after a recent failure');
  const ecourts = await import('./ecourts.service');
  try {
    // lookupByCnr / fetchFilingCaseHistory write through to this store themselves.
    return await limited<unknown | null>(() => (kind === 'history' ? ecourts.lookupByCnr(cnr, court) : ecourts.fetchFilingCaseHistory(cnr, court)));
  } catch (err) {
    const { classifySyncError } = await import('./ecourts-link.service');
    if (classifySyncError(err) === 'upstream') upstreamDownUntil = Date.now() + BREAKER_MS;
    throw err;
  }
}

// ---- background refresh ---------------------------------------------------------

const refreshing = new Set<string>();

function refreshInBackground(kind: StoreKind, cnr: string, court: Court): void {
  const k = key(kind, cnr, court);
  if (refreshing.has(k)) return;
  refreshing.add(k);
  void fetchLive(kind, cnr, court)
    .catch((err) => logger.info({ err: (err as Error).message, kind, cnr }, 'ecourts background refresh failed; keeping stored copy'))
    .finally(() => refreshing.delete(k));
}

// ---- public API --------------------------------------------------------------------

export type CaseResult<K extends StoreKind> =
  | { status: 'ok'; data: DataFor<K>; fetchedAt: string; stale: boolean; refreshing: boolean }
  | { status: 'not_found' }
  | { status: 'queued'; message: string }
  | { status: 'unavailable'; message: string };

export interface GetCaseOptions {
  /** When eCourts can't be reached and nothing is stored: queue a retrying
   *  fetch and notify this user when it lands. Off for row badges. */
  queueFor?: { userId: string; firmId: string | null };
}

export async function getCase<K extends StoreKind>(kind: K, rawCnr: string, court: Court, opts: GetCaseOptions = {}): Promise<CaseResult<K>> {
  const cnr = rawCnr.trim().toUpperCase();
  const stored = await readStored(kind, cnr, court).catch(() => null);

  if (stored) {
    void markViewed(kind, cnr, court);
    const age = Date.now() - stored.fetchedAt.getTime();
    const freshFor = stored.data == null ? NOT_FOUND_FRESH_MS : FRESH_MS;
    const stale = age > freshFor;
    if (stale) refreshInBackground(kind, cnr, court);
    if (stored.data == null && !stale) return { status: 'not_found' };
    if (stored.data != null) {
      return { status: 'ok', data: stored.data as DataFor<K>, fetchedAt: stored.fetchedAt.toISOString(), stale, refreshing: stale };
    }
    // Stale "not found": fall through and ask eCourts again now.
  }

  try {
    const data = await fetchLive(kind, cnr, court);
    void markViewed(kind, cnr, court);
    if (data == null) return { status: 'not_found' };
    return { status: 'ok', data: data as DataFor<K>, fetchedAt: new Date().toISOString(), stale: false, refreshing: false };
  } catch (err) {
    const { classifySyncError } = await import('./ecourts-link.service');
    if (!(err instanceof UpstreamPausedError) && classifySyncError(err) !== 'upstream') throw err;
    if (!opts.queueFor) {
      return { status: 'unavailable', message: 'eCourts is not responding right now.' };
    }
    await queueFetch(kind, cnr, court, opts.queueFor);
    return {
      status: 'queued',
      message: 'eCourts is busy right now. DifAi will keep trying in the background and notify you as soon as this case is ready.',
    };
  }
}

// ---- queued fetch (same retry pattern as the scheduled sync) -----------------------

export interface CaseFetchPayload {
  kind: StoreKind;
  cnr: string;
  court: Court;
  userId: string;
  firmId: string | null;
}

/** One pending fetch per case+user. pg-boss's singletonKey stops de-duplicating
 *  once a job is in 'retry' (seen live: every poll added another job), so
 *  this process remembers what it already queued for the retry window. */
const QUEUE_WINDOW_MS = 2 * 60 * 60 * 1000;
const queuedAt = new Map<string, number>();

async function queueFetch(kind: StoreKind, cnr: string, court: Court, who: { userId: string; firmId: string | null }): Promise<void> {
  const k = `${key(kind, cnr, court)}:${who.userId}`;
  const prev = queuedAt.get(k);
  if (prev && Date.now() - prev < QUEUE_WINDOW_MS) return;
  queuedAt.set(k, Date.now());
  try {
    await jobs.enqueue<CaseFetchPayload>('ecourts.case.fetch', { kind, cnr, court, ...who }, {
      singletonKey: `ecourts-fetch:${kind}:${court}:${cnr}:${who.userId}`,
      // 2, 4, 8, 16, 32, 64 min - roughly two hours of retries.
      retryLimit: 6,
      retryDelay: 120,
      retryBackoff: true,
    });
  } catch (err) {
    logger.warn({ err, cnr }, 'ecourts case fetch: could not queue');
  }
}

/** Job handler. Throws only while eCourts is unreachable, so pg-boss retries. */
export async function runCaseFetchJob(p: CaseFetchPayload): Promise<void> {
  const data = await fetchLive(p.kind, p.cnr, p.court, { force: true }); // throws on upstream failure -> retry
  queuedAt.delete(`${key(p.kind, p.cnr, p.court)}:${p.userId}`);
  if (!p.firmId || p.kind !== 'history') return;
  const { notificationsStore } = await import('./notifications.service');
  const h = data as CaseHistory | null;
  await notificationsStore.create({
    firmId: p.firmId,
    userId: p.userId,
    tone: h ? 'sage' : 'amber',
    icon: 'ecourts',
    title: h ? `Case ready: ${[h.pet_name, h.res_name].filter(Boolean).join(' v. ') || p.cnr}` : `No case found for ${p.cnr}`,
    body: h
      ? `eCourts is back. CNR ${p.cnr} has been fetched and is ready to open.`
      : `eCourts answered but has no record for CNR ${p.cnr}.`,
    view: `ecourts?cnr=${p.cnr}`,
    dedupeKey: `ecourts-fetch:${p.cnr}`,
  });
}

// ---- scheduled refresh of recently viewed cases -----------------------------------

/**
 * Run from the 09:00 / 19:00 jobs after the matters sync: refresh cases
 * advocates looked at in the last 7 days that aren't matters (matters are
 * already refreshed - and written through - by the sync itself). Paced, with
 * the same circuit breaker idea as the sync.
 */
export async function refreshRecentlyViewed(slot: string): Promise<{ refreshed: number; failed: number; skipped: number }> {
  const sql = db();
  if (!sql || !(await hasTable(sql))) return { refreshed: 0, failed: 0, skipped: 0 };
  let rows: Array<{ kind: StoreKind; cnr: string; court: Court }>;
  try {
    rows = await sql<Array<{ kind: StoreKind; cnr: string; court: Court }>>`
      select s.kind, s.cnr, s.court from ecourts_case_store s
      where s.viewed_at > now() - interval '7 days'
        and s.fetched_at < now() - interval '2 hours'
        and not exists (select 1 from cases c where upper(trim(c.cnr)) = s.cnr and c.deleted_at is null)
      order by s.viewed_at desc
      limit 150
    `;
  } catch (err) {
    if (isMissingTable(err)) { noteMissing(err); return { refreshed: 0, failed: 0, skipped: 0 }; }
    throw err;
  }
  let refreshed = 0;
  let failed = 0;
  let consecutive = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    try {
      await fetchLive(r.kind, r.cnr, r.court, { force: true });
      refreshed += 1;
      consecutive = 0;
    } catch {
      failed += 1;
      consecutive += 1;
      if (consecutive >= 5) {
        logger.warn({ slot, refreshed, remaining: rows.length - i - 1 }, 'viewed-case refresh: eCourts unreachable, stopping');
        return { refreshed, failed, skipped: rows.length - i - 1 };
      }
    }
    await new Promise((res) => setTimeout(res, 1_500));
  }
  logger.info({ slot, refreshed, failed }, 'viewed-case refresh complete');
  return { refreshed, failed, skipped: 0 };
}
