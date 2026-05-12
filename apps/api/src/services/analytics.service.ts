import type { AnalyticsSummary } from '@lexdraft/types';
import { db } from '../db/client';

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

interface RevenueRow { y: number; m: number; total: number }
interface StageRow   { stage: string; count: number }
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
    const earliest = `${months[0]!.year}-${String(months[0]!.month + 1).padStart(2, '0')}-01`;

    const [activeRows, stageRows, outcomeRows, revRows, ytdRows] = await Promise.all([
      sql<{ count: number }[]>`
        select count(*)::int as count from cases
        where firm_id = ${firmId}::uuid and status = 'Active'
      `,
      sql<StageRow[]>`
        select stage, count(*)::int as count from cases
        where firm_id = ${firmId}::uuid and status = 'Active'
        group by stage order by count desc
      `,
      sql<OutcomeRow[]>`
        select
          count(*) filter (where outcome = 'Won')::int as won,
          count(*) filter (where outcome is not null)::int as total
        from cases
        where firm_id = ${firmId}::uuid
      `,
      sql<RevenueRow[]>`
        select extract(year  from issued_date)::int as y,
               extract(month from issued_date)::int as m,
               coalesce(sum(amount_inr), 0)::int    as total
        from invoices
        where firm_id = ${firmId}::uuid
          and status in ('paid','pending','overdue')
          and issued_date >= ${earliest}::date
        group by 1, 2
      `,
      sql<{ total: number }[]>`
        select coalesce(sum(amount_inr), 0)::int as total
        from invoices
        where firm_id = ${firmId}::uuid
          and extract(year from issued_date) = ${new Date().getFullYear()}
      `,
    ]);

    const revMap = new Map<string, number>();
    for (const r of revRows) revMap.set(`${r.y}-${r.m}`, r.total);

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
        activeMatters: activeRows[0]?.count ?? 0,
        billableHoursMonth: 0, // no time-entries table yet
        revenueYtdInr: ytdRows[0]?.total ?? 0,
        winRatePct,
      },
      stages: stageRows.map((r) => ({ label: r.stage, count: r.count })),
      monthlyRevenue,
    };
  },
};
