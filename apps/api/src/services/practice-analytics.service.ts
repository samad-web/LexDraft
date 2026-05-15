/**
 * Practice-tier analytics - lighter cousin of the Firm-tier `analyticsService`.
 *
 * Two surfaces:
 *  1. `workload(firmId)`     - fairness view, distribution of open matters
 *                              and upcoming hearings across firm members.
 *  2. `profitability(firmId)` - paid vs. expenses per matter, worst-first.
 *
 * Live joins over OLTP tables (`users`, `cases`, `hearings`, `invoices`,
 * `expenses`, `tasks`). The Firm tier reads from materialized views; we
 * deliberately stay live here because (a) Practice tenants are smaller
 * (≤ 25 seats), (b) the queries we run are O(matters) at worst, and
 * (c) partners want to see today's numbers, not yesterday's. If perf
 * becomes a problem the upgrade path is a `practice_analytics_*_mv` set
 * - see the agent report.
 *
 * Tenant safety: every query is scoped by `firm_id`. We return empty
 * payloads (not 4xx) for callers without a firm attachment, matching the
 * convention set by `clausesService` and friends.
 */

import { db } from '../db/client';
import type {
  ProfitabilityMatter,
  ProfitabilityResponse,
  WorkloadMember,
  WorkloadResponse,
} from '../types/practice-analytics.types';

const EMPTY_WORKLOAD: WorkloadResponse = {
  members: [],
  totals: { activeMatters: 0, hearingsThisWeek: 0, hearingsNextWeek: 0, memberCount: 0 },
};

const EMPTY_PROFITABILITY: ProfitabilityResponse = { matters: [] };

/**
 * Compute the [Monday-anchored] ISO week start for a given date, and the
 * exclusive end of the *next* week. Returns three boundaries:
 *   thisWeekStart <= d < nextWeekStart <= weekAfterStart
 * so a `>= thisWeekStart and < nextWeekStart` filter matches "this week",
 * and `>= nextWeekStart and < weekAfterStart` matches "next week".
 */
function weekBoundaries(now: Date): { thisStart: string; nextStart: string; afterStart: string } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // JS: Sun=0..Sat=6. ISO weeks start Monday - shift accordingly.
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  const thisStart = d.toISOString().slice(0, 10);

  const next = new Date(d);
  next.setDate(next.getDate() + 7);
  const nextStart = next.toISOString().slice(0, 10);

  const after = new Date(next);
  after.setDate(after.getDate() + 7);
  const afterStart = after.toISOString().slice(0, 10);

  return { thisStart, nextStart, afterStart };
}

/** Median of a numeric array (numeric median, not the integer-only flavour). */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

interface MemberRow {
  id: string;
  name: string;
  role: string;
}

interface TaskCountRow {
  assignee: string;
  open_count: number | string;
}

interface MatterAggRow {
  case_id: string;
  title: string;
  client: string;
  invoiced_inr: number | string | null;
  paid_inr: number | string | null;
  last_invoice_at: Date | string | null;
}

interface ExpenseAggRow {
  case_label: string;
  expense_inr: number | string | null;
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'string' ? Number(v) : v;
}

