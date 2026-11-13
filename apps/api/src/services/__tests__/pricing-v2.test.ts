import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Pricing v2 phase A - tests map to the acceptance criteria (AC#) in
// build-docs/features/pricing-v2.md.

const h = vi.hoisted(() => ({
  useFakeDb: false,
  calls: [] as Array<{ text: string; strings: TemplateStringsArray; values: unknown[] }>,
  rows: (_text: string): unknown[] => [],
}));

vi.mock('../../db/client', () => ({
  db: () => {
    if (!h.useFakeDb) return null;
    return (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      h.calls.push({ text, strings, values });
      return Promise.resolve(h.rows(text));
    };
  },
}));

let billing: typeof import('../billing.service');
let quota: typeof import('../ai-quota.service');
let freePlan: typeof import('../../lib/free-plan');

beforeAll(async () => {
  billing = await import('../billing.service');
  quota = await import('../ai-quota.service');
  freePlan = await import('../../lib/free-plan');
});

afterEach(() => {
  h.useFakeDb = false;
  h.calls = [];
  h.rows = () => [];
  vi.unstubAllGlobals();
});

describe('AC1 intake draft counted once', () => {
  it('a generated intake draft adds 1; re-render/edit of the same draft adds 0', async () => {
    const u = 'user-ac1';
    const before = (await quota.aiQuotaService.status(null, u)).used;
    const state = { status: 'generated', matterId: 'm-1', docLabel: 'Bail Application' };
    await quota.aiQuotaService.countIntakeDraft('f', u, state);
    await quota.aiQuotaService.countIntakeDraft('f', u, state);
    expect((await quota.aiQuotaService.status(null, u)).used).toBe(before + 1);
  });

  it('a new document on the same matter is a new draft', async () => {
    const u = 'user-ac1b';
    await quota.aiQuotaService.countIntakeDraft('f', u, { status: 'generated', matterId: 'm-2', docLabel: 'Plaint' });
    await quota.aiQuotaService.countIntakeDraft('f', u, { status: 'generated', matterId: 'm-2', docLabel: 'Affidavit' });
    expect((await quota.aiQuotaService.status(null, u)).used).toBe(2);
  });

  it('gathering / refused turns are not counted', async () => {
    const u = 'user-ac1c';
    for (const status of ['gathering', 'refused', 'closed']) {
      await quota.aiQuotaService.countIntakeDraft('f', u, { status, matterId: 'm-3', docLabel: 'Plaint' });
    }
    expect((await quota.aiQuotaService.status(null, u)).used).toBe(0);
  });

  it('with a database, the count is an insert that ignores a repeated key', async () => {
    h.useFakeDb = true;
    await quota.aiQuotaService.recordOnce('f', '00000000-0000-0000-0000-000000000001', 'intake:m:Plaint', 'Plaint');
    const call = h.calls[0]!;
    expect(call.text).toMatch(/insert into ai_generations/);
    expect(call.text).toMatch(/on conflict \(source_key\) where source_key is not null do nothing/);
    expect(call.values).toContain('intake:m:Plaint');
  });
});

describe('AC2 Solo limit 50', () => {
  it('draft #51 is refused with the reset date', async () => {
    const u = 'user-ac2';
    for (let i = 0; i < 50; i++) await quota.aiQuotaService.record(null, u, 'generate');
    const err = await quota.aiQuotaService.assertCanGenerate(null, u).catch((e) => e);
    expect(err).toBeInstanceOf(quota.AiQuotaExceededError);
    expect(err.status.cap).toBe(50);
    expect(err.status.cycleEnd).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('AC3 free limit 30', () => {
  it('free accounts get 30 drafts a month', () => {
    expect(freePlan.FREE_AI_MONTHLY_CAP).toBe(30);
  });
});

// AC5/AC6 (Chamber seats at checkout and from the webhook) moved to
// razorpay-billing.test.ts when Razorpay replaced Dodo (2026-11-13).

describe('AC8 plan cards: new prices, GST label, web and API lists match', () => {
  it('API plans carry the v2 prices, limits and GST basis', () => {
    const plans = billing.billingPlans();
    const by = (id: string) => plans.find((p) => p.id === id)!;
    expect(plans.map((p) => p.id)).toEqual(['free', 'solo', 'practice', 'firm']);
    expect(by('solo')).toMatchObject({ monthlyInr: 1499, annualMonthlyInr: 1199, gst: 'inclusive', draftsPerMonth: 50 });
    expect(by('practice')).toMatchObject({
      name: 'Chamber', monthlyInr: 2999, annualMonthlyInr: 2399, gst: 'exclusive', draftsPerMonth: 40,
      seats: { included: 2, max: 8, extraMonthlyInr: 899, extraAnnualMonthlyInr: 719 },
    });
    expect(by('free').draftsPerMonth).toBe(30);
  });

  it('web SIGNUP_PLANS mirrors billingPlans() (except purchasable)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../../web/src/components/PlanCards.tsx'), 'utf8');
    const start = src.indexOf('[', src.indexOf('export const SIGNUP_PLANS'));
    const end = src.indexOf('\n];', start) + 2;
    // A pure object literal: evaluate it as data.
    const web = new Function(`return ${src.slice(start, end)}`)() as Array<Record<string, unknown>>;
    const strip = (p: Record<string, unknown>) => { const { purchasable: _p, ...rest } = p; return rest; };
    expect(web.map(strip)).toEqual(billing.billingPlans().map((p) => strip(p as unknown as Record<string, unknown>)));
  });
});
