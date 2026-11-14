import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Pay per period, no Autopay - tests map to the acceptance criteria (AC#) in
// build-docs/features/manual-renewal.md (owner, 2026-11-14: no grace period;
// days left on a different plan are not carried over; remind before the end).

const h = vi.hoisted(() => ({
  useFakeDb: false,
  calls: [] as Array<{ text: string; strings: TemplateStringsArray; values: unknown[] }>,
  rows: (_text: string): unknown[] => [],
}));

vi.mock('../../db/client', () => ({
  db: () => {
    if (!h.useFakeDb) return null;
    const q = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      h.calls.push({ text, strings, values });
      return Promise.resolve(h.rows(text));
    };
    return Object.assign(q, { json: (v: unknown) => v, begin: async (fn: (tx: typeof q) => unknown) => fn(q) });
  },
}));

type Call = { text: string; strings: TemplateStringsArray; values: unknown[] };
const valueAfter = (call: Call, marker: string) => {
  const i = call.strings.findIndex((s) => s.trimEnd().endsWith(marker));
  return i >= 0 ? call.values[i] : undefined;
};

let billing: typeof import('../billing.service');
let planStatus: typeof import('../plan-status.service');

beforeAll(async () => {
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'key-secret', RAZORPAY_WEBHOOK_SECRET: 'wh-secret',
    WEB_PUBLIC_BASE_URL: 'https://app.example.in',
    INVOICE_SELLER_LEGAL_NAME: 'M MOHAMED RIYAZ', INVOICE_SELLER_TRADE_NAME: 'SIRAH DIGITAL', INVOICE_SELLER_GSTIN: '33CVVPM9805M1ZO',
    INVOICE_SELLER_ADDRESS: 'Chennai, Tamil Nadu 600044', INVOICE_SELLER_EMAIL: 'billing@example.in', INVOICE_SAC: '998315', INVOICE_PREFIX: 'DIF',
  });
  billing = await import('../billing.service');
  planStatus = await import('../plan-status.service');
});

afterEach(() => {
  h.useFakeDb = false;
  h.calls = [];
  h.rows = () => [];
  vi.unstubAllGlobals();
});

const FIRM = '00000000-0000-0000-0000-0000000000f1';
/** Razorpay: GET /orders/:id returns our order. */
function stubOrder(order: { amount: number; notes: Record<string, unknown> }) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'order_PlanPay001', ...order }), { status: 200 })));
}
const captured = (amount: number, id = 'pay_p1') => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id, order_id: 'order_PlanPay001', amount } } },
});
const vakalatMonth = { amount: 39900, notes: { kind: 'plan', firm_id: FIRM, user_id: 'u1', plan: 'vakalat', cycle: 'monthly', seats: '1', munshi: '0' } };
const update = () => h.calls.find((c) => /update firms set\s+plan_tier/.test(c.text)) as Call | undefined;
const event = () => h.calls.find((c) => /insert into billing_events/.test(c.text)) as Call | undefined;
const firmRow = (f: Record<string, unknown>) => (t: string) =>
  t.includes('from firms where id') && t.includes('for update') ? [f]
    : t.includes('from firms f join users u') ? [{ practice: 'P', name: 'N', email: null, phone: null, gstin: null, address_line: null, pincode: null, state: null }]
      : t.includes('insert into invoice_counters') ? [{ last: 1 }]
        : t.includes('insert into subscription_invoices') ? [{ id: 'inv' }] : [];

