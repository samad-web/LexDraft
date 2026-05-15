import type {
  Alert,
  CaseStageSlice,
  FirmDashboardSummary,
  FirmMember,
  MonthlyRevenuePoint,
  PracticeAreaSlice,
  TopClient,
} from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_ALERTS } from '../data/seed';
import { hearingsService } from './hearings.service';

/**
 * Firm overview = aggregate of cases, invoices, clients, users, hearings,
 * and alerts for the caller's firm. Everything that the schema can answer is
 * derived live; metrics that require tables we haven't built yet (time
 * tracking, per-member case assignment) come back as zero / empty so the UI
 * shows truthful gaps instead of fake numbers.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function inrLabel(rupees: number): string {
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(1)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

function fyBoundaries(now = new Date()): {
  startCurrent: string;
  endCurrent: string;
  startPrior: string;
  endPrior: string;
  label: string;
} {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  const startYear = m >= 3 ? y : y - 1;
  const endYear = startYear + 1;
  const startCurrent = `${startYear}-04-01`;
  const endCurrent = `${endYear}-03-31`;
  const startPrior = `${startYear - 1}-04-01`;
  const endPrior = `${startYear}-03-31`;
  const q = Math.floor(((m - 3 + 12) % 12) / 3) + 1;
  const label = `FY ${String(startYear).slice(2)}-${String(endYear).slice(2)} · Q${q}`;
  return { startCurrent, endCurrent, startPrior, endPrior, label };
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '·';
}

function relativeFromIso(iso: string | null): string {
  if (!iso) return '-';
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (Number.isNaN(days)) return iso.slice(0, 10);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return iso.slice(0, 10);
}

interface AlertRow { id: string; tone: Alert['type']; text: string; detail: string }

async function alerts(firmId: string | null): Promise<Alert[]> {
  if (!firmId) return [];
  const sql = db();
  if (!sql) return SEED_ALERTS;
  const rows = await sql<AlertRow[]>`
    select id, tone, text, detail
    from alerts
    where firm_id = ${firmId}::uuid
    order by created_at desc
  `;
  return rows.map((r) => ({ id: r.id, type: r.tone, text: r.text, detail: r.detail }));
}

interface FirmRow { id: string; name: string; seats: number }
interface IntRow { n: number }
interface SumRow { total: number | null }
interface UserRow { id: string; name: string; role: string }
interface ClientCountRow { count: number | null }
interface CaseTypeRow { type: string; n: number }
interface CaseStageRow { stage: string; n: number }
interface ClientAggRow { client: string; total: number | null; matters: number | null; last_issued: string | Date | null }
interface MonthRow { ym: string; total: number | null }

const EMPTY_DASHBOARD: FirmDashboardSummary = {
  firm: { name: 'Your firm', seats: 1, seatsUsed: 1, period: fyBoundaries().label },
  stats: {
    totalMatters: 0, activeMatters: 0,
    revenueFY: '₹0', revenueDeltaPct: 0,
    billableHoursMonth: 0, realizationPct: 0,
    advocatesActive: 0, clientsActive: 0,
  },
  members: [],
  practiceAreas: [],
  topClients: [],
  caseStages: [],
  monthlyRevenue: [],
  alerts: [],
  hearingsToday: [],
};

async function firmIdForUser(userId: string | undefined): Promise<string | null> {
  if (!userId) return null;
  const sql = db();
  if (!sql) return null;
  const rows = await sql<{ firm_id: string | null }[]>`
    select firm_id from users where id = ${userId} limit 1
  `;
  return rows[0]?.firm_id ?? null;
}

export const firmService = {
  async dashboard(userId: string | undefined): Promise<FirmDashboardSummary> {
    const sql = db();
    const fy = fyBoundaries();

    if (!sql) {
      // No database configured (local dev without Postgres). Return a small
      // synthetic snapshot so the UI doesn't render empty. Mark it clearly.
      const [hearingsToday, alertsList] = await Promise.all([
        hearingsService.listToday(null),
        alerts(null),
      ]);
      return {
        ...EMPTY_DASHBOARD,
        firm: { name: 'Demo firm (no DB)', seats: 1, seatsUsed: 1, period: fy.label },
        alerts: alertsList,
        hearingsToday,
      };
    }

    const firmId = await firmIdForUser(userId);
    if (!firmId) {
      const [hearingsToday, alertsList] = await Promise.all([
        hearingsService.listToday(null),
        alerts(null),
      ]);
      return { ...EMPTY_DASHBOARD, alerts: alertsList, hearingsToday };
    }

    // ---- One round-trip per logical query, all scoped by firmId. -----------
    const [
      [firmRow],
      [seatsUsedRow],
      [matterTotalRow],
      [matterActiveRow],
      [clientsActiveRow],
      [revFyRow],
      [revPriorRow],
      stageRows,
      typeRows,
      memberRows,
      clientAggRows,
      monthRows,
      hearingsToday,
      alertsList,
    ] = await Promise.all([
      sql<FirmRow[]>`select id, name, seats from firms where id = ${firmId} limit 1`,
      sql<IntRow[]>`select count(*)::int as n from users where firm_id = ${firmId}`,
      sql<IntRow[]>`select count(*)::int as n from cases where firm_id = ${firmId}`,
      sql<IntRow[]>`select count(*)::int as n from cases where firm_id = ${firmId} and status = 'Active'`,
      sql<IntRow[]>`select count(*)::int as n from clients where firm_id = ${firmId} and status = 'active'`,
      sql<SumRow[]>`
        select coalesce(sum(amount_inr), 0)::bigint as total
        from invoices
        where firm_id = ${firmId}
          and issued_date between ${fy.startCurrent} and ${fy.endCurrent}
      `,
      sql<SumRow[]>`
        select coalesce(sum(amount_inr), 0)::bigint as total
        from invoices
        where firm_id = ${firmId}
          and issued_date between ${fy.startPrior} and ${fy.endPrior}
      `,
      sql<CaseStageRow[]>`
        select stage, count(*)::int as n
        from cases
        where firm_id = ${firmId}
        group by stage
        order by n desc
      `,
      sql<CaseTypeRow[]>`
        select type, count(*)::int as n
        from cases
        where firm_id = ${firmId}
        group by type
        order by n desc
      `,
      sql<UserRow[]>`
        select id, name, role
        from users
        where firm_id = ${firmId}
        order by created_at asc
      `,
      sql<ClientAggRow[]>`
        select i.client,
               coalesce(sum(i.amount_inr), 0)::bigint as total,
               (select count(*)::int from cases c
                  where c.firm_id = ${firmId} and c.client = i.client) as matters,
               max(i.issued_date)::text as last_issued
        from invoices i
        where i.firm_id = ${firmId}
        group by i.client
        order by total desc
        limit 6
      `,
      sql<MonthRow[]>`
        select to_char(date_trunc('month', issued_date), 'YYYY-MM') as ym,
               coalesce(sum(amount_inr), 0)::bigint as total
        from invoices
        where firm_id = ${firmId}
          and issued_date >= (current_date - interval '11 months')
        group by 1
        order by 1
      `,
      hearingsService.listToday(firmId),
      alerts(firmId),
    ]);

    const firmName = firmRow?.name ?? 'Your firm';
    const seats = firmRow?.seats ?? 1;
    const seatsUsed = seatsUsedRow?.n ?? 0;

    const totalMatters = matterTotalRow?.n ?? 0;
    const activeMatters = matterActiveRow?.n ?? 0;
    const clientsActive = clientsActiveRow?.n ?? 0;
    const advocatesActive = seatsUsed;

    const revFy = Number(revFyRow?.total ?? 0);
    const revPrior = Number(revPriorRow?.total ?? 0);
    const revenueDeltaPct = revPrior === 0
      ? (revFy === 0 ? 0 : 100)
      : Math.round(((revFy - revPrior) / revPrior) * 100);

    const stages: CaseStageSlice[] = stageRows.map((r) => ({ stage: r.stage, count: r.n }));

    const totalCasesByType = typeRows.reduce((s, r) => s + r.n, 0) || 1;
    // Without a case→invoice link in the schema, revenue per practice area is
    // approximated by joining invoices to cases on the freeform `client`
    // column. Good enough for an overview; the value displayed is just the
    // matters count for now.
    const practiceAreas: PracticeAreaSlice[] = typeRows.map((r) => ({
      name: r.type,
      matters: r.n,
      revenue: '-',
      share: r.n / totalCasesByType,
    }));

    const members: FirmMember[] = memberRows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      initials: initialsFor(r.name),
      activeMatters: 0,   // no users↔cases assignment table yet
      billableHours: 0,   // no time-tracking table yet
      winRate: 0,         // no per-user case outcome link yet
      status: 'Active',
    }));

    const topClients: TopClient[] = clientAggRows.map((r) => ({
      name: r.client,
      billed: inrLabel(Number(r.total ?? 0)),
      matters: r.matters ?? 0,
      lastActivity: relativeFromIso(
        r.last_issued instanceof Date ? r.last_issued.toISOString() : r.last_issued,
      ),
    }));

    // Build a contiguous 12-month window so the chart renders a smooth axis
    // even if some months had zero invoices.
    const monthMap = new Map(monthRows.map((r) => [r.ym, Number(r.total ?? 0)]));
    const monthlyRevenue: MonthlyRevenuePoint[] = [];
    const start = new Date();
    start.setMonth(start.getMonth() - 11);
    start.setDate(1);
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const inr = monthMap.get(ym) ?? 0;
      monthlyRevenue.push({
        month: MONTHS[d.getMonth()] ?? '',
        value: Number((inr / 100_000).toFixed(1)), // store in lakhs for chart axis
      });
    }

    return {
      firm: { name: firmName, seats, seatsUsed, period: fy.label },
      stats: {
        totalMatters,
        activeMatters,
        revenueFY: inrLabel(revFy),
        revenueDeltaPct,
        billableHoursMonth: 0,
        realizationPct: 0,
        advocatesActive,
        clientsActive,
      },
      members,
      practiceAreas,
      topClients,
      caseStages: stages,
      monthlyRevenue,
      alerts: alertsList,
      hearingsToday,
    };
  },
};
