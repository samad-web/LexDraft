/**
 * Firm 360 + business overview against real Postgres. Tests map to the
 * acceptance criteria (AC#) in build-docs/features/admin-firm-360.md.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { adminService } from '../admin.service';
import { creditService } from '../credit.service';
import { firm360Service, planName } from '../firm360.service';

const admin = { id: '', email: 'owner@example.test' };

async function firmOn(name: string, o: { plan: string; mrr: number; renewsInDays: number; status?: string; free?: boolean; planStatus?: string; createdMinsAgo?: number }) {
  const sql = getIntegrationSql();
  const f = await seedFirm(name, 'Solo');
  await sql`update firms set selected_plan = ${o.plan}, mrr_inr = ${o.mrr}, plan_status = ${o.planStatus ?? 'active'}::billing_status,
    free_plan = ${o.free ?? false}, status = ${o.status ?? 'active'}::firm_status, seats = 1,
    renews_at = now() + make_interval(days => ${o.renewsInDays}),
    created_at = now() - make_interval(mins => ${o.createdMinsAgo ?? 600})
    where id = ${f.id}::uuid`;
  return f.id;
}

beforeEach(async () => {
  const sql = getIntegrationSql();
  await sql`update firms set status = 'suspended'::firm_status`; // isolate each test's counts
  if (!admin.id) {
    const a = await seedFirm('Admin firm', 'Firm');
    admin.id = (await seedUser(a.id)).id;
    await sql`update firms set status = 'suspended'::firm_status where id = ${a.id}::uuid`;
  }
});

describe('AC1 overview: plan mix and MRR count only paid, running plans', () => {
  it('expired, free-launch and suspended firms add nothing to MRR; ARR = 12 × MRR; overview MRR = stats MRR', async () => {
    await firmOn('Paid A', { plan: 'advocate', mrr: 699, renewsInDays: 20 });
    await firmOn('Paid B', { plan: 'chambers', mrr: 1699, renewsInDays: 3 });
    await firmOn('Expired', { plan: 'advocate', mrr: 699, renewsInDays: -2 });
    await firmOn('Free launch', { plan: 'free', mrr: 0, renewsInDays: 100, free: true });
    await firmOn('Suspended', { plan: 'law_firm', mrr: 3699, renewsInDays: 20, status: 'suspended' });
    const o = await firm360Service.overview();
    expect(o.mrrInr).toBe(699 + 1699);
    expect(o.arrInr).toBe((699 + 1699) * 12);
    expect((await adminService.platformStats()).mrrInr).toBe(o.mrrInr);
    const adv = o.planMix.find((p) => p.plan === 'advocate')!;
    expect(adv).toMatchObject({ label: 'Advocate', firms: 2, paidFirms: 1, mrrInr: 699 });
    expect(o.planMix.find((p) => p.plan === 'free_launch')!.label).toBe('Free launch');
  });
});

describe('AC2 ending soon + stuck sign-ups', () => {
  it('lists plans ending within 7 days and paid sign-ups that never paid (older than 30 min)', async () => {
    await firmOn('Ends in 3', { plan: 'chambers', mrr: 1699, renewsInDays: 3 });
    await firmOn('Ends in 20', { plan: 'advocate', mrr: 699, renewsInDays: 20 });
    await firmOn('Stuck', { plan: 'advocate', mrr: 0, renewsInDays: 0, planStatus: 'trial' });
    await firmOn('Just signed up', { plan: 'advocate', mrr: 0, renewsInDays: 0, planStatus: 'trial', createdMinsAgo: 5 });
    const o = await firm360Service.overview();
    expect(o.endingSoon.map((e) => e.name)).toEqual(['Ends in 3']);
    expect(o.stuckSignups.map((s) => s.name)).toEqual(['Stuck']);
  });

  it('firms list carries the plan name and credits left', async () => {
    const id = await firmOn('Listed', { plan: 'advocate', mrr: 699, renewsInDays: 20 });
    await creditService.balance(id); // opens the 150-credit grant
    const f = (await adminService.listFirms()).find((x) => x.id === id)!;
    expect(f).toMatchObject({ planName: 'Advocate', creditsLeft: 150 });
    expect(planName('enterprise', 'Acme', false)).toBe('Acme (custom)');
    expect(planName('sanad', null, false)).toBe('Sanad (v4)');
  });
});

describe('AC3 Firm 360 actions', () => {
  it('extend by 1 month: renews_at moves a month, no extra plan credits, audited', async () => {
    const sql = getIntegrationSql();
    const id = await firmOn('Extend me', { plan: 'advocate', mrr: 699, renewsInDays: 10 });
    await creditService.balance(id);
    await creditService.charge({ firmId: id, userId: null }, 'research', 20);
    const before = (await creditService.balance(id)).balance;
    const [r0] = await sql<{ renews_at: Date }[]>`select renews_at from firms where id = ${id}::uuid`;
    const r = await firm360Service.extend(id, 1, 'Goodwill after outage', admin);
    const months = (new Date(r.renewsAt).getUTCMonth() - r0!.renews_at.getUTCMonth() + 12) % 12;
    expect(months).toBe(1);
    expect((await creditService.balance(id)).balance).toBe(before);
    const grants = await sql`select id from credit_grants where firm_id = ${id}::uuid and source = 'plan'`;
    expect(grants).toHaveLength(1);
    const audit = await sql`select payload from audit_log where action = 'firm.plan.extend' and target_id = ${id}`;
    expect(audit).toHaveLength(1);
  });

  it('suspended firm and free-launch firm cannot be extended; unknown firm 404', async () => {
    const s = await firmOn('Susp', { plan: 'advocate', mrr: 699, renewsInDays: 10, status: 'suspended' });
    await expect(firm360Service.extend(s, 1, 'test', admin)).rejects.toMatchObject({ code: 'firm_suspended' });
    const f = await firmOn('Free', { plan: 'free', mrr: 0, renewsInDays: 10, free: true });
    await expect(firm360Service.extend(f, 1, 'test', admin)).rejects.toMatchObject({ code: 'not_extendable' });
    await expect(firm360Service.extend('00000000-0000-0000-0000-000000000000', 1, 'test', admin)).rejects.toMatchObject({ status: 404 });
  });

  it('payments list events (incl. manual notes) and the ledger pages 50 at a time', async () => {
    const sql = getIntegrationSql();
    const id = await firmOn('Ledger', { plan: 'law_firm', mrr: 3699, renewsInDays: 20 });
    await sql`insert into billing_events (firm_id, kind, plan, cycle, amount_paise, provider, provider_ref, note)
      values (${id}::uuid, 'subscription_active', 'enterprise', 'annual', 2950000, 'manual', 'manual:x', 'UPI · Ref 1')`;
    const p = await firm360Service.payments(id);
    expect(p.events[0]).toMatchObject({ provider: 'manual', note: 'UPI · Ref 1', amountInr: 29500 });
    await creditService.balance(id);
    for (let i = 0; i < 55; i++) await creditService.charge({ firmId: id, userId: null }, 'research', 0.5);
    await sql`update credit_ledger set created_at = created_at - make_interval(secs => (random() * 1000)::int) where firm_id = ${id}::uuid`;
    const page1 = await firm360Service.ledger(id);
    expect(page1.items).toHaveLength(50);
    expect(page1.next).not.toBeNull();
    const page2 = await firm360Service.ledger(id, page1.next!);
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
    expect(page2.next).toBeNull();
  });
});
