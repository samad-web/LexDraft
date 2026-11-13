import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Pricing v4 plan catalogue - tests map to the acceptance criteria (AC#) in
// build-docs/features/pricing-v4.md.

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
let freePlan: typeof import('../../lib/free-plan');

beforeAll(async () => {
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'key-secret', RAZORPAY_WEBHOOK_SECRET: 'wh-secret',
    WEB_PUBLIC_BASE_URL: 'https://app.example.in',
  });
  billing = await import('../billing.service');
  onboarding = await import('../onboarding.service');
  invitations = await import('../invitations.service');
  invoices = await import('../subscription-invoice.service');
  freePlan = await import('../../lib/free-plan');
});

afterEach(() => {
  h.useFakeDb = false;
  h.calls = [];
  h.rows = () => [];
  vi.unstubAllGlobals();
});

/** Razorpay API stub: records the plan amount it was asked to create. */
function stubRazorpay() {
  const fetchMock = vi.fn(async (url: string) => {
    const id = url.endsWith('/plans') ? 'plan_v4' : url.endsWith('/subscriptions') ? 'sub_v4abcdef' : 'x';
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

// Expected v4 prices, written out independently of lib/plans.ts.
const V4 = {
  sanad:      { name: 'Sanad',      monthly: 199,  annual: 2190,  pages: 25 },
  vakalat:    { name: 'Vakalat',    monthly: 399,  annual: 4490,  pages: 75 },
  brief:      { name: 'Brief',      monthly: 1499, annual: 16490, pages: 200 },
  associates: { name: 'Associates', monthly: 649,  annual: 7140,  pages: 75 },
} as const;
const MUNSHI = { monthly: 149, annual: 1590 };

describe('AC1 the catalogue is exactly the v4 table, and the web mirrors it', () => {
  it('billingPlans() returns the v4 plans, prices, pages, seats and Munshi add-on (GST included)', () => {
    const plans = billing.billingPlans();
    expect(plans.map((p) => p.id)).toEqual(['sanad', 'vakalat', 'brief', 'associates', 'partners']);
    for (const [id, v] of Object.entries(V4)) {
      expect(plans.find((p) => p.id === id)).toMatchObject({
        name: v.name, monthlyInr: v.monthly, annualInr: v.annual, pagesPerMonth: v.pages, gst: 'inclusive',
        munshi: { monthlyInr: MUNSHI.monthly, annualInr: MUNSHI.annual, max: 4 },
      });
      expect(plans.find((p) => p.id === id)!.meaning).toMatch(new RegExp(`^${v.name}: `));
    }
    expect(plans.find((p) => p.id === 'associates')!.seats).toEqual({ min: 2, max: 8 });
    expect(plans.find((p) => p.id === 'partners')).toMatchObject({ monthlyInr: null, purchasable: false });
    expect(plans.some((p) => p.id === 'free')).toBe(false); // decision 1a: not sold to new sign-ups
  });

  it('web SIGNUP_PLANS mirrors billingPlans() (except purchasable)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../../web/src/components/PlanCards.tsx'), 'utf8');
    const start = src.indexOf('[', src.indexOf('export const SIGNUP_PLANS'));
    const end = src.indexOf('\n];', start) + 2;
    const web = new Function(`return ${src.slice(start, end)}`)() as Array<Record<string, unknown>>;
    const strip = (p: Record<string, unknown>) => { const { purchasable: _p, ...rest } = p; return rest; };
    expect(web.map(strip)).toEqual(billing.billingPlans().map((p) => strip(p as unknown as Record<string, unknown>)));
  });
});

