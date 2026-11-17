/**
 * Per-user AI usage + DifAi-set monthly credit caps against real Postgres.
 * Tests map to the acceptance criteria (AC#) in build-docs/features/admin-per-user-usage.md.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { aiUsageReportService } from '../ai-usage-report.service';
import { creditService } from '../credit.service';

const admin = { id: '', email: 'owner@example.test' };
let firmId: string;
let a: string;
let b: string;

beforeEach(async () => {
  const sql = getIntegrationSql();
  if (!admin.id) {
    const f = await seedFirm('Admin firm', 'Firm');
    admin.id = (await seedUser(f.id)).id;
  }
  const firm = await seedFirm('Cap Chambers', 'Practice');
  firmId = firm.id;
  a = (await seedUser(firmId)).id;
  b = (await seedUser(firmId)).id;
  await sql`update firms set plan_status = 'active', selected_plan = 'chambers', seats = 3, free_plan = false,
    renews_at = now() + interval '20 days' where id = ${firmId}::uuid`;
  await creditService.balance(firmId); // 350 a month
});

const balance = async () => (await creditService.balance(firmId)).balance;

describe('AC2/AC3 a cap stops one user, not the firm', () => {
  it('cap 10: spends 10, the 11th credit is refused (402 user_cap_reached), pool untouched; colleague unaffected', async () => {
    expect(await creditService.setUserCap(a, 10, admin)).toBe(true);
    for (let i = 0; i < 5; i++) await creditService.charge({ firmId, userId: a }, 'research', 2);
    const before = await balance();
    await expect(creditService.charge({ firmId, userId: a }, 'research', 1)).rejects.toMatchObject({ status: 402, code: 'user_cap_reached' });
    await expect(creditService.assertAvailable({ firmId, userId: a }, 0.5)).rejects.toMatchObject({ code: 'user_cap_reached' });
    expect(await balance()).toBe(before);
    await expect(creditService.charge({ firmId, userId: b }, 'research', 5)).resolves.toMatchObject({ credits: 5 });
  });

  it('refunds do not count toward the cap', async () => {
    await creditService.setUserCap(a, 4, admin);
    const c = await creditService.charge({ firmId, userId: a }, 'research', 4);
    await c.refund();
    await expect(creditService.charge({ firmId, userId: a }, 'research', 4)).resolves.toMatchObject({ credits: 4 });
  });

  it('cap 0 turns AI off for that user; null removes the cap', async () => {
    await creditService.setUserCap(a, 0, admin);
    await expect(creditService.charge({ firmId, userId: a }, 'research', 0.5)).rejects.toMatchObject({ code: 'user_cap_reached' });
    await creditService.setUserCap(a, null, admin);
    await expect(creditService.charge({ firmId, userId: a }, 'research', 0.5)).resolves.toBeTruthy();
  });

  it('drafted pages past the cap stay locked; unlock is refused with user_cap_reached', async () => {
    await creditService.setUserCap(a, 2, admin);
    const m = await creditService.meterDraft({ firmId, userId: a }, 'draft-cap-1', 2000); // 5 pages
    expect(m.paid).toBe(2);
    expect(m.lockedCredits).toBe(3);
    await expect(creditService.unlock({ firmId, userId: a }, 'draft-cap-1')).rejects.toMatchObject({ code: 'user_cap_reached' });
  });
});

describe('AC4 cycle reset', () => {
  it('spend from before this cycle no longer counts', async () => {
    await creditService.setUserCap(a, 3, admin);
    await creditService.charge({ firmId, userId: a }, 'research', 3);
    await expect(creditService.charge({ firmId, userId: a }, 'research', 1)).rejects.toMatchObject({ code: 'user_cap_reached' });
    await getIntegrationSql()`update credit_ledger set created_at = now() - interval '40 days' where user_id = ${a}::uuid`;
    await expect(creditService.charge({ firmId, userId: a }, 'research', 3)).resolves.toMatchObject({ credits: 3 });
  });
});

describe('AC1 per-user report', () => {
  it('per-user totals add up to the firm totals; credits and cap shown; sorted by cost', async () => {
    const sql = getIntegrationSql();
    await sql`insert into ai_token_usage (firm_id, user_id, feature, provider, model, tokens_in, tokens_out) values
      (${firmId}::uuid, ${a}::uuid, 'drafting', 'anthropic', 'claude-sonnet-5-5', 1000, 200000),
      (${firmId}::uuid, ${a}::uuid, 'matter_chat', 'anthropic', 'claude-sonnet-5-5', 500, 1000),
      (${firmId}::uuid, ${b}::uuid, 'review', 'openai', 'gpt-5.5', 2000, 10000)`;
    await creditService.charge({ firmId, userId: a }, 'research', 3);
    await creditService.setUserCap(b, 50, admin);
    const end = new Date(Date.now() + 60_000);
    const start = new Date(Date.now() - 86_400_000);
    const users = await aiUsageReportService.byUser(start, end, firmId);
    const report = await aiUsageReportService.report(start, end);
    const firmRow = report.byFirm.find((f) => f.firmId === firmId)!;
    const sumTokens = users.reduce((n, u) => n + u.tokensIn + u.tokensOut, 0);
    expect(sumTokens).toBe(firmRow.totalTokens);
    const ua = users.find((u) => u.userId === a)!;
    expect(ua).toMatchObject({ calls: 2, creditsUsed: 3, topFeature: 'drafting', creditCapMonth: null });
    expect(users.find((u) => u.userId === b)!.creditCapMonth).toBe(50);
    expect(users[0]!.userId).toBe(a); // most expensive first
  });
});

describe('AC5 audit', () => {
  it('cap changes are audited with the actor; unknown user returns false', async () => {
    await creditService.setUserCap(a, 25, admin);
    const rows = await getIntegrationSql()`select actor_email, payload from audit_log where action = 'user.credit_cap.set' and target_id = ${a}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_email).toBe(admin.email);
    expect(await creditService.setUserCap('00000000-0000-0000-0000-000000000000', 5, admin)).toBe(false);
  });
});
