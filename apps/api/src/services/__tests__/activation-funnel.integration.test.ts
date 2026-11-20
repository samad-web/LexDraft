/**
 * Activation funnel against real Postgres. Tests map to the acceptance
 * criteria (AC#) and edge cases in build-docs/features/activation-funnel.md.
 * Seeded firms sit in a past week (5 weeks back) so other firms never mix in.
 */
import { describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { env } from '../../env';
import { firm360Service } from '../firm360.service';

const WEEKS_BACK = 5;

/** A Wednesday noon (IST) WEEKS_BACK weeks ago, so the firm lands mid-week. */
async function weekStart(): Promise<{ monday: string; wednesday: Date }> {
  const sql = getIntegrationSql();
  const [r] = await sql<{ monday: string; wed: Date }[]>`
    select to_char(date_trunc('week', now() at time zone 'Asia/Kolkata') - make_interval(weeks => ${WEEKS_BACK}), 'YYYY-MM-DD') as monday,
           ((date_trunc('week', now() at time zone 'Asia/Kolkata') - make_interval(weeks => ${WEEKS_BACK}) + interval '2 days 12 hours') at time zone 'Asia/Kolkata') as wed`;
  return { monday: r!.monday, wednesday: r!.wed };
}

const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

async function firm(name: string, at: Date, o: { email?: string; superadmin?: boolean; free?: boolean } = {}) {
  const sql = getIntegrationSql();
  const f = await seedFirm(name, 'Solo');
  const u = await seedUser(f.id, o.email ? { email: o.email } : {});
  await sql`update firms set created_at = ${at}, free_plan = ${o.free ?? false} where id = ${f.id}::uuid`;
  if (o.superadmin) await sql`update users set is_superadmin = true where id = ${u.id}::uuid`;
  return { firmId: f.id, userId: u.id };
}

async function pay(firmId: string, at: Date, kind = 'subscription_active') {
  await getIntegrationSql()`insert into billing_events (firm_id, kind, provider, created_at) values (${firmId}::uuid, ${kind}, 'razorpay', ${at})`;
}

async function draft(firmId: string, userId: string, at: Date) {
  await getIntegrationSql()`insert into drafts (firm_id, user_id, title, doc_type, created_at) values (${firmId}::uuid, ${userId}::uuid, 'Funnel draft', 'notice', ${at})`;
}

async function row() {
  const { monday } = await weekStart();
  const out = await firm360Service.activation();
  return { out, w: out.weeks.find((x) => x.weekStart === monday)! };
}

describe('AC1 funnel steps for the last 8 weekly cohorts', () => {
  it('always returns 8 weeks, newest first, empty weeks as 0 (edge: empty cohort)', async () => {
    const { out } = await row();
    expect(out.weeks).toHaveLength(8);
    const sorted = [...out.weeks].map((w) => w.weekStart).sort().reverse();
    expect(out.weeks.map((w) => w.weekStart)).toEqual(sorted);
    for (const w of out.weeks) expect(w.signedUp).toBeGreaterThanOrEqual(0);
  });

  it('counts signed up → paid → first draft → active in week 2 → paid again', async () => {
    const { wednesday: t } = await weekStart();
    const before = (await row()).w;

    // A: paid on day 0, drafted on day 1 and again on day 9 (week 2), renewed.
    const a = await firm('Funnel A', t);
    await pay(a.firmId, t);
    await draft(a.firmId, a.userId, days(t, 1));
    await draft(a.firmId, a.userId, days(t, 9));
    await pay(a.firmId, days(t, 30), 'renewed');
    // B: paid, drafted on day 1 only (not active in week 2).
    const b = await firm('Funnel B', t);
    await pay(b.firmId, t);
    await draft(b.firmId, b.userId, days(t, 1));
    // C: signed up, never paid.
    await firm('Funnel C', t);

    const { w } = await row();
    expect(w.signedUp - before.signedUp).toBe(3);
    expect(w.paid - before.paid).toBe(2);
    expect(w.firstDraft - before.firstDraft).toBe(2);
    expect(w.week2Due - before.week2Due).toBe(2);
    expect(w.activeWeek2 - before.activeWeek2).toBe(1);
    expect(w.paidAgain - before.paidAgain).toBe(1);
  });

  it('activity on day 15 or day 6 does not count as week 2', async () => {
    const { wednesday: t } = await weekStart();
    const before = (await row()).w;
    const d = await firm('Funnel D', t);
    await pay(d.firmId, t);
    await draft(d.firmId, d.userId, days(t, 6));
    await draft(d.firmId, d.userId, days(t, 15));
    const { w } = await row();
    expect(w.activeWeek2 - before.activeWeek2).toBe(0);
    expect(w.week2Due - before.week2Due).toBe(1);
  });

  it('week 2 not over yet → not in week2Due (this week\'s sign-ups)', async () => {
    const out0 = await firm360Service.activation();
    const e = await firm('Funnel recent', new Date());
    await pay(e.firmId, new Date());
    const out1 = await firm360Service.activation();
    expect(out1.weeks[0]!.paid - out0.weeks[0]!.paid).toBe(1);
    expect(out1.weeks[0]!.week2Due - out0.weeks[0]!.week2Due).toBe(0);
  });
});

describe('Edge: excluded firms', () => {
  it('superadmin, test-coupon and free-launch firms are left out', async () => {
    const { wednesday: t } = await weekStart();
    const before = (await row()).w;
    const testEmail = 'funnel-test@integration.test';
    const prev = env.razorpay.testEmails.slice();
    env.razorpay.testEmails.push(testEmail);
    try {
      await firm('Funnel superadmin', t, { superadmin: true });
      await firm('Funnel test account', t, { email: testEmail });
      await firm('Funnel free launch', t, { free: true });
      const { w } = await row();
      expect(w.signedUp - before.signedUp).toBe(0);
    } finally {
      env.razorpay.testEmails.splice(0, env.razorpay.testEmails.length, ...prev);
    }
  });

  it('a multi-seat firm counts once', async () => {
    const { wednesday: t } = await weekStart();
    const before = (await row()).w;
    const m = await firm('Funnel multi-seat', t);
    await seedUser(m.firmId);
    await seedUser(m.firmId);
    await pay(m.firmId, t);
    const { w } = await row();
    expect(w.signedUp - before.signedUp).toBe(1);
    expect(w.paid - before.paid).toBe(1);
  });
});
