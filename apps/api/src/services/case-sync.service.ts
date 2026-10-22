import type { Case } from '@lexdraft/types';
import { db } from '../db/client';
import { lookupByCnr } from './ecourts.service';
import type { CaseHistory, ExtraParty } from '../lib/ecourts/types';
import { caseActsService, type NewCaseAct } from './case-acts.service';
import { casePartiesService, type NewCaseParty } from './case-parties.service';
import { logger } from '../logger';
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../lib/errors';
import type { Court } from '../lib/ecourts/types';
import { casePipelineService, customStagesForFirm, kindForType, snapshotFor } from './case-pipeline.service';
import { mapEcourtsPurposeToStage } from './ecourts-stage-map';

// =============================================================================
// case-sync.service
//
// Pulls live case data from eCourts (via lib/ecourts) and folds it into the
// caller's `cases` and `hearings` rows. The mapping is documented in
// memory/project_ecourts_api_reverse_engineering.md and was reviewed with the
// user — short version:
//
//   ALWAYS overwrite : court, next_hearing, closed_at, status
//   PIPELINE         : stage - eCourts' purpose is mapped to the matter's
//                      pipeline stage (ecourts-stage-map.ts) and applied via
//                      casePipelineService.transition; unmapped -> unchanged
//   FILL-IF-BLANK    : title, client, type
//   DERIVED          : outcome  (needs `side` — see auto-detect below)
//   REPLACED EN BLOC : hearings rows  (we delete + reinsert from
//                      history.historyOfCaseHearing on every sync)
//
// We deliberately do NOT touch:
//   - cases.kind, cases.created_by_user_id, cases.firm_id, cases.id, cases.cnr
//   - documents (orders are surfaced separately in the UI)
//   - acts / parties / FIR (no schema for those yet — that's "Phase 2")
// =============================================================================

export type Side = 'petitioner' | 'respondent';

export interface SyncOptions {
  /** Which side the firm represents. Used to translate the eCourts disposition
   *  (DISMISSED / ALLOWED / WITHDRAWN / …) into the right case_outcome enum.
   *  When omitted we try to auto-detect by matching the current `cases.client`
   *  against pet_name / res_name; if that fails too, outcome is left null. */
  side?: Side;
  /** When true, the FILL-IF-BLANK fields (title, client, type) are overwritten
   *  even if the user already set them. Default false. */
  overwriteAll?: boolean;
  /** Court tier — district or high. Falls back to 'DC' which covers most
   *  matters. Callers can override per-call. */
  court?: Court;
}

export interface SyncResult {
  caseRow: Case;
  changes: Record<string, { from: unknown; to: unknown }>;
  hearingsReplaced: number;
  actsReplaced: number;
  partiesReplaced: number;
  side: Side | null;
  /** Surface-only fields the UI may want to show but the DB can't store yet.
   *  (Phase 2 migrated parties / acts / FIR into proper tables; only orders
   *  and court transfers remain here.) */
  surfaceOnly: {
    finalOrders: number;
    interimOrders: number;
    transfers: Array<{ on: string; from: string; to: string }>;
  };
}

// 4 letters (state + district) + 12 alphanumeric. The establishment code
// at positions 5-6 can be alphanumeric (`0B` for Alandur JM, etc.) so a
// `\d{12}` suffix would reject valid CNRs like TNCG0B0011172024.
export const CNR_RE = /^[A-Z]{4}[A-Z0-9]{12}$/;

/** eCourts answered, but has no record for this CNR on either court tier.
 *  Distinct from "eCourts is down" (which surfaces as EcourtsHttpError /
 *  EcourtsSessionError) - callers retry the latter, never the former. Still
 *  a 400 for the HTTP route, same as before this class existed. */
export class EcourtsRecordNotFoundError extends BadRequestError {
  constructor(cnr: string) {
    super(`eCourts returned no record for CNR ${cnr}`, { code: 'ecourts_not_found' });
  }
}

/** Last-resort tier guess for a case that has never synced. Once a sync
 *  succeeds the tier that actually answered is stored in
 *  cases.ecourts_court_tier and this is no longer consulted. */
function guessTier(court: string | null | undefined): Court {
  return /high\s*court/i.test(court ?? '') ? 'HC' : 'DC';
}

