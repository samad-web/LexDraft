import { db } from '../db/client';
import { logger } from '../logger';
import { narrowCandidates, nameTokens } from '../lib/efiling/match';
import type { CnrCandidateDto } from '../lib/efiling/types';
import { jobs } from './jobs.service';
import { classifySyncError, extractCnrCandidates, normaliseCnr } from './ecourts-link.service';
import { searchByFilingNumber, searchByPartyName } from './ecourts.service';
import { efilingFilingsService, recordFilingEvent } from './efiling-filings.service';
import { istDate, type SyncSlot } from './ecourts-sync-runs.service';

// =============================================================================
// efiling-tracker.service
//
// Connects e-filed cases to eCourts. A case submitted on the eFiling portal
// has an eFiling number but no CNR until the court registers it, and the
// portal's own status pages sit behind the advocate's login + CAPTCHA, so an
// unattended job can't read them. eCourts case status CAN be read unattended,
// so the tracker watches for the registered case there instead:
//
//   1. court filing number known (the advocate got it by SMS on acceptance)
//        -> searchByFilingNumber in the filing's establishment
//   2. otherwise -> searchByPartyName (petitioner) for the filing year, then
//        narrow by petitioner AND respondent names (lib/efiling/match.ts)
//   3. exactly one match -> attach the CNR and hand the matter to the normal
//        eCourts link/sync (ecourts-link.service) - from then on it refreshes
//        with every other case at 09:00 / 19:00
//      several -> 'ambiguous', the advocate picks (never guessed)
//      none    -> still awaiting registration; checked again next slot
//
// Runs right after each scheduled eCourts sync (jobs.service.ts) so the two
// never hit eCourts at the same time, and survives eCourts being down the
// same way that sync does: overlap guard, circuit breaker, 30-minute retries
// for whatever was unreachable, and ONE in-app summary per advocate per slot
// that retries rewrite instead of stacking.
// =============================================================================

const THROTTLE_MS = 1_500;
const UPSTREAM_BACKOFF_MS = 5_000;
const BREAKER_THRESHOLD = 5;
export const MAX_ATTEMPTS = 7;
export const RETRY_DELAY_SEC = 30 * 60;
const STALE_RUN_HOURS = 4;
export const RUN_EXPIRE_SEC = STALE_RUN_HOURS * 3600;
/** A filing still unregistered this long after submission gets flagged. */
const STALE_FILING_DAYS = 21;

export interface TrackOptions {
  slot: SyncSlot;
  attempt?: number;
  runDate?: string;
}

export interface TrackSummary {
  runId: string | null;
  slot: SyncSlot;
  attempt: number;
  status: 'completed' | 'partial' | 'upstream_down' | 'skipped';
  scanned: number;
  matched: number;
  ambiguous: number;
  notFound: number;
  failed: number;
  deferred: number;
  retryScheduled: boolean;
}

/** Thrown for a filing we can't search for (missing court codes etc.). */
class FilingDataError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TrackRow {
  id: string;
  firm_id: string;
  case_id: string;
  case_cnr: string | null;
  case_title: string;
  submitted_at: Date | null;
  court_filing_no: string | null;
  court_filing_year: number | null;
  tracking_status: string;
  tracking_candidates: CnrCandidateDto[] | string | null;
  court_tier: 'DC' | 'HC' | null;
  state_code: number | null;
  district_code: number | null;
  court_code: number | null;
  est_code: string | null;
  hide_party: boolean;
  petitioner: string | null;
  respondent: string | null;
}

type Outcome = { kind: 'matched'; cnr: string } | { kind: 'ambiguous'; candidates: CnrCandidateDto[] } | { kind: 'not_found'; reason: string };

/** Title fallback: "A v. B" / "A vs B". */
function sidesFromTitle(title: string): { pet: string | null; res: string | null } {
  const parts = title.split(/\s+v(?:s|\/s)?\.?\s+/i);
  return parts.length >= 2 ? { pet: parts[0]!.trim(), res: parts.slice(1).join(' ').trim() } : { pet: title.trim() || null, res: null };
}

/** eCourts party search is a substring match: search on the longest real
 *  word of the name, then narrow the hits by full-name similarity. */