export const practiceAnalyticsService = {
  /**
   * Workload-fairness view. Pulls active members, then layers on:
   *  - open matters per member (firm-wide total split across members because
   *    `cases.assignee` does not exist in the schema yet - flagged in the
   *    agent report);
   *  - hearings this/next ISO week (firm-wide; same gap);
   *  - open tasks (task.assignee → users.name case-insensitive match).
   *
   * `isOverloaded` is a simple median-based flag: any member whose openMatters
   * exceeds 1.5x the median is tinted in the UI. With even distribution
   * (the current heuristic) nobody ever flips overloaded - once the
   * assignee column lands the math will start to bite.
   */
  async workload(firmId: string | null): Promise<WorkloadResponse> {
    if (!firmId) return EMPTY_WORKLOAD;
    const sql = db();
    if (!sql) return EMPTY_WORKLOAD;

    const { thisStart, nextStart, afterStart } = weekBoundaries(new Date());

    const [memberRows, activeMattersRow, hearingsThisWeekRow, hearingsNextWeekRow, taskRows] =
      await Promise.all([
        sql<MemberRow[]>`
          select id, name, role
          from users
          where firm_id = ${firmId}::uuid
            and status = 'active'
          order by name asc
        `,
        sql<Array<{ n: number | string }>>`
          select count(*)::int as n
          from cases
          where firm_id = ${firmId}::uuid
            and status = 'Active'
        `,
        sql<Array<{ n: number | string }>>`
          select count(*)::int as n
          from hearings h
          join cases c on c.id = h.case_id
          where c.firm_id = ${firmId}::uuid
            and h.hearing_date >= ${thisStart}::date
            and h.hearing_date <  ${nextStart}::date
        `,
        sql<Array<{ n: number | string }>>`
          select count(*)::int as n
          from hearings h
          join cases c on c.id = h.case_id
          where c.firm_id = ${firmId}::uuid
            and h.hearing_date >= ${nextStart}::date
            and h.hearing_date <  ${afterStart}::date
        `,
        sql<TaskCountRow[]>`
          select lower(assignee) as assignee, count(*)::int as open_count
          from tasks
          where firm_id = ${firmId}::uuid
            and column_name <> 'done'
          group by lower(assignee)
        `,
      ]);

    const memberCount = memberRows.length;
    const totalActiveMatters = Number(activeMattersRow[0]?.n ?? 0);
    const totalHearingsThisWeek = Number(hearingsThisWeekRow[0]?.n ?? 0);
    const totalHearingsNextWeek = Number(hearingsNextWeekRow[0]?.n ?? 0);

    if (memberCount === 0) {
      return {
        members: [],
        totals: {
          activeMatters: totalActiveMatters,
          hearingsThisWeek: totalHearingsThisWeek,
          hearingsNextWeek: totalHearingsNextWeek,
          memberCount: 0,
        },
      };
    }

    // Even-distribution heuristic. We give earlier-sorted members the
    // remainder so the totals reconcile exactly: e.g. 10 matters across
    // 3 members -> [4, 3, 3], not [3.33, 3.33, 3.33].
    const baseShare = Math.floor(totalActiveMatters / memberCount);
    const remainder = totalActiveMatters - baseShare * memberCount;
    const baseHearingsThisWeek = Math.floor(totalHearingsThisWeek / memberCount);
    const remainderHearingsThisWeek = totalHearingsThisWeek - baseHearingsThisWeek * memberCount;
    const baseHearingsNextWeek = Math.floor(totalHearingsNextWeek / memberCount);
    const remainderHearingsNextWeek = totalHearingsNextWeek - baseHearingsNextWeek * memberCount;

    const taskByAssignee = new Map<string, number>();
    for (const r of taskRows) taskByAssignee.set(r.assignee, Number(r.open_count));

    const partial: Array<Omit<WorkloadMember, 'isOverloaded'>> = memberRows.map((m, i) => ({
      userId: m.id,
      name: m.name,
      role: m.role,
      openMatters: baseShare + (i < remainder ? 1 : 0),
      hearingsThisWeek: baseHearingsThisWeek + (i < remainderHearingsThisWeek ? 1 : 0),
      hearingsNextWeek: baseHearingsNextWeek + (i < remainderHearingsNextWeek ? 1 : 0),
      openTasks: taskByAssignee.get(m.name.toLowerCase()) ?? 0,
    }));

    const medianMatters = median(partial.map((p) => p.openMatters));
    const overloadThreshold = medianMatters * 1.5;
    const members: WorkloadMember[] = partial.map((p) => ({
      ...p,
      // Strictly greater-than: at the median * 1.5 mark you're heavy, not flagged.
      isOverloaded: medianMatters > 0 && p.openMatters > overloadThreshold,
    }));

    return {
      members,
      totals: {
        activeMatters: totalActiveMatters,
        hearingsThisWeek: totalHearingsThisWeek,
        hearingsNextWeek: totalHearingsNextWeek,
        memberCount,
      },
    };
  },

  /**
   * Profitability-per-matter (light). Joins `cases` to two aggregates:
   *   - invoices grouped by `cases.client` (no `invoices.case_id` column);
   *   - expenses grouped by `cases.title` (matched against `expenses.case_label`).
   *
   * The invoice→case match is by client name, so a client with multiple
   * matters will see invoices smeared across them. This is the same
   * compromise the existing invoice list makes - fix lands when a real
   * `invoices.case_id` column does. See agent report.
   *
   * Sorted by netInr ascending (worst first). `since` filters by
   * `cases.created_at` so the query window stays bounded - useful when
   * partners want a quarterly snapshot.
   */
  async profitability(
    firmId: string | null,
    opts: { since?: Date } = {},
  ): Promise<ProfitabilityResponse> {
    if (!firmId) return EMPTY_PROFITABILITY;
    const sql = db();
    if (!sql) return EMPTY_PROFITABILITY;

    const sinceIso = opts.since ? opts.since.toISOString() : null;

    const [matterRows, expenseRows] = await Promise.all([
      sql<MatterAggRow[]>`
        select
          c.id          as case_id,
          c.title       as title,
          c.client      as client,
          coalesce(sum(i.amount_inr) filter (
            where i.status in ('paid','pending','overdue')
          ), 0)::bigint as invoiced_inr,
          coalesce(sum(i.amount_inr) filter (
            where i.status = 'paid'
          ), 0)::bigint as paid_inr,
          max(i.issued_date) as last_invoice_at
        from cases c
        left join invoices i
          on i.firm_id = c.firm_id
         and i.client  = c.client
        where c.firm_id = ${firmId}::uuid
          and (${sinceIso}::timestamptz is null or c.created_at >= ${sinceIso}::timestamptz)
        group by c.id, c.title, c.client
      `,
      sql<ExpenseAggRow[]>`
        select
          case_label,
          coalesce(sum(amount_inr), 0)::bigint as expense_inr
        from expenses
        where firm_id = ${firmId}::uuid
          and case_label <> ''
        group by case_label
      `,
    ]);

    const expenseByLabel = new Map<string, number>();
    for (const r of expenseRows) {
      expenseByLabel.set(r.case_label, toNum(r.expense_inr));
    }

    const matters: ProfitabilityMatter[] = matterRows.map((r) => {
      const invoicedInr = toNum(r.invoiced_inr);
      const paidInr = toNum(r.paid_inr);
      const expensesInr = expenseByLabel.get(r.title) ?? 0;
      const netInr = paidInr - expensesInr;
      const marginPct = paidInr > 0 ? Math.round((netInr / paidInr) * 100) : null;
      const lastInvoiceAt = r.last_invoice_at
        ? (r.last_invoice_at instanceof Date
            ? r.last_invoice_at.toISOString().slice(0, 10)
            : String(r.last_invoice_at).slice(0, 10))
        : null;

      return {
        caseId: r.case_id,
        title: r.title,
        client: r.client,
        invoicedInr,
        paidInr,
        expensesInr,
        netInr,
        marginPct,
        isUnprofitable: marginPct !== null && marginPct < 20,
        lastInvoiceAt,
      };
    });

    // Sort by netInr ascending - partners want worst-first. Tie-break on
    // marginPct (lower first; null treated as worst since "no revenue yet"
    // is essentially a write-down candidate).
    matters.sort((a, b) => {
      if (a.netInr !== b.netInr) return a.netInr - b.netInr;
      const am = a.marginPct ?? -Infinity;
      const bm = b.marginPct ?? -Infinity;
      return am - bm;
    });

    return { matters };
  },
};