/**
 * Top-level entry point. Reads the case, calls eCourts, applies the mapping
 * within a single transaction, and returns the diff so the route handler can
 * surface "what changed" to the caller.
 */
export async function syncCaseFromEcourts(
  caseId: string,
  firmId: string,
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const sql = db();
  if (!sql) {
    // Without a DB we can't persist anything — fail loudly rather than
    // silently returning a no-op so the dev environment doesn't drift.
    throw new UnprocessableEntityError('Sync requires DATABASE_URL to be configured');
  }

  // Pull the case row first so we know the CNR and the current values to diff
  // against. We re-read inside the transaction below, but a pre-flight here
  // gives us a clean "case not found" path before we burn an eCourts call.
  const [pre] = await sql<Array<CaseFullRow>>`
    select id, cnr, title, court, stage, client, status, next_hearing, type,
           outcome, closed_at, practice_area, visible_to_client,
           est_code, court_code, district_code, state_code, filing_no, efil_no,
           judge, fir_no, fir_year, police_st_code, fir_details, ecourts_court_tier
    from cases
    where id::text = ${caseId} and firm_id = ${firmId}::uuid
    limit 1
  `;
  if (!pre) throw new NotFoundError('Case not found');
  const cnr = (pre.cnr ?? '').trim().toUpperCase();
  if (!CNR_RE.test(cnr)) {
    throw new BadRequestError(
      `Case has no valid CNR (got ${JSON.stringify(pre.cnr)}). Set the CNR before syncing.`,
      { code: 'ecourts_no_cnr' },
    );
  }

  // 1. Fetch live data. Tier precedence: explicit caller choice, then the
  //    tier that answered last time, then a guess from the court name. When
  //    the caller didn't force a tier and the first one has no record, try
  //    the other - a High Court matter whose court name doesn't literally say
  //    "High Court" used to fail on the DC backend forever. An upstream
  //    failure on the first tier throws straight out (no point asking the
  //    second tier of a server that's down).
  let tier: Court = opts.court ?? pre.ecourts_court_tier ?? guessTier(pre.court);
  let history = await lookupByCnr(cnr, tier);
  if (!history && !opts.court) {
    const other: Court = tier === 'DC' ? 'HC' : 'DC';
    const alt = await lookupByCnr(cnr, other);
    if (alt) {
      history = alt;
      tier = other;
    }
  }
  if (!history) {
    throw new EcourtsRecordNotFoundError(cnr);
  }

  // 2. Figure out which side we're on. If the caller specified one, trust it.
  //    Otherwise try a fuzzy match against the current client name. The match
  //    is intentionally lenient — "Ajayakumar" vs "1) Ajayakumar" vs "Ajay
  //    Kumar" all collide in practice when lawyers enter names by hand.
  const side = opts.side ?? detectSide(pre.client, history);

  // 2b. Which pipeline stage does eCourts' purpose correspond to? Mapped onto
  //     this matter's own stages (catalog for its type + firm custom stages).
  //     No confident match -> leave the pipeline alone.
  const kind = kindForType(pre.type);
  const stageOptions = snapshotFor(pre.type, null, await customStagesForFirm(firmId, kind)).stages;
  const stageTarget = mapEcourtsPurposeToStage(history.purpose_name, stageOptions, Boolean(history.disp_name));
  const stageMoves = stageTarget !== null && stageTarget.toLowerCase() !== (pre.stage ?? '').trim().toLowerCase();

  // 3. Apply the mapping inside a transaction so partial writes can't leave
  //    the case half-synced (e.g. case fields updated but hearings not).
  const { caseRow, changes, hearingsReplaced, actsReplaced, partiesReplaced } = await sql.begin(async (tx) => {
    const patch = buildCasePatch(pre, history, side, opts.overwriteAll ?? false);
    const diff = diffPatch(pre, patch);
    // Reported (and notified) like any other change; applied after commit.
    if (stageMoves) diff.stage = { from: pre.stage, to: stageTarget };

    const [updated] = await tx<Array<CaseFullRow>>`
      update cases set
        title           = coalesce(${patch.title ?? null}, title),
        court           = coalesce(${patch.court ?? null}, court),
        stage           = coalesce(${patch.stage ?? null}, stage),
        client          = coalesce(${patch.client ?? null}, client),
        status          = coalesce(${(patch.status ?? null) as string | null}::case_status, status),
        -- An undefined patch field means "unchanged": keep the column. (It
        -- used to write NULL here, so every sync of a case whose next date
        -- hadn't moved wiped next_hearing / outcome / closed_at - found live
        -- 2026-10-20.) A null patch field still clears it on purpose.
        next_hearing    = case when ${patch.next_hearing === undefined} then next_hearing
                               else ${patch.next_hearing ?? null}::date end,
        type            = coalesce(${patch.type ?? null}, type),
        outcome         = case when ${patch.outcome === undefined} then outcome
                               else ${patch.outcome ?? null}::case_outcome end,
        closed_at       = case when ${patch.closed_at === undefined} then closed_at
                               else ${patch.closed_at ?? null}::date end,
        practice_area   = coalesce(${patch.practice_area ?? null}, practice_area),
        -- court-identity columns (migration 0053). These are ALWAYS overwritten
        -- because the server-side codes are authoritative — there is no
        -- meaningful "manual edit" of a court_code to preserve.
        est_code        = ${patch.est_code ?? null},
        court_code      = ${patch.court_code ?? null},
        district_code   = ${patch.district_code ?? null},
        state_code      = ${patch.state_code ?? null},
        filing_no       = ${patch.filing_no ?? null},
        efil_no         = ${patch.efil_no ?? null},
        judge           = ${patch.judge ?? null},
        fir_no          = ${patch.fir_no ?? null},
        fir_year        = ${patch.fir_year ?? null},
        police_st_code  = ${patch.police_st_code ?? null},
        fir_details     = ${patch.fir_details ?? null},
        ecourts_synced_at = now(),
        -- Link state (migration 0085): a successful fetch is, by definition,
        -- a working link - clear any failure left by an earlier attempt.
        ecourts_court_tier      = ${tier},
        ecourts_link_status     = 'linked',
        ecourts_last_attempt_at = now(),
        ecourts_last_error      = null,
        ecourts_fail_count      = 0,
        ecourts_last_changed_at = case when ${hasNotableChange(diff)} then now() else ecourts_last_changed_at end,
        updated_at      = now()
      where id::text = ${caseId} and firm_id = ${firmId}::uuid
      returning id, cnr, title, court, stage, client, status, next_hearing, type,
                outcome, closed_at, practice_area, visible_to_client,
                est_code, court_code, district_code, state_code, filing_no, efil_no,
                judge, fir_no, fir_year, police_st_code, fir_details
    `;
    if (!updated) {
      // Should be impossible — we just read it — but the transaction may have
      // raced a delete. Bail out explicitly rather than continue with stale data.
      throw new NotFoundError('Case disappeared mid-sync');
    }

    // 4. Replace hearings en bloc. eCourts is the source of truth for the
    //    historical hearing record; partial syncing risks duplicate rows
    //    every time a user clicks "Sync".
    await tx`
      delete from hearings h
      using cases c
      where h.case_id = c.id
        and c.id::text = ${caseId}
        and c.firm_id = ${firmId}::uuid
    `;
    const caseLabel = updated.title;
    const hearingRows = hearingRowsFromHistory(history, caseId, caseLabel);
    for (const r of hearingRows) {
      // `hearings.firm_id` is NOT NULL (migration 0043 — tenant invariants).
      // Stamp it from the firmId we already validated.
      await tx`
        insert into hearings (case_id, firm_id, case_label, hearing_time, court, purpose, status, hearing_date, judge)
        values (${r.case_id}::uuid, ${firmId}::uuid, ${r.case_label}, ${r.hearing_time}, ${r.court},
                ${r.purpose}, ${r.status}::hearing_status, ${r.hearing_date || null},
                ${r.judge})
      `;
    }

    // 5. Replace acts + parties en bloc through their own services so the
    //    insert SQL lives next to the rest of the table's logic. The services
    //    accept the transaction handle so we stay atomic with the case + hearings
    //    writes.
    const actItems = actRowsFromHistory(history);
    await caseActsService.replaceForCase(caseId, actItems, tx as unknown as Parameters<typeof caseActsService.replaceForCase>[2]);

    const partyItems = partyRowsFromHistory(history);
    await casePartiesService.replaceForCase(caseId, partyItems, tx as unknown as Parameters<typeof casePartiesService.replaceForCase>[2]);

    return {
      caseRow: toDto(updated),
      changes: diff,
      hearingsReplaced: hearingRows.length,
      actsReplaced: actItems.length,
      partiesReplaced: partyItems.length,
    };
  });

  // 6. Move the matter's pipeline to the eCourts stage through the normal
  //    transition (sets the active node + cases.stage and records a stage
  //    event in the timeline). Best-effort: a pipeline hiccup must not undo
  //    a successful sync - the next sync retries the move.
  if (stageMoves && stageTarget) {
    try {
      await casePipelineService.transition({
        caseId,
        firmId,
        toStage: stageTarget,
        actor: { id: null, name: 'eCourts sync' },
        note: history.purpose_name ? `eCourts: ${history.purpose_name.trim()}` : 'Updated from eCourts',
      });
      caseRow.stage = stageTarget;
    } catch (err) {
      logger.warn({ err, caseId, stageTarget }, 'eCourts sync: pipeline stage move failed');
      delete changes.stage;
    }
  }

  logger.info(
    {
      caseId, cnr, side,
      changes: Object.keys(changes).length,
      hearings: hearingsReplaced,
      acts: actsReplaced,
      parties: partiesReplaced,
    },
    'eCourts sync applied',
  );

  return {
    caseRow,
    changes,
    hearingsReplaced,
    actsReplaced,
    partiesReplaced,
    side,
    surfaceOnly: extractSurfaceOnly(history),
  };
}

