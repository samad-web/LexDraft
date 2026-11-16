import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Pricing v5 (Advocate / Chambers / Firm / Enterprise, prices + 18% GST) -
// tests map to the acceptance criteria (AC#) in build-docs/features/pricing-v5.md.
// Replaces pricing-v4.test.ts (owner moved everyone to v5 on 2026-11-16).

type Call = { text: string; strings: TemplateStringsArray; values: unknown[] };
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
    return Object.assign(q, {
      json: (v: unknown) => v,
      begin: async (fn: (tx: typeof q) => unknown) => fn(q),
    });
  },
}));

// Onboarding reads the finished user back through authService; the account
// itself is not under test here.
vi.mock('../auth.service', () => ({
  authService: { getById: async (id: string) => ({ id }) },
  resolveSystemRoleId: async () => null,
  systemRoleNameFor: () => null,
  unusablePasswordHash: async () => 'x',
}));

function valueAfter(call: Call, marker: string): unknown {
  const i = call.strings.findIndex((s) => s.trimEnd().endsWith(marker));
  return i >= 0 ? call.values[i] : undefined;
}

let billing: typeof import('../billing.service');
let onboarding: typeof import('../onboarding.service');
let invitations: typeof import('../invitations.service');
let invoices: typeof import('../subscription-invoice.service');
let credit: typeof import('../credit.service');
let plans: typeof import('../../lib/plans');
let freePlan: typeof import('../../lib/free-plan');

beforeAll(async () => {
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'key-secret', RAZORPAY_WEBHOOK_SECRET: 'wh-secret',
    WEB_PUBLIC_BASE_URL: 'https://app.example.in',
    INVOICE_SELLER_LEGAL_NAME: 'M MOHAMED RIYAZ', INVOICE_SELLER_TRADE_NAME: 'SIRAH DIGITAL', INVOICE_SELLER_GSTIN: '33CVVPM9805M1ZO',
    INVOICE_SELLER_ADDRESS: 'Chennai, Tamil Nadu 600044', INVOICE_SAC: '998315', INVOICE_PREFIX: 'DIF',
  });
  billing = await import('../billing.service');
  onboarding = await import('../onboarding.service');
  invitations = await import('../invitations.service');
  invoices = await import('../subscription-invoice.service');
  credit = await import('../credit.service');
  plans = await import('../../lib/plans');
  freePlan = await import('../../lib/free-plan');
});

afterEach(() => {
  h.useFakeDb = false;
  h.calls = [];
  h.rows = () => [];
  vi.unstubAllGlobals();
});

