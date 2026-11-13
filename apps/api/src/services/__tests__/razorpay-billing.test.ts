import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Razorpay billing - tests map to the acceptance criteria (AC#) in
// build-docs/features/razorpay-billing.md.

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

const KEY_SECRET = 'key-secret-for-tests';
let billing: typeof import('../billing.service');

beforeAll(async () => {
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: 'wh-secret',
    WEB_PUBLIC_BASE_URL: 'https://app.example.in',
  });
  billing = await import('../billing.service');
});

afterEach(() => {
  h.useFakeDb = false;
  h.calls = [];
  h.rows = () => [];
  vi.unstubAllGlobals();
});

function owner(over: Record<string, unknown> = {}) {
  return {
    user_id: 'u1', name: 'A', email: 'a@x.in', phone: null, role: 'Managing Partner', firm_id: 'f1',
    plan_tier: 'Practice', plan_status: 'trial', free_plan: false, trial_ends_at: null, renews_at: null,
    billing_cycle: null, selected_plan: 'practice', razorpay_subscription_id: null, seats: 8, members: 1, ...over,
  };
}

/** Razorpay API stub: plans and subscriptions get fixed ids; records every call. */
function stubRazorpay() {
  const fetchMock = vi.fn(async (url: string) => {
    const id = url.endsWith('/plans') ? 'plan_new1' : url.endsWith('/subscriptions') ? 'sub_new123' : 'x';
    return new Response(JSON.stringify({ id }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const body = (path: string) => {
    const c = fetchMock.mock.calls.find((x) => String(x[0]).endsWith(path)) as unknown as [string, { body: string }] | undefined;
    return c ? JSON.parse(c[1].body) : undefined;
  };
  return { fetchMock, body };
}

const ownerRows = (o: Record<string, unknown>) => (t: string) =>
  (t.includes('from users u left join firms') ? [owner(o)] : []);

describe('AC1/AC4 checkout creates a Razorpay subscription for the exact plan and seats', () => {
  it('Chamber with 3 advocates: a plan priced for 3 (+18% GST), subscription notes carry the firm', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({});
    const { body } = stubRazorpay();
    const r = await billing.billingService.startCheckout('u1', 'practice', 'monthly', 3);
    expect(r.checkoutUrl).toBe('https://app.example.in/api/billing/pay/sub_new123');
    expect(body('/plans')).toMatchObject({ period: 'monthly', interval: 1, item: { amount: Math.round((2999 + 899) * 1.18 * 100), currency: 'INR' } });
    expect(body('/subscriptions')).toMatchObject({ plan_id: 'plan_new1', quantity: 1, total_count: 120, notes: { firm_id: 'f1', plan: 'practice', seats: '3' } });
    const stored = h.calls.find((c) => /insert into razorpay_plans/.test(c.text))!;
    expect(stored.values).toEqual(['plan_new1', 'practice', 'monthly', 3, Math.round(3898 * 1.18 * 100)]);
  });

  it('an existing Razorpay plan for the same price is reused, not created again', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from users u left join firms') ? [owner({ role: 'Solo Advocate', selected_plan: 'solo' })]
      : t.includes('from razorpay_plans') ? [{ razorpay_plan_id: 'plan_old' }] : []);
    const { fetchMock, body } = stubRazorpay();
    await billing.billingService.startCheckout('u1', 'solo', 'annual');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/plans'))).toBe(false);
    expect(body('/subscriptions')).toMatchObject({ plan_id: 'plan_old', total_count: 10 });
  });

  it('Solo is charged its GST-inclusive price (no GST added)', () => {
    expect(billing.chargePaise('solo', 'monthly', 1)).toBe(149900);
    expect(billing.chargePaise('solo', 'annual', 1)).toBe(1199 * 12 * 100);
  });

  it.each([1, 9, 2.5])('Chamber seats = %s is rejected with 400 before Razorpay is called', async (seats) => {
    h.useFakeDb = true;
    h.rows = ownerRows({});
    const { fetchMock } = stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'practice', 'monthly', seats))
      .rejects.toMatchObject({ status: 400, code: 'invalid_seats' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fewer seats than members + pending invites is refused (seats_below_members)', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ members: 4 });
    const { fetchMock } = stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'practice', 'monthly', 3))
      .rejects.toMatchObject({ status: 400, code: 'seats_below_members' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Solo is refused for a practice with 2 members', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ role: 'Solo Advocate', members: 2 });
    const { fetchMock } = stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'solo', 'monthly'))
      .rejects.toMatchObject({ status: 400, code: 'seats_below_members' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a non-owner cannot buy', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ role: 'Associate' });
    stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'practice', 'monthly', 2))
      .rejects.toMatchObject({ status: 403, code: 'billing_owner_only' });
  });
});

