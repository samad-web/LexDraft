import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Pricing v2 phase A - tests map to the acceptance criteria (AC#) in
// build-docs/features/pricing-v2.md.

type Call = { text: string; strings: TemplateStringsArray; values: unknown[] };
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

/** The value bound right after the SQL fragment ending in `marker`. */
function valueAfter(call: Call, marker: string): unknown {
  const i = call.strings.findIndex((s) => s.trimEnd().endsWith(marker));
  return i >= 0 ? call.values[i] : undefined;
}

let billing: typeof import('../billing.service');
let quota: typeof import('../ai-quota.service');
let freePlan: typeof import('../../lib/free-plan');

beforeAll(async () => {
  Object.assign(process.env, {
    DODO_PAYMENTS_API_KEY: 'test_key',
    DODO_PRODUCT_SOLO_MONTHLY: 'pdt_solo_m', DODO_PRODUCT_SOLO_ANNUAL: 'pdt_solo_y',
    DODO_PRODUCT_PRACTICE_MONTHLY: 'pdt_ch_m', DODO_PRODUCT_PRACTICE_ANNUAL: 'pdt_ch_y',
    DODO_ADDON_CHAMBER_SEAT_MONTHLY: 'adn_seat_m', DODO_ADDON_CHAMBER_SEAT_ANNUAL: 'adn_seat_y',
  });
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

describe('AC5/AC6 Chamber checkout seats', () => {
  function ownerRow(members = 1) {
    return {
      user_id: 'u1', name: 'A', email: 'a@x.in', phone: null, role: 'Managing Partner', firm_id: 'f1',
      plan_tier: 'Practice', plan_status: 'trial', free_plan: false, trial_ends_at: null, renews_at: null,
      billing_cycle: null, selected_plan: 'practice', dodo_customer_id: null, dodo_subscription_id: null,
      seats: 8, members,
    };
  }
  function stubDodo() {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ session_id: 's1', checkout_url: 'https://pay/x' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('seats = 5 sends the seat add-on with quantity 3', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from users u left join firms') ? [ownerRow()] : []);
    const fetchMock = stubDodo();
    await billing.billingService.startCheckout('u1', 'practice', 'monthly', 5);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.product_cart).toEqual([
      { product_id: 'pdt_ch_m', quantity: 1, addons: [{ addon_id: 'adn_seat_m', quantity: 3 }] },
    ]);
    expect(body.metadata.seats).toBe('5');
  });

  it('seats = 2 sends no add-on', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from users u left join firms') ? [ownerRow()] : []);
    const fetchMock = stubDodo();
    await billing.billingService.startCheckout('u1', 'practice', 'annual', 2);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.product_cart).toEqual([{ product_id: 'pdt_ch_y', quantity: 1 }]);
  });

  it.each([1, 9, 2.5])('seats = %s is rejected with 400', async (seats) => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from users u left join firms') ? [ownerRow()] : []);
    const fetchMock = stubDodo();
    await expect(billing.billingService.startCheckout('u1', 'practice', 'monthly', seats))
      .rejects.toMatchObject({ status: 400, code: 'invalid_seats' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fewer seats than active members + pending invites is refused', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from users u left join firms') ? [ownerRow(4)] : []);
    const fetchMock = stubDodo();
    await expect(billing.billingService.startCheckout('u1', 'practice', 'monthly', 3))
      .rejects.toMatchObject({ status: 400, code: 'seats_below_members' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AC5 webhook sets seats from the paid add-on', () => {
  function webhookRows(t: string): unknown[] {
    if (t.includes('select seats from firms')) return [{ seats: 8 }];
    return [];
  }
  const update = () => h.calls.find((c) => /update firms set\s+plan_tier/.test(c.text))!;

  it('add-on quantity 3 -> firms.seats = 5 and MRR includes 3 extra advocates', async () => {
    h.useFakeDb = true;
    h.rows = webhookRows;
    await billing.billingService.handleWebhook('wh_1', {
      type: 'subscription.active',
      data: {
        subscription_id: 'sub_1', product_id: 'pdt_ch_m', next_billing_date: '2026-12-11T00:00:00Z',
        metadata: { firm_id: 'f1', plan: 'practice', cycle: 'monthly' },
        addons: [{ addon_id: 'adn_seat_m', quantity: 3 }],
      },
    });
    expect(valueAfter(update(), 'seats = coalesce(')).toBe(5);
    expect(valueAfter(update(), 'mrr_inr =')).toBe(2999 + 3 * 899);
  });

  it('an unknown add-on id leaves seats unchanged', async () => {
    h.useFakeDb = true;
    h.rows = webhookRows;
    await billing.billingService.handleWebhook('wh_2', {
      type: 'subscription.renewed',
      data: {
        subscription_id: 'sub_1', product_id: 'pdt_ch_m',
        metadata: { firm_id: 'f1' }, addons: [{ addon_id: 'adn_other', quantity: 2 }],
      },
    });
    expect(valueAfter(update(), 'seats = coalesce(')).toBeNull();
  });

  it('no add-ons -> the 2 included advocates', () => {
    expect(billing.chamberSeatsFrom([])).toBe(2);
    expect(billing.chamberSeatsFrom(undefined)).toBeNull();
  });
});

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
