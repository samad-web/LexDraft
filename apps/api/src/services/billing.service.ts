import crypto from 'node:crypto';
import type {
  AdminBillingEvent, AdminBillingSummary, BillingCycle, BillingEventKind, BillingPlan,
  BillingPlanId, BillingStateResponse, BriefPack, BriefPackId, FirmPlanTier, PaidPlanId,
} from '@lexdraft/types';
import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { FREE_PLAN_ENDS_AT } from '../lib/free-plan';
import {
  BRIEF_PACK_DAYS, BRIEF_PACKS, isBriefPack, isPaidPlan, isV4Plan, MUNSHI, MUNSHI_ROLES, monthlyValueInr, periodPriceInr,
  PLANS, V4_PACK_PRICES, v4ChargePaise, v5PlanFor, withGstPaise,
} from '../lib/plans';
import { creditService } from './credit.service';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError, UnauthorizedError } from '../lib/errors';
import { invalidatePlanStatusCache } from './plan-status.service';
import { invalidatePermissionsCache } from './permissions.service';
import { subscriptionInvoiceService } from './subscription-invoice.service';

// =============================================================================
// Self-serve billing through Razorpay Subscriptions (migrations 0096 + 0105).
//
// The owner picks a plan; we create a Razorpay subscription and send them to
// /api/billing/pay/:id, which opens Razorpay Checkout (UPI Autopay, cards,
// netbanking). Razorpay then calls POST /api/billing/webhook and the firm's plan
// flips there, never on the browser's say-so. Every step is written to
// billing_events so the superadmin Billing page sees who stopped at checkout.
// =============================================================================

/** Only the account owner (the person who signed up) buys or changes the plan. */
const OWNER_ROLES = new Set(['Solo Advocate', 'Managing Partner']);


export function paymentsEnabled(): boolean {
  return !!env.razorpay.keyId && !!env.razorpay.keySecret;
}

if (env.razorpay.testKeyInProd) {
  logger.error('RAZORPAY_KEY_ID is a test key in production: online payment stays OFF');
}

const GST_NOTE = '+ 18% GST · billed monthly or yearly';
const MUNSHI_OFFER = { monthlyInr: MUNSHI.monthlyInr, annualInr: MUNSHI.annualInr, max: MUNSHI.max };

/** The v5 plans on sale (lib/plans.ts). The free launch plan is not sold: only
 *  accounts that already have it keep it (firms.free_launch). */
export function billingPlans(): BillingPlan[] {
  const can = paymentsEnabled();
  const paid = (id: PaidPlanId, extra: Pick<BillingPlan, 'for' | 'meaning' | 'features'>): BillingPlan => ({
    id, name: PLANS[id].name, monthlyInr: PLANS[id].monthlyInr, annualInr: PLANS[id].annualInr, note: GST_NOTE,
    purchasable: can, pagesPerMonth: PLANS[id].credits, advocates: PLANS[id].seats, gst: 'exclusive', munshi: MUNSHI_OFFER, ...extra,
  });
  return [
    paid('advocate', {
      for: 'One advocate · the full app with AI drafting',
      meaning: 'For an advocate practising on their own.',
      features: [`${PLANS.advocate.credits} AI credits a month (1 credit = one 400-word page)`, 'Cases, diary & eCourts sync', 'eFiling help, limitation & land records', 'Firm analytics', `Add a Munshi seat for ₹${MUNSHI.monthlyInr} + GST a month`],
    }),
    paid('chambers', {
      for: `Up to ${PLANS.chambers.seats} advocates`,
      meaning: 'For a chamber: a senior with a few advocates working together.',
      features: [`${PLANS.chambers.credits} AI credits a month, shared`, 'Everything in Advocate', 'Roles and permissions', 'Firm dashboard and team chat'],
    }),
    paid('law_firm', {
      for: `Up to ${PLANS.law_firm.seats} advocates`,
      meaning: 'For a law firm with several advocates.',
      features: [`${PLANS.law_firm.credits} AI credits a month, shared`, 'Everything in Chambers', 'Up to 8 advocates'],
    }),
    {
      id: 'enterprise', name: 'Enterprise', for: 'Nine advocates and above',
      meaning: 'For larger firms: seats and AI credits set to your size.',
      monthlyInr: null, annualInr: null, note: 'Custom quote · talk to us',
      features: ['Seats and AI credits set for your firm', 'Everything in Firm', 'Dedicated success manager'],
      purchasable: false, pagesPerMonth: null, advocates: null, gst: null,
    },
  ];
}

/** Rupees a month for MRR (yearly spread over 12), GST excluded. */
export function mrrFor(plan: PaidPlanId, cycle: BillingCycle, munshi = 0): number {
  return monthlyValueInr(plan, cycle, munshi);
}

/** What Razorpay charges per billing period, in paise: the price + 18% GST. */
export function chargePaise(plan: PaidPlanId, cycle: BillingCycle, munshi = 0): number {
  return withGstPaise(periodPriceInr(plan, cycle, munshi));
}