/** Razorpay API stub: records the order it was asked to create. */
function stubRazorpay() {
  const fetchMock = vi.fn(async (url: string) => {
    const id = url.endsWith('/orders') ? 'order_v5abcdef' : 'x';
    return new Response(JSON.stringify({ id }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const body = (p: string) => {
    const c = fetchMock.mock.calls.find((x) => String(x[0]).endsWith(p)) as unknown as [string, { body: string }] | undefined;
    return c ? JSON.parse(c[1].body) : undefined;
  };
  return { fetchMock, body };
}

const owner = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1', name: 'A', email: 'a@x.in', phone: null, role: 'Solo Advocate', firm_id: 'f1',
  plan_tier: 'Solo', plan_status: 'trial', free_plan: false, trial_ends_at: null, renews_at: null,
  billing_cycle: null, selected_plan: null, razorpay_subscription_id: null, seats: 1, munshi_seats: 0,
  members: 1, munshi_members: 0, ...over,
});
const ownerRows = (o: Record<string, unknown>) => (t: string) => (t.includes('from users u left join firms') ? [owner(o)] : []);

// Expected v5 prices (GST excluded), written out independently of lib/plans.ts.
const V5 = {
  advocate: { name: 'Advocate', monthly: 699,  annual: 7689,  credits: 150, seats: 1, tier: 'Solo' },
  chambers: { name: 'Chambers', monthly: 1699, annual: 18689, credits: 350, seats: 3, tier: 'Practice' },
  law_firm: { name: 'Firm',     monthly: 3699, annual: 40689, credits: 750, seats: 8, tier: 'Firm' },
} as const;
const MUNSHI = { monthly: 149, annual: 1639 };
type Id = keyof typeof V5;
const ids = Object.keys(V5) as Id[];

describe('AC1 the catalogue is exactly the v5 table, and the web mirrors it', () => {
  it('billingPlans() returns Advocate / Chambers / Firm (+ GST) and Enterprise (not purchasable)', () => {
    const list = billing.billingPlans();
    expect(list.map((p) => p.id)).toEqual(['advocate', 'chambers', 'law_firm', 'enterprise']);
    for (const id of ids) {
      const v = V5[id];
      expect(list.find((p) => p.id === id)).toMatchObject({
        name: v.name, monthlyInr: v.monthly, annualInr: v.annual, pagesPerMonth: v.credits, advocates: v.seats,
        gst: 'exclusive', munshi: { monthlyInr: MUNSHI.monthly, annualInr: MUNSHI.annual, max: 4 },
      });
      expect(plans.PLANS[id]).toMatchObject({ tier: v.tier, seats: v.seats, credits: v.credits });
      expect(v.annual).toBe(v.monthly * 11); // "1 month free"
    }
    expect(list.find((p) => p.id === 'enterprise')).toMatchObject({ monthlyInr: null, purchasable: false, gst: null });
    expect(list.some((p) => p.id === 'free')).toBe(false);
  });

  it('web SIGNUP_PLANS mirrors billingPlans() (except purchasable)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../../web/src/components/PlanCards.tsx'), 'utf8');
    const start = src.indexOf('[', src.indexOf('export const SIGNUP_PLANS'));
    const end = src.indexOf('\n];', start) + 2;
    const web = new Function(`return ${src.slice(start, end)}`)() as Array<Record<string, unknown>>;
    const strip = (p: Record<string, unknown>) => { const { purchasable: _p, ...rest } = p; return rest; };
    expect(web.map(strip)).toEqual(billing.billingPlans().map((p) => strip(p as unknown as Record<string, unknown>)));
  });

  it('Brief Packs are ₹429 / ₹849 / ₹1,699 / ₹4,249 + GST for 25 / 60 / 130 / 330 credits, 365 days', () => {
    expect(plans.BRIEF_PACKS).toEqual({
      pack_25: { credits: 25, priceInr: 429 }, pack_60: { credits: 60, priceInr: 849 },
      pack_130: { credits: 130, priceInr: 1699 }, pack_330: { credits: 330, priceInr: 4249 },
    });
    expect(plans.BRIEF_PACK_DAYS).toBe(365);
  });
});

describe('AC2 the order amount is (plan + Munshi) ex-GST x 118 paise, for every plan x cycle x Munshi 0-4', () => {
  it('every combination', () => {
    for (const id of ids) {
      for (const cycle of ['monthly', 'annual'] as const) {
        const each = cycle === 'annual' ? V5[id].annual : V5[id].monthly;
        const clerk = cycle === 'annual' ? MUNSHI.annual : MUNSHI.monthly;
        for (const munshi of [0, 1, 2, 3, 4]) {
          expect(billing.chargePaise(id, cycle, munshi)).toBe((each + clerk * munshi) * 118);
        }
      }
    }
  });

  it('spot checks: Advocate monthly ₹824.82; Firm yearly + 2 Munshi yearly = ₹51,881.06; MRR is ex-GST', () => {
    expect(billing.chargePaise('advocate', 'monthly')).toBe(82482);
    expect(billing.chargePaise('law_firm', 'annual', 2)).toBe(5188106);
    expect(billing.mrrFor('law_firm', 'annual', 2)).toBe(Math.round((40689 + 3278) / 12));
    expect(billing.mrrFor('chambers', 'monthly', 1)).toBe(1848);
  });

  it('the order is for that exact amount and carries plan, fixed seats and Munshi seats', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ role: 'Managing Partner' });
    const { body } = stubRazorpay();
    await billing.billingService.startCheckout('u1', 'chambers', 'monthly', 1);
    expect(body('/orders')).toMatchObject({
      amount: (1699 + 149) * 118, notes: { kind: 'plan', pricing: 'v5', plan: 'chambers', seats: '3', munshi: '1' },
    });
  });

  it.each([-1, 5, 1.5])('munshi = %s is refused before Razorpay is called', async (munshi) => {
    h.useFakeDb = true;
    h.rows = ownerRows({});
    const { fetchMock } = stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'advocate', 'monthly', munshi))
      .rejects.toMatchObject({ status: 400, code: 'invalid_munshi' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// payment.captured for one of our own orders (the only way a plan is applied).
const FIRM = '00000000-0000-0000-0000-0000000000f1';
const firmRows = (state: string | null = null) => (t: string) =>
  t.includes('for update') ? [{ selected_plan: null, plan_status: 'trial', renews_at: null, free_plan: false, seats: 1, munshi_seats: 0 }]
    : t.includes('from firms f join users u') ? [{ practice: 'P', name: 'N', email: null, phone: null, gstin: null, address_line: null, pincode: null, state }]
      : t.includes('insert into invoice_counters') ? [{ last: 7 }]
        : t.includes('insert into subscription_invoices') ? [{ id: 'inv' }]
          : t.includes('insert into credit_grants') ? [{ id: 'g' }] : [];
function pay(orderNotes: Record<string, unknown>, orderAmount: number, paid = orderAmount) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'order_V5test0001', amount: orderAmount, notes: orderNotes }), { status: 200 })));
  return billing.billingService.handleWebhook(`evt_${Math.random()}`, {
    event: 'payment.captured', payload: { payment: { entity: { id: 'pay_V5test0001', order_id: 'order_V5test0001', amount: paid } } },
  });
}
const firmUpdate = () => h.calls.find((c) => /update firms set\s+plan_tier/.test(c.text)) as Call | undefined;
const invoiceInsert = () => h.calls.find((c) => c.text.includes('insert into subscription_invoices')) as Call | undefined;