describe('AC5 plan change: one subscription replaces the other at the period end', () => {
  const renews = new Date(Date.now() + 10 * 24 * 3600 * 1000);

  it('a paying firm gets a new subscription starting at its renewal date, marked as replacing the old one', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ role: 'Solo Advocate', selected_plan: 'solo', plan_status: 'active', razorpay_subscription_id: 'sub_old999', renews_at: renews });
    const { body } = stubRazorpay();
    await billing.billingService.startCheckout('u1', 'practice', 'monthly', 2);
    const sub = body('/subscriptions');
    expect(sub.start_at).toBe(Math.floor(renews.getTime() / 1000));
    expect(sub.notes.replaces).toBe('sub_old999');
  });

  it('once the new one is authorised, the old one is cancelled at its cycle end', async () => {
    h.useFakeDb = true;
    const { fetchMock, body } = stubRazorpay();
    await billing.billingService.handleWebhook('evt_auth', {
      event: 'subscription.authenticated',
      payload: { subscription: { entity: { id: 'sub_new123', plan_id: 'plan_x', notes: { firm_id: 'f1', replaces: 'sub_old999' } } } },
    });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/subscriptions\/sub_old999\/cancel$/);
    expect(body('/cancel')).toEqual({ cancel_at_cycle_end: 1 });
  });

  it('the same plan again is refused', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ plan_status: 'active', razorpay_subscription_id: 'sub_old999', billing_cycle: 'monthly', seats: 2 });
    stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'practice', 'monthly', 2)).rejects.toMatchObject({ status: 400 });
  });
});

describe('AC1/AC3/AC4 webhook sets the plan from what Razorpay charged', () => {
  const end = Math.floor(Date.UTC(2026, 11, 13) / 1000);
  const rows = (t: string) => (t.includes('from razorpay_plans where razorpay_plan_id')
    ? [{ plan: 'practice', cycle: 'monthly', seats: 3 }] : []);
  const update = () => h.calls.find((c) => /update firms set\s+plan_tier/.test(c.text))!;
  const logged = () => h.calls.filter((c) => /insert into billing_events/.test(c.text));
  const ev = (event: string, paid = 1) => ({
    event,
    payload: { subscription: { entity: {
      id: 'sub_new123', plan_id: 'plan_new1', paid_count: paid, current_end: end, customer_id: 'cust_1',
      notes: { firm_id: 'f1', user_id: 'u1' },
    } } },
  });

  it('activated: plan, seats, MRR, renewal date and Razorpay ids are saved; one event logged', async () => {
    h.useFakeDb = true;
    h.rows = rows;
    await billing.billingService.handleWebhook('evt_a1', ev('subscription.activated'));
    expect(valueAfter(update(), 'seats =')).toBe(3);
    expect(valueAfter(update(), 'mrr_inr =')).toBe(2999 + 899);
    expect(valueAfter(update(), 'renews_at =')).toEqual(new Date(end * 1000));
    expect(valueAfter(update(), 'razorpay_subscription_id =')).toBe('sub_new123');
    expect(logged()).toHaveLength(1);
    expect(logged()[0]!.values).toContain('subscription_active');
  });

  it('the first charge (paid_count 1) is not logged as a renewal', async () => {
    h.useFakeDb = true;
    h.rows = rows;
    await billing.billingService.handleWebhook('evt_c1', ev('subscription.charged', 1));
    expect(update()).toBeDefined();
    expect(logged()).toHaveLength(0);
  });

  it('a later charge is logged as a renewal', async () => {
    h.useFakeDb = true;
    h.rows = rows;
    await billing.billingService.handleWebhook('evt_c2', ev('subscription.charged', 2));
    expect(logged()[0]!.values).toContain('renewed');
  });

  it('AC2 a redelivered event id changes nothing', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('where webhook_id') ? [{ id: 'seen' }] : rows(t));
    await billing.billingService.handleWebhook('evt_a1', ev('subscription.activated'));
    expect(h.calls.some((c) => /update firms/.test(c.text))).toBe(false);
  });

  it('an unknown Razorpay plan is skipped, never guessed', async () => {
    h.useFakeDb = true;
    await billing.billingService.handleWebhook('evt_u', ev('subscription.activated'));
    expect(h.calls.some((c) => /update firms/.test(c.text))).toBe(false);
  });
});