async function logEvent(e: {
  firmId: string; userId?: string | null; kind: BillingEventKind; plan?: string | null;
  cycle?: string | null; amountPaise?: number | null; providerRef?: string | null; webhookId?: string | null;
}): Promise<void> {
  const sql = db();
  if (!sql) return;
  // amount_paise is the exact amount charged (₹824.82); amount_inr stays whole rupees for old readers.
  const paise = e.amountPaise ?? null;
  await sql`
    insert into billing_events (firm_id, user_id, kind, plan, cycle, amount_inr, amount_paise, provider, provider_ref, webhook_id)
    values (${e.firmId}::uuid, ${e.userId ?? null}, ${e.kind}, ${e.plan ?? null}, ${e.cycle ?? null},
            ${paise == null ? null : Math.round(paise / 100)}, ${paise}, 'razorpay', ${e.providerRef ?? null}, ${e.webhookId ?? null})
  `;
}

interface OwnerRow {
  user_id: string; name: string; email: string; phone: string | null; role: string;
  firm_id: string | null; plan_tier: FirmPlanTier | null; plan_status: BillingStateResponse['current']['planStatus'];
  free_plan: boolean; trial_ends_at: Date | null; renews_at: Date | null; billing_cycle: BillingCycle | null;
  selected_plan: BillingPlanId | null; razorpay_subscription_id: string | null;
  seats: number | null; munshi_seats: number | null; members: number; munshi_members: number;
}

async function loadUser(userId: string): Promise<OwnerRow> {
  const sql = db();
  if (!sql) throw new HttpError(503, 'Billing needs the database.');
  const [row] = await sql<OwnerRow[]>`
    select u.id as user_id, u.name, u.email, u.phone, u.role, u.firm_id,
           f.plan_tier, f.plan_status, coalesce(f.free_plan, false) as free_plan, f.trial_ends_at,
           f.renews_at, f.billing_cycle, f.selected_plan, f.razorpay_subscription_id, f.seats, f.munshi_seats,
           ((select count(*)::int from users m where m.firm_id = u.firm_id and m.status = 'active')
            + (select count(*)::int from invitations i where i.firm_id = u.firm_id and i.status = 'pending')) as members,
           ((select count(*)::int from users m where m.firm_id = u.firm_id and m.status = 'active' and m.role = any(${MUNSHI_ROLES as string[]}))
            + (select count(*)::int from invitations i where i.firm_id = u.firm_id and i.status = 'pending' and i.role = any(${MUNSHI_ROLES as string[]}))) as munshi_members
    from users u left join firms f on f.id = u.firm_id
    where u.id = ${userId}::uuid
  `;
  if (!row) throw new NotFoundError('User not found');
  return row;
}