describe('AC3 the webhook sets plan, tier, seats and Munshi seats from our own order only', () => {
  it.each(ids)('%s: tier, fixed seats and Munshi seats are applied; custom credits cleared', async (id) => {
    h.useFakeDb = true;
    h.rows = firmRows();
    await pay({ kind: 'plan', pricing: 'v5', firm_id: FIRM, plan: id, cycle: 'monthly', seats: '1', munshi: '2' }, (V5[id].monthly + 2 * 149) * 118);
    const upd = firmUpdate()!;
    expect(valueAfter(upd, 'plan_tier =')).toBe(V5[id].tier);
    expect(valueAfter(upd, 'selected_plan =')).toBe(id);
    expect(valueAfter(upd, 'seats =')).toBe(V5[id].seats); // from the plan, never from the notes
    expect(valueAfter(upd, 'munshi_seats =')).toBe(2);
    expect(upd.text).toMatch(/credit_allowance = null/);
  });

  it('a payment of any other amount applies nothing and issues no invoice', async () => {
    h.useFakeDb = true;
    h.rows = firmRows();
    await pay({ kind: 'plan', pricing: 'v5', firm_id: FIRM, plan: 'law_firm', cycle: 'monthly', seats: '8', munshi: '0' }, 69900);
    expect(firmUpdate()).toBeUndefined();
    expect(invoiceInsert()).toBeUndefined();
  });

  it('the exact amount is logged in paise (₹824.82 does not fit whole rupees)', async () => {
    h.useFakeDb = true;
    h.rows = firmRows();
    await pay({ kind: 'plan', pricing: 'v5', firm_id: FIRM, plan: 'advocate', cycle: 'monthly', seats: '1', munshi: '0' }, 82482);
    const ev = h.calls.find((c) => c.text.includes('insert into billing_events'))!;
    expect(ev.values).toContain(82482);
    expect(ev.values).toContain(825);
  });
});