describe('Found in Razorpay test-mode run (2026-11-13): two paid checkouts', () => {
  const rows = (current: string) => (t: string) =>
    t.includes('from razorpay_plans where razorpay_plan_id') ? [{ plan: 'practice', cycle: 'monthly', seats: 3 }]
      : t.includes('select razorpay_subscription_id from firms') ? [{ razorpay_subscription_id: current }] : [];
  const ev = (id: string, createdAt: number) => ({
    event: 'subscription.activated',
    payload: { subscription: { entity: { id, plan_id: 'plan_c', created_at: createdAt, current_end: 1_900_000_000, notes: { firm_id: 'f1' } } } },
  });
  /** Razorpay stub: GET returns the other subscription; cancel succeeds or fails. */
  function stub(other: { status: string; created_at: number }, cancelFails = false) {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'GET') return new Response(JSON.stringify({ id: 'sub_cur', ...other }), { status: 200 });
      return cancelFails ? new Response('{"error":{"description":"already cancelled"}}', { status: 400 })
        : new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const cancelled = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/cancel')).map((c) => String(c[0]));
    return { cancelled };
  }
  const switched = () => h.calls.some((c) => /update firms set\s+plan_tier/.test(c.text));

  it('a newer paid subscription wins: the older live one is cancelled now and the firm switches', async () => {
    h.useFakeDb = true;
    h.rows = rows('sub_cur');
    const { cancelled } = stub({ status: 'active', created_at: 100 });
    await billing.billingService.handleWebhook('evt_d1', ev('sub_newer', 200));
    expect(cancelled()).toEqual([expect.stringMatching(/\/subscriptions\/sub_cur\/cancel$/)]);
    expect(switched()).toBe(true);
  });

  it('a late retry for an older subscription is cancelled and never switches the firm back', async () => {
    h.useFakeDb = true;
    h.rows = rows('sub_cur');
    const { cancelled } = stub({ status: 'active', created_at: 300 });
    await billing.billingService.handleWebhook('evt_d2', ev('sub_older', 200));
    expect(cancelled()).toEqual([expect.stringMatching(/\/subscriptions\/sub_older\/cancel$/)]);
    expect(switched()).toBe(false);
  });

  it('the other one is already cancelled: nothing to cancel, the firm switches', async () => {
    h.useFakeDb = true;
    h.rows = rows('sub_cur');
    const { cancelled } = stub({ status: 'cancelled', created_at: 300 });
    await billing.billingService.handleWebhook('evt_d3', ev('sub_x', 200));
    expect(cancelled()).toEqual([]);
    expect(switched()).toBe(true);
  });

  it('a cancel that Razorpay refuses (already cancelled) does not fail the webhook', async () => {
    h.useFakeDb = true;
    h.rows = rows('sub_cur');
    stub({ status: 'active', created_at: 300 }, true);
    await expect(billing.billingService.handleWebhook('evt_d4', ev('sub_older', 200))).resolves.toBeUndefined();
  });
});

