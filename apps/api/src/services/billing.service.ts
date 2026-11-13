import crypto from 'node:crypto';
import type {
  AdminBillingEvent, AdminBillingSummary, BillingCycle, BillingEventKind, BillingPlan,
  BillingPlanId, BillingStateResponse, FirmPlanTier, PaidPlanId,
} from '@lexdraft/types';
import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { FREE_PLAN_ENDS_AT } from '../lib/free-plan';
import { BadRequestError, ForbiddenError, HttpError, NotFoundError, UnauthorizedError } from '../lib/errors';
import { invalidatePlanStatusCache } from './plan-status.service';
import { invalidatePermissionsCache } from './permissions.service';

// =============================================================================
// Self-serve billing through Razorpay Subscriptions (migrations 0096 + 0105).
//
// The owner picks a plan; we create a Razorpay subscription and send them to
// /api/billing/pay/:id, which opens Razorpay Checkout (UPI Autopay, cards,
// netbanking). Razorpay then calls POST /api/billing/webhook and the firm's plan
// flips there, never on the browser's say-so. Every step is written to
// billing_events so the superadmin Billing page sees who stopped at checkout.
// =============================================================================

const PAID: Record<PaidPlanId, { tier: FirmPlanTier; monthlyInr: number; annualMonthlyInr: number }> = {
  solo:     { tier: 'Solo',     monthlyInr: 1499, annualMonthlyInr: 1199 },
  practice: { tier: 'Practice', monthlyInr: 2999, annualMonthlyInr: 2399 },
};

/** Chamber (internally `practice`): price covers 2 advocates, plus each extra
 *  one. Online purchase goes up to 8. */
export const CHAMBER_SEATS = { included: 2, max: 8, extraMonthlyInr: 899, extraAnnualMonthlyInr: 719 } as const;

/** Monthly drafts per advocate (mirrors plan_ai_caps, migration 0104). */
const DRAFTS = { free: 30, solo: 50, practice: 40 } as const;

/** Prices shown +GST are charged with 18% added; the rest already include it. */
const GST_EXCLUSIVE: Record<PaidPlanId, boolean> = { solo: false, practice: true };

/** Only the account owner (the person who signed up) buys or changes the plan. */
const OWNER_ROLES = new Set(['Solo Advocate', 'Managing Partner']);

/** Renewals a subscription runs for before Razorpay marks it completed. */
const TOTAL_COUNT: Record<BillingCycle, number> = { monthly: 120, annual: 10 };

function paymentsEnabled(): boolean {
  return !!env.razorpay.keyId && !!env.razorpay.keySecret;
}

if (env.razorpay.testKeyInProd) {
  logger.error('RAZORPAY_KEY_ID is a test key in production: online payment stays OFF');
}

export function billingPlans(): BillingPlan[] {
  const can = paymentsEnabled();
  return [
    {
      id: 'free', name: 'Free', for: 'Solo advocates & law students',
      monthlyInr: 0, annualMonthlyInr: 0, note: 'Free till 1 June 2027',
      features: [`${DRAFTS.free} drafts a month`, 'Cases, hearings & eCourts sync', 'Diary and documents', '1 GB storage'],
      purchasable: false, draftsPerMonth: DRAFTS.free, gst: null,
    },
    {
      id: 'solo', name: 'Solo', for: 'One advocate, everything unlocked',
      monthlyInr: PAID.solo.monthlyInr, annualMonthlyInr: PAID.solo.annualMonthlyInr, note: 'Incl. GST · billed monthly or yearly',
      features: [`${DRAFTS.solo} drafts a month`, 'Everything in Free', 'Limitation tracker', 'Co-counsel handover', 'Practice analytics', 'Team chat', 'Unlimited storage'],
      purchasable: can, draftsPerMonth: DRAFTS.solo, gst: 'inclusive',
    },
    {
      id: 'practice', name: 'Chamber', for: 'Chambers and firms · two to eight advocates',
      monthlyInr: PAID.practice.monthlyInr, annualMonthlyInr: PAID.practice.annualMonthlyInr,
      note: '+18% GST · 2 advocates included · 14-day free trial',
      features: [`${DRAFTS.practice} drafts per advocate a month`, 'Everything in Solo',
        `Extra advocate ₹${CHAMBER_SEATS.extraMonthlyInr}/month, up to ${CHAMBER_SEATS.max}`, 'Roles and permissions', 'Firm dashboard', 'Priority support'],
      purchasable: can, draftsPerMonth: DRAFTS.practice, gst: 'exclusive',
      seats: { included: CHAMBER_SEATS.included, max: CHAMBER_SEATS.max,
        extraMonthlyInr: CHAMBER_SEATS.extraMonthlyInr, extraAnnualMonthlyInr: CHAMBER_SEATS.extraAnnualMonthlyInr },
    },
    {
      id: 'firm', name: 'Firm', for: 'Nine advocates and above',
      monthlyInr: null, annualMonthlyInr: null, note: 'Custom pricing · book a demo',
      features: ['Unlimited seats', 'SSO and audit logs', 'Dedicated success manager', 'Bespoke integrations'],
      purchasable: false, draftsPerMonth: null, gst: null,
    },
  ];
}