describe('AC4 the invoice shows taxable = the ex-GST price, CGST+SGST (TN) or IGST (other states)', () => {
  it('Chambers + 1 Munshi, Tamil Nadu buyer: ₹1,848 taxable + ₹166.32 CGST + ₹166.32 SGST = ₹2,180.64', async () => {
    h.useFakeDb = true;
    h.rows = firmRows('Tamil Nadu');
    await pay({ kind: 'plan', pricing: 'v5', firm_id: FIRM, plan: 'chambers', cycle: 'monthly', seats: '3', munshi: '1' }, 218064);
    expect(invoiceInsert()!.values.slice(-5)).toEqual([184800, 16632, 16632, 0, 218064]);
  });

  it('Advocate yearly, Karnataka buyer: ₹7,689 taxable + ₹1,384.02 IGST', async () => {
    h.useFakeDb = true;
    h.rows = firmRows('Karnataka');
    await pay({ kind: 'plan', pricing: 'v5', firm_id: FIRM, plan: 'advocate', cycle: 'annual', seats: '1', munshi: '0' }, 907302);
    expect(invoiceInsert()!.values.slice(-5)).toEqual([768900, 0, 0, 138402, 907302]);
  });

  it('a Brief Pack (₹429 + GST) is invoiced at ₹429 taxable', async () => {
    h.useFakeDb = true;
    h.rows = firmRows('Tamil Nadu');
    await pay({ pricing: 'v5', firm_id: FIRM, pack: 'pack_25' }, 429 * 118);
    expect(invoiceInsert()!.values.slice(-5)).toEqual([42900, 3861, 3861, 0, 50622]);
  });

  it('splitTax refuses a taxable value that does not add up to the total (never a wrong invoice)', () => {
    expect(() => invoices.splitTax(82482, true, 69800)).toThrow(/GST mismatch/);
    expect(invoices.splitTax(82482, false, 69900)).toEqual({ taxable: 69900, cgst: 0, sgst: 0, igst: 12582 });
  });
});

describe('AC6 monthly credits: Advocate 150, Chambers 350, Firm 750, whatever the seat count', () => {
  const active = (o: Record<string, unknown>) => ({
    plan_tier: 'Solo', plan_status: 'active', free_plan: false, selected_plan: null, seats: 1, renews_at: null, trial_ends_at: null, ...o,
  }) as never;
  it.each(ids)('%s', (id) => {
    for (const seats of [1, 3, 8]) expect(credit.allowanceFor(active({ selected_plan: id, seats }))).toBe(V5[id].credits);
  });
  it('older plan ids fall back to the v5 plan of the same tier', () => {
    expect(credit.allowanceFor(active({ selected_plan: 'sanad', plan_tier: 'Solo' }))).toBe(150);
    expect(credit.allowanceFor(active({ selected_plan: 'practice', plan_tier: 'Practice', seats: 5 }))).toBe(350);
    expect(credit.allowanceFor(active({ selected_plan: null, plan_tier: 'Firm', seats: 20 }))).toBe(750);
  });
  it('free launch keeps 25 until 1 June 2027', () => {
    expect(credit.allowanceFor(active({ free_plan: true }), new Date('2026-12-01'))).toBe(25);
  });
});

describe('AC16 Enterprise: a per-firm credit allowance set by the superadmin wins over the plan', () => {
  const firm = (o: Record<string, unknown>) => ({
    plan_tier: 'Firm', plan_status: 'active', free_plan: false, selected_plan: 'enterprise', seats: 20, renews_at: null, trial_ends_at: null, ...o,
  }) as never;
  it('custom 2,500 credits; "0" from the DB is respected; null falls back to the tier', () => {
    expect(credit.allowanceFor(firm({ credit_allowance: '2500.0' }))).toBe(2500);
    expect(credit.allowanceFor(firm({ credit_allowance: '0' }))).toBe(0);
    expect(credit.allowanceFor(firm({ credit_allowance: null }))).toBe(750);
  });
  it('not while the plan is inactive', () => {
    expect(credit.allowanceFor(firm({ credit_allowance: 2500, plan_status: 'cancelled' }))).toBe(0);
  });
});

describe('AC7 invite seat caps: 1 / 3 / 8 advocates; Munshi within Munshi seats', () => {
  const firm = (o: Partial<{ seats: number; munshi_seats: number; used: number; munshi_used: number }>) => (t: string) =>
    (t.includes('from firms f') ? [{ seats: 1, munshi_seats: 0, used: 1, munshi_used: 0, ...o }] : []);
  it.each([[1, 'advocate'], [3, 'chambers'], [8, 'law_firm']] as const)('%s seats (%s): the next advocate is refused (402)', async (seats, _plan) => {
    h.useFakeDb = true;
    h.rows = firm({ seats, used: seats });
    await expect(invitations.assertSeatCapNotExceeded('f1', 'Associate')).rejects.toMatchObject({ status: 402, code: 'seat_cap_exceeded' });
    h.rows = firm({ seats, used: seats - 1 });
    await expect(invitations.assertSeatCapNotExceeded('f1', 'Associate')).resolves.toBeUndefined();
  });
  it('a Munshi within the Munshi seats passes; past them is refused', async () => {
    h.useFakeDb = true;
    h.rows = firm({ seats: 1, used: 1, munshi_seats: 1 });
    await expect(invitations.assertSeatCapNotExceeded('f1', 'Munshi')).resolves.toBeUndefined();
    h.rows = firm({ seats: 1, used: 2, munshi_seats: 1, munshi_used: 1 });
    await expect(invitations.assertSeatCapNotExceeded('f1', 'Munshi')).rejects.toMatchObject({ status: 402 });
  });
  it('accepting an invite does not count that invite twice', async () => {
    h.useFakeDb = true;
    h.rows = firm({ seats: 3, used: 2 });
    const id = '11111111-1111-1111-1111-111111111111';
    await expect(invitations.assertSeatCapNotExceeded('f1', 'Associate', id)).resolves.toBeUndefined();
    expect(h.calls[0]!.values).toContain(id);
  });
});

