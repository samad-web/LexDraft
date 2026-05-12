/**
 * Caseload health assessor.
 *
 * Computes a composite "is this solo advocate burning out invisibly?" score
 * from a handful of operational signals: open matters, imminent limitation
 * deadlines, upcoming unscheduled hearings, overdue invoices, and overdue
 * tasks. Each signal has a warning + critical threshold; the score starts
 * at 100 and decays as signals trip.
 *
 * The function is firm-scoped (every read filters by firm_id, via the
 * service layer or direct SQL). When the caller has no firm attachment
 * (`firmId === null`) we return a flat "healthy / no signal" payload —
 * never the global table — mirroring the tenant-isolation invariant used
 * across the rest of the api.
 *
 * Thresholds are tuned for the Solo tier (one advocate, no support staff).
 * Practice / Firm tiers will likely want different cutoffs; that's a
 * follow-up — for now this widget is gated to Solo.
 *
 * Score formula: start at 100, subtract 15 per critical signal, 8 per
 * warning. Floor at 0. Bands: healthy ≥ 75, stretched 50–74, overloaded < 50.
 */

import type {
  CaseloadHealthBand,
  CaseloadHealthSeverity,
  CaseloadHealthSignal,
  CaseloadHealthSummary,
} from '../types/caseload-health.types';
import { db } from '../db/client';

// ---- Threshold catalogue --------------------------------------------------
// Centralised so the UI can render the same numbers in copy if needed, and
// so we can re-tune without scattered constants. Keys match
// CaseloadHealthSignalKey 1:1.
const THRESHOLDS = {
  open_matters:          { warning: 25, critical: 40 },
  imminent_limitations:  { warning: 3,  critical: 6  },
  tasks_overdue:         { warning: 5,  critical: 10 },
  invoice_overdue:       { warning: 3,  critical: 6  },
  // No critical band for unscheduled hearings — it's a "watch this" signal.
  unscheduled_hearings:  { warning: 4,  critical: Number.POSITIVE_INFINITY },
} as const;

const WEIGHTS: Record<CaseloadHealthSeverity, number> = {
  info: 0,
  warning: 8,
  critical: 15,
};

const BAND_HEALTHY_MIN    = 75;
const BAND_STRETCHED_MIN  = 50;

function severityFor(
  value: number,
  thresholds: { warning: number; critical: number },
): CaseloadHealthSeverity {
  if (value >= thresholds.critical) return 'critical';
  if (value >= thresholds.warning)  return 'warning';
  return 'info';
}

function bandFor(score: number): CaseloadHealthBand {
  if (score >= BAND_HEALTHY_MIN)   return 'healthy';
  if (score >= BAND_STRETCHED_MIN) return 'stretched';
  return 'overloaded';
}

function thresholdValueFor(
  severity: CaseloadHealthSeverity,
  thresholds: { warning: number; critical: number },
): number {
  if (severity === 'critical') return thresholds.critical;
  if (severity === 'warning')  return thresholds.warning;
  return 0;
}

// ---- Recommendation generator --------------------------------------------
// Derive at most three short, actionable suggestions from the heaviest
// (highest severity, then highest value) signals.
function recommendationsFor(signals: CaseloadHealthSignal[]): string[] {
  // critical first, then warning, then by value desc
  const sevRank: Record<CaseloadHealthSeverity, number> = { critical: 0, warning: 1, info: 2 };
  const sorted = [...signals]
    .filter((s) => s.severity !== 'info')
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.value - a.value);

  const out: string[] = [];
  for (const s of sorted) {
    if (out.length >= 3) break;
    switch (s.key) {
      case 'imminent_limitations':
        out.push(
          s.severity === 'critical'
            ? `Block 90 minutes today for limitation review — ${s.value} deadlines inside 14 days.`
            : `Schedule a limitation sweep this week (${s.value} deadlines inside 14 days).`,
        );
        break;
      case 'open_matters':
        out.push(
          s.severity === 'critical'
            ? `Archive or hand off stale matters — ${s.value} are open right now.`
            : `Review your active roster — ${s.value} open matters is near the solo ceiling.`,
        );
        break;
      case 'tasks_overdue':
        out.push(`Triage your task board: ${s.value} items are past due.`);
        break;
      case 'invoice_overdue':
        out.push(`Send reminders on ${s.value} overdue invoice${s.value === 1 ? '' : 's'} — cash flow matters.`);
        break;
      case 'unscheduled_hearings':
        out.push(`Prepare briefs for the ${s.value} hearings listed in the next 7 days.`);
        break;
    }
  }
  return out;
}

// ---- Demo-mode (no DB) defaults ------------------------------------------
// When DATABASE_URL is blank the demo dashboard should still render this
// widget. Return the most flattering payload — no signals, healthy band.
function emptySummary(): CaseloadHealthSummary {
  return { score: 100, band: 'healthy', signals: [], recommendations: [] };
}

interface CountsRow {
  open_matters:         number | string;
  imminent_limitations: number | string;
  tasks_overdue:        number | string;
  invoice_overdue:      number | string;
  unscheduled_hearings: number | string;
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'string' ? Number(v) || 0 : v;
}