describe('AC2 checkout charges the right amount for every plan x cycle x advocates x munshi', () => {
  it('every combination, GST included (nothing added on top)', () => {
    for (const [id, v] of Object.entries(V4) as Array<[keyof typeof V4, (typeof V4)[keyof typeof V4]]>) {
      for (const cycle of ['monthly', 'annual'] as const) {
        const each = cycle === 'annual' ? v.annual : v.monthly;
        const clerk = cycle === 'annual' ? MUNSHI.annual : MUNSHI.monthly;
        for (const advocates of id === 'associates' ? [2, 3, 4, 5, 6, 7, 8] : [1]) {
          for (const munshi of [0, 1, 2, 3]) {
            expect(billing.chargePaise(id, cycle, advocates, munshi)).toBe((each * advocates + clerk * munshi) * 100);
          }
        }
      }
    }
  });

  it('spot checks: Associates 3 advocates + 1 Munshi = ₹2,096 a month; yearly 4 + 2 = ₹31,740', () => {
    expect(billing.chargePaise('associates', 'monthly', 3, 1)).toBe(209600);
    expect(billing.chargePaise('associates', 'annual', 4, 2)).toBe(3174000);
    expect(billing.mrrFor('associates', 'annual', 4, 2)).toBe(2645);
  });

  it('the Razorpay plan is created for that exact amount and remembers the Munshi seats', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ role: 'Managing Partner' });
    const { body } = stubRazorpay();
    await billing.billingService.startCheckout('u1', 'associates', 'monthly', 3, 1);
    expect(body('/plans')).toMatchObject({ item: { amount: 209600, name: 'DifAi Associates, 3 advocates + 1 Munshi seat' } });
    expect(body('/subscriptions').notes).toMatchObject({ plan: 'associates', seats: '3', munshi: '1' });
    const stored = h.calls.find((c) => /insert into razorpay_plans/.test(c.text))!;
    expect(stored.values).toEqual(['plan_v4', 'associates', 'monthly', 3, 1, 209600]);
  });

  it.each([-1, 5, 1.5])('munshi = %s is refused before Razorpay is called', async (munshi) => {
    h.useFakeDb = true;
    h.rows = ownerRows({});
    const { fetchMock } = stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'vakalat', 'monthly', undefined, munshi))
      .rejects.toMatchObject({ status: 400, code: 'invalid_munshi' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AC3 the webhook sets plan, tier, advocates and Munshi seats from the Razorpay plan only', () => {
  it('notes claiming another plan are ignored', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from razorpay_plans where razorpay_plan_id')
      ? [{ plan: 'associates', cycle: 'annual', seats: 4, munshi_seats: 2 }] : []);
    await billing.billingService.handleWebhook('evt_v4a', {
      event: 'subscription.activated',
      payload: { subscription: { entity: {
        id: 'sub_v4abcdef', plan_id: 'plan_v4', current_end: 1_900_000_000,
        notes: { firm_id: 'f1', plan: 'sanad', seats: '1', munshi: '0' },
      } } },
    });
    const upd = h.calls.find((c) => /update firms set\s+plan_tier/.test(c.text))! as Call;
    expect(valueAfter(upd, 'plan_tier =')).toBe('Practice');
    expect(valueAfter(upd, 'selected_plan =')).toBe('associates');
    expect(valueAfter(upd, 'seats =')).toBe(4);
    expect(valueAfter(upd, 'munshi_seats =')).toBe(2);
    expect(valueAfter(upd, 'mrr_inr =')).toBe(2645);
  });

  it.each(['sanad', 'vakalat', 'brief'])('%s maps to the Solo permission tier', async (plan) => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from razorpay_plans where razorpay_plan_id') ? [{ plan, cycle: 'monthly', seats: 1, munshi_seats: 0 }] : []);
    await billing.billingService.handleWebhook(`evt_${plan}`, {
      event: 'subscription.activated',
      payload: { subscription: { entity: { id: 'sub_v4abcdef', plan_id: 'plan_v4', current_end: 1_900_000_000, notes: { firm_id: 'f1' } } } },
    });
    const upd = h.calls.find((c) => /update firms set\s+plan_tier/.test(c.text))! as Call;
    expect(valueAfter(upd, 'plan_tier =')).toBe('Solo');
  });

  it('a pre-v4 Razorpay plan (solo / practice) is never applied', async () => {
    h.useFakeDb = true;
    h.rows = (t) => (t.includes('from razorpay_plans where razorpay_plan_id') ? [{ plan: 'solo', cycle: 'monthly', seats: 1, munshi_seats: 0 }] : []);
    await billing.billingService.handleWebhook('evt_old', {
      event: 'subscription.activated',
      payload: { subscription: { entity: { id: 'sub_v4abcdef', plan_id: 'plan_old', notes: { firm_id: 'f1' } } } },
    });
    expect(h.calls.some((c) => /update firms/.test(c.text))).toBe(false);
  });
});