describe('AC8 a plan smaller than the practice is refused at checkout', () => {
  it('4 advocates: Chambers refused (seats_below_members), Firm accepted', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ role: 'Managing Partner', members: 4 });
    stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'chambers', 'monthly'))
      .rejects.toMatchObject({ status: 400, code: 'seats_below_members', message: expect.stringMatching(/up to 3 advocates/) });
    await expect(billing.billingService.startCheckout('u1', 'law_firm', 'monthly')).resolves.toHaveProperty('checkoutUrl');
  });
  it('one advocate with a clerk: Advocate needs the Munshi seat', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ members: 2, munshi_members: 1 });
    stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'advocate', 'monthly', 0)).rejects.toMatchObject({ code: 'seats_below_members' });
    await expect(billing.billingService.startCheckout('u1', 'advocate', 'monthly', 1)).resolves.toHaveProperty('checkoutUrl');
  });
});

describe('AC11 a v4 order opened before the switch and paid after is honoured', () => {
  it('Sanad ₹199: applied as Advocate (1 seat, Solo), invoiced by backing GST out of ₹199', async () => {
    h.useFakeDb = true;
    h.rows = firmRows('Tamil Nadu');
    await pay({ kind: 'plan', firm_id: FIRM, plan: 'sanad', cycle: 'monthly', seats: '1', munshi: '0' }, 19900);
    const upd = firmUpdate()!;
    expect(valueAfter(upd, 'selected_plan =')).toBe('advocate');
    expect(valueAfter(upd, 'plan_tier =')).toBe('Solo');
    expect(valueAfter(upd, 'mrr_inr =')).toBe(169);
    expect(invoiceInsert()!.values.slice(-5)).toEqual([16864, 1518, 1518, 0, 19900]);
  });

  it('Associates for 4 advocates (₹2,596): applied as Firm (8 seats, Firm tier)', async () => {
    h.useFakeDb = true;
    h.rows = firmRows();
    await pay({ kind: 'plan', firm_id: FIRM, plan: 'associates', cycle: 'monthly', seats: '4', munshi: '0' }, 259600);
    expect(valueAfter(firmUpdate()!, 'selected_plan =')).toBe('law_firm');
    expect(valueAfter(firmUpdate()!, 'seats =')).toBe(8);
  });

  it('a v4 order paid at a v5 amount (or the reverse) is refused', async () => {
    h.useFakeDb = true;
    h.rows = firmRows();
    await pay({ kind: 'plan', firm_id: FIRM, plan: 'sanad', cycle: 'monthly', seats: '1', munshi: '0' }, 82482);
    expect(firmUpdate()).toBeUndefined();
  });

  it('a v4 Brief Pack order (₹499, no pricing note) still grants its 25 credits', async () => {
    h.useFakeDb = true;
    h.rows = firmRows();
    await pay({ firm_id: FIRM, pack: 'pack_25' }, 49900);
    expect(h.calls.some((c) => c.text.includes('insert into credit_grants'))).toBe(true);
    expect(invoiceInsert()!.values.at(-1)).toBe(49900);
  });
});

