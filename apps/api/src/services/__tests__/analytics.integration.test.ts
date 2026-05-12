/**
 * analyticsService — read-after-MV-refresh integration coverage.
 *
 * The summary endpoint reads four materialized views (0021_analytics_views).
 * Without an explicit REFRESH after a write, the views remain empty for a
 * fresh schema — so we:
 *
 *   1. Seed cases + invoices for two firms.
 *   2. Call analyticsRefreshService.refreshAll() — this is the same code
 *      path the pg-boss cron and the on-demand admin endpoint use.
 *   3. Read analyticsService.summary(firmId) and assert the aggregates match.
 *
 * Bonus: assert firm B's rows don't leak into firm A's summary.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { analyticsRefreshService } from '../analytics-refresh.service';
import { analyticsService } from '../analytics.service';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, type SeededFirm } from '../../__tests__/integration-fixtures';

let firmA: SeededFirm;
let firmB: SeededFirm;

async function seedCase(
  firmId: string,
  opts: { cnr: string; stage: string; status?: 'Active' | 'Closed'; outcome?: string | null },
): Promise<void> {
  const sql = getIntegrationSql();
  await sql`
    insert into cases (firm_id, cnr, title, court, stage, client, status, type, outcome)
    values (
      ${firmId}::uuid, ${opts.cnr}, ${'Test Case ' + opts.cnr}, 'Test HC',
      ${opts.stage}, 'Test Client',
      ${opts.status ?? 'Active'}::case_status,
      'civil',
      ${opts.outcome ?? null}::case_outcome
    )
  `;
}

async function seedInvoice(
  firmId: string,
  opts: { invoiceNo: string; amount: number; year: number; month: number; status?: 'paid' | 'pending' | 'overdue' },
): Promise<void> {
  const sql = getIntegrationSql();
  const issuedDate = `${opts.year}-${String(opts.month).padStart(2, '0')}-15`;
  const dueDate = `${opts.year}-${String(opts.month).padStart(2, '0')}-28`;
  await sql`
    insert into invoices (firm_id, invoice_no, client, amount_inr, issued_date, due_date, status)
    values (
      ${firmId}::uuid, ${opts.invoiceNo}, 'Test Client', ${opts.amount},
      ${issuedDate}::date, ${dueDate}::date,
      ${opts.status ?? 'paid'}::invoice_status
    )
  `;
}

beforeAll(async () => {
  firmA = await seedFirm('Analytics Firm A', 'Firm');
  firmB = await seedFirm('Analytics Firm B', 'Firm');

  // Firm A: 3 active cases (2 Pleadings, 1 Trial), 1 closed (Won), 1 closed (Lost).
  await seedCase(firmA.id, { cnr: 'A/CN-1', stage: 'Pleadings' });
  await seedCase(firmA.id, { cnr: 'A/CN-2', stage: 'Pleadings' });
  await seedCase(firmA.id, { cnr: 'A/CN-3', stage: 'Trial' });
  await seedCase(firmA.id, { cnr: 'A/CN-4', stage: 'Judgment', status: 'Closed', outcome: 'Won' });
  await seedCase(firmA.id, { cnr: 'A/CN-5', stage: 'Judgment', status: 'Closed', outcome: 'Lost' });

  // Firm B: 1 active, just to prove firm-scoping.
  await seedCase(firmB.id, { cnr: 'B/CN-1', stage: 'Pleadings' });
  await seedCase(firmB.id, { cnr: 'B/CN-2', stage: 'Pleadings' });

  // Firm A invoices — current year so they roll into YTD.
  const currentYear = new Date().getFullYear();
  await seedInvoice(firmA.id, { invoiceNo: 'INV-A-1', amount: 100_000, year: currentYear, month: 1 });
  await seedInvoice(firmA.id, { invoiceNo: 'INV-A-2', amount: 200_000, year: currentYear, month: 2 });
  await seedInvoice(firmA.id, { invoiceNo: 'INV-A-3', amount: 300_000, year: currentYear, month: 3, status: 'pending' });

  await seedInvoice(firmB.id, { invoiceNo: 'INV-B-1', amount: 999_999, year: currentYear, month: 1 });

  // Refresh the four MVs so the read paths return rows.
  const results = await analyticsRefreshService.refreshAll();
  // Surface a meaningful error if a refresh failed (e.g. CONCURRENTLY needs an
  // existing populated view).
  for (const r of results) {
    if (!r.ok) {
      throw new Error(`MV ${r.view} failed to refresh: ${r.error}`);
    }
  }
});

describe('analyticsService.summary', () => {
  it('returns the empty shape for null firmId', async () => {
    const out = await analyticsService.summary(null);
    expect(out.kpis.activeMatters).toBe(0);
    expect(out.stages).toEqual([]);
  });

  it('computes active matters + stages for firm A only', async () => {
    const out = await analyticsService.summary(firmA.id);
    expect(out.kpis.activeMatters).toBe(3);
    // Stages: Pleadings(2), Trial(1) — order is by stage_count desc.
    const stageMap = new Map(out.stages.map((s) => [s.label, s.count]));
    expect(stageMap.get('Pleadings')).toBe(2);
    expect(stageMap.get('Trial')).toBe(1);
  });

  it('win rate from closed cases: 1 Won / 2 total = 50%', async () => {
    const out = await analyticsService.summary(firmA.id);
    expect(out.kpis.winRatePct).toBe(50);
  });

  it('revenueYtdInr sums paid + pending invoices for the current year only', async () => {
    const out = await analyticsService.summary(firmA.id);
    // 100k + 200k + 300k = 600k total this year — service stores as integer.
    expect(out.kpis.revenueYtdInr).toBe(600_000);
  });

  it('firm A summary excludes firm B data', async () => {
    const outA = await analyticsService.summary(firmA.id);
    const outB = await analyticsService.summary(firmB.id);
    // Firm A active count must not include firm B's 2 actives.
    expect(outA.kpis.activeMatters).toBe(3);
    expect(outB.kpis.activeMatters).toBe(2);
    // Firm A revenue never includes firm B's 999_999.
    expect(outA.kpis.revenueYtdInr).toBe(600_000);
  });

  it('monthlyRevenue series renders 12 trailing months', async () => {
    const out = await analyticsService.summary(firmA.id);
    expect(out.monthlyRevenue).toHaveLength(12);
  });
});