/** Razorpay's REST API (basic auth with the key id + secret), JSON in and out. */
async function razorpay<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const auth = Buffer.from(`${env.razorpay.keyId}:${env.razorpay.keySecret}`).toString('base64');
  const res = await fetch(`${env.razorpay.baseUrl}${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    logger.error({ status: res.status, body: text.slice(0, 500), path }, 'razorpay api call failed');
    throw new HttpError(502, 'The payment page could not be opened. Please try again in a minute.');
  }
  return JSON.parse(text) as T;
}

/** Constant-time compare of two hex HMACs. */
function hexEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{6,40}$/;

/** The owner's ₹1 test price. Valid only when the code matches the server's
 *  BILLING_TEST_COUPON AND the buyer's email is on BILLING_TEST_EMAILS, so a
 *  leaked code is useless to anyone else. No code given -> false. */
export const TEST_PRICE_PAISE = 100;
function testCouponFor(email: string | null, coupon: string | undefined): boolean {
  if (!coupon) return false;
  const { testCoupon, testEmails } = env.razorpay;
  const ok = !!testCoupon && coupon.trim().toUpperCase() === testCoupon && !!email && testEmails.includes(email.toLowerCase());
  if (!ok) throw new BadRequestError('This code is not valid.', { code: 'invalid_coupon' });
  return true;
}
const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;

export function briefPacks(): BriefPack[] {
  const can = paymentsEnabled();
  return (Object.keys(BRIEF_PACKS) as BriefPackId[]).map((id) => ({ id, ...BRIEF_PACKS[id], purchasable: can }));
}

type RzpSubscription = {
  id?: string; plan_id?: string; status?: string; quantity?: number; paid_count?: number; created_at?: number;
  current_start?: number | null; current_end?: number | null; customer_id?: string | null; notes?: Record<string, unknown> | unknown[];
};

/** Cancels a duplicate subscription immediately. Already-cancelled is fine; the
 *  payment it took has to be refunded from the Razorpay dashboard. */
async function cancelNow(subscriptionId: string, firmId: string): Promise<void> {
  try {
    await razorpay('POST', `/subscriptions/${subscriptionId}/cancel`, { cancel_at_cycle_end: 0 });
  } catch {
    // razorpay() already logged the API error (e.g. already cancelled).
  }
  logger.warn({ firmId, subscriptionId }, 'razorpay: duplicate subscription cancelled - refund its payment in the dashboard');
}

/** Grants a paid Brief Pack: exactly once (grant ref + invoice are unique on the
 *  payment id), only for the pack's exact price, as read from our own order. */
async function handleOrderPayment(eventId: string, payment: { id: string; order_id: string; amount?: unknown }): Promise<void> {
  const sql = db();
  if (!sql) return;
  const order = await razorpay<{ amount?: number; notes?: Record<string, unknown> | unknown[] }>('GET', `/orders/${payment.order_id}`);
  const notes = (order.notes && !Array.isArray(order.notes) ? order.notes : {}) as Record<string, unknown>;
  if (notes.kind === 'plan') return applyPlanPayment(eventId, payment, notes, Number(order.amount));
  return grantBriefPack(eventId, payment, notes, Number(order.amount));
}

/** A month or a year later (same day; end of month when it doesn't exist). */
export function addPeriod(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (cycle === 'annual' ? 12 : 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * A paid plan period (one-time order). Exactly once per payment, only for the
 * exact price of what our own order says was bought. A v4 order (opened before
 * pricing v5) is honoured at its v4 price and applied as the v5 plan it maps to.
 *  - Same plan (and seats) still active: the new period is added after the
 *    current end, so paying early never loses days.
 *  - A different plan, or nothing active: it starts now. Days left on a
 *    different plan are not carried over (owner, 2026-11-14).
 */
async function applyPlanPayment(eventId: string, payment: { id: string; amount?: unknown }, notes: Record<string, unknown>, orderAmount: number): Promise<void> {
  const sql = db();
  if (!sql) return;
  const firmId = typeof notes.firm_id === 'string' ? notes.firm_id : null;
  const ordered = notes.plan;
  const cycle = notes.cycle === 'annual' ? 'annual' : notes.cycle === 'monthly' ? 'monthly' : null;
  const orderedSeats = Number(notes.seats ?? 1);
  const munshi = Number(notes.munshi ?? 0);
  const v4 = !isPaidPlan(ordered) && isV4Plan(ordered);
  if (!firmId || (!isPaidPlan(ordered) && !v4) || !cycle || !Number.isInteger(orderedSeats) || orderedSeats < 1
    || !Number.isInteger(munshi) || munshi < 0 || munshi > MUNSHI.max) {
    logger.error({ paymentId: payment.id, notes }, 'plan payment: unreadable order notes, NOT applied');
    return;
  }
  const plan: PaidPlanId = v4 ? v5PlanFor(ordered as string, orderedSeats) : (ordered as PaidPlanId);
  const seats = PLANS[plan].seats;
  const test = notes.coupon === 'test'; // set only by our own checkout, on our own order
  const want = test ? TEST_PRICE_PAISE : v4 ? v4ChargePaise(ordered as string, cycle, orderedSeats, munshi) : chargePaise(plan, cycle, munshi);
  // Taxable value for the invoice: the ex-GST price. v4 prices included GST, so
  // those (and the ₹1 test) are backed out of the total instead.
  const taxablePaise = test || v4 ? undefined : periodPriceInr(plan, cycle, munshi) * 100;
  if (Number(payment.amount) !== want || orderAmount !== want) {
    logger.error({ paymentId: payment.id, plan, amount: payment.amount }, 'plan payment: amount does not match the plan, NOT applied');
    return;
  }
  const userId = typeof notes.user_id === 'string' ? notes.user_id : null;
  const applied = await sql.begin(async (tx) => {
    const [seen] = await tx<{ id: string }[]>`
      select id from billing_events where provider_ref = ${payment.id}
        and kind in ('subscription_active', 'renewed', 'plan_changed') limit 1`;
    if (seen) return null;
    const [f] = await tx<Array<{ selected_plan: string | null; plan_status: string | null; renews_at: Date | null; free_plan: boolean | null; seats: number | null; munshi_seats: number | null }>>`
      select selected_plan, plan_status, renews_at, free_plan, seats, munshi_seats from firms where id = ${firmId}::uuid for update`;
    if (!f) return null;
    const now = new Date();
    const active = f.plan_status === 'active' && !f.free_plan && !!f.renews_at && new Date(f.renews_at) > now;
    const same = active && f.selected_plan === plan && (f.seats ?? 1) === seats && (f.munshi_seats ?? 0) === munshi;
    const start = same ? new Date(f.renews_at!) : now;
    const end = addPeriod(start, cycle);
    await tx`
      update firms set
        plan_tier = ${PLANS[plan].tier}::firm_plan_tier,
        plan_status = 'active',
        free_plan = false,
        trial_ends_at = null,
        renews_at = ${end},
        billing_cycle = ${cycle},
        selected_plan = ${plan},
        mrr_inr = ${test ? 0 : v4 ? Math.round(want / 118 / (cycle === 'annual' ? 12 : 1)) : mrrFor(plan, cycle, munshi)},
        seats = ${seats},
        munshi_seats = ${munshi},
        credit_allowance = null,
        razorpay_subscription_id = null
      where id = ${firmId}::uuid`;
    const kind: BillingEventKind = !active ? 'subscription_active' : same ? 'renewed' : 'plan_changed';
    await tx`
      insert into billing_events (firm_id, user_id, kind, plan, cycle, amount_inr, amount_paise, provider, provider_ref, webhook_id)
      values (${firmId}::uuid, ${userId}, ${kind}, ${plan}, ${cycle}, ${Math.round(want / 100)}, ${want}, 'razorpay', ${payment.id}, ${eventId})`;
    return { start, end };
  });
  // The invoice is idempotent on the payment id: safe on a redelivery too.
  await subscriptionInvoiceService.issueForPayment({
    firmId, paymentId: payment.id, amountPaise: want, taxablePaise, subscriptionId: null,
    plan, cycle, seats, munshi, periodStart: applied?.start ?? null, periodEnd: applied?.end ?? null,
  });
  if (applied) {
    invalidatePlanStatusCache();
    invalidatePermissionsCache();
  }
}

async function grantBriefPack(eventId: string, payment: { id: string; amount?: unknown }, notes: Record<string, unknown>, orderAmount: number): Promise<void> {
  const pack = notes.pack;
  const firmId = typeof notes.firm_id === 'string' ? notes.firm_id : null;
  if (!isBriefPack(pack) || !firmId) return; // not one of ours
  const test = notes.coupon === 'test'; // set only by our own checkout, on our own order
  // Orders from before pricing v5 carry no `pricing` note and the v4 GST-inclusive price.
  const v4 = !test && notes.pricing !== 'v5';
  const want = test ? TEST_PRICE_PAISE : v4 ? V4_PACK_PRICES[pack] * 100 : withGstPaise(BRIEF_PACKS[pack].priceInr);
  if (Number(payment.amount) !== want || orderAmount !== want) {
    logger.error({ paymentId: payment.id, pack, amount: payment.amount }, 'brief pack: amount does not match the pack, NOT granted');
    return;
  }
  const granted = await creditService.addGrant({
    firmId, source: 'topup', amount: BRIEF_PACKS[pack].credits, ref: `topup:${payment.id}`,
    expiresAt: new Date(Date.now() + BRIEF_PACK_DAYS * 86_400_000), note: pack,
  });
  await subscriptionInvoiceService.issueForPayment({
    firmId, paymentId: payment.id, amountPaise: want, subscriptionId: null,
    taxablePaise: test || v4 ? undefined : BRIEF_PACKS[pack].priceInr * 100,
    plan: pack, cycle: 'one-time', seats: 0, periodStart: null, periodEnd: null,
  });
  if (granted) {
    const userId = typeof notes.user_id === 'string' ? notes.user_id : null;
    await logEvent({ firmId, userId, kind: 'pack_bought', plan: pack, cycle: 'one-time', amountPaise: want, providerRef: payment.id, webhookId: eventId });
  }
}

export const billingService = {
  plans: billingPlans,

  async state(userId: string): Promise<BillingStateResponse> {
    const u = await loadUser(userId);
    return {
      plans: billingPlans(),
      packs: briefPacks(),
      current: {
        planTier: u.plan_tier,
        planStatus: u.plan_status,
        freePlan: u.free_plan,
        trialEndsAt: u.trial_ends_at ? u.trial_ends_at.toISOString() : null,
        renewsAt: u.renews_at ? new Date(u.renews_at).toISOString() : null,
        billingCycle: u.billing_cycle,
        selectedPlan: u.selected_plan,
        // A custom (Enterprise) plan recorded by DifAi counts as paid, like a checkout.
        subscribed: u.plan_status === 'active' && !u.free_plan && (isPaidPlan(u.selected_plan) || u.selected_plan === 'enterprise'),
        seats: u.seats ?? 1,
        munshiSeats: u.munshi_seats ?? 0,
      },
      paymentsEnabled: paymentsEnabled(),
      canManage: OWNER_ROLES.has(u.role),
    };
  },

  /**
   * Creates a one-time Razorpay order for one period of the plan (price + 18%
   * GST) and returns the page that opens Razorpay Checkout for it. The plan's
   * advocate seats are fixed (1 / 3 / 8); any plan takes `munshi` clerk seats
   * (0-4). Nothing renews automatically (manual-renewal.md).
   */
  async startCheckout(userId: string, plan: PaidPlanId, cycle: BillingCycle, munshi = 0, coupon?: string): Promise<{ checkoutUrl: string }> {
    if (!isPaidPlan(plan)) throw new BadRequestError('Unknown plan.', { code: 'invalid_plan' });
    const wanted = PLANS[plan].seats;
    if (!Number.isInteger(munshi) || munshi < 0 || munshi > MUNSHI.max) {
      throw new BadRequestError(`Choose up to ${MUNSHI.max} Munshi seats.`, { code: 'invalid_munshi' });
    }
    const u = await loadUser(userId);
    if (!u.firm_id) throw new BadRequestError('Your account is not attached to a practice.');
    if (!OWNER_ROLES.has(u.role)) {
      throw new ForbiddenError('Only the account owner can change the plan.', { code: 'billing_owner_only' });
    }
    // A custom plan agreed with DifAi is changed by DifAi, never overwritten by a checkout.
    if (u.selected_plan === 'enterprise' && u.plan_status === 'active' && u.renews_at && new Date(u.renews_at) > new Date()) {
      throw new HttpError(409, 'Your practice is on a custom plan agreed with DifAi. Contact DifAi to change it.', { code: 'custom_plan_active' });
    }
    if (!paymentsEnabled()) {
      throw new HttpError(503, 'Online payment is not switched on yet. Please try again later.', { code: 'payments_disabled' });
    }
    // Members and pending invites must fit: advocates in advocate seats, and a
    // Munshi (Paralegal / Legal Secretary) in a Munshi seat or a spare advocate seat.
    const advocateMembers = u.members - u.munshi_members;
    if (advocateMembers > wanted || u.members > wanted + munshi) {
      const short = u.members - wanted;
      throw new BadRequestError(
        advocateMembers > wanted
          ? `${PLANS[plan].name} is for ${wanted === 1 ? 'one advocate' : `up to ${wanted} advocates`}, and your practice has ${advocateMembers} (with pending invitations). Choose a bigger plan, or remove members first.`
          : `Your practice has ${u.munshi_members} Munshi${u.munshi_members === 1 ? '' : 's'} (clerks). Add ${short} Munshi seat${short === 1 ? '' : 's'}, or remove members first.`,
        { code: 'seats_below_members' },
      );
    }
    // One payment buys one month or one year; nothing renews automatically
    // (owner, 2026-11-14). The plan is applied only by the signed
    // payment.captured webhook (applyPlanPayment).
    const test = testCouponFor(u.email, coupon);
    const order = await razorpay<{ id: string }>('POST', '/orders', {
      amount: test ? TEST_PRICE_PAISE : chargePaise(plan, cycle, munshi),
      currency: 'INR',
      receipt: `plan-${crypto.randomUUID().slice(0, 30)}`,
      notes: {
        kind: 'plan', pricing: 'v5', firm_id: u.firm_id, user_id: u.user_id, plan, cycle, seats: String(wanted), munshi: String(munshi),
        ...(test ? { coupon: 'test' } : {}),
      },
    });
    await logEvent({
      firmId: u.firm_id, userId: u.user_id, kind: 'checkout_started', plan, cycle,
      amountPaise: test ? TEST_PRICE_PAISE : chargePaise(plan, cycle, munshi), providerRef: order.id,
    });
    return { checkoutUrl: `${env.webPublicBaseUrl.replace(/\/$/, '')}/api/billing/pay/${order.id}` };
  },

  /** A Brief Pack: a one-time Razorpay order for its exact price. Credits are
   *  granted only by the signed `payment.captured` webhook. Owner only. */
  async startPackCheckout(userId: string, pack: BriefPackId, coupon?: string): Promise<{ checkoutUrl: string }> {
    if (!isBriefPack(pack)) throw new BadRequestError('Unknown Brief Pack.', { code: 'invalid_pack' });
    const u = await loadUser(userId);
    if (!u.firm_id) throw new BadRequestError('Your account is not attached to a practice.');
    if (!OWNER_ROLES.has(u.role)) {
      throw new ForbiddenError('Only the account owner can buy Brief Packs.', { code: 'billing_owner_only' });
    }
    if (!paymentsEnabled()) {
      throw new HttpError(503, 'Online payment is not switched on yet. Please try again later.', { code: 'payments_disabled' });
    }
    const p = BRIEF_PACKS[pack];
    const test = testCouponFor(u.email, coupon);
    const order = await razorpay<{ id: string }>('POST', '/orders', {
      amount: test ? TEST_PRICE_PAISE : withGstPaise(p.priceInr),
      currency: 'INR',
      receipt: `pack-${crypto.randomUUID().slice(0, 30)}`,
      notes: { pricing: 'v5', firm_id: u.firm_id, user_id: u.user_id, pack, ...(test ? { coupon: 'test' } : {}) },
    });
    await logEvent({ firmId: u.firm_id, userId: u.user_id, kind: 'checkout_started', plan: pack, cycle: 'one-time', amountPaise: test ? TEST_PRICE_PAISE : withGstPaise(p.priceInr), providerRef: order.id });
    return { checkoutUrl: `${env.webPublicBaseUrl.replace(/\/$/, '')}/api/billing/pay/${order.id}` };
  },

  /** The firm whose invoices this user may see: only the account owner's. */
  async ownerFirmId(userId: string): Promise<string> {
    const u = await loadUser(userId);
    if (!u.firm_id || !OWNER_ROLES.has(u.role)) {
      throw new ForbiddenError('Only the account owner can see invoices.', { code: 'billing_owner_only' });
    }
    return u.firm_id;
  },

  /** Plan picked on the first sign-up step. */
  async recordSignup(userId: string, plan: BillingPlanId, cycle: BillingCycle | null): Promise<void> {
    const sql = db();
    if (!sql) return;
    const [u] = await sql<{ firm_id: string | null }[]>`select firm_id from users where id = ${userId}::uuid`;
    if (!u?.firm_id) return;
    await sql`update firms set selected_plan = ${plan}, billing_cycle = ${cycle} where id = ${u.firm_id}::uuid`;
    await logEvent({ firmId: u.firm_id, userId, kind: 'signup', plan, cycle });
  },

  /** The small page that opens Razorpay Checkout for a subscription (sub_…)
   *  or a Brief Pack order (order_…), then returns to the app. Null when the
   *  id is malformed or payments are off. */
  payPage(id: string): string | null {
    const isOrder = ORDER_ID.test(id);
    if ((!isOrder && !SUBSCRIPTION_ID.test(id)) || !paymentsEnabled()) return null;
    const base = env.webPublicBaseUrl.replace(/\/$/, '');
    const options = {
      key: env.razorpay.keyId,
      ...(isOrder ? { order_id: id } : { subscription_id: id }),
      name: 'DifAi',
      description: 'DifAi',
      callback_url: `${base}/api/billing/callback`,
      redirect: true,
      theme: { color: '#111111' },
    };
    // JSON in a <script> block: escape "<" so nothing can close the tag.
    const json = JSON.stringify(options).replace(/</g, '\\u003c');
    const back = JSON.stringify(`${base}/app/billing?checkout=cancelled`).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>DifAi · Payment</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#111}</style></head>
<body><p id="m">Opening the secure payment page…</p>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
var o = ${json};
o.modal = { ondismiss: function () { location.href = ${back}; } };
if (window.Razorpay) { new Razorpay(o).open(); }
else { document.getElementById('m').textContent = 'The payment page could not load. Please check your connection and try again.'; }
</script></body></html>`;
  },

  /** Where Razorpay Checkout returns after paying. The plan itself only
   *  changes on the webhook; this just picks the right message. */
  checkoutReturn(body: Record<string, unknown>): string {
    const base = `${env.webPublicBaseUrl.replace(/\/$/, '')}/app/billing?checkout=`;
    const paymentId = String(body.razorpay_payment_id ?? '');
    const orderId = String(body.razorpay_order_id ?? '');
    if (orderId) {
      // A Brief Pack order: signature = HMAC(order_id|payment_id).
      const s = String(body.razorpay_signature ?? '');
      if (!paymentId || !s || !env.razorpay.keySecret) return `${base}cancelled`;
      const want = crypto.createHmac('sha256', env.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
      return hexEqual(s, want) ? `${base}paid` : `${base}cancelled`;
    }
    const subId = String(body.razorpay_subscription_id ?? '');
    const sig = String(body.razorpay_signature ?? '');
    if (!paymentId || !subId || !sig || !env.razorpay.keySecret) return `${base}cancelled`;
    const expected = crypto.createHmac('sha256', env.razorpay.keySecret).update(`${paymentId}|${subId}`).digest('hex');
    return hexEqual(sig, expected) ? `${base}done` : `${base}cancelled`;
  },

  /** Razorpay webhook: X-Razorpay-Signature is the hex HMAC-SHA256 of the raw
   *  body with the webhook secret. Returns the event id (for idempotency). */
  verifyWebhook(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>): string {
    const secret = env.razorpay.webhookSecret;
    if (!secret) throw new HttpError(503, 'Billing webhook secret not configured');
    const sig = String(headers['x-razorpay-signature'] ?? '');
    const id = String(headers['x-razorpay-event-id'] ?? '');
    if (!rawBody || !sig || !id) {
      logger.warn({ hasBody: !!rawBody, hasSignature: !!sig, hasEventId: !!id }, 'razorpay webhook: missing signature parts');
      throw new UnauthorizedError('Missing webhook signature');
    }
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!hexEqual(sig, expected)) {
      logger.warn({ eventId: id, bodyBytes: rawBody.length }, 'razorpay webhook: bad signature (check RAZORPAY_WEBHOOK_SECRET matches the dashboard)');
      throw new UnauthorizedError('Bad webhook signature');
    }
    return id;
  },

  async handleWebhook(eventId: string, event: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> }): Promise<void> {
    const sql = db();
    if (!sql) return;
    const type = event.event ?? '';
    const sub = (event.payload?.subscription?.entity ?? {}) as RzpSubscription;
    const payment = (event.payload?.payment?.entity ?? {}) as Record<string, unknown>;
    const subscriptionId = sub.id ?? (typeof payment.subscription_id === 'string' ? payment.subscription_id : null);
    const notes = (sub.notes && !Array.isArray(sub.notes) ? sub.notes : {}) as Record<string, unknown>;
    const periodEnd = typeof sub.current_end === 'number' ? new Date(sub.current_end * 1000) : null;

    // A one-time order payment: a plan period or a Brief Pack. Old Autopay
    // subscription payments also send payment.captured; their orders carry
    // neither, so they are ignored here.
    if (type === 'payment.captured') {
      if (typeof payment.order_id === 'string' && ORDER_ID.test(payment.order_id) && typeof payment.id === 'string') {
        await handleOrderPayment(eventId, payment as { id: string; order_id: string; amount?: unknown });
      }
      return;
    }

    // Which firm: our notes first, else the stored subscription id.
    let firmId = typeof notes.firm_id === 'string' ? notes.firm_id : null;
    if (!firmId && subscriptionId) {
      const [f] = await sql<{ id: string }[]>`select id from firms where razorpay_subscription_id = ${subscriptionId} limit 1`;
      firmId = f?.id ?? null;
    }
    if (!firmId) {
      logger.warn({ type, subscriptionId }, 'razorpay webhook: no firm for event, skipping');
      return;
    }
    // What was bought: the Razorpay plan id maps back to plan, cycle and seats.
    let plan: PaidPlanId | null = null;
    let cycle: BillingCycle | null = null;
    let seats: number | null = null;
    let munshi = 0;
    if (sub.plan_id) {
      const [p] = await sql<{ plan: string; cycle: BillingCycle; seats: number; munshi_seats: number | null }[]>`
        select plan, cycle, seats, munshi_seats from razorpay_plans where razorpay_plan_id = ${sub.plan_id}`;
      // Subscriptions are no longer sold. A v4 one still charging applies as
      // the v5 plan it maps to; pre-v4 (solo / practice) is treated as unknown.
      if (p && (isPaidPlan(p.plan) || isV4Plan(p.plan))) {
        plan = isPaidPlan(p.plan) ? p.plan : v5PlanFor(p.plan, p.seats);
        cycle = p.cycle;
        seats = PLANS[plan].seats;
        munshi = p.munshi_seats ?? 0;
      }
    }
    const userId = typeof notes.user_id === 'string' ? notes.user_id : null;

    // Redelivery of an event we already handled: stop here.
    const [seen] = await sql<{ id: string }[]>`select id from billing_events where webhook_id = ${eventId}`;
    if (seen) return;

    const base = { firmId, userId, plan, cycle, providerRef: subscriptionId, webhookId: eventId };
    const sameSubscription = async () => {
      const [f] = await sql<{ razorpay_subscription_id: string | null }[]>`
        select razorpay_subscription_id from firms where id = ${firmId}::uuid`;
      return !!subscriptionId && f?.razorpay_subscription_id === subscriptionId;
    };

    const hadFreeLaunch = async () => {
      const [f] = await sql<{ free_launch: boolean | null }[]>`select free_launch from firms where id = ${firmId}::uuid`;
      return !!f?.free_launch;
    };

    switch (type) {
      case 'subscription.authenticated': {
        // A plan change is authorised: stop the old subscription at its period end.
        const replaces = typeof notes.replaces === 'string' ? notes.replaces : null;
        if (replaces && SUBSCRIPTION_ID.test(replaces) && replaces !== subscriptionId) {
          await razorpay('POST', `/subscriptions/${replaces}/cancel`, { cancel_at_cycle_end: 1 });
        }
        return;
      }
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed': {
        if (!plan || !cycle || !seats) {
          logger.warn({ type, firmId, planId: sub.plan_id }, 'razorpay webhook: unknown plan, skipping');
          return;
        }
        // Two live subscriptions that are not a planned plan change (the owner
        // paid two checkouts): the newest one wins, the other is stopped now.
        // A late retry for the older one must never switch the firm back.
        const [cur] = await sql<{ razorpay_subscription_id: string | null }[]>`
          select razorpay_subscription_id from firms where id = ${firmId}::uuid`;
        const current = cur?.razorpay_subscription_id ?? null;
        if (current && subscriptionId && current !== subscriptionId && notes.replaces !== current) {
          const other = await razorpay<RzpSubscription & { created_at?: number }>('GET', `/subscriptions/${current}`);
          const otherLive = !['cancelled', 'completed', 'expired'].includes(String(other.status));
          if (otherLive && (other.created_at ?? 0) > (sub.created_at ?? 0)) {
            await cancelNow(subscriptionId, firmId);
            await logEvent({ ...base, kind: 'cancelled' });
            return;
          }
          if (otherLive) {
            await cancelNow(current, firmId);
            await logEvent({ ...base, providerRef: current, webhookId: null, kind: 'cancelled' });
          }
        }
        // A planned plan change has started: make sure the replaced subscription
        // can't charge again, even if its end-of-cycle cancel never took effect.
        const replaced = typeof notes.replaces === 'string' ? notes.replaces : null;
        if (type === 'subscription.activated' && replaced && SUBSCRIPTION_ID.test(replaced) && replaced !== subscriptionId) {
          try {
            await razorpay('POST', `/subscriptions/${replaced}/cancel`, { cancel_at_cycle_end: 0 });
          } catch { /* already cancelled at its cycle end: nothing to do */ }
        }
        await sql`
          update firms set
            plan_tier = ${PLANS[plan].tier}::firm_plan_tier,
            plan_status = 'active',
            free_plan = false,
            trial_ends_at = null,
            renews_at = ${periodEnd},
            billing_cycle = ${cycle},
            selected_plan = ${plan},
            mrr_inr = ${mrrFor(plan, cycle, munshi)},
            seats = ${seats},
            munshi_seats = ${munshi},
            razorpay_subscription_id = ${subscriptionId},
            razorpay_customer_id = coalesce(${sub.customer_id ?? null}, razorpay_customer_id)
          where id = ${firmId}::uuid
        `;
        // GST tax invoice for every successful charge (first and renewals). If it
        // throws, the webhook answers 500 and Razorpay redelivers: the plan update
        // above is safe to repeat and the invoice is idempotent on the payment id.
        if (type === 'subscription.charged' && typeof payment.id === 'string') {
          await subscriptionInvoiceService.issueForPayment({
            firmId, paymentId: payment.id, amountPaise: Number(payment.amount), subscriptionId,
            plan, cycle, seats, munshi,
            periodStart: typeof sub.current_start === 'number' ? new Date(sub.current_start * 1000) : null,
            periodEnd,
          });
        }
        // Razorpay sends `charged` for the first payment too, beside `activated`:
        // only a later charge is a renewal, else the first would count twice.
        if (type === 'subscription.charged' && (sub.paid_count ?? 0) <= 1) break;
        const kind: BillingEventKind = type === 'subscription.charged' ? 'renewed'
          : typeof notes.replaces === 'string' ? 'plan_changed' : 'subscription_active';
        await logEvent({ ...base, kind, amountPaise: chargePaise(plan, cycle, munshi) });
        break;
      }
      case 'subscription.pending':
      case 'subscription.halted': {
        if (await sameSubscription()) {
          await sql`update firms set plan_status = 'past_due' where id = ${firmId}::uuid`;
        }
        await logEvent({ ...base, kind: 'on_hold' });
        break;
      }
      case 'payment.failed':
        // A failed first payment leaves the firm on its free plan / trial.
        await logEvent({ ...base, kind: 'payment_failed' });
        break;
      case 'subscription.cancelled':
      case 'subscription.completed': {
        if (await sameSubscription()) {
          const ended = !periodEnd || periodEnd.getTime() <= Date.now() + 60 * 60 * 1000;
          if (!ended) {
            // Paid time is kept: access runs to the end of the period.
            await sql`update firms set renews_at = ${periodEnd} where id = ${firmId}::uuid`;
          } else if (plan && PLANS[plan].tier === 'Solo' && Date.now() < FREE_PLAN_ENDS_AT.getTime() && await hadFreeLaunch()) {
            // A lapsed one-advocate plan goes back to the free launch plan while
            // it lasts, only for accounts that were promised it (firms.free_launch).
            await sql`
              update firms set free_plan = true, plan_status = 'trial', trial_ends_at = ${FREE_PLAN_ENDS_AT},
                renews_at = null, mrr_inr = 0, selected_plan = 'free', razorpay_subscription_id = null
              where id = ${firmId}::uuid`;
          } else {
            await sql`update firms set plan_status = 'cancelled', mrr_inr = 0 where id = ${firmId}::uuid`;
          }
        }
        await logEvent({ ...base, kind: type === 'subscription.completed' ? 'expired' : 'cancelled' });
        break;
      }
      default:
        return;
    }
    invalidatePlanStatusCache();
    invalidatePermissionsCache();
  },

  // ---- Superadmin -----------------------------------------------------------

  async adminEvents(limit = 300): Promise<AdminBillingEvent[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Array<{
      id: string; kind: BillingEventKind; plan: string | null; cycle: string | null; amount_inr: number | null;
      created_at: Date; firm_id: string; firm_name: string | null; user_id: string | null; user_name: string | null;
      email: string | null; phone: string | null; plan_tier: FirmPlanTier | null;
      plan_status: AdminBillingEvent['planStatus']; free_plan: boolean | null;
    }>>`
      select e.id, e.kind, e.plan, e.cycle, e.amount_inr, e.created_at, e.firm_id, f.name as firm_name,
             e.user_id, coalesce(u.name, o.name) as user_name, coalesce(u.email, o.email) as email,
             coalesce(u.phone, o.phone) as phone, f.plan_tier, f.plan_status, f.free_plan
      from billing_events e
      join firms f on f.id = e.firm_id
      left join users u on u.id = e.user_id
      left join lateral (
        select name, email, phone from users where firm_id = e.firm_id order by created_at limit 1
      ) o on true
      order by e.created_at desc
      limit ${limit}
    `;
    return rows.map((r) => ({
      id: r.id, kind: r.kind, plan: r.plan, cycle: r.cycle, amountInr: r.amount_inr,
      createdAt: r.created_at.toISOString(), firmId: r.firm_id, firmName: r.firm_name,
      userId: r.user_id, userName: r.user_name, email: r.email, phone: r.phone,
      planTier: r.plan_tier, planStatus: r.plan_status, freePlan: !!r.free_plan,
    }));
  },

  async adminSummary(): Promise<AdminBillingSummary> {
    const sql = db();
    if (!sql) return { payingFirms: 0, mrrInr: 0, trialsEndingSoon: 0, abandonedCheckouts: 0, signupsByPlan: {} };
    const [paying] = await sql<{ n: number; mrr: number }[]>`
      select count(*)::int n, coalesce(sum(mrr_inr), 0)::int mrr
      from firms where plan_status = 'active' and not coalesce(free_plan, false)
        and selected_plan in ('advocate', 'chambers', 'law_firm', 'sanad', 'vakalat', 'brief', 'associates')`;
    const [trials] = await sql<{ n: number }[]>`
      select count(*)::int n from firms
      where plan_status = 'trial' and not coalesce(free_plan, false)
        and trial_ends_at between now() and now() + interval '7 days'`;
    const [abandoned] = await sql<{ n: number }[]>`
      select count(distinct e.firm_id)::int n
      from billing_events e join firms f on f.id = e.firm_id
      where e.kind = 'checkout_started' and e.created_at > now() - interval '30 days'
        and not (f.plan_status = 'active' and not coalesce(f.free_plan, false))`;
    const byPlan = await sql<{ plan: string | null; n: number }[]>`
      select plan, count(*)::int n from billing_events
      where kind = 'signup' and created_at > now() - interval '30 days'
      group by plan`;
    return {
      payingFirms: paying?.n ?? 0,
      mrrInr: paying?.mrr ?? 0,
      trialsEndingSoon: trials?.n ?? 0,
      abandonedCheckouts: abandoned?.n ?? 0,
      signupsByPlan: Object.fromEntries(byPlan.map((r) => [r.plan ?? 'unknown', r.n])),
    };
  },
};