describe('AC12 old plan ids still read on old rows and invoices; the invoice names the v5 plan', () => {
  it('labels', () => {
    expect(plans.planLabel('sanad', 1, 0)).toBe('Sanad');
    expect(plans.planLabel('associates', 3, 1)).toBe('Associates, 3 advocates + 1 Munshi seat');
    expect(plans.planLabel('chambers', 3, 1)).toBe('Chambers (up to 3 advocates) + 1 Munshi seat');
    expect(plans.planLabel('law_firm', 8, 0)).toBe('Firm (up to 8 advocates)');
    expect(plans.planLabel('advocate', 1, 0)).toBe('Advocate');
  });
  it('"DifAi Chambers (up to 3 advocates) + 1 Munshi seat, billed monthly"', () => {
    const html = invoices.subscriptionInvoiceService.html({
      id: 'i', invoice_no: 'DIF/26-27/000009', firm_id: 'f', razorpay_payment_id: 'pay_1', plan: 'chambers', cycle: 'monthly',
      seats: 3, munshi_seats: 1, period_start: null, period_end: null,
      buyer: { name: 'N', practice: null, gstin: null, address: null, state: '33-Tamil Nadu', email: null, phone: null },
      seller: { legalName: 'L', tradeName: 'T', gstin: '33CVVPM9805M1ZO', address: 'Chennai', state: '33-Tamil Nadu', email: '', phone: '' },
      place_of_supply: '33-Tamil Nadu', sac: '998315', taxable_paise: 184800, cgst_paise: 16632, sgst_paise: 16632, igst_paise: 0, total_paise: 218064,
      issued_at: new Date('2026-11-16T10:00:00Z'),
    } as never);
    expect(html).toContain('DifAi Chambers (up to 3 advocates) + 1 Munshi seat, billed monthly');
  });
});

describe('Onboarding: new sign-ups pick a paid v5 plan; free-launch accounts keep free', () => {
  const rows = (freeLaunch: boolean) => (t: string) =>
    t.includes('onboarded_at from users') ? [{ firm_id: 'f1', name: 'Asha', onboarded_at: null }]
      : t.includes('select free_launch from firms') ? [{ free_launch: freeLaunch }]
        : t.includes('from users u left join firms') ? [owner({ role: 'Managing Partner' })]
          : [];
  const update = () => h.calls.find((c) => /update firms set\s+name =/.test(c.text))! as Call;

  it('a new account cannot pick Free (plan_required) and nothing is changed', async () => {
    h.useFakeDb = true;
    h.rows = rows(false);
    await expect(onboarding.onboardingService.complete('u1', { plan: 'free' })).rejects.toMatchObject({ status: 400, code: 'plan_required' });
    expect(h.calls.some((c) => /update firms/.test(c.text))).toBe(false);
  });

  it('a free-launch account keeps Free till 1 June 2027', async () => {
    h.useFakeDb = true;
    h.rows = rows(true);
    const r = await onboarding.onboardingService.complete('u1', { plan: 'free', kind: 'student', college: 'GLC' });
    expect(r.checkoutUrl).toBeUndefined();
    expect(valueAfter(update(), 'free_plan =')).toBe(true);
    expect(valueAfter(update(), 'trial_ends_at =')).toEqual(freePlan.FREE_PLAN_ENDS_AT);
  });

  it('Advocate: Solo tier, not free, a 30-minute window to pay, Razorpay opens for ₹824.82', async () => {
    h.useFakeDb = true;
    h.rows = rows(false);
    const { body } = stubRazorpay();
    const before = Date.now();
    const r = await onboarding.onboardingService.complete('u1', { plan: 'advocate', cycle: 'monthly' });
    expect(r.checkoutUrl).toBe('https://app.example.in/api/billing/pay/order_v5abcdef');
    expect(valueAfter(update(), 'free_plan =')).toBe(false);
    expect(valueAfter(update(), 'plan_tier =')).toBe('Solo');
    const ends = (valueAfter(update(), 'trial_ends_at =') as Date).getTime();
    expect(ends - before).toBeGreaterThanOrEqual(onboarding.PAYMENT_WINDOW_MS - 1000);
    expect(ends - before).toBeLessThanOrEqual(onboarding.PAYMENT_WINDOW_MS + 5000);
    expect(body('/orders').amount).toBe(82482);
  });

  it.each([['chambers', 'Practice', (1699 + 149) * 118], ['law_firm', 'Firm', (3699 + 149) * 118]] as const)(
    '%s + 1 Munshi: %s tier, owner is Managing Partner, Razorpay opens for the price + GST', async (plan, tier, amount) => {
      h.useFakeDb = true;
      h.rows = rows(false);
      const { body } = stubRazorpay();
      await onboarding.onboardingService.complete('u1', { plan, firm: 'Asha & Associates', munshi: 1 });
      expect(valueAfter(update(), 'plan_tier =')).toBe(tier);
      const userUpdate = h.calls.find((c) => /update users set\s+role =/.test(c.text))! as Call;
      expect(valueAfter(userUpdate, 'role =')).toBe('Managing Partner');
      expect(body('/orders').amount).toBe(amount);
    });

  it('Chambers without a firm name is refused', async () => {
    h.useFakeDb = true;
    h.rows = rows(false);
    await expect(onboarding.onboardingService.complete('u1', { plan: 'chambers' })).rejects.toMatchObject({ status: 400 });
  });

  it('interim (owner, 2026-11-14): without live payment keys a new sign-up gets the free launch, no checkout', async () => {
    vi.resetModules();
    const saved = process.env['RAZORPAY_KEY_ID'];
    process.env['RAZORPAY_KEY_ID'] = '';
    try {
      const fresh = await import('../onboarding.service');
      h.useFakeDb = true;
      h.rows = rows(false);
      const r = await fresh.onboardingService.complete('u1', { plan: 'advocate' });
      expect(r.checkoutUrl).toBeUndefined();
      const upd = h.calls.find((c) => /update firms set\s+name =/.test(c.text))! as Call;
      expect(valueAfter(upd, 'free_plan =')).toBe(true);
      expect(valueAfter(upd, 'free_launch = free_launch or')).toBe(true);
    } finally {
      process.env['RAZORPAY_KEY_ID'] = saved;
      vi.resetModules();
    }
  });
});