/** Rupees a month for the plan (before any +GST); Chamber adds each advocate beyond 2. */
export function mrrFor(plan: PaidPlanId, cycle: BillingCycle, seats: number = CHAMBER_SEATS.included): number {
  const annual = cycle === 'annual';
  const base = annual ? PAID[plan].annualMonthlyInr : PAID[plan].monthlyInr;
  if (plan !== 'practice') return base;
  const extra = Math.max(0, seats - CHAMBER_SEATS.included);
  return base + extra * (annual ? CHAMBER_SEATS.extraAnnualMonthlyInr : CHAMBER_SEATS.extraMonthlyInr);
}

function amountFor(plan: PaidPlanId, cycle: BillingCycle, seats?: number): number {
  return mrrFor(plan, cycle, seats) * (cycle === 'annual' ? 12 : 1);
}

/** What Razorpay charges per billing period, in paise (GST added where the price is +GST). */
export function chargePaise(plan: PaidPlanId, cycle: BillingCycle, seats: number): number {
  return Math.round(amountFor(plan, cycle, seats) * (GST_EXCLUSIVE[plan] ? 1.18 : 1) * 100);
}

async function logEvent(e: {
  firmId: string; userId?: string | null; kind: BillingEventKind; plan?: string | null;
  cycle?: string | null; amountInr?: number | null; providerRef?: string | null; webhookId?: string | null;
}): Promise<void> {
  const sql = db();
  if (!sql) return;
  await sql`
    insert into billing_events (firm_id, user_id, kind, plan, cycle, amount_inr, provider, provider_ref, webhook_id)
    values (${e.firmId}::uuid, ${e.userId ?? null}, ${e.kind}, ${e.plan ?? null}, ${e.cycle ?? null},
            ${e.amountInr ?? null}, 'razorpay', ${e.providerRef ?? null}, ${e.webhookId ?? null})
  `;
}

interface OwnerRow {
  user_id: string; name: string; email: string; phone: string | null; role: string;
  firm_id: string | null; plan_tier: FirmPlanTier | null; plan_status: BillingStateResponse['current']['planStatus'];
  free_plan: boolean; trial_ends_at: Date | null; renews_at: Date | null; billing_cycle: BillingCycle | null;
  selected_plan: BillingPlanId | null; razorpay_subscription_id: string | null;
  seats: number | null; members: number;
}

