import type { Alert, DashboardSummary, DocumentRecord } from '@lexdraft/types';
import { casesService } from './cases.service';
import { hearingsService } from './hearings.service';
import { documentsService } from './documents.service';
import { draftsService } from './drafts.service';
import { authService } from './auth.service';
import { firmIdForUser } from './tenant';
import { fyBoundaries, inrLabel } from './firm.service';
import { db } from '../db/client';
import { SEED_ALERTS } from '../data/seed';

interface AlertRow {
  id: string;
  tone: Alert['type'];
  text: string;
  detail: string;
}

async function listAlerts(firmId: string | null): Promise<Alert[]> {
  if (!firmId) return [];
  const sql = db();
  if (sql) {
    const rows = await sql<AlertRow[]>`
      select id, tone, text, detail
      from alerts
      where firm_id = ${firmId}::uuid
      order by created_at desc
    `;
    return rows.map((r) => ({ id: r.id, type: r.tone, text: r.text, detail: r.detail }));
  }
  return SEED_ALERTS;
}

/** Active clients and invoiced revenue for the current Indian FY (Apr-Mar). */
async function clientAndRevenueTotals(
  firmId: string | null,
): Promise<{ clients: number; revenueFY: number } | null> {
  if (!firmId) return null;
  const sql = db();
  if (!sql) return null;
  const fy = fyBoundaries();
  const [[clientRow], [revRow]] = await Promise.all([
    sql<Array<{ n: number }>>`
      select count(*)::int as n from clients
      where firm_id = ${firmId}::uuid and status = 'active'
    `,
    sql<Array<{ total: number | string | null }>>`
      select coalesce(sum(amount_inr), 0)::bigint as total from invoices
      where firm_id = ${firmId}::uuid
        and issued_date between ${fy.startCurrent} and ${fy.endCurrent}
    `,
  ]);
  return { clients: clientRow?.n ?? 0, revenueFY: Number(revRow?.total ?? 0) };
}

function relativeFromIso(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '-';
  const diff = Date.now() - then;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.round(mon / 12)}y ago`;
}

export const dashboardService = {
  async summary(userId?: string): Promise<DashboardSummary> {
    // Resolve the caller's firm once and pass it to every downstream read so
    // the dashboard never returns rows that don't belong to this tenant.
    const firmId = await firmIdForUser(userId);

    const [cases, hearings, alerts, docs, drafts, user] = await Promise.all([
      casesService.list({ firmId }),
      hearingsService.listToday(firmId),
      listAlerts(firmId),
      documentsService.list(firmId),
      userId ? draftsService.list({ userId }) : Promise.resolve([]),
      userId ? authService.getById(userId) : Promise.resolve(undefined),
    ]);
    const draftDocs: DocumentRecord[] = drafts.map((d) => ({
      id: d.id,
      name: d.title,
      type: d.docType,
      case: '-',
      updated: relativeFromIso(d.updatedAt),
    }));
    const merged: DocumentRecord[] = [...draftDocs, ...docs].slice(0, 4);
    const clientNames = new Set(cases.map((c) => c.client).filter((n) => n && n.trim()));
    const totals = await clientAndRevenueTotals(firmId);
    return {
      user: { name: user?.name ?? '', role: user?.role ?? '' },
      hearings,
      myHearings: hearings.filter((h) => !h.assignedToUserId || h.assignedToUserId === userId),
      alerts,
      recentDocs: merged,
      stats: {
        activeMatters: cases.filter((c) => c.status === 'Active').length,
        // Prefer the clients directory; fall back to names on matters for
        // firms that never filled it in.
        clients: totals?.clients || clientNames.size,
        unread: alerts.length,
        revenueFY: totals ? inrLabel(totals.revenueFY) : '-',
      },
    };
  },
};