describe('AC4 seat checks refuse fewer advocates or Munshi seats than people using them', () => {
  // A chamber with 2 advocates and 1 paralegal (members include pending invites).
  const chamber = { role: 'Managing Partner', members: 3, munshi_members: 1 };

  it('Associates 2 advocates + 0 Munshi is refused; + 1 Munshi seat is accepted', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows(chamber);
    stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'associates', 'monthly', 2, 0))
      .rejects.toMatchObject({ status: 400, code: 'seats_below_members', message: expect.stringMatching(/Munshi seat/) });
    await expect(billing.billingService.startCheckout('u1', 'associates', 'monthly', 2, 1)).resolves.toHaveProperty('checkoutUrl');
  });

  it('a spare advocate seat can hold the Munshi: Associates 3 advocates + 0 is accepted', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows(chamber);
    stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'associates', 'monthly', 3, 0)).resolves.toHaveProperty('checkoutUrl');
  });

  it('one advocate with a clerk: Vakalat needs the Munshi seat', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ members: 2, munshi_members: 1 });
    stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'vakalat', 'monthly', undefined, 0))
      .rejects.toMatchObject({ code: 'seats_below_members' });
    await expect(billing.billingService.startCheckout('u1', 'vakalat', 'monthly', undefined, 1)).resolves.toHaveProperty('checkoutUrl');
  });

  it('two advocates never fit a one-advocate plan, whatever the Munshi seats', async () => {
    h.useFakeDb = true;
    h.rows = ownerRows({ members: 2, munshi_members: 0 });
    stubRazorpay();
    await expect(billing.billingService.startCheckout('u1', 'brief', 'monthly', undefined, 4))
      .rejects.toMatchObject({ code: 'seats_below_members', message: expect.stringMatching(/Associates/) });
  });

  describe('inviting a member', () => {
    const firm = (o: Partial<{ seats: number; munshi_seats: number; used: number; munshi_used: number }>) => (t: string) =>
      (t.includes('from firms f') ? [{ seats: 2, munshi_seats: 1, used: 2, munshi_used: 0, ...o }] : []);

    it('advocate seats full: another advocate is refused (402), a Paralegal takes the Munshi seat', async () => {
      h.useFakeDb = true;
      h.rows = firm({});
      await expect(invitations.assertSeatCapNotExceeded('f1', 'Associate')).rejects.toMatchObject({ status: 402, code: 'seat_cap_exceeded' });
      await expect(invitations.assertSeatCapNotExceeded('f1', 'Paralegal')).resolves.toBeUndefined();
    });

    it('Munshi seat taken too: a Legal Secretary is refused', async () => {
      h.useFakeDb = true;
      h.rows = firm({ used: 3, munshi_used: 1 });
      await expect(invitations.assertSeatCapNotExceeded('f1', 'Legal Secretary')).rejects.toMatchObject({ status: 402 });
    });

    it('accepting an invite does not count that invite twice (2 seats: owner + the invitee fit)', async () => {
      h.useFakeDb = true;
      h.rows = firm({ munshi_seats: 0, used: 1 }); // the query leaves the accepted invite out
      const id = '11111111-1111-1111-1111-111111111111';
      await expect(invitations.assertSeatCapNotExceeded('f1', 'Associate', id)).resolves.toBeUndefined();
      expect(h.calls[0]!.values).toContain(id);
    });
  });
});

describe('AC5 the invoice line names the v4 plan, advocates and Munshi seats', () => {
  it('"DifAi Associates, 3 advocates + 1 Munshi seat, billed monthly"', () => {
    const html = invoices.subscriptionInvoiceService.html({
      id: 'i', invoice_no: 'DIF/26-27/000002', firm_id: 'f', razorpay_payment_id: 'pay_1', plan: 'associates', cycle: 'monthly',
      seats: 3, munshi_seats: 1, period_start: null, period_end: null,
      buyer: { name: 'N', practice: null, gstin: null, address: null, state: '33-Tamil Nadu', email: null, phone: null },
      seller: { legalName: 'M MOHAMED RIYAZ', tradeName: 'SIRAH DIGITAL', gstin: '33CVVPM9805M1ZO', address: 'Chennai', state: '33-Tamil Nadu', email: '', phone: '' },
      place_of_supply: '33-Tamil Nadu', sac: '998315', taxable_paise: 177627, cgst_paise: 15987, sgst_paise: 15986, igst_paise: 0, total_paise: 209600,
      issued_at: new Date('2026-11-13T10:00:00Z'),
    } as never);
    expect(html).toContain('DifAi Associates, 3 advocates + 1 Munshi seat, billed monthly');
  });

  it('one-advocate plans read "DifAi Vakalat, billed yearly"', () => {
    const html = invoices.subscriptionInvoiceService.html({
      id: 'i', invoice_no: 'DIF/26-27/000003', firm_id: 'f', razorpay_payment_id: 'pay_2', plan: 'vakalat', cycle: 'annual',
      seats: 1, munshi_seats: 0, period_start: null, period_end: null,
      buyer: { name: 'N', practice: null, gstin: null, address: null, state: '33-Tamil Nadu', email: null, phone: null },
      seller: { legalName: 'L', tradeName: 'T', gstin: '33CVVPM9805M1ZO', address: 'Chennai', state: '33-Tamil Nadu', email: '', phone: '' },
      place_of_supply: '33-Tamil Nadu', sac: '998315', taxable_paise: 380508, cgst_paise: 34246, sgst_paise: 34246, igst_paise: 0, total_paise: 449000,
      issued_at: new Date('2026-11-13T10:00:00Z'),
    } as never);
    expect(html).toContain('DifAi Vakalat, billed yearly');
  });
});