async function loadUser(userId: string): Promise<OwnerRow> {
  const sql = db();
  if (!sql) throw new HttpError(503, 'Billing needs the database.');
  const [row] = await sql<OwnerRow[]>`
    select u.id as user_id, u.name, u.email, u.phone, u.role, u.firm_id,
           f.plan_tier, f.plan_status, coalesce(f.free_plan, false) as free_plan, f.trial_ends_at,
           f.renews_at, f.billing_cycle, f.selected_plan, f.razorpay_subscription_id, f.seats,
           ((select count(*)::int from users m where m.firm_id = u.firm_id and m.status = 'active')
            + (select count(*)::int from invitations i where i.firm_id = u.firm_id and i.status = 'pending')) as members
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

/** The Razorpay plan for this exact price, created the first time it is bought. */
async function razorpayPlanId(plan: PaidPlanId, cycle: BillingCycle, seats: number): Promise<string> {
  const sql = db();
  if (!sql) throw new HttpError(503, 'Billing needs the database.');
  const amount = chargePaise(plan, cycle, seats);
  const find = () => sql<{ razorpay_plan_id: string }[]>`
    select razorpay_plan_id from razorpay_plans
    where plan = ${plan} and cycle = ${cycle} and seats = ${seats} and amount_paise = ${amount}
    order by created_at limit 1`;
  const [found] = await find();
  if (found) return found.razorpay_plan_id;
  const name = plan === 'practice' ? `DifAi Chamber, ${seats} advocates` : 'DifAi Solo';
  const created = await razorpay<{ id: string }>('POST', '/plans', {
    period: cycle === 'annual' ? 'yearly' : 'monthly',
    interval: 1,
    item: { name, amount, currency: 'INR', description: `${name}, billed ${cycle === 'annual' ? 'yearly' : 'monthly'}` },
    notes: { plan, cycle, seats: String(seats) },
  });
  await sql`
    insert into razorpay_plans (razorpay_plan_id, plan, cycle, seats, amount_paise)
    values (${created.id}, ${plan}, ${cycle}, ${seats}, ${amount})
    on conflict do nothing`;
  // A concurrent buyer may have created the same price first: use the oldest.
  const [row] = await find();
  return row?.razorpay_plan_id ?? created.id;
}

/** Constant-time compare of two hex HMACs. */
function hexEqual(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{6,40}$/;

type RzpSubscription = {
  id?: string; plan_id?: string; status?: string; quantity?: number; paid_count?: number; created_at?: number;
  current_end?: number | null; customer_id?: string | null; notes?: Record<string, unknown> | unknown[];
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

export const billingService = {
  plans: billingPlans,

  async state(userId: string): Promise<BillingStateResponse> {
    const u = await loadUser(userId);
    return {
      plans: billingPlans(),
      current: {
        planTier: u.plan_tier,
        planStatus: u.plan_status,
        freePlan: u.free_plan,
        trialEndsAt: u.trial_ends_at ? u.trial_ends_at.toISOString() : null,
        renewsAt: u.renews_at ? new Date(u.renews_at).toISOString() : null,
        billingCycle: u.billing_cycle,
        selectedPlan: u.selected_plan,
        subscribed: !!u.razorpay_subscription_id,
        seats: u.seats ?? 1,
      },
      paymentsEnabled: paymentsEnabled(),
      canManage: OWNER_ROLES.has(u.role),
    };
  },

  /**
   * Creates a Razorpay subscription for the user's firm and returns the page
   * that opens Razorpay Checkout for it. Chamber takes `seats` (2-8). A firm
   * already paying on another plan gets the new plan from its next renewal:
   * the old subscription is cancelled at cycle end once the new one is authorised.
   */
  async startCheckout(userId: string, plan: PaidPlanId, cycle: BillingCycle, seats?: number): Promise<{ checkoutUrl: string }> {
    const wanted = plan === 'practice' ? (seats ?? CHAMBER_SEATS.included) : 1;
    if (plan === 'practice' && (!Number.isInteger(wanted) || wanted < CHAMBER_SEATS.included || wanted > CHAMBER_SEATS.max)) {
      throw new BadRequestError(`Choose between ${CHAMBER_SEATS.included} and ${CHAMBER_SEATS.max} advocates.`, { code: 'invalid_seats' });
    }
    const u = await loadUser(userId);
    if (!u.firm_id) throw new BadRequestError('Your account is not attached to a practice.');
    if (!OWNER_ROLES.has(u.role)) {
      throw new ForbiddenError('Only the account owner can change the plan.', { code: 'billing_owner_only' });
    }
    if (!paymentsEnabled()) {
      throw new HttpError(503, 'Online payment is not switched on yet. Please try again later.', { code: 'payments_disabled' });
    }
    if (u.members > wanted) {
      throw new BadRequestError(
        plan === 'practice'
          ? `Your practice has ${u.members} members and pending invitations. Choose at least ${u.members} advocates, or remove members first.`
          : `Solo is for one advocate, and your practice has ${u.members} members and pending invitations. Choose Chamber, or remove members first.`,
        { code: 'seats_below_members' },
      );
    }
    const paying = !!u.razorpay_subscription_id && u.plan_status === 'active';
    if (paying && u.selected_plan === plan && u.billing_cycle === cycle && (plan !== 'practice' || u.seats === wanted)) {
      throw new BadRequestError('You are already on this plan.');
    }
    // A plan change starts when the current paid period ends, so nobody pays twice.
    const startAt = paying && u.renews_at && new Date(u.renews_at).getTime() > Date.now() + 60_000
      ? Math.floor(new Date(u.renews_at).getTime() / 1000) : null;
    const sub = await razorpay<{ id: string }>('POST', '/subscriptions', {
      plan_id: await razorpayPlanId(plan, cycle, wanted),
      total_count: TOTAL_COUNT[cycle],
      quantity: 1,
      customer_notify: 1,
      ...(startAt ? { start_at: startAt } : {}),
      notes: {
        firm_id: u.firm_id, user_id: u.user_id, plan, cycle, seats: String(wanted),
        ...(paying ? { replaces: u.razorpay_subscription_id } : {}),
      },
    });
    await logEvent({
      firmId: u.firm_id, userId: u.user_id, kind: 'checkout_started', plan, cycle,
      amountInr: amountFor(plan, cycle, wanted), providerRef: sub.id,
    });
    return { checkoutUrl: `${env.webPublicBaseUrl.replace(/\/$/, '')}/api/billing/pay/${sub.id}` };
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

  /** The small page that opens Razorpay Checkout for a subscription, then
   *  returns to the app. Null when the id is malformed or payments are off. */
  payPage(subscriptionId: string): string | null {
    if (!SUBSCRIPTION_ID.test(subscriptionId) || !paymentsEnabled()) return null;
    const base = env.webPublicBaseUrl.replace(/\/$/, '');
    const options = {
      key: env.razorpay.keyId,
      subscription_id: subscriptionId,
      name: 'DifAi',
      description: 'DifAi plan',
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
    if (sub.plan_id) {
      const [p] = await sql<{ plan: PaidPlanId; cycle: BillingCycle; seats: number }[]>`
        select plan, cycle, seats from razorpay_plans where razorpay_plan_id = ${sub.plan_id}`;
      if (p) ({ plan, cycle, seats } = p);
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
            plan_tier = ${PAID[plan].tier}::firm_plan_tier,
            plan_status = 'active',
            free_plan = false,
            trial_ends_at = null,
            renews_at = ${periodEnd},
            billing_cycle = ${cycle},
            selected_plan = ${plan},
            mrr_inr = ${mrrFor(plan, cycle, seats)},
            seats = ${seats},
            razorpay_subscription_id = ${subscriptionId},
            razorpay_customer_id = coalesce(${sub.customer_id ?? null}, razorpay_customer_id)
          where id = ${firmId}::uuid
        `;
        // Razorpay sends `charged` for the first payment too, beside `activated`:
        // only a later charge is a renewal, else the first would count twice.
        if (type === 'subscription.charged' && (sub.paid_count ?? 0) <= 1) break;
        const kind: BillingEventKind = type === 'subscription.charged' ? 'renewed'
          : typeof notes.replaces === 'string' ? 'plan_changed' : 'subscription_active';
        await logEvent({ ...base, kind, amountInr: amountFor(plan, cycle, seats) });
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
          } else if (plan === 'solo' && Date.now() < FREE_PLAN_ENDS_AT.getTime()) {
            // A lapsed Solo goes back to the free launch plan while it lasts.
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
      from firms where razorpay_subscription_id is not null and plan_status = 'active'`;
    const [trials] = await sql<{ n: number }[]>`
      select count(*)::int n from firms
      where plan_status = 'trial' and not coalesce(free_plan, false)
        and trial_ends_at between now() and now() + interval '7 days'`;
    const [abandoned] = await sql<{ n: number }[]>`
      select count(distinct e.firm_id)::int n
      from billing_events e join firms f on f.id = e.firm_id
      where e.kind = 'checkout_started' and e.created_at > now() - interval '30 days'
        and f.razorpay_subscription_id is null`;
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
