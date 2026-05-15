import type { AnalyticsSummary } from '@lexdraft/types';
import { db } from '../db/client';

/**
 * Firm-tier analytics.
 *
 * Reads from the materialized views created in migration 0021
 * (analytics_active_matters_mv, analytics_stages_mv, analytics_outcomes_mv,
 * analytics_monthly_revenue_mv) instead of aggregating live OLTP tables on
 * every request. Refresh cadence is daily via the `analytics.refresh`
 * pg-boss job; on-demand refresh is available to operators through
 * analyticsRefreshService.refreshAll().
 *
 * Staleness: the dashboard can lag by up to 24h since the last refresh.
 * That tradeoff buys cheap reads + no contention against invoice/case
 * write traffic. For sub-day freshness, callers should trigger a manual
 * refresh.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function trailing12Months(): Array<{ year: number; month: number; label: string }> {
  const now = new Date();
  const out: Array<{ year: number; month: number; label: string }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTHS[d.getMonth()]! });
  }
  return out;
}

interface RevenueRow { y: number; m: number; total: number | string }
interface StageRow   { stage: string; stage_count: number }
interface OutcomeRow { won: number; total: number }

const EMPTY_SUMMARY: AnalyticsSummary = {
  kpis: { activeMatters: 0, billableHoursMonth: 0, revenueYtdInr: 0, winRatePct: 0 },
  stages: [],
  monthlyRevenue: [],
};

export const analyticsService = {
  async summary(firmId: string | null): Promise<AnalyticsSummary> {
    if (!firmId) return EMPTY_SUMMARY;
    const sql = db();
    if (!sql) return EMPTY_SUMMARY;

    const months = trailing12Months();
    // Earliest (y, m) pair the trailing-12 chart needs. Used as a tuple
    // filter `(y, m) >= (earliestY, earliestM)` so we never pull rows we
    // won't render.
    const earliestY = months[0]!.year;
    const earliestM = months[0]!.month + 1;
    const currentYear = new Date().getFullYear();

    const [activeRows, stageRows, outcomeRows, revRows] = await Promise.all([
      sql<{ active_count: number }[]>`
        select active_count
        from analytics_active_matters_mv
        where firm_id = ${firmId}::uuid
        limit 1
      `,
      sql<StageRow[]>`
        select stage, stage_count
        from analytics_stages_mv
        where firm_id = ${firmId}::uuid
        order by stage_count desc
      `,
      sql<OutcomeRow[]>`
        select won, total
        from analytics_outcomes_mv
        where firm_id = ${firmId}::uuid
        limit 1
      `,
      sql<RevenueRow[]>`
        select y, m, total
        from analytics_monthly_revenue_mv
        where firm_id = ${firmId}::uuid
          and (y, m) >= (${earliestY}, ${earliestM})
      `,
    ]);

    const revMap = new Map<string, number>();
    let revenueYtdInr = 0;
    for (const r of revRows) {
      // bigint columns come back as string in postgres-js - coerce defensively
      const total = typeof r.total === 'string' ? Number(r.total) : r.total;
      revMap.set(`${r.y}-${r.m}`, total);
      if (r.y === currentYear) revenueYtdInr += total;
    }

    const monthlyRevenue = months.map((m) => ({
      label: m.label,
      // values displayed in lakhs for compact readout
      value: Math.round(((revMap.get(`${m.year}-${m.month + 1}`) ?? 0) / 100_000) * 10) / 10,
    }));

    const winRatePct = outcomeRows[0]?.total
      ? Math.round((outcomeRows[0].won / outcomeRows[0].total) * 100)
      : 0;

    return {
      kpis: {
        activeMatters: activeRows[0]?.active_count ?? 0,
        billableHoursMonth: 0, // no time-entries table yet
        revenueYtdInr,
        winRatePct,
      },
      stages: stageRows.map((r) => ({ label: r.stage, count: r.stage_count })),
      monthlyRevenue,
    };
  },
};