export function partySearchTerm(name: string): string | null {
  const tokens = nameTokens(name).filter((t) => t.length >= 3).sort((a, b) => b.length - a.length);
  return tokens[0] ?? null;
}

async function takenCnrs(firmId: string, caseId: string): Promise<Set<string>> {
  const sql = db()!;
  const rows = await sql<Array<{ cnr: string }>>`
    select upper(trim(cnr)) as cnr from cases
    where firm_id = ${firmId}::uuid and id <> ${caseId}::uuid and deleted_at is null
      and upper(trim(cnr)) ~ '^[A-Z]{4}[A-Z0-9]{12}$'
  `;
  return new Set(rows.map((r) => r.cnr));
}

async function lookupFiling(row: TrackRow): Promise<Outcome> {
  if (row.state_code == null || row.district_code == null || row.court_code == null || !row.est_code) {
    throw new FilingDataError('Court not set on the filing (state, district, establishment). Add it under eFiling particulars.');
  }
  const court = row.court_tier ?? 'DC';
  const base = {
    stateCode: row.state_code,
    distCode: row.district_code,
    courtCode: row.court_code,
    estCode: row.est_code,
    court,
  } as const;
  const taken = await takenCnrs(row.firm_id, row.case_id);

  // 1. By court filing number - precise, works for hidden-identity cases too.
  if (row.court_filing_no && row.court_filing_year) {
    const payload = await searchByFilingNumber({ ...base, filingNo: row.court_filing_no, filingYear: row.court_filing_year });
    const candidates = extractCnrCandidates(payload).filter((c) => !taken.has(c.cino));
    if (candidates.length === 1) return { kind: 'matched', cnr: candidates[0]!.cino };
    if (candidates.length > 1) return { kind: 'ambiguous', candidates };
    return { kind: 'not_found', reason: `No case with filing number ${row.court_filing_no}/${row.court_filing_year} on eCourts yet.` };
  }

  // 2. By party name.
  if (row.hide_party) {
    return { kind: 'not_found', reason: 'Party identity is hidden on this case, so it can only be found by the court filing number. Enter it once the court accepts the filing.' };
  }
  const pet = row.petitioner ?? sidesFromTitle(row.case_title).pet;
  const res = row.respondent ?? sidesFromTitle(row.case_title).res;
  const term = pet ? partySearchTerm(pet) : null;
  if (!pet || !term) throw new FilingDataError('No petitioner name to search eCourts with. Add the parties under eFiling particulars.');

  const submittedYear = (row.submitted_at ?? new Date()).getFullYear();
  const years = [...new Set([submittedYear, new Date().getFullYear()])];
  const all: CnrCandidateDto[] = [];
  for (const year of years) {
    const payload = await searchByPartyName({ ...base, partyName: term, year });
    all.push(...extractCnrCandidates(payload));
  }
  const unique = [...new Map(all.map((c) => [c.cino, c])).values()];
  const narrowed = narrowCandidates({ petitioner: pet, respondent: res, candidates: unique, takenCnrs: taken });
  if (narrowed.length === 1) return { kind: 'matched', cnr: narrowed[0]!.cino };
  if (narrowed.length > 1) return { kind: 'ambiguous', candidates: narrowed.slice(0, 10) };
  return { kind: 'not_found', reason: 'Not on eCourts yet. Registration usually takes a few days after acceptance.' };
}

async function applyOutcome(row: TrackRow, outcome: Outcome): Promise<'matched' | 'ambiguous' | 'not_found'> {
  const sql = db()!;
  const { notify } = await import('./notifications.service');
  if (outcome.kind === 'matched') {
    await efilingFilingsService.attachCnr(row.id, row.firm_id, outcome.cnr, 'tracker');
    await notify.efilingRegistered(row.firm_id, { filingId: row.id, caseId: row.case_id, matterTitle: row.case_title, cnr: outcome.cnr });
    return 'matched';
  }
  if (outcome.kind === 'ambiguous') {
    const previous = typeof row.tracking_candidates === 'string' ? JSON.parse(row.tracking_candidates) as CnrCandidateDto[] : row.tracking_candidates ?? [];
    const changed = previous.map((c) => c.cino).sort().join() !== outcome.candidates.map((c) => c.cino).sort().join();
    await sql`
      update efiling_filings set
        tracking_status = 'ambiguous', tracking_candidates = ${sql.json(outcome.candidates as never)},
        tracking_last_attempt_at = now(), tracking_last_error = null, updated_at = now()
      where id = ${row.id}::uuid
    `;
    if (changed) {
      await recordFilingEvent(sql, { filingId: row.id, firmId: row.firm_id, source: 'tracker', note: `${outcome.candidates.length} possible matches on eCourts. Pick the right one.` });
      await notify.efilingNeedsChoice(row.firm_id, { filingId: row.id, matterTitle: row.case_title, count: outcome.candidates.length });
    }
    return 'ambiguous';
  }
  await sql`
    update efiling_filings set
      tracking_status = 'not_found', tracking_last_attempt_at = now(), tracking_last_error = ${outcome.reason},
      updated_at = now()
    where id = ${row.id}::uuid
  `;
  return 'not_found';
}