// ---------------------------------------------------------------------------
// Change classification
//
// The batch sync itself (09:00 / 19:00 IST, with retries while eCourts is
// unreachable) lives in ecourts-sync-runs.service.ts. These helpers decide
// which parts of a sync diff are worth telling an advocate about - pure
// identity back-fill (court_code etc.) never pings anyone.
// ---------------------------------------------------------------------------

/** Fields whose change is worth notifying a lawyer about. */
const NOTIFY_ON_FIELDS = ['next_hearing', 'status', 'stage', 'closed_at'] as const;

export function hasNotableChange(changes: Record<string, { from: unknown; to: unknown }>): boolean {
  return NOTIFY_ON_FIELDS.some((f) => f in changes);
}

export interface DailySyncSummary {
  scanned: number;
  synced: number;
  changed: number;
  notified: number;
  failed: number;
}

export function humanizeChanges(changes: Record<string, { from: unknown; to: unknown }>): string[] {
  const labels: Record<string, string> = {
    next_hearing: 'Next hearing',
    status: 'Status',
    stage: 'Stage',
    closed_at: 'Disposed on',
  };
  const out: string[] = [];
  for (const field of NOTIFY_ON_FIELDS) {
    const c = changes[field];
    if (!c) continue;
    const from = c.from == null || c.from === '' ? '—' : String(c.from).slice(0, 40);
    const to = c.to == null || c.to === '' ? '—' : String(c.to).slice(0, 40);
    out.push(`${labels[field]}: ${from} → ${to}`);
  }
  return out;
}

