import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Owner's ₹1 test code (owner, 2026-11-14): "code + only my accounts".
// A leaked code must be useless to anyone not on BILLING_TEST_EMAILS.

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

let billing: typeof import('../billing.service');

beforeAll(async () => {
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'key-secret', RAZORPAY_WEBHOOK_SECRET: 'wh-secret',
    WEB_PUBLIC_BASE_URL: 'https://app.example.in',
    BILLING_TEST_COUPON: 'difaitest', BILLING_TEST_EMAILS: 'Owner@Example.in, second@example.in',
    INVOICE_SELLER_LEGAL_NAME: 'M MOHAMED RIYAZ', INVOICE_SELLER_TRADE_NAME: 'SIRAH DIGITAL', INVOICE_SELLER_GSTIN: '33CVVPM9805M1ZO',
    INVOICE_SELLER_ADDRESS: 'Chennai, Tamil Nadu 600044', INVOICE_SELLER_EMAIL: 'billing@example.in', INVOICE_SAC: '998315', INVOICE_PREFIX: 'DIF',
  });
  billing = await import('../billing.service');
});

afterEach(() => {
  h.useFakeDb = false;
  h.calls = [];
  h.rows = () => [];
  vi.unstubAllGlobals();
});

const owner = (email: string) => ({
  user_id: 'u1', name: 'A', email, phone: null, role: 'Solo Advocate', firm_id: 'f1',
  plan_tier: 'Solo', plan_status: 'active', free_plan: true, trial_ends_at: null, renews_at: null,
  billing_cycle: null, selected_plan: 'free', razorpay_subscription_id: null, seats: 1, munshi_seats: 0, members: 1, munshi_members: 0,
});
function stub() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'order_TestCoupon01' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const order = () => JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
  return { fetchMock, order };
}
const asUser = (email: string) => { h.useFakeDb = true; h.rows = (t) => (t.includes('from users u left join firms') ? [owner(email)] : []); };

describe('checkout with the test code', () => {
  it('an allow-listed account pays ₹1 for a plan (code and email match case-insensitively)', async () => {
    asUser('owner@example.in');
    const { order } = stub();
    await billing.billingService.startCheckout('u1', 'brief', 'annual', undefined, 0, ' DifAiTest ');
    expect(order()).toMatchObject({ amount: 100, notes: { kind: 'plan', plan: 'brief', cycle: 'annual', coupon: 'test' } });
  });

  it('and ₹1 for a Brief Pack', async () => {
    asUser('second@example.in');
    const { order } = stub();
    await billing.billingService.startPackCheckout('u1', 'pack_330', 'DIFAITEST');
    expect(order()).toMatchObject({ amount: 100, notes: { pack: 'pack_330', coupon: 'test' } });
  });

  it('the right code on anyone else\'s account is refused (400 invalid_coupon) and nothing is created', async () => {
    asUser('someone@else.in');
    const { fetchMock } = stub();
    await expect(billing.billingService.startCheckout('u1', 'brief', 'monthly', undefined, 0, 'DIFAITEST'))
      .rejects.toMatchObject({ status: 400, code: 'invalid_coupon' });
    await expect(billing.billingService.startPackCheckout('u1', 'pack_25', 'DIFAITEST')).rejects.toMatchObject({ code: 'invalid_coupon' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a wrong code is refused even for an allow-listed account; no code = normal price', async () => {
    asUser('owner@example.in');
    const { fetchMock, order } = stub();
    await expect(billing.billingService.startCheckout('u1', 'sanad', 'monthly', undefined, 0, 'FREE100')).rejects.toMatchObject({ code: 'invalid_coupon' });
    expect(fetchMock).not.toHaveBeenCalled();
    await billing.billingService.startCheckout('u1', 'sanad', 'monthly');
    expect(order().amount).toBe(19900);
    expect(order().notes.coupon).toBeUndefined();
  });

  it('with no code configured on the server, every code is refused', async () => {
    vi.resetModules();
    const saved = process.env['BILLING_TEST_COUPON'];
    process.env['BILLING_TEST_COUPON'] = '';
    try {
      const fresh = await import('../billing.service');
      asUser('owner@example.in');
      const { fetchMock } = stub();
      await expect(fresh.billingService.startCheckout('u1', 'sanad', 'monthly', undefined, 0, 'DIFAITEST')).rejects.toMatchObject({ code: 'invalid_coupon' });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env['BILLING_TEST_COUPON'] = saved;
      vi.resetModules();
    }
  });
});

describe('the ₹1 payment is applied like a real one, from our own order only', () => {
  const firm = (t: string) => t.includes('for update') ? [{ selected_plan: 'free', plan_status: 'trial', renews_at: null, free_plan: true, seats: 1, munshi_seats: 0 }]
    : t.includes('from firms f join users u') ? [{ practice: 'P', name: 'N', email: null, phone: null, gstin: null, address_line: null, pincode: null, state: null }]
      : t.includes('insert into invoice_counters') ? [{ last: 2 }]
        : t.includes('insert into subscription_invoices') ? [{ id: 'inv' }] : [];
  const pay = (orderNotes: Record<string, unknown>, orderAmount: number, paid: number) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'order_TestCoupon01', amount: orderAmount, notes: orderNotes }), { status: 200 })));
    return billing.billingService.handleWebhook('evt_t', { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TestCoupon01', order_id: 'order_TestCoupon01', amount: paid } } } });
  };
  const planNotes = { kind: 'plan', firm_id: '00000000-0000-0000-0000-0000000000f1', plan: 'brief', cycle: 'monthly', seats: '1', munshi: '0' };

  it('a ₹1 test order activates the plan (MRR 0, ₹1 invoice)', async () => {
    h.useFakeDb = true;
    h.rows = firm;
    await pay({ ...planNotes, coupon: 'test' }, 100, 100);
    const upd = h.calls.find((c) => /update firms set\s+plan_tier/.test(c.text))!;
    expect(upd).toBeDefined();
    expect(upd.values).toContain(0); // mrr_inr
    expect(h.calls.find((c) => c.text.includes('insert into subscription_invoices'))!.values.at(-1)).toBe(100);
  });

  it('₹1 paid on a normal (no-code) order applies nothing', async () => {
    h.useFakeDb = true;
    h.rows = firm;
    await pay(planNotes, 100, 100);
    expect(h.calls.some((c) => /update firms set\s+plan_tier/.test(c.text))).toBe(false);
  });
});