export const caseloadHealthService = {
  /**
   * Compute the health summary for a solo's caseload.
   *
   * @param _userId  Reserved — currently unused because Solo plans have a
   *                 single advocate per firm, so firm-scoped counts ARE the
   *                 user's counts. Kept on the signature so a future
   *                 multi-user variant (Practice tier roll-out) can scope
   *                 by assignee without a breaking change.
   * @param firmId   Required for any data; null returns the empty/healthy
   *                 payload (mirrors tenant-isolation pattern elsewhere).
   */
  async assess(_userId: string | undefined, firmId: string | null): Promise<CaseloadHealthSummary> {
    if (!firmId) return emptySummary();
    const sql = db();
    if (!sql) return emptySummary();

    // One round-trip, one row. Each subquery is firm-scoped and uses an
    // existing index (cases_firm_idx, limitations_firm_idx, etc.).
    const [row] = await sql<CountsRow[]>`
      select
        (
          select count(*) from cases
          where firm_id = ${firmId}::uuid and status = 'Active'
        )::int as open_matters,
        (
          select count(*) from limitations
          where firm_id = ${firmId}::uuid
            and deadline >= current_date
            and deadline <= current_date + interval '14 days'
        )::int as imminent_limitations,
        (
          select count(*) from tasks
          where firm_id = ${firmId}::uuid
            and column_name <> 'done'
            and due_date is not null
            and due_date < current_date
        )::int as tasks_overdue,
        (
          select count(*) from invoices
          where firm_id = ${firmId}::uuid and status = 'overdue'
        )::int as invoice_overdue,
        (
          select count(*) from hearings h
          join cases c on c.id = h.case_id
          where c.firm_id = ${firmId}::uuid
            and h.hearing_date is not null
            and h.hearing_date >= current_date
            and h.hearing_date <= current_date + interval '7 days'
        )::int as unscheduled_hearings
    `;

    const counts = {
      open_matters:         num(row?.open_matters),
      imminent_limitations: num(row?.imminent_limitations),
      tasks_overdue:        num(row?.tasks_overdue),
      invoice_overdue:      num(row?.invoice_overdue),
      unscheduled_hearings: num(row?.unscheduled_hearings),
    };

    const signals: CaseloadHealthSignal[] = [];

    const openSev = severityFor(counts.open_matters, THRESHOLDS.open_matters);
    if (openSev !== 'info') {
      signals.push({
        key: 'open_matters',
        severity: openSev,
        label: 'Open matters',
        value: counts.open_matters,
        threshold: thresholdValueFor(openSev, THRESHOLDS.open_matters),
        message: `${counts.open_matters} active matters — solos start to drop balls past ${THRESHOLDS.open_matters.warning}.`,
      });
    }

    const limSev = severityFor(counts.imminent_limitations, THRESHOLDS.imminent_limitations);
    if (limSev !== 'info') {
      signals.push({
        key: 'imminent_limitations',
        severity: limSev,
        label: 'Imminent limitations',
        value: counts.imminent_limitations,
        threshold: thresholdValueFor(limSev, THRESHOLDS.imminent_limitations),
        message: `${counts.imminent_limitations} statutory deadlines inside the next 14 days.`,
      });
    }

    const taskSev = severityFor(counts.tasks_overdue, THRESHOLDS.tasks_overdue);
    if (taskSev !== 'info') {
      signals.push({
        key: 'tasks_overdue',
        severity: taskSev,
        label: 'Overdue tasks',
        value: counts.tasks_overdue,
        threshold: thresholdValueFor(taskSev, THRESHOLDS.tasks_overdue),
        message: `${counts.tasks_overdue} tasks past their due date and not yet done.`,
      });
    }

    const invSev = severityFor(counts.invoice_overdue, THRESHOLDS.invoice_overdue);
    if (invSev !== 'info') {
      signals.push({
        key: 'invoice_overdue',
        severity: invSev,
        label: 'Overdue invoices',
        value: counts.invoice_overdue,
        threshold: thresholdValueFor(invSev, THRESHOLDS.invoice_overdue),
        message: `${counts.invoice_overdue} invoice${counts.invoice_overdue === 1 ? '' : 's'} marked overdue.`,
      });
    }

    const hearSev = severityFor(counts.unscheduled_hearings, THRESHOLDS.unscheduled_hearings);
    if (hearSev !== 'info') {
      signals.push({
        key: 'unscheduled_hearings',
        severity: hearSev,
        label: 'Hearings in 7 days',
        value: counts.unscheduled_hearings,
        threshold: thresholdValueFor(hearSev, THRESHOLDS.unscheduled_hearings),
        message: `${counts.unscheduled_hearings} hearings listed in the next 7 days — confirm briefs.`,
      });
    }

    // Score & band -----------------------------------------------------------
    let score = 100;
    for (const s of signals) score -= WEIGHTS[s.severity];
    if (score < 0) score = 0;
    const band = bandFor(score);

    return {
      score,
      band,
      signals,
      recommendations: recommendationsFor(signals),
    };
  },
};