describe('AC7 failed renewal and cancellation', () => {
  const sameSub = (t: string) => (t.includes('select razorpay_subscription_id from firms') ? [{ razorpay_subscription_id: 'sub_new123' }] : []);
  const ev = (event: string, currentEnd: number | null, planId = 'plan_s') => ({
    event,
    payload: { subscription: { entity: { id: 'sub_new123', plan_id: planId, current_end: currentEnd, notes: { firm_id: 'f1' } } } },
  });

  it('halted -> past_due', async () => {
    h.useFakeDb = true;
    h.rows = sameSub;
    await billing.billingService.handleWebhook('evt_h', ev('subscription.halted', null));
    expect(h.calls.some((c) => /update firms set plan_status = 'past_due'/.test(c.text))).toBe(true);
  });

  it('cancelled with paid time left keeps access until the period end', async () => {
    h.useFakeDb = true;
    h.rows = sameSub;
    const later = Math.floor(Date.now() / 1000) + 5 * 24 * 3600;
    await billing.billingService.handleWebhook('evt_x1', ev('subscription.cancelled', later));
    const upd = h.calls.find((c) => /update firms set renews_at/.test(c.text))!;
    expect(upd.values[0]).toEqual(new Date(later * 1000));
  });

  it('an ended Solo goes back to the free launch plan while it lasts', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from razorpay_plans') ? [{ plan: 'solo', cycle: 'monthly', seats: 1 }] : sameSub(t));
    await billing.billingService.handleWebhook('evt_x2', ev('subscription.cancelled', Math.floor(Date.now() / 1000) - 60));
    expect(h.calls.some((c) => /free_plan = true/.test(c.text) && /razorpay_subscription_id = null/.test(c.text))).toBe(true);
  });

  it('a cancellation of an older, replaced subscription does not touch the firm', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('select razorpay_subscription_id from firms') ? [{ razorpay_subscription_id: 'sub_other' }] : []);
    await billing.billingService.handleWebhook('evt_x3', ev('subscription.cancelled', null));
    expect(h.calls.some((c) => /update firms/.test(c.text))).toBe(false);
  });
});

describe('Checkout page and return', () => {
  it('the pay page opens Razorpay Checkout for that subscription and returns to the app', () => {
    const html = billing.billingService.payPage('sub_new123')!;
    expect(html).toContain('https://checkout.razorpay.com/v1/checkout.js');
    expect(html).toContain('"subscription_id":"sub_new123"');
    expect(html).toContain('"callback_url":"https://app.example.in/api/billing/callback"');
    expect(html).not.toContain(KEY_SECRET);
  });

  it('a malformed subscription id gets no page (no script injection)', () => {
    expect(billing.billingService.payPage('sub_1"><script>')).toBeNull();
    expect(billing.billingService.payPage('pay_123456789')).toBeNull();
  });

  it('a correctly signed return goes to "done"; a forged one to "cancelled"', () => {
    const good = crypto.createHmac('sha256', KEY_SECRET).update('pay_1|sub_new123').digest('hex');
    expect(billing.billingService.checkoutReturn({ razorpay_payment_id: 'pay_1', razorpay_subscription_id: 'sub_new123', razorpay_signature: good }))
      .toBe('https://app.example.in/app/billing?checkout=done');
    expect(billing.billingService.checkoutReturn({ razorpay_payment_id: 'pay_1', razorpay_subscription_id: 'sub_new123', razorpay_signature: 'f'.repeat(64) }))
      .toBe('https://app.example.in/app/billing?checkout=cancelled');
    expect(billing.billingService.checkoutReturn({})).toBe('https://app.example.in/app/billing?checkout=cancelled');
  });
});

describe('AC9 test keys never work in production', () => {
  it('rzp_test_ keys are ignored when NODE_ENV=production', async () => {
    vi.resetModules();
    const saved = { ...process.env };
    Object.assign(process.env, { NODE_ENV: 'production', RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 's' });
    try {
      const { env } = await import('../../env');
      expect(env.razorpay.keyId).toBe('');
      expect(env.razorpay.testKeyInProd).toBe(true);
    } finally {
      process.env = saved;
      vi.resetModules();
    }
  });
});