describe('AC2 a paid period is applied once, with the right paid-until', () => {
  it('nothing active: starts now, paid until one month later, plan active, one invoice', async () => {
    h.useFakeDb = true;
    h.rows = firmRow({ selected_plan: 'free', plan_status: 'trial', renews_at: null, free_plan: true, seats: 1, munshi_seats: 0 });
    stubOrder(vakalatMonth);
    const before = Date.now();
    await billing.billingService.handleWebhook('evt_1', captured(39900));
    const u = update()!;
    expect(valueAfter(u, 'selected_plan =')).toBe('vakalat');
    expect(valueAfter(u, 'free_plan =')).toBeUndefined(); // set as a literal false in SQL
    expect(u.text).toContain('free_plan = false');
    const end = valueAfter(u, 'renews_at =') as Date;
    const days = (end.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31.1);
    expect(event()!.values).toContain('subscription_active');
    expect(h.calls.filter((c) => c.text.includes('insert into subscription_invoices'))).toHaveLength(1);
  });

  it('same plan still active: the new month is added after the current end (paying early loses nothing)', async () => {
    h.useFakeDb = true;
    const end = new Date(Date.UTC(2099, 0, 15));
    h.rows = firmRow({ selected_plan: 'vakalat', plan_status: 'active', renews_at: end, free_plan: false, seats: 1, munshi_seats: 0 });
    stubOrder(vakalatMonth);
    await billing.billingService.handleWebhook('evt_2', captured(39900));
    expect((valueAfter(update()!, 'renews_at =') as Date).toISOString()).toBe('2099-02-15T00:00:00.000Z');
    expect(event()!.values).toContain('renewed');
  });

  it('a different plan while active: starts today; days left are not carried over', async () => {
    h.useFakeDb = true;
    h.rows = firmRow({ selected_plan: 'sanad', plan_status: 'active', renews_at: new Date(Date.UTC(2099, 0, 15)), free_plan: false, seats: 1, munshi_seats: 0 });
    stubOrder(vakalatMonth);
    await billing.billingService.handleWebhook('evt_3', captured(39900));
    const end = valueAfter(update()!, 'renews_at =') as Date;
    expect(end.getTime()).toBeLessThan(Date.UTC(2099, 0, 1));
    expect(event()!.values).toContain('plan_changed');
  });

  it('a redelivered payment changes nothing (applied once)', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('select id from billing_events where provider_ref') ? [{ id: 'seen' }]
      : t.includes('where razorpay_payment_id') ? [{ id: 'inv' }] : []);
    stubOrder(vakalatMonth);
    await billing.billingService.handleWebhook('evt_4', captured(39900));
    expect(update()).toBeUndefined();
    expect(h.calls.some((c) => c.text.includes('insert into subscription_invoices'))).toBe(false);
  });

  it.each([
    ['a paid amount that is not the plan price', 100, vakalatMonth],
    ['an order whose amount was changed', 39900, { ...vakalatMonth, amount: 100 }],
    ['an unknown plan', 39900, { ...vakalatMonth, notes: { ...vakalatMonth.notes, plan: 'gold' } }],
  ])('%s applies nothing', async (_l, paid, order) => {
    h.useFakeDb = true;
    h.rows = firmRow({ selected_plan: 'free', plan_status: 'trial', renews_at: null, free_plan: true, seats: 1, munshi_seats: 0 });
    stubOrder(order as typeof vakalatMonth);
    await billing.billingService.handleWebhook('evt_5', captured(paid as number));
    expect(update()).toBeUndefined();
  });

  it('a month later keeps the day, or the month end when it does not exist; a year is 12 months', () => {
    expect(billing.addPeriod(new Date('2027-01-31T10:00:00Z'), 'monthly').toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(billing.addPeriod(new Date('2026-11-14T09:00:00Z'), 'monthly').toISOString()).toBe('2026-12-14T09:00:00.000Z');
    expect(billing.addPeriod(new Date('2026-11-14T09:00:00Z'), 'annual').toISOString()).toBe('2027-11-14T09:00:00.000Z');
  });
});

describe('AC3/AC4 no grace: the plan ends at its paid-until date', () => {
  it('an active plan past its paid-until date is blocked (plan_expired), no grace days', () => {
    const yesterday = new Date(Date.now() - 86_400_000 * 1.5);
    expect(planStatus.evaluatePlanState({ firmId: 'f', planStatus: 'active', renewsAt: yesterday, trialEndsAt: null }))
      .toMatchObject({ ok: false, reason: 'plan_expired' });
  });

  it('a free-launch account whose paid period ended goes back to the free launch, not blocked', async () => {
    h.useFakeDb = true;
    const past = new Date(Date.now() - 86_400_000 * 2);
    h.rows = (t) => t.includes('from users u') ? [{ firm_id: 'f1', plan_status: 'active', renews_at: past, trial_ends_at: null }]
      : t.includes('update firms set free_plan = true') ? [{ plan_status: 'trial', renews_at: null, trial_ends_at: new Date('2027-06-01T18:29:59Z') }] : [];
    planStatus.invalidatePlanStatusCache();
    const s = await planStatus.getPlanState('00000000-0000-0000-0000-0000000000a9');
    expect(s.planStatus).toBe('trial');
    expect(planStatus.evaluatePlanState(s).ok).toBe(true);
    expect(h.calls.find((c) => c.text.includes('update firms set free_plan = true'))!.text).toContain('free_launch');
  });
});
