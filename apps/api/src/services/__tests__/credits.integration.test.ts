/**
 * AI credits against real Postgres (row locks, transactions, idempotency).
 * Tests map to build-docs/features/ai-credits.md acceptance criteria (AC#).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { creditService, CreditsExhaustedError } from '../credit.service';
import { draftMeterService } from '../draft-meter.service';

let firmId: string;
let userId: string;

/** A firm on Vakalat (75 credits a month), with `left` credits remaining. */
async function firmWith(left: number, plan = 'vakalat'): Promise<void> {
  const sql = getIntegrationSql();
  const firm = await seedFirm('Credits Firm', 'Solo');
  firmId = firm.id;
  userId = (await seedUser(firmId)).id;
  await sql`update firms set plan_status = 'active', selected_plan = ${plan}, seats = 1, free_plan = false,
    renews_at = now() + interval '20 days' where id = ${firmId}::uuid`;
  const b = await creditService.balance(firmId); // creates this month's grant
  await sql`update credit_grants set remaining = ${left} where firm_id = ${firmId}::uuid and source = 'plan'`;
  expect(b.allowance).toBeGreaterThan(0);
}
const ctx = () => ({ firmId, userId });
const balance = async () => (await creditService.balance(firmId)).balance;

describe('plan allowance', () => {
  beforeEach(() => firmWith(75));

  it('Vakalat gets 75 a month; the grant is created once per cycle', async () => {
    const sql = getIntegrationSql();
    await creditService.balance(firmId);
    await creditService.balance(firmId);
    const grants = await sql`select amount from credit_grants where firm_id = ${firmId}::uuid and source = 'plan'`;
    expect(grants).toHaveLength(1);
    expect(Number(grants[0]!.amount)).toBe(75);
  });

  it('an upgrade mid-cycle adds the difference, not a second full grant; a downgrade keeps the bigger grant', async () => {
    const sql = getIntegrationSql();
    await creditService.charge(ctx(), 'research', 2);
    await sql`update firms set selected_plan = 'brief' where id = ${firmId}::uuid`;
    const up = await creditService.balance(firmId);
    expect(up.allowance).toBe(200);
    expect(up.balance).toBe(198); // 73 left + 125 more
    await sql`update firms set selected_plan = 'sanad' where id = ${firmId}::uuid`;
    expect((await creditService.balance(firmId)).allowance).toBe(200);
  });

  it('a free-launch account gets 25; an unpaid v4 sign-up gets none', async () => {
    const sql = getIntegrationSql();
    const free = await seedFirm('Free Firm', 'Solo');
    await sql`update firms set free_plan = true, plan_status = 'trial', trial_ends_at = '2027-06-01' where id = ${free.id}::uuid`;
    expect((await creditService.balance(free.id)).balance).toBe(25);
    const unpaid = await seedFirm('Unpaid Firm', 'Solo');
    await sql`update firms set free_plan = false, plan_status = 'trial', selected_plan = 'vakalat',
      trial_ends_at = now() + interval '30 minutes' where id = ${unpaid.id}::uuid`;
    expect((await creditService.balance(unpaid.id)).balance).toBe(0);
  });
});