/**
 * Ad-hoc full sync (smoke scripts, manual job trigger). Same engine as the
 * scheduled 09:00 / 19:00 runs - including the circuit breaker and the
 * per-advocate summary notification - just recorded as a 'manual' slot.
 */
export async function syncAllActiveCasesFromEcourts(): Promise<DailySyncSummary> {
  const { runScheduledSync } = await import('./ecourts-sync-runs.service');
  const r = await runScheduledSync({ slot: 'manual' });
  return {
    scanned: r.scanned,
    synced: r.synced,
    changed: r.changed,
    notified: r.changed,
    failed: r.failed + r.deferred,
  };
}

// ---------------------------------------------------------------------------
// Hearing reminders
//
// `cases.next_hearing` is kept current by the sync above (and by manual
// edits), but nothing ever read it to actually remind anyone - the
// `reminder_offset_days` field on diary entries and the `hearing.reminder`
// job were both scaffolded (schema + a stub handler) and never wired end to
// end. This closes that gap: once a day, find every active case whose next
// hearing falls within REMINDER_WINDOW_DAYS and fire an in-app notification.
//
// Fixed window rather than per-case `reminder_offset_days` (deliberately -
// that field lives on `diary` entries, which are a separate, manually-
// created concept from `cases.next_hearing`; wiring cases to a
// per-diary-entry offset would require a case<->diary link that doesn't
// exist). A single firm-wide window is the right scope for "don't let an
// advocate miss a hearing that was just added from eCourts."
// ---------------------------------------------------------------------------