async function recordFailure(row: TrackRow, kind: 'upstream' | 'data', err: unknown): Promise<void> {
  const sql = db()!;
  const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  await sql`
    update efiling_filings set
      tracking_status = ${kind === 'data' ? 'error' : 'searching'},
      tracking_last_attempt_at = now(),
      tracking_last_error = ${kind === 'data' ? msg : `eCourts not responding: ${msg}`},
      tracking_fail_count = tracking_fail_count + 1
    where id = ${row.id}::uuid
  `;
}

/** The matter already has a CNR (linked by hand, or synced): just close the filing. */
async function closeAlreadyLinked(row: TrackRow, cnr: string): Promise<void> {
  const sql = db()!;
  await sql`
    update efiling_filings set status = 'registered', cnr = ${cnr}, registered_at = coalesce(registered_at, now()),
      tracking_status = 'matched', tracking_candidates = null, updated_at = now()
    where id = ${row.id}::uuid
  `;
  await recordFilingEvent(sql, { filingId: row.id, firmId: row.firm_id, to: 'registered', source: 'tracker', note: `Matter already connected to eCourts (CNR ${cnr})` });
}

async function enqueueRetry(payload: { slot: SyncSlot; runDate: string; attempt: number }): Promise<boolean> {
  try {
    await jobs.enqueue('efiling.track.retry', payload, {
      delaySec: RETRY_DELAY_SEC,
      expireInSeconds: RUN_EXPIRE_SEC,
      singletonKey: `efiling-retry:${payload.slot}:${payload.runDate}:${payload.attempt}`,
    });
    return true;
  } catch (err) {
    logger.error({ err, payload }, 'efiling tracker: could not schedule retry');
    return false;
  }
}

function empty(opts: TrackOptions, attempt: number): TrackSummary {
  return { runId: null, slot: opts.slot, attempt, status: 'skipped', scanned: 0, matched: 0, ambiguous: 0, notFound: 0, failed: 0, deferred: 0, retryScheduled: false };
}

