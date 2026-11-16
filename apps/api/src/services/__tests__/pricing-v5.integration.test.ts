/**
 * Migration 0113 (pricing v5) against real Postgres. Tests map to the
 * acceptance criteria (AC#) in build-docs/features/pricing-v5.md.
 * The schema already has every migration applied; each test seeds v4 rows and
 * runs 0113 again (it is idempotent), as prod will on deploy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { creditService } from '../credit.service';
import { invalidatePermissionsCache, resolveFeatures } from '../permissions.service';

const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../../../migrations/0113_pricing_v5.sql'), 'utf8');
const migrate = () => getIntegrationSql().unsafe(MIGRATION);

type Firm = { selected_plan: string; seats: number; plan_tier: string; mrr_inr: number; renews_at: Date; billing_cycle: string; munshi_seats: number; plan_status: string };
const firmRow = async (id: string): Promise<Firm> =>
  (await getIntegrationSql()<Firm[]>`select selected_plan, seats, plan_tier, mrr_inr, renews_at, billing_cycle, munshi_seats, plan_status from firms where id = ${id}::uuid`)[0]!;

async function v4Firm(plan: string, seats: number, o: { tier?: 'Solo' | 'Practice' | 'Firm'; active?: boolean; mrr?: number; munshi?: number } = {}) {
  const sql = getIntegrationSql();
  const f = await seedFirm(`v4 ${plan} ${seats}`, o.tier ?? 'Solo');
  await sql`update firms set selected_plan = ${plan}, seats = ${seats}, munshi_seats = ${o.munshi ?? 0},
    plan_status = ${o.active === false ? 'trial' : 'active'}::billing_status, free_plan = false, billing_cycle = 'monthly',
    renews_at = '2026-12-14T00:00:00Z', mrr_inr = ${o.mrr ?? 0} where id = ${f.id}::uuid`;
  return f.id;
}

describe('AC9 migration 0113 moves v4 firms to v5, keeping paid-until, cycle and Munshi seats', () => {
  it('Sanad -> Advocate (1 seat, Solo, MRR ex-GST); next balance call shows 150 credits this cycle; a move row is kept', async () => {
    const id = await v4Firm('sanad', 1, { mrr: 199, munshi: 1 });
    const sql = getIntegrationSql();
    // This cycle's v4 grant (25) exists before the move.
    await sql`update firms set selected_plan = 'sanad' where id = ${id}::uuid`;
    await migrate();
    const f = await firmRow(id);
    expect(f).toMatchObject({ selected_plan: 'advocate', seats: 1, plan_tier: 'Solo', mrr_inr: 169, billing_cycle: 'monthly', munshi_seats: 1, plan_status: 'active' });
    expect(f.renews_at.toISOString()).toBe('2026-12-14T00:00:00.000Z');
    expect((await creditService.balance(id)).allowance).toBe(150);
    const [move] = await sql`select old_plan, old_seats, old_mrr_inr from pricing_v5_moves where firm_id = ${id}::uuid`;
    expect(move).toMatchObject({ old_plan: 'sanad', old_seats: 1, old_mrr_inr: 199 });
  });

  it('a v4 grant this cycle is raised to the v5 allowance, not doubled (Sanad 25 -> 150)', async () => {
    const sql = getIntegrationSql();
    const f = await seedFirm('v4 grant', 'Solo');
    await sql`update firms set selected_plan = 'sanad', seats = 1, plan_status = 'active', free_plan = false,
      renews_at = now() + interval '20 days' where id = ${f.id}::uuid`;
    expect((await creditService.balance(f.id)).allowance).toBe(150); // already v5 code: fallback by tier
    await migrate();
    const grants = await sql`select amount from credit_grants where firm_id = ${f.id}::uuid and source = 'plan'`;
    expect(grants.map((g) => Number(g.amount))).toEqual([150]);
  });

  it.each([
    ['vakalat', 1, 'Solo', 'advocate', 1, 'Solo'],
    ['associates', 2, 'Practice', 'chambers', 3, 'Practice'],
    ['associates', 3, 'Practice', 'chambers', 3, 'Practice'],
    ['associates', 4, 'Practice', 'law_firm', 8, 'Firm'],
    ['associates', 8, 'Practice', 'law_firm', 8, 'Firm'],
    ['partners', 20, 'Firm', 'enterprise', 20, 'Firm'],
  ] as const)('%s with %i seats -> %s %s', async (plan, seats, tier, v5, v5seats, v5tier) => {
    const id = await v4Firm(plan, seats, { tier });
    await migrate();
    expect(await firmRow(id)).toMatchObject({ selected_plan: v5, seats: v5seats, plan_tier: v5tier });
  });

  it('an unpaid v4 sign-up is moved too (pre-selection only); v5, free and pre-v4 rows are untouched; re-running changes nothing', async () => {
    const sql = getIntegrationSql();
    const unpaid = await v4Firm('vakalat', 1, { active: false });
    const v5 = await v4Firm('chambers', 3, { tier: 'Practice', mrr: 1699 });
    const old = await v4Firm('practice', 5, { tier: 'Practice', mrr: 3000 });
    await migrate();
    await migrate();
    expect(await firmRow(unpaid)).toMatchObject({ selected_plan: 'advocate', plan_status: 'trial' });
    expect(await firmRow(v5)).toMatchObject({ selected_plan: 'chambers', seats: 3, mrr_inr: 1699 });
    expect(await firmRow(old)).toMatchObject({ selected_plan: 'practice', seats: 5, mrr_inr: 3000 });
    const [n] = await sql`select count(*)::int n from pricing_v5_moves where firm_id = ${unpaid}::uuid`;
    expect(n!.n).toBe(1);
  });
});

describe('AC10 the migration stops when a paying Brief firm would lose credits', () => {
  it('raises, and changes nothing', async () => {
    const sql = getIntegrationSql();
    const brief = await v4Firm('brief', 1, { mrr: 1499 });
    const sanad = await v4Firm('sanad', 1);
    await expect(migrate()).rejects.toThrow(/paying Brief firm/);
    expect((await firmRow(brief)).selected_plan).toBe('brief');
    expect((await firmRow(sanad)).selected_plan).toBe('sanad');
    // Not paying (lapsed) -> not guarded; the owner's answer was "move everyone".
    await sql`update firms set plan_status = 'cancelled' where id = ${brief}::uuid`;
    await migrate();
    expect((await firmRow(brief)).selected_plan).toBe('advocate');
  });
});

describe('AC17 analytics on every plan, never for a Munshi (0113)', () => {
  it('Advocate owner (Solo Advocate on the Solo tier) and Chambers owner see Firm Analytics; a Munshi does not', async () => {
    const solo = await seedFirm('Analytics Solo', 'Solo');
    const soloOwner = await seedUser(solo.id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    const soloMunshi = await seedUser(solo.id, { role: 'Munshi', systemRole: 'Munshi' });
    const chambers = await seedFirm('Analytics Chambers', 'Practice');
    const chambersOwner = await seedUser(chambers.id, { role: 'Managing Partner', systemRole: 'Firm Admin' });
    invalidatePermissionsCache();
    const has = async (id: string, key: string) => new Set((await resolveFeatures(id)).features).has(key as never);
    expect(await has(soloOwner.id, 'analytics.firm')).toBe(true);
    expect(await has(soloOwner.id, 'reports.activity')).toBe(true); // the page's data route
    expect(await has(chambersOwner.id, 'analytics.firm')).toBe(true);
    expect(await has(soloMunshi.id, 'analytics.firm')).toBe(false);
    // Still no firm admin surfaces on the Solo tier.
    expect(await has(soloOwner.id, 'admin.users')).toBe(false);
  });
});

describe('AC16 Enterprise credit allowance on a real firm', () => {
  it('firms.credit_allowance overrides the plan; clearing it falls back', async () => {
    const sql = getIntegrationSql();
    const f = await seedFirm('Enterprise Co', 'Firm');
    await sql`update firms set selected_plan = 'enterprise', seats = 25, plan_status = 'active', free_plan = false,
      renews_at = now() + interval '20 days', credit_allowance = 2500 where id = ${f.id}::uuid`;
    expect((await creditService.balance(f.id)).allowance).toBe(2500);
    await expect(sql`update firms set credit_allowance = -1 where id = ${f.id}::uuid`).rejects.toThrow();
  });
});
