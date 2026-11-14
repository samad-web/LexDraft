import crypto from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Brief Packs - tests map to the acceptance criteria (AC#) in
// build-docs/features/brief-packs.md. AC4 (plan credits spent before a pack)
// is in credits.integration.test.ts.

const h = vi.hoisted(() => ({
  useFakeDb: false,
  calls: [] as Array<{ text: string; values: unknown[] }>,
  rows: (_text: string): unknown[] => [],
}));

vi.mock('../../db/client', () => ({
  db: () => {
    if (!h.useFakeDb) return null;
    const q = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      h.calls.push({ text, values });
      return Promise.resolve(h.rows(text));
    };
    return Object.assign(q, { json: (v: unknown) => v, begin: async (fn: (tx: typeof q) => unknown) => fn(q) });
  },
}));

const KEY_SECRET = 'key-secret-for-tests';
let billing: typeof import('../billing.service');

beforeAll(async () => {
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: 'wh-secret',
    WEB_PUBLIC_BASE_URL: 'https://app.example.in',
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

const owner = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1', name: 'A', email: 'a@x.in', phone: null, role: 'Solo Advocate', firm_id: 'f1',
  plan_tier: 'Solo', plan_status: 'active', free_plan: false, trial_ends_at: null, renews_at: null,
  billing_cycle: 'monthly', selected_plan: 'vakalat', razorpay_subscription_id: 'sub_x', seats: 1, munshi_seats: 0,
  members: 1, munshi_members: 0, ...over,
});

function stubRazorpay(order: { amount?: number; notes?: Record<string, unknown> } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'GET' && url.includes('/orders/')) return new Response(JSON.stringify({ id: 'order_abc123', ...order }), { status: 200 });
    return new Response(JSON.stringify({ id: 'order_abc123' }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const body = (p: string) => {
    const c = fetchMock.mock.calls.find((x) => String(x[0]).endsWith(p)) as unknown as [string, { body: string }] | undefined;
    return c ? JSON.parse(c[1].body) : undefined;
  };
  return { fetchMock, body };
}

describe('AC1 buying a pack opens a one-time Razorpay order for exactly its price', () => {
  it.each([['pack_25', 49900], ['pack_60', 99900], ['pack_130', 199900], ['pack_330', 499900]] as const)('%s -> order of %i paise', async (pack, paise) => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from users u left join firms') ? [owner()] : []);
    const { body } = stubRazorpay();
    const r = await billing.billingService.startPackCheckout('u1', pack);
    expect(r.checkoutUrl).toBe('https://app.example.in/api/billing/pay/order_abc123');
    expect(body('/orders')).toMatchObject({ amount: paise, currency: 'INR', notes: { firm_id: 'f1', user_id: 'u1', pack } });
  });

  it('a non-owner gets 403; an unknown pack 400', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from users u left join firms') ? [owner({ role: 'Associate' })] : []);
    stubRazorpay();
    await expect(billing.billingService.startPackCheckout('u1', 'pack_60')).rejects.toMatchObject({ status: 403 });
    await expect(billing.billingService.startPackCheckout('u1', 'pack_999' as never)).rejects.toMatchObject({ status: 400, code: 'invalid_pack' });
  });

  it('without Razorpay keys: 503', async () => {
    vi.resetModules();
    const saved = process.env['RAZORPAY_KEY_ID'];
    process.env['RAZORPAY_KEY_ID'] = '';
    try {
      const fresh = await import('../billing.service');
      h.useFakeDb = true;
      h.rows = (t) => (t.includes('from users u left join firms') ? [owner()] : []);
      await expect(fresh.billingService.startPackCheckout('u1', 'pack_25')).rejects.toMatchObject({ status: 503, code: 'payments_disabled' });
    } finally {
      process.env['RAZORPAY_KEY_ID'] = saved;
      vi.resetModules();
    }
  });

  it('the pay page opens checkout for the order; the return checks HMAC(order|payment)', () => {
    const html = billing.billingService.payPage('order_abc123')!;
    expect(html).toContain('"order_id":"order_abc123"');
    expect(html).not.toContain('subscription_id');
    const good = crypto.createHmac('sha256', KEY_SECRET).update('order_abc123|pay_1').digest('hex');
    expect(billing.billingService.checkoutReturn({ razorpay_order_id: 'order_abc123', razorpay_payment_id: 'pay_1', razorpay_signature: good }))
      .toBe('https://app.example.in/app/billing?checkout=paid');
    expect(billing.billingService.checkoutReturn({ razorpay_order_id: 'order_abc123', razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) }))
      .toBe('https://app.example.in/app/billing?checkout=cancelled');
  });
});