describe('AC17 analytics on every plan; never for a Munshi', () => {
  it('Solo Advocate (Advocate plan owner) gets the Analytics page and its data; Munshi does not', async () => {
    const { __testing } = await import('../permissions.service');
    expect(__testing.demoFallbackFor('Solo Advocate')).toEqual(expect.arrayContaining(['analytics.firm', 'reports.activity']));
    expect(__testing.demoFallbackFor('Firm Admin')).toContain('analytics.firm');
    expect(__testing.demoFallbackFor('Munshi')).not.toContain('analytics.firm');
  });

  it('migration grants analytics.firm to the Solo and Practice tiers and the Solo Advocate role only', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/0113_pricing_v5.sql'), 'utf8');
    expect(sql).toMatch(/'Solo'::firm_plan_tier,\s+'analytics\.firm'/);
    expect(sql).toMatch(/'Practice'::firm_plan_tier,\s+'analytics\.firm'/);
    expect(sql).toMatch(/r\.name = 'Solo Advocate'/);
    expect(sql).not.toMatch(/name = 'Munshi'/);
  });
});

describe("Munshi = the advocate's clerk (owner, 2026-11-14): no AI", () => {
  it('the role has diary, hearings, eFiling and documents, and no AI feature', async () => {
    const { __testing } = await import('../permissions.service');
    const f = __testing.demoFallbackFor('Munshi');
    for (const k of ['matter.view', 'matter.create', 'client.view', 'drafting.basic', 'tools.calculators']) expect(f).toContain(k);
    for (const k of ['drafting.ai', 'mock_arguments.use', 'matter.intelligence', 'research.basic']) expect(f).not.toContain(k);
  });

  it('any AI charge by a Munshi is refused (403 munshi_no_ai) before credits move', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('select role from users') ? [{ role: 'Munshi' }] : []);
    await expect(credit.creditService.charge({ firmId: 'f1', userId: '00000000-0000-0000-0000-0000000000a1' }, 'research', 2))
      .rejects.toMatchObject({ status: 403, code: 'munshi_no_ai' });
    expect(h.calls.some((c) => /credit_grants|credit_ledger/.test(c.text))).toBe(false);
  });

  it('Munshi seat: ₹149 + GST a month, ₹1,639 + GST a year, max 4', () => {
    expect(plans.MUNSHI).toEqual({ monthlyInr: 149, annualInr: 1639, max: 4 });
    expect(plans.MUNSHI_ROLES).toEqual(['Munshi']);
  });
});