export async function runEfilingTracking(opts: TrackOptions): Promise<TrackSummary> {
  const attempt = opts.attempt ?? 1;
  const runDate = opts.runDate ?? istDate();
  const sql = db();
  if (!sql) return empty(opts, attempt);

  await sql`
    update efiling_tracking_runs set status = 'failed', finished_at = now()
    where status = 'running' and started_at <= now() - make_interval(hours => ${STALE_RUN_HOURS})
  `;
  const busy = await sql`select id from efiling_tracking_runs where status = 'running' limit 1`;
  if (busy.length > 0) {
    logger.warn({ slot: opts.slot, attempt }, 'efiling tracker: another run in progress, skipped');
    return empty(opts, attempt);
  }

  const [run] = await sql<Array<{ id: string; started_at: Date }>>`
    insert into efiling_tracking_runs (slot, run_date, attempt) values (${opts.slot}, ${runDate}::date, ${attempt})
    returning id, started_at
  `;
  if (!run) return empty(opts, attempt);
  let cutoff = run.started_at;
  if (attempt > 1) {
    const [first] = await sql<Array<{ started_at: Date }>>`
      select started_at from efiling_tracking_runs
      where slot = ${opts.slot} and run_date = ${runDate}::date and attempt = 1
      order by started_at asc limit 1
    `;
    if (first) cutoff = first.started_at;
  }

  const summary: TrackSummary = { runId: run.id, slot: opts.slot, attempt, status: 'completed', scanned: 0, matched: 0, ambiguous: 0, notFound: 0, failed: 0, deferred: 0, retryScheduled: false };

  try {
    // New-case filings on the portal, not yet registered. A retry only
    // re-tries what eCourts couldn't answer earlier in this slot.
    const rows = await sql<TrackRow[]>`
      select f.id, f.firm_id, f.case_id, c.cnr as case_cnr, c.title as case_title, f.submitted_at,
             f.court_filing_no, f.court_filing_year, f.tracking_status, f.tracking_candidates,
             coalesce(p.court_tier, c.ecourts_court_tier) as court_tier,
             coalesce(p.state_code, c.state_code) as state_code,
             coalesce(p.district_code, c.district_code) as district_code,
             coalesce(p.court_code, c.court_code) as court_code,
             coalesce(p.est_code, c.est_code) as est_code,
             coalesce(p.hide_party, false) as hide_party,
             (select name from case_filing_parties fp where fp.case_id = f.case_id and fp.side = 'petitioner' order by position limit 1) as petitioner,
             (select name from case_filing_parties fp where fp.case_id = f.case_id and fp.side = 'respondent' order by position limit 1) as respondent
      from efiling_filings f
      join cases c on c.id = f.case_id and c.deleted_at is null
      left join case_filing_particulars p on p.case_id = f.case_id
      where f.kind = 'new_case'
        and f.status in ('submitted', 'objected', 'refiled', 'accepted')
        and (
          ${attempt === 1}
          or (f.tracking_status = 'searching' and (f.tracking_last_attempt_at is null or f.tracking_last_attempt_at >= ${cutoff}))
        )
      order by coalesce(f.tracking_last_attempt_at, 'epoch'::timestamptz) asc
    `;
    summary.scanned = rows.length;
    let consecutiveUpstream = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const existing = normaliseCnr(row.case_cnr);
      if (existing) {
        await closeAlreadyLinked(row, existing);
        summary.matched += 1;
        continue;
      }
      try {
        const outcome = await lookupFiling(row);
        const result = await applyOutcome(row, outcome);
        if (result === 'matched') summary.matched += 1;
        else if (result === 'ambiguous') summary.ambiguous += 1;
        else summary.notFound += 1;
        consecutiveUpstream = 0;
      } catch (err) {
        if (err instanceof FilingDataError || classifySyncError(err) !== 'upstream') {
          await recordFailure(row, 'data', err);
          summary.failed += 1;
          consecutiveUpstream = 0;
        } else {
          await recordFailure(row, 'upstream', err);
          summary.failed += 1;
          consecutiveUpstream += 1;
          if (consecutiveUpstream >= BREAKER_THRESHOLD) {
            summary.deferred = rows.length - i - 1;
            summary.status = 'upstream_down';
            // Deferred rows go to 'searching' so the retry picks them up.
            const deferredIds = rows.slice(i + 1).map((r) => r.id);
            if (deferredIds.length > 0) {
              await sql`
                update efiling_filings set tracking_status = 'searching', tracking_last_attempt_at = now(),
                  tracking_last_error = 'eCourts not responding. Will retry.'
                where id = any(${deferredIds}::uuid[])
              `;
            }
            logger.warn({ slot: opts.slot, attempt, deferred: summary.deferred }, 'efiling tracker: eCourts unreachable, circuit breaker tripped');
            break;
          }
          await sleep(UPSTREAM_BACKOFF_MS);
        }
      }
      await sleep(THROTTLE_MS);
    }
    if (summary.status === 'completed' && summary.failed > 0) summary.status = 'partial';
  } catch (err) {
    await sql`update efiling_tracking_runs set status = 'failed', finished_at = now() where id = ${run.id}`;
    throw err;
  }

  await sql`
    update efiling_tracking_runs set status = ${summary.status}, finished_at = now(),
      scanned = ${summary.scanned}, matched = ${summary.matched}, ambiguous = ${summary.ambiguous},
      not_found = ${summary.notFound}, failed = ${summary.failed}, deferred = ${summary.deferred}
    where id = ${run.id}
  `;

  const [left] = await sql<Array<{ n: number }>>`
    select count(*)::int as n from efiling_filings
    where kind = 'new_case' and status in ('submitted', 'objected', 'refiled', 'accepted') and tracking_status = 'searching'
  `;
  const willRetry = (left?.n ?? 0) > 0 && attempt < MAX_ATTEMPTS;
  if (willRetry) summary.retryScheduled = await enqueueRetry({ slot: opts.slot, runDate, attempt: attempt + 1 });

  await sendTrackingSummaries(opts.slot, runDate, cutoff, { retrying: summary.retryScheduled });
  logger.info(summary, 'efiling tracking run complete');
  return summary;
}