describe('AC2/AC3 credits come only from the signed webhook, once, for the right amount', () => {
  const captured = (amount: number) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_pk1', order_id: 'order_abc123', amount } } },
  });
  const grantInsert = () => h.calls.find((c) => c.text.includes('insert into credit_grants'));
  const firmBuyer = { practice: 'P', name: 'N', email: null, phone: null, gstin: null, address_line: null, pincode: null, state: 'Tamil Nadu' };

  it('pack_60 paid: 60 credits for 12 months, one GST invoice for ₹999, logged as pack_bought', async () => {
    h.useFakeDb = true;
    h.rows = (t) => t.includes('insert into credit_grants') ? [{ id: 'g1' }]
      : t.includes('from firms f join users u') ? [firmBuyer]
        : t.includes('insert into invoice_counters') ? [{ last: 4 }]
          : t.includes('insert into subscription_invoices') ? [{ id: 'inv-p' }] : [];
    stubRazorpay({ amount: 99900, notes: { firm_id: '00000000-0000-0000-0000-0000000000f1', user_id: 'u1', pack: 'pack_60' } });
    await billing.billingService.handleWebhook('evt_pk1', captured(99900));
    const g = grantInsert()!;
    expect(g.values).toContain(60);
    expect(g.values).toContain('topup:pay_pk1');
    const expires = g.values.find((v) => v instanceof Date) as Date;
    expect(Math.round((expires.getTime() - Date.now()) / 86_400_000)).toBe(365);
    const inv = h.calls.find((c) => c.text.includes('insert into subscription_invoices'))!;
    expect(inv.values).toContain('pack_60');
    expect(inv.values).toContain('one-time');
    expect(inv.values.at(-1)).toBe(99900);
    expect(h.calls.find((c) => c.text.includes('insert into billing_events'))!.values).toContain('pack_bought');
  });

  it('a redelivery grants nothing more (the grant ref already exists)', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('where razorpay_payment_id') ? [{ id: 'inv-p' }] : []); // grant insert -> conflict, no row
    stubRazorpay({ amount: 99900, notes: { firm_id: 'f1', pack: 'pack_60' } });
    await billing.billingService.handleWebhook('evt_pk1b', captured(99900));
    expect(h.calls.some((c) => c.text.includes('insert into billing_events'))).toBe(false);
    expect(h.calls.some((c) => c.text.includes('insert into subscription_invoices'))).toBe(false);
  });

  it.each([
    ['a paid amount that is not the pack price', 100, { firm_id: 'f1', pack: 'pack_60' }, 99900],
    ['an order whose amount was changed', 99900, { firm_id: 'f1', pack: 'pack_60' }, 100],
    ['an unknown pack', 99900, { firm_id: 'f1', pack: 'pack_free' }, 99900],
    ['a subscription payment (no pack on the order)', 99900, { firm_id: 'f1' }, 99900],
  ])('%s grants nothing', async (_label, paid, notes, orderAmount) => {
    h.useFakeDb = true;
    stubRazorpay({ amount: orderAmount as number, notes: notes as Record<string, unknown> });
    await billing.billingService.handleWebhook('evt_bad', captured(paid as number));
    expect(grantInsert()).toBeUndefined();
    expect(h.calls.some((c) => c.text.includes('insert into subscription_invoices'))).toBe(false);
  });
});

describe('AC5 the packs on offer', () => {
  it('four packs, GST-inclusive prices, offered with the plan state', () => {
    expect(billing.briefPacks().map((p) => [p.id, p.credits, p.priceInr])).toEqual([
      ['pack_25', 25, 499], ['pack_60', 60, 999], ['pack_130', 130, 1999], ['pack_330', 330, 4999],
    ]);
  });
});