describe('AC2/AC6 fixed costs', () => {
  it('with 0 credits every charge is refused (402) and nothing is taken', async () => {
    await firmWith(0);
    await expect(creditService.charge(ctx(), 'research', 2)).rejects.toBeInstanceOf(CreditsExhaustedError);
    await expect(creditService.charge(ctx(), 'draft_chat', 0.5)).rejects.toMatchObject({ status: 402, code: 'credits_exhausted' });
    expect(await balance()).toBe(0);
  });

  it('a failed AI call nets 0 (refund); a retried charge with the same key counts once', async () => {
    await firmWith(10);
    await expect(creditService.withCredits(ctx(), 'research', 2, async () => { throw new Error('model down'); })).rejects.toThrow('model down');
    expect(await balance()).toBe(10);
    await creditService.charge(ctx(), 'mock_arguments', 3, 'req-1');
    await creditService.charge(ctx(), 'mock_arguments', 3, 'req-1');
    expect(await balance()).toBe(7);
    await creditService.refund('req-1');
    await creditService.refund('req-1');
    expect(await balance()).toBe(10);
  });

  it('AC7 two concurrent ½-credit questions with ½ left: exactly one succeeds', async () => {
    await firmWith(0.5);
    const results = await Promise.allSettled([
      creditService.charge(ctx(), 'matter_chat', 0.5),
      creditService.charge(ctx(), 'matter_chat', 0.5),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance()).toBe(0);
  });

  it('spends the soonest-expiring credits first: plan before a Brief Pack', async () => {
    await firmWith(1);
    await creditService.addGrant({ firmId, source: 'topup', amount: 25, ref: `topup:t-${firmId}`, expiresAt: new Date(Date.now() + 300 * 86_400_000) });
    await creditService.charge(ctx(), 'research', 2);
    const sql = getIntegrationSql();
    const rows = await sql`select source, remaining from credit_grants where firm_id = ${firmId}::uuid order by source`;
    expect(rows.map((r) => [r.source, Number(r.remaining)])).toEqual([['plan', 0], ['topup', 24]]);
  });
});

describe('AC3/AC5 drafted pages past the balance are locked, then unlocked', () => {
  const words = (p: number, n: number) => Array.from({ length: n }, (_, i) => `p${p}w${i}`).join(' ');
  /** Six distinct 400-word paragraphs = 6 pages. */
  const sixPages = Array.from({ length: 6 }, (_, p) => words(p, 400)).join('\n\n');

  it('a 6-page draft with 3 credits: 3 charged, ~1,200 words sent, the rest held; unlock takes 3 and returns it', async () => {
    await firmWith(3);
    const out = await draftMeterService.text(ctx(), sixPages);
    expect(out.locked?.lockedCredits).toBe(3);
    expect(await balance()).toBe(0);
    const visible = out.text.split('[The rest of this draft is locked')[0]!;
    expect(visible.match(/\S+/g)!.length).toBe(1200);
    expect(out.text).not.toContain('p3w0'); // page 4 onwards never leaves the server
    expect(out.text).toContain('p2w399');

    await expect(creditService.unlock(ctx(), out.locked!.draftKey)).rejects.toMatchObject({ code: 'credits_exhausted' });
    await creditService.addGrant({ firmId, source: 'admin', amount: 3, ref: `admin:a-${firmId}`, expiresAt: new Date(Date.now() + 86_400_000) });
    const un = await creditService.unlock(ctx(), out.locked!.draftKey);
    expect((un.payload as { text: string }).text).toBe(sixPages);
    expect(await balance()).toBe(0);
    // A second unlock charges nothing.
    await creditService.unlock(ctx(), out.locked!.draftKey);
    expect(await balance()).toBe(0);
  });

  it('re-metering the same draft is free; only growth past the paid pages costs', async () => {
    await firmWith(10);
    const key = `intake:m-${firmId}:Plaint`;
    await creditService.meterDraft(ctx(), key, 800);   // 2 pages
    await creditService.meterDraft(ctx(), key, 790);   // same draft re-rendered
    expect(await balance()).toBe(8);
    await creditService.meterDraft(ctx(), key, 1000);  // grew to 2.5 pages
    expect(await balance()).toBe(7.5);
  });

  it("another firm can't unlock (or even see) this firm's draft", async () => {
    await firmWith(1);
    const out = await draftMeterService.text(ctx(), sixPages);
    const other = await seedFirm('Other Firm', 'Solo');
    await expect(creditService.unlock({ firmId: other.id, userId: null }, out.locked!.draftKey)).rejects.toMatchObject({ status: 404 });
  });
});