const REMINDER_WINDOW_DAYS = 3;

export interface HearingReminderSummary {
  scanned: number;
  reminded: number;
}

export async function sendUpcomingHearingReminders(): Promise<HearingReminderSummary> {
  const sql = db();
  if (!sql) {
    logger.warn('hearing reminder scan skipped: no DATABASE_URL');
    return { scanned: 0, reminded: 0 };
  }

  const rows = await sql<Array<{ id: string; firm_id: string; title: string; next_hearing: string; created_by_user_id: string | null }>>`
    select id, firm_id, title, next_hearing::text, created_by_user_id
    from cases
    where status = 'Active'
      and deleted_at is null
      and next_hearing is not null
      and next_hearing >= current_date
      and next_hearing <= current_date + ${REMINDER_WINDOW_DAYS}::int
  `;

  const summary: HearingReminderSummary = { scanned: rows.length, reminded: 0 };
  const { notify } = await import('./notifications.service');

  for (const row of rows) {
    try {
      const daysUntil = Math.round(
        (new Date(row.next_hearing).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86_400_000,
      );
      await notify.hearingReminder(row.firm_id, {
        matterTitle: row.title,
        caseId: row.id,
        hearingDate: row.next_hearing,
        daysUntil,
        ownerUserId: row.created_by_user_id,
      });
      summary.reminded += 1;
    } catch (err) {
      // One bad row (missing firm, notification write failure) must not
      // abort the scan for every other case due today or tomorrow.
      logger.warn({ err, caseId: row.id }, 'hearing reminder: case failed');
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

interface CaseFullRow {
  id: string;
  cnr: string;
  title: string;
  court: string;
  stage: string;
  client: string;
  status: Case['status'];
  next_hearing: string | Date | null;
  type: string;
  outcome: string | null;
  closed_at: string | Date | null;
  practice_area: string | null;
  visible_to_client: boolean | null;
  // eCourts identity (migration 0053)
  est_code: string | null;
  court_code: number | null;
  district_code: number | null;
  state_code: number | null;
  filing_no: string | null;
  efil_no: string | null;
  judge: string | null;
  fir_no: string | null;
  fir_year: number | null;
  police_st_code: number | null;
  fir_details: string | null;
  /** Tier that last answered for this CNR (migration 0085). Pre-sync read only. */
  ecourts_court_tier?: Court | null;
}

interface CasePatch {
  title?: string;
  court?: string;
  stage?: string;
  client?: string;
  status?: Case['status'];
  /** `null` clears the column; `undefined` leaves it alone. */
  next_hearing?: string | null;
  type?: string;
  outcome?: 'Won' | 'Lost' | 'Settled' | 'Withdrawn' | null;
  closed_at?: string | null;
  practice_area?: string;
  // Identity columns are always overwritten from the server-of-truth — every
  // present field on the eCourts payload ends up here.
  est_code?: string | null;
  court_code?: number | null;
  district_code?: number | null;
  state_code?: number | null;
  filing_no?: string | null;
  efil_no?: string | null;
  judge?: string | null;
  fir_no?: string | null;
  fir_year?: number | null;
  police_st_code?: number | null;
  fir_details?: string | null;
}

function buildCasePatch(
  pre: CaseFullRow,
  h: CaseHistory,
  side: Side | null,
  overwriteAll: boolean,
): CasePatch {
  const patch: CasePatch = {};

  // ALWAYS-overwrite fields (court-of-record truth wins).
  if (h.court_name && h.court_name !== pre.court) patch.court = h.court_name;
  // Stage is NOT patched here. eCourts' free-text purpose is mapped onto the
  // matter's pipeline stage and applied through the pipeline transition
  // after the transaction (see syncCaseFromEcourts) - writing it straight to
  // cases.stage left the pipeline stepper showing a different stage.
  const status = h.disp_name ? 'Closed' : 'Active';
  if (status !== pre.status) patch.status = status as Case['status'];
  const nextHearing = pickDate(h.date_next_list);
  // next_hearing intentionally flips to null when the case has been disposed
  // (no more hearings scheduled) — that's what the user expects to see.
  if (h.disp_name) {
    patch.next_hearing = null;
  } else if (nextHearing !== dateString(pre.next_hearing)) {
    patch.next_hearing = nextHearing ?? null;
  }
  const closed = pickDate(h.date_of_decision);
  if (closed !== dateString(pre.closed_at)) patch.closed_at = closed ?? null;
  const outcome = side ? mapOutcome(h.disp_name, side) : null;
  if (outcome !== pre.outcome) patch.outcome = outcome;

  // FILL-IF-BLANK fields. We never clobber user edits unless overwriteAll.
  const ecourtsTitle = buildTitle(h);
  if (ecourtsTitle && (overwriteAll || isBlank(pre.title))) patch.title = ecourtsTitle;

  const ecourtsClient = pickClient(h, side);
  if (ecourtsClient && (overwriteAll || isBlank(pre.client))) patch.client = ecourtsClient;

  const ecourtsType = h.type_name as string | undefined ?? h.fil_type_name as string | undefined;
  if (ecourtsType && (overwriteAll || isBlank(pre.type))) patch.type = String(ecourtsType);

  const derivedArea = derivePracticeArea(h);
  if (derivedArea && (overwriteAll || !pre.practice_area)) patch.practice_area = derivedArea;

  // Identity columns — always overwrite when eCourts has a value, clear when
  // it doesn't. These describe the matter's location in the court hierarchy
  // and the operator names them server-side; users can't meaningfully edit
  // a court_code or est_code by hand.
  patch.est_code        = h.est_code ?? null;
  patch.court_code      = numericOrNull(h.court_code);
  patch.district_code   = numericOrNull(h.district_code);
  patch.state_code      = numericOrNull(h.state_code);
  patch.filing_no       = h.filing_no ?? null;
  patch.efil_no         = h.efilno ?? null;
  patch.judge           = h.desgname ?? null;

  // FIR columns — fir_no is empty string on civil matters; normalise to null
  // so SQL `is null` semantics are predictable.
  patch.fir_no          = h.fir_no && h.fir_no.length > 0 ? h.fir_no : null;
  patch.fir_year        = patch.fir_no ? numericOrNull(h.fir_year) : null;
  patch.police_st_code  = patch.fir_no ? numericOrNull(h.police_st_code) : null;
  patch.fir_details     = patch.fir_no ? (h.fir_details ?? null) : null;

  return patch;
}

function diffPatch(pre: CaseFullRow, patch: CasePatch): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, to] of Object.entries(patch)) {
    if (to === undefined) continue;
    const from = (pre as unknown as Record<string, unknown>)[k];
    diff[k] = { from, to };
  }
  return diff;
}

function detectSide(currentClient: string | null | undefined, h: CaseHistory): Side | null {
  if (!currentClient) return null;
  const c = norm(currentClient);
  if (!c) return null;
  const pet = norm(h.pet_name);
  const res = norm(h.res_name);
  if (pet && (pet.includes(c) || c.includes(pet))) return 'petitioner';
  if (res && (res.includes(c) || c.includes(res))) return 'respondent';
  return null;
}

function mapOutcome(disp: string | undefined, side: Side): CasePatch['outcome'] {
  if (!disp) return null;
  const d = disp.toUpperCase().trim();
  // Withdrawn / settled are symmetric — same outcome for both sides.
  if (d === 'WITHDRAWN' || d === 'ABATED') return 'Withdrawn';
  if (d === 'COMPROMISED' || d === 'SETTLED' || d === 'COMPROMISE') return 'Settled';
  // The asymmetric ones flip based on which side the firm sits on.
  if (d === 'ALLOWED' || d === 'PARTLY ALLOWED' || d === 'ACCEPTED') {
    return side === 'petitioner' ? 'Won' : 'Lost';
  }
  if (d === 'DISMISSED' || d === 'DISMISSED IN DEFAULT' || d === 'REJECTED') {
    return side === 'petitioner' ? 'Lost' : 'Won';
  }
  return null;
}

function buildTitle(h: CaseHistory): string {
  // Prefer `petName` / `resName` when present — they already include sr.
  // numbering ("1) Ajayakumar"). Strip leading "1) " to keep the title clean.
  const pet = stripLeader(h.petName ?? h.pet_name);
  const res = stripLeader(h.resName ?? h.res_name);
  if (!pet && !res) return '';
  return `${pet || '?'} v. ${res || '?'}`;
}

function pickClient(h: CaseHistory, side: Side | null): string {
  if (side === 'petitioner') return stripLeader(h.petName ?? h.pet_name);
  if (side === 'respondent') return stripLeader(h.resName ?? h.res_name);
  return '';
}

function derivePracticeArea(h: CaseHistory): string | null {
  const acts = (h.act ?? []).map((a) => (a.actCodeName ?? '').toUpperCase());
  if (acts.some((a) => /CR\.?\s*P\.?\s*C\.?|IPC|BHARTIYA\s+NYAYA|NDPS|POCSO/.test(a))) return 'Criminal';
  if (acts.some((a) => /CPC|TRANSFER\s+OF\s+PROPERTY|EVIDENCE|LIMITATION/.test(a))) return 'Civil';
  if (acts.some((a) => /COMPANIES|INSOLVENCY|IBC|SARFAESI/.test(a))) return 'Corporate';
  if (acts.some((a) => /FAMILY|HINDU\s+MARRIAGE|GUARDIAN/.test(a))) return 'Family';
  if (acts.some((a) => /MOTOR\s+VEHICLE|CONSUMER\s+PROTECTION/.test(a))) return 'Consumer/MACT';
  // FIR-bearing cases are criminal by default even when the act code is absent.
  if (h.fir_no && h.fir_no.length > 0) return 'Criminal';
  return null;
}

// ---------------------------------------------------------------------------
// Hearings
// ---------------------------------------------------------------------------

interface HearingInsertRow {
  case_id: string;
  case_label: string;
  hearing_time: string;
  court: string;
  purpose: string;
  status: 'today' | 'upcoming' | 'past';
  hearing_date: string | null;
  judge: string | null;
}

function hearingRowsFromHistory(h: CaseHistory, caseId: string, caseLabel: string): HearingInsertRow[] {
  const rows: HearingInsertRow[] = [];
  const todayISO = new Date().toISOString().slice(0, 10);

  // Every past hearing the court reported.
  for (const hr of h.historyOfCaseHearing ?? []) {
    const date = parseEcourtsDate(hr.todays_date1 || hr.todays_date);
    if (!date) continue;
    rows.push({
      case_id: caseId,
      case_label: caseLabel,
      // eCourts doesn't carry time — we keep a stable sentinel so the column
      // is non-null (it's text not null in the schema). Users can edit later.
      hearing_time: '10:30',
      court: hr.judge_name || h.court_name || '',
      purpose: hr.purpose || '',
      status: 'past',
      hearing_date: date,
      judge: hr.judge_name || null,
    });
  }

  // Plus the upcoming hearing, if the case isn't disposed and we have a date.
  const next = parseEcourtsDate(h.date_next_list);
  if (next && !h.disp_name) {
    rows.push({
      case_id: caseId,
      case_label: caseLabel,
      hearing_time: '10:30',
      court: h.court_name || '',
      purpose: h.purpose_name || 'Listed',
      status: next === todayISO ? 'today' : 'upcoming',
      hearing_date: next,
      judge: h.desgname || null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Surface-only data (not persisted today)
// ---------------------------------------------------------------------------

function extractSurfaceOnly(h: CaseHistory): SyncResult['surfaceOnly'] {
  return {
    finalOrders:   h.finalOrder?.length ?? 0,
    interimOrders: h.interimOrder?.length ?? 0,
    transfers: (h.transfer ?? []).map((t) => ({
      on: t.transfer_date,
      from: t.from_court,
      to:   t.to_court,
    })),
  };
}

// ---------------------------------------------------------------------------
// Acts + parties extraction (migration 0053 — replace-en-bloc)
// ---------------------------------------------------------------------------

function actRowsFromHistory(h: CaseHistory): NewCaseAct[] {
  return (h.act ?? [])
    .map((a) => ({
      actName: (a.actCodeName ?? '').trim().replace(/\\$/, ''),
      section: (a.actSectionName ?? '').trim(),
      source:  'ecourts' as const,
    }))
    .filter((a) => a.actName.length > 0 || a.section.length > 0);
}

function partyRowsFromHistory(h: CaseHistory): NewCaseParty[] {
  const rows: NewCaseParty[] = [];

  // Principal petitioner (eCourts always carries one).
  const principalPet = stripLeader(h.petName ?? h.pet_name);
  if (principalPet) {
    rows.push({
      side: 'petitioner',
      partyName: principalPet,
      advocateName: cleanAdvocate(h.pet_adv),
      source: 'ecourts',
    });
  }
  for (const p of h.ex_pet_namelegal ?? []) {
    const name = (p.partyname ?? '').trim();
    if (!name) continue;
    rows.push({
      side: 'petitioner',
      partyName: name,
      roleLabel: makeRoleLabel(p),
      advocateName: cleanAdvocate(p.advExtraAdvname ?? p.adv_name_new as string | undefined),
      source: 'ecourts',
    });
  }

  // Principal respondent.
  const principalRes = stripLeader(h.resName ?? h.res_name);
  if (principalRes) {
    rows.push({
      side: 'respondent',
      partyName: principalRes,
      advocateName: cleanAdvocate(h.res_adv),
      source: 'ecourts',
    });
  }
  for (const p of h.ex_res_namelegal ?? []) {
    const name = (p.partyname ?? '').trim();
    if (!name) continue;
    rows.push({
      side: 'respondent',
      partyName: name,
      roleLabel: makeRoleLabel(p),
      advocateName: cleanAdvocate(p.advExtraAdvname ?? p.adv_name_new as string | undefined),
      source: 'ecourts',
    });
  }

  return rows;
}

function makeRoleLabel(p: ExtraParty): string | null {
  // eCourts ships a few free-text descriptors per party — litigant status,
  // legal-heir flag, guardian, power-of-attorney. Concatenate the non-empty
  // ones so the UI can render the gist without per-field columns.
  const bits = [
    p.litigantStatus,
    p.legalheir ? `Legal heir: ${p.legalheir as string}` : '',
    p.extraPrtyGuardian ? `Guardian: ${p.extraPrtyGuardian as string}` : '',
    p.extraparty_Power_Of_Attorney ? `PoA: ${p.extraparty_Power_Of_Attorney as string}` : '',
  ].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  return bits.length > 0 ? bits.join(' · ') : null;
}

function cleanAdvocate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.replace(/^Advocate\s*-\s*/i, '').trim();
  return v.length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isBlank(v: string | null | undefined): boolean {
  return !v || v.trim().length === 0;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/^\s*\d+\)\s*/, '').replace(/\s+/g, ' ').trim();
}

function stripLeader(s: string | null | undefined): string {
  return (s ?? '').replace(/^\s*\d+\)\s*/, '').trim();
}

function pickDate(v: string | undefined | null): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return parseEcourtsDate(v);
}

function dateString(v: string | Date | null): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

/** eCourts mixes `2023-01-09`, `09-01-2023`, and the cause-list compact
 *  `20230109` formats. Normalise to `YYYY-MM-DD`. */
function parseEcourtsDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return null;
}

function toDto(r: CaseFullRow): Case {
  const next =
    r.next_hearing instanceof Date
      ? r.next_hearing.toISOString().slice(0, 10)
      : (r.next_hearing ?? '');
  return {
    id: r.id,
    cnr: r.cnr,
    title: r.title,
    court: r.court,
    stage: r.stage,
    client: r.client,
    status: r.status,
    next,
    type: r.type,
    visibleToClient: r.visible_to_client ?? false,
    estCode:        r.est_code,
    courtCode:      r.court_code,
    districtCode:   r.district_code,
    stateCode:      r.state_code,
    filingNo:       r.filing_no,
    efilNo:         r.efil_no,
    judge:          r.judge,
    firNo:          r.fir_no,
    firYear:        r.fir_year,
    policeStCode:   r.police_st_code,
    firDetails:     r.fir_details,
    // ecourtsSyncedAt: written by the same UPDATE, but we don't return it
    // from this transactional UPDATE (RETURNING omits now()). The caller's
    // /sync route re-reads via casesService.get for the timeline so the
    // freshly-written timestamp lands on the response there.
  };
}

function numericOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