describe('AC6 new sign-ups pick a paid plan; free-launch accounts keep free', () => {
  const rows = (freeLaunch: boolean) => (t: string) =>
    t.includes('onboarded_at from users') ? [{ firm_id: 'f1', name: 'Asha', onboarded_at: null }]
      : t.includes('select free_launch from firms') ? [{ free_launch: freeLaunch }]
        : t.includes('from users u left join firms') ? [owner({ role: 'Managing Partner' })]
          : [];
  const firmUpdate = () => h.calls.find((c) => /update firms set\s+name =/.test(c.text))! as Call;

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
    expect(valueAfter(firmUpdate(), 'free_plan =')).toBe(true);
    expect(valueAfter(firmUpdate(), 'trial_ends_at =')).toEqual(freePlan.FREE_PLAN_ENDS_AT);
  });

  it('Vakalat: Solo tier, not free, a 30-minute window to pay, and Razorpay opens for ₹399', async () => {
    h.useFakeDb = true;
    h.rows = rows(false);
    const { body } = stubRazorpay();
    const before = Date.now();
    const r = await onboarding.onboardingService.complete('u1', { plan: 'vakalat', cycle: 'monthly' });
    expect(r.checkoutUrl).toBe('https://app.example.in/api/billing/pay/sub_v4abcdef');
    expect(valueAfter(firmUpdate(), 'free_plan =')).toBe(false);
    expect(valueAfter(firmUpdate(), 'plan_tier =')).toBe('Solo');
    const ends = (valueAfter(firmUpdate(), 'trial_ends_at =') as Date).getTime();
    expect(ends - before).toBeGreaterThanOrEqual(onboarding.PAYMENT_WINDOW_MS - 1000);
    expect(ends - before).toBeLessThanOrEqual(onboarding.PAYMENT_WINDOW_MS + 5000);
    expect(body('/plans').item.amount).toBe(39900);
  });

  it('Associates 3 advocates + 1 Munshi: Practice tier, owner is Managing Partner, Razorpay opens for ₹2,096', async () => {
    h.useFakeDb = true;
    h.rows = rows(false);
    const { body } = stubRazorpay();
    await onboarding.onboardingService.complete('u1', { plan: 'associates', firm: 'Asha & Associates', seats: 3, munshi: 1 });
    expect(valueAfter(firmUpdate(), 'plan_tier =')).toBe('Practice');
    const userUpdate = h.calls.find((c) => /update users set\s+role =/.test(c.text))! as Call;
    expect(valueAfter(userUpdate, 'role =')).toBe('Managing Partner');
    expect(body('/plans').item.amount).toBe(209600);
  });

  it('Associates without a firm name is refused', async () => {
    h.useFakeDb = true;
    h.rows = rows(false);
    await expect(onboarding.onboardingService.complete('u1', { plan: 'associates' })).rejects.toMatchObject({ status: 400 });
  });

  it('without online payment a paid plan is refused (503) and nothing is changed', async () => {
    vi.resetModules();
    const saved = process.env['RAZORPAY_KEY_ID'];
    process.env['RAZORPAY_KEY_ID'] = '';
    try {
      const fresh = await import('../onboarding.service');
      h.useFakeDb = true;
      h.rows = rows(false);
      await expect(fresh.onboardingService.complete('u1', { plan: 'sanad' })).rejects.toMatchObject({ status: 503, code: 'payments_disabled' });
      expect(h.calls.some((c) => /update firms/.test(c.text))).toBe(false);
    } finally {
      process.env['RAZORPAY_KEY_ID'] = saved;
      vi.resetModules();
    }
  });
});
