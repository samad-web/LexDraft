import crypto from 'node:crypto';
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

/** A firm on Advocate (150 credits a month, pricing v5), with `left` credits remaining. */
async function firmWith(left: number, plan = 'advocate'): Promise<void> {
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

  it('Advocate gets 150 a month; the grant is created once per cycle', async () => {
    const sql = getIntegrationSql();
    await creditService.balance(firmId);
    await creditService.balance(firmId);
    const grants = await sql`select amount from credit_grants where firm_id = ${firmId}::uuid and source = 'plan'`;
    expect(grants).toHaveLength(1);
    expect(Number(grants[0]!.amount)).toBe(150);
  });

  it('an upgrade mid-cycle adds the difference, not a second full grant; a downgrade keeps the bigger grant', async () => {
    const sql = getIntegrationSql();
    await creditService.charge(ctx(), 'research', 2);
    await sql`update firms set selected_plan = 'chambers' where id = ${firmId}::uuid`;
    const up = await creditService.balance(firmId);
    expect(up.allowance).toBe(350);
    expect(up.balance).toBe(273); // 73 left + 200 more
    await sql`update firms set selected_plan = 'advocate' where id = ${firmId}::uuid`;
    expect((await creditService.balance(firmId)).allowance).toBe(350);
  });

  it('found live 2026-11-14: a free-launch account that starts paying mid-month keeps only the new plan credits', async () => {
    const sql = getIntegrationSql();
    const f = await seedFirm('Switch Firm', 'Solo');
    await sql`update firms set free_plan = true, plan_status = 'trial', trial_ends_at = '2027-06-01' where id = ${f.id}::uuid`;
    expect((await creditService.balance(f.id)).balance).toBe(25); // calendar-month free grant
    await sql`update firms set free_plan = false, plan_status = 'active', selected_plan = 'advocate',
      renews_at = now() + interval '30 days' where id = ${f.id}::uuid`;
    const b = await creditService.balance(f.id); // new cycle anchored on the paid-until day
    expect(b.balance).toBe(150); // the free month's 25 end; only the plan's own credits
    expect(b.allowance).toBe(150);
  });

  it('a free-launch account gets 25; an unpaid sign-up gets none', async () => {
    const sql = getIntegrationSql();
    const free = await seedFirm('Free Firm', 'Solo');
    await sql`update firms set free_plan = true, plan_status = 'trial', trial_ends_at = '2027-06-01' where id = ${free.id}::uuid`;
    expect((await creditService.balance(free.id)).balance).toBe(25);
    const unpaid = await seedFirm('Unpaid Firm', 'Solo');
    await sql`update firms set free_plan = false, plan_status = 'trial', selected_plan = 'advocate',
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

// credits-not-pages.md (owner 2026-11-17): drafts are charged in credits and
// never cut into locked pages. Replaces the old "pages past the balance are
// locked" tests (that rule was retired by the owner).
describe('credits-not-pages: a draft is delivered whole, or refused up front', () => {
  const words = (p: number, n: number) => Array.from({ length: n }, (_, i) => `p${p}w${i}`).join(' ');
  /** Six distinct 400-word paragraphs = 6 credits. */
  const sixPages = Array.from({ length: 6 }, (_, p) => words(p, 400)).join('\n\n');

  it('AC2 a new 6-credit draft with 3 left: delivered whole, balance 0, 3 absorbed and logged', async () => {
    await firmWith(3);
    const out = await draftMeterService.text(ctx(), sixPages);
    expect(out.locked).toBeUndefined();
    expect(out.text).toBe(sixPages);
    expect(await balance()).toBe(0);
    const [row] = await getIntegrationSql()<{ credits: string; meta: { absorbed?: number } }[]>`
      select credits, meta from credit_ledger where firm_id = ${firmId}::uuid and action = 'draft'`;
    expect(Number(row!.credits)).toBe(3);
    expect(row!.meta.absorbed).toBe(3);
  });

  it('AC3 a new 6-credit draft with only 2 left (under half): 402, nothing charged, nothing stored', async () => {
    await firmWith(2);
    await expect(draftMeterService.text(ctx(), sixPages)).rejects.toMatchObject({ status: 402, code: 'credits_exhausted' });
    expect(await balance()).toBe(2);
    const rows = await getIntegrationSql()`select 1 from metered_drafts where firm_id = ${firmId}::uuid`;
    expect(rows).toHaveLength(0);
  });

  it('re-metering the same draft is free; only growth past what it paid costs', async () => {
    await firmWith(10);
    const key = `intake:m-${firmId}:Plaint`;
    await creditService.meterDraft(ctx(), key, 800);   // 2 credits
    await creditService.meterDraft(ctx(), key, 790);   // same draft re-rendered
    expect(await balance()).toBe(8);
    await creditService.meterDraft(ctx(), key, 1000);  // grew to 2.5
    expect(await balance()).toBe(7.5);
  });

  it('AC4 a re-render that grows past the pool: 402 and the stored draft stays as it was', async () => {
    await firmWith(2);
    const key = `intake:m-${firmId}:Notice`;
    await creditService.meterDraft(ctx(), key, 800); // 2 credits, pool 0
    await expect(creditService.meterDraft(ctx(), key, 1600)).rejects.toMatchObject({ code: 'credits_exhausted' });
    const [m] = await getIntegrationSql()<{ paid: string; needed: string }[]>`select paid, needed from metered_drafts where ref_key = ${key}`;
    expect(Number(m!.paid)).toBe(2);
    expect(Number(m!.needed)).toBe(2);
  });

  it('a streamed draft (already shown) is never refused: pool to 0, rest absorbed', async () => {
    await firmWith(0.5);
    await creditService.meterDraft(ctx(), `text:${crypto.randomUUID()}`, 2400, null, { delivered: true });
    expect(await balance()).toBe(0);
  });

  it("an old locked draft: another firm can't unlock (or even see) it", async () => {
    await firmWith(1);
    const key = `text:${crypto.randomUUID()}`;
    await getIntegrationSql()`insert into metered_drafts (ref_key, firm_id, needed, paid, total_words, payload)
      values (${key}, ${firmId}::uuid, 6, 1, 2400, ${getIntegrationSql().json({ text: sixPages })})`;
    const other = await seedFirm('Other Firm', 'Solo');
    await expect(creditService.unlock({ firmId: other.id, userId: null }, key)).rejects.toMatchObject({ status: 404 });
  });
});
