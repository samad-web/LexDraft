import type { Alert, DashboardSummary } from '@lexdraft/types';
import { casesService } from './cases.service';
import { hearingsService } from './hearings.service';
import { documentsService } from './documents.service';
import { authService } from './auth.service';
import { db } from '../db/client';
import { SEED_ALERTS } from '../data/seed';

interface AlertRow {
  id: string;
  tone: Alert['type'];
  text: string;
  detail: string;
}

async function listAlerts(): Promise<Alert[]> {
  const sql = db();
  if (sql) {
    const rows = await sql<AlertRow[]>`
      select id, tone, text, detail from alerts order by created_at desc
    `;
    return rows.map((r) => ({ id: r.id, type: r.tone, text: r.text, detail: r.detail }));
  }
  return SEED_ALERTS;
}

export const dashboardService = {
  async summary(userId?: string): Promise<DashboardSummary> {
    const [cases, hearings, alerts, docs, user] = await Promise.all([
      casesService.list(),
      hearingsService.listToday(),
      listAlerts(),
      documentsService.list(),
      userId ? authService.getById(userId) : Promise.resolve(undefined),
    ]);
    const clientNames = new Set(cases.map((c) => c.client).filter((n) => n && n.trim()));
    return {
      user: { name: user?.name ?? '', role: user?.role ?? '' },
      hearings,
      alerts,
      recentDocs: docs.slice(0, 4),
      stats: {
        activeMatters: cases.filter((c) => c.status === 'Active').length,
        clients: clientNames.size,
        unread: alerts.length,
        revenueFY: '—',
      },
    };
  },
};