// ---------------------------------------------------------------------------
// Per-advocate summary
// ---------------------------------------------------------------------------

export interface EfilingTally {
  open: number;
  registeredNow: number;
  registeredTitles: string[];
  awaiting: number;
  needsChoice: number;
  needsData: number;
  unreachable: number;
  objected: number;
  readyNotSubmitted: number;
  stale: number;
}

async function sendTrackingSummaries(slot: SyncSlot, runDate: string, cutoff: Date, state: { retrying: boolean }): Promise<void> {
  const sql = db();
  if (!sql) return;
  const groups = await sql<Array<{
    firm_id: string; created_by_user_id: string | null;
    open: number; registered_now: number; awaiting: number; needs_choice: number; needs_data: number;
    unreachable: number; objected: number; ready_not_submitted: number; stale: number;
    registered_titles: string[] | null;
  }>>`
    select f.firm_id, f.created_by_user_id,
      count(*) filter (where f.status not in ('registered', 'rejected', 'withdrawn'))::int as open,
      count(*) filter (where f.status = 'registered' and f.registered_at >= ${cutoff})::int as registered_now,
      count(*) filter (where f.kind = 'new_case' and f.status in ('submitted', 'refiled', 'accepted') and f.tracking_status in ('idle', 'not_found'))::int as awaiting,
      count(*) filter (where f.tracking_status = 'ambiguous' and f.status <> 'registered')::int as needs_choice,
      count(*) filter (where f.tracking_status = 'error' and f.status <> 'registered')::int as needs_data,
      count(*) filter (where f.tracking_status = 'searching' and f.status <> 'registered')::int as unreachable,
      count(*) filter (where f.status = 'objected')::int as objected,
      count(*) filter (where f.status in ('ready', 'efiled'))::int as ready_not_submitted,
      count(*) filter (where f.kind = 'new_case' and f.status in ('submitted', 'refiled', 'accepted')
                         and f.submitted_at < now() - make_interval(days => ${STALE_FILING_DAYS}))::int as stale,
      (array_agg(c.title order by f.registered_at desc) filter (where f.status = 'registered' and f.registered_at >= ${cutoff}))[1:3] as registered_titles
    from efiling_filings f
    join cases c on c.id = f.case_id and c.deleted_at is null
    group by f.firm_id, f.created_by_user_id
  `;
  const { notify, resolveCaseRecipients } = await import('./notifications.service');
  const perUser = new Map<string, { firmId: string; tally: EfilingTally }>();
  for (const g of groups) {
    if (g.open === 0 && g.registered_now === 0) continue;
    for (const r of await resolveCaseRecipients(g.firm_id, g.created_by_user_id)) {
      const entry = perUser.get(r.id) ?? {
        firmId: g.firm_id,
        tally: { open: 0, registeredNow: 0, registeredTitles: [], awaiting: 0, needsChoice: 0, needsData: 0, unreachable: 0, objected: 0, readyNotSubmitted: 0, stale: 0 },
      };
      const t = entry.tally;
      t.open += g.open;
      t.registeredNow += g.registered_now;
      t.awaiting += g.awaiting;
      t.needsChoice += g.needs_choice;
      t.needsData += g.needs_data;
      t.unreachable += g.unreachable;
      t.objected += g.objected;
      t.readyNotSubmitted += g.ready_not_submitted;
      t.stale += g.stale;
      for (const title of g.registered_titles ?? []) if (t.registeredTitles.length < 3) t.registeredTitles.push(title);
      perUser.set(r.id, entry);
    }
  }
  for (const [userId, { firmId, tally }] of perUser) {
    await notify.efilingTrackingSummary(firmId, userId, { slot, runDate, tally, retrying: state.retrying });
  }
}
