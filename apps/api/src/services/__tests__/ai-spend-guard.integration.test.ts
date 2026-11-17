/**
 * AI spend guard against real Postgres. Tests map to the acceptance criteria
 * (AC#) in build-docs/features/admin-ai-spend-guard.md.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { setPlatformPausedCache } from '../../lib/ai-pause';
import { aiSpendService } from '../ai-spend.service';
import { creditService } from '../credit.service';

const admin = { id: '', email: 'owner@example.test' };

async function paidFirm(name: string): Promise<{ firmId: string; userId: string }> {
  const sql = getIntegrationSql();
  const firm = await seedFirm(name, 'Solo');
  const userId = (await seedUser(firm.id)).id;
  await sql`update firms set plan_status = 'active', selected_plan = 'advocate', seats = 1, free_plan = false,
    renews_at = now() + interval '20 days' where id = ${firm.id}::uuid`;
  await creditService.balance(firm.id);
  return { firmId: firm.id, userId };
}

const ledgerRows = async (firmId: string) =>
  Number((await getIntegrationSql()<{ n: string }[]>`select count(*)::text as n from credit_ledger where firm_id = ${firmId}::uuid`)[0]!.n);

beforeEach(async () => {
  const sql = getIntegrationSql();
  await sql`delete from platform_settings`;
  await sql`delete from ai_token_usage`;
  setPlatformPausedCache(false);
  if (!admin.id) {
    const f = await seedFirm('Admin firm', 'Firm');
    admin.id = (await seedUser(f.id)).id;
    await sql`update users set is_superadmin = true, status = 'active' where id = ${admin.id}::uuid`;
  }
});

describe('AC4 platform AI pause', () => {
  it('pause refuses every charge with 503 ai_paused and takes no credits; resume restores it', async () => {
    const a = await paidFirm('Pause A');
    const before = (await creditService.balance(a.firmId)).balance;
    await aiSpendService.setPaused(true, admin, 'test pause');
    await expect(creditService.charge(a, 'research', 1)).rejects.toMatchObject({ status: 503, code: 'ai_paused' });
    await expect(creditService.assertAvailable(a, 1)).rejects.toMatchObject({ code: 'ai_paused' });
    expect(await ledgerRows(a.firmId)).toBe(0);
    expect((await creditService.balance(a.firmId)).balance).toBe(before);

    await aiSpendService.setPaused(false, admin, 'test resume');
    await creditService.charge(a, 'research', 1);
    expect((await creditService.balance(a.firmId)).balance).toBe(before - 1);
  });
});

describe('AC5 firm AI pause', () => {
  it('pausing one firm leaves other firms working', async () => {
    const a = await paidFirm('Firm pause A');
    const b = await paidFirm('Firm pause B');
    expect(await aiSpendService.setFirmPaused(a.firmId, true, admin)).toBe(true);
    await expect(creditService.charge(a, 'research', 1)).rejects.toMatchObject({ code: 'ai_paused' });
    await expect(creditService.charge(b, 'research', 1)).resolves.toMatchObject({ credits: 1 });
    await aiSpendService.setFirmPaused(a.firmId, false, admin);
    await expect(creditService.charge(a, 'research', 1)).resolves.toMatchObject({ credits: 1 });
  });

  it('unknown firm id returns false (404 at the route)', async () => {
    expect(await aiSpendService.setFirmPaused('00000000-0000-0000-0000-000000000000', true, admin)).toBe(false);
  });
});

describe('AC2/AC3 budget and alerts', () => {
  /** Spend `usd` this month in DifAi's estimate (Sonnet 5.5 output at $10/MTok). */
  async function spendUsd(usd: number) {
    await getIntegrationSql()`insert into ai_token_usage (feature, provider, model, tokens_in, tokens_out)
      values ('drafting', 'anthropic', 'claude-sonnet-5-5', 0, ${Math.round(usd * 100_000)})`;
  }

  it('without an admin key the estimate is shown and labelled', async () => {
    await spendUsd(3);
    const s = await aiSpendService.spend();
    expect(s.provider).toBeNull();
    expect(s.providerError).toMatch(/admin key not set/);
    expect(s.estimate.usd).toBeGreaterThan(0);
    expect(s.usedPct).toBeNull(); // no budget yet
  });

  it('alerts once at 80% and once at 100% per month, never repeated; auto-pause only when switched on', async () => {
    const sql = getIntegrationSql();
    await aiSpendService.updateSettings({ budgetUsd: 10, alertPcts: [100, 80] }, admin);
    expect((await aiSpendService.settings()).alertPcts).toEqual([80, 100]);
    const per = await aiSpendService.spend();
    const unit = per.estimate.usd; // 0 before any spend
    expect(unit).toBe(0);

    await spendUsd(8.5);
    expect((await aiSpendService.checkBudget()).sent).toEqual([80]);
    expect((await aiSpendService.checkBudget()).sent).toEqual([]); // hourly rerun: nothing new

    await spendUsd(2);
    expect((await aiSpendService.checkBudget()).sent).toEqual([100]);
    expect((await aiSpendService.checkBudget()).sent).toEqual([]);
    expect((await aiSpendService.spend()).paused).toBe(false); // autopause is off by default

    const notes = await sql`select title from notifications where user_id = ${admin.id}::uuid and dedupe_key like 'ai-budget:%'`;
    expect(notes).toHaveLength(2);
  });

  it('auto-pause at 100% when switched on, recorded in the audit log as system', async () => {
    const sql = getIntegrationSql();
    await aiSpendService.updateSettings({ budgetUsd: 1, autopause: true }, admin);
    await spendUsd(1.2);
    await aiSpendService.checkBudget();
    expect((await aiSpendService.spend()).paused).toBe(true);
    const [row] = await sql`select actor_email from audit_log where action = 'platform.ai.paused' order by created_at desc limit 1`;
    expect(row!.actor_email).toBe('system');
  });
});

describe('AC6 audit', () => {
  it('settings, platform pause and firm pause are all audited with the actor', async () => {
    const sql = getIntegrationSql();
    const a = await paidFirm('Audit firm');
    const t0 = (await sql<{ t0: Date }[]>`select clock_timestamp() as t0`)[0]!.t0;
    await aiSpendService.updateSettings({ budgetUsd: 50 }, admin);
    await aiSpendService.setPaused(true, admin, 'audit check');
    await aiSpendService.setPaused(false, admin, 'audit check');
    await aiSpendService.setFirmPaused(a.firmId, true, admin);
    const rows = await sql<{ action: string; actor_email: string }[]>`
      select action, actor_email from audit_log where action in
        ('platform.ai_spend.settings','platform.ai.paused','platform.ai.resumed','firm.ai.paused')
        and created_at >= ${t0}`; // earlier tests leave rows (e.g. the system auto-pause)
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['platform.ai_spend.settings', 'platform.ai.paused', 'platform.ai.resumed', 'firm.ai.paused']));
    expect(rows.every((r) => r.actor_email === admin.email)).toBe(true);
  });
});
