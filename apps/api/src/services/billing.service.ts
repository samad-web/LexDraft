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
// Self-serve billing through Dodo Payments (migration 0096).
//
// The plan the user picks is bought on a Dodo-hosted checkout page; Dodo then
// calls POST /api/billing/webhook and the firm's plan flips there, never on the
// browser's say-so. Every step is written to billing_events so the superadmin
// Billing page can see who picked what and who stopped at checkout.
// =============================================================================

const PAID: Record<PaidPlanId, { tier: FirmPlanTier; monthlyInr: number; annualMonthlyInr: number }> = {
  solo:     { tier: 'Solo',     monthlyInr: 1499, annualMonthlyInr: 1199 },
  practice: { tier: 'Practice', monthlyInr: 2999, annualMonthlyInr: 2399 },
};

/** Chamber (internally `practice`): price covers 2 advocates; each extra one
 *  is a Dodo add-on on the same subscription. Online purchase goes up to 8. */
export const CHAMBER_SEATS = { included: 2, max: 8, extraMonthlyInr: 899, extraAnnualMonthlyInr: 719 } as const;

/** Monthly drafts per advocate (mirrors plan_ai_caps, migration 0104). */
const DRAFTS = { free: 30, solo: 50, practice: 40 } as const;

/** Only the account owner (the person who signed up) buys or changes the plan. */
const OWNER_ROLES = new Set(['Solo Advocate', 'Managing Partner']);

function productId(plan: PaidPlanId, cycle: BillingCycle): string {
  return env.dodo.products[plan][cycle];
}

function paymentsEnabled(): boolean {
  return !!env.dodo.apiKey;
}

export function billingPlans(): BillingPlan[] {
  const can = (p: PaidPlanId) => paymentsEnabled() && !!productId(p, 'monthly') && !!productId(p, 'annual');
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
      purchasable: can('solo'), draftsPerMonth: DRAFTS.solo, gst: 'inclusive',
    },
    {
      id: 'practice', name: 'Chamber', for: 'Chambers and firms · two to eight advocates',
      monthlyInr: PAID.practice.monthlyInr, annualMonthlyInr: PAID.practice.annualMonthlyInr,
      note: '+18% GST · 2 advocates included · 14-day free trial',
      features: [`${DRAFTS.practice} drafts per advocate a month`, 'Everything in Solo',
        `Extra advocate ₹${CHAMBER_SEATS.extraMonthlyInr}/month, up to ${CHAMBER_SEATS.max}`, 'Roles and permissions', 'Firm dashboard', 'Priority support'],
      purchasable: can('practice'), draftsPerMonth: DRAFTS.practice, gst: 'exclusive',
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

/** Rupees a month for the plan; Chamber adds each advocate beyond the 2 included. */
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

/**
 * Chamber seats from a Dodo subscription payload: 2 + the seat add-on quantity.
 * Returns null (keep the firm's seats) when the payload has no add-on list or
 * carries an add-on we don't know - an unknown id must never wipe seats.
 */
export function chamberSeatsFrom(addons: unknown): number | null {
  if (!Array.isArray(addons)) return null;
  const known = new Set([env.dodo.chamberSeatAddon.monthly, env.dodo.chamberSeatAddon.annual].filter(Boolean));
  let extra = 0;
  for (const a of addons as Array<Record<string, unknown>>) {
    const id = typeof a?.addon_id === 'string' ? a.addon_id : '';
    const qty = Number(a?.quantity);
    if (!known.has(id) || !Number.isInteger(qty) || qty < 0) {
      logger.warn({ addonId: id, quantity: a?.quantity }, 'dodo webhook: unknown add-on, seats left unchanged');
      return null;
    }
    extra += qty;
  }
  return CHAMBER_SEATS.included + extra;
}

async function logEvent(e: {
  firmId: string; userId?: string | null; kind: BillingEventKind; plan?: string | null;
  cycle?: string | null; amountInr?: number | null; providerRef?: string | null; webhookId?: string | null;
}): Promise<void> {
  const sql = db();
  if (!sql) return;
  await sql`
    insert into billing_events (firm_id, user_id, kind, plan, cycle, amount_inr, provider_ref, webhook_id)
    values (${e.firmId}::uuid, ${e.userId ?? null}, ${e.kind}, ${e.plan ?? null}, ${e.cycle ?? null},
            ${e.amountInr ?? null}, ${e.providerRef ?? null}, ${e.webhookId ?? null})
  `;
}

interface OwnerRow {
  user_id: string; name: string; email: string; phone: string | null; role: string;
  firm_id: string | null; plan_tier: FirmPlanTier | null; plan_status: BillingStateResponse['current']['planStatus'];
  free_plan: boolean; trial_ends_at: Date | null; renews_at: Date | null; billing_cycle: BillingCycle | null;
  selected_plan: BillingPlanId | null; dodo_customer_id: string | null; dodo_subscription_id: string | null;
  seats: number | null; members: number;
}

async function loadUser(userId: string): Promise<OwnerRow> {
  const sql = db();
  if (!sql) throw new HttpError(503, 'Billing needs the database.');
  const [row] = await sql<OwnerRow[]>`
    select u.id as user_id, u.name, u.email, u.phone, u.role, u.firm_id,
           f.plan_tier, f.plan_status, coalesce(f.free_plan, false) as free_plan, f.trial_ends_at,
           f.renews_at, f.billing_cycle, f.selected_plan, f.dodo_customer_id, f.dodo_subscription_id, f.seats,
           ((select count(*)::int from users m where m.firm_id = u.firm_id and m.status = 'active')
            + (select count(*)::int from invitations i where i.firm_id = u.firm_id and i.status = 'pending')) as members
    from users u left join firms f on f.id = u.firm_id
    where u.id = ${userId}::uuid
  `;
  if (!row) throw new NotFoundError('User not found');
  return row;
}

/** Dodo's API, JSON in and out. */
async function dodo<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${env.dodo.baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.dodo.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    logger.error({ status: res.status, body: text.slice(0, 500), path }, 'dodo api call failed');
    throw new HttpError(502, 'The payment page could not be opened. Please try again in a minute.');
  }
  return JSON.parse(text) as T;
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
        subscribed: !!u.dodo_subscription_id,
        seats: u.seats ?? 1,
      },
      paymentsEnabled: paymentsEnabled(),
      canManage: OWNER_ROLES.has(u.role),
    };
  },

  /** Opens a Dodo checkout for the user's firm and returns its URL. Chamber
   *  takes `seats` (2-8 advocates); other plans ignore it. */
  async startCheckout(userId: string, plan: PaidPlanId, cycle: BillingCycle, seats?: number): Promise<{ checkoutUrl: string }> {
    const wanted = plan === 'practice' ? (seats ?? CHAMBER_SEATS.included) : 1;
    if (plan === 'practice' && (!Number.isInteger(wanted) || wanted < CHAMBER_SEATS.included || wanted > CHAMBER_SEATS.max)) {
      throw new BadRequestError(`Choose between ${CHAMBER_SEATS.included} and ${CHAMBER_SEATS.max} advocates.`, { code: 'invalid_seats' });
    }
    const extraSeats = Math.max(0, wanted - CHAMBER_SEATS.included);
    const u = await loadUser(userId);
    if (!u.firm_id) throw new BadRequestError('Your account is not attached to a practice.');
    if (!OWNER_ROLES.has(u.role)) {
      throw new ForbiddenError('Only the account owner can change the plan.', { code: 'billing_owner_only' });
    }
    if (!paymentsEnabled() || !productId(plan, cycle) || (extraSeats > 0 && !env.dodo.chamberSeatAddon[cycle])) {
      throw new HttpError(503, 'Online payment is not switched on yet. Please try again later.', { code: 'payments_disabled' });
    }
    if (plan === 'practice' && u.members > wanted) {
      throw new BadRequestError(
        `Your practice has ${u.members} members and pending invitations. Choose at least ${u.members} advocates, or remove members first.`,
        { code: 'seats_below_members' },
      );
    }
    if (u.dodo_subscription_id && u.plan_status === 'active' && u.selected_plan === plan && u.billing_cycle === cycle
        && (plan !== 'practice' || u.seats === wanted)) {
      throw new BadRequestError('You are already on this plan.');
    }
    const base = env.webPublicBaseUrl.replace(/\/$/, '');
    const session = await dodo<{ session_id: string; checkout_url: string | null }>('/checkouts', {
      product_cart: [{
        product_id: productId(plan, cycle), quantity: 1,
        ...(extraSeats > 0 ? { addons: [{ addon_id: env.dodo.chamberSeatAddon[cycle], quantity: extraSeats }] } : {}),
      }],
      customer: u.dodo_customer_id
        ? { customer_id: u.dodo_customer_id }
        : { email: u.email, name: u.name, ...(u.phone ? { phone_number: u.phone } : {}) },
      billing_address: { country: 'IN' },
      return_url: `${base}/app/billing?checkout=done`,
      cancel_url: `${base}/app/billing?checkout=cancelled`,
      metadata: { firm_id: u.firm_id, user_id: u.user_id, plan, cycle, seats: String(wanted) },
    });
    if (!session.checkout_url) throw new HttpError(502, 'The payment page could not be opened. Please try again.');
    await logEvent({
      firmId: u.firm_id, userId: u.user_id, kind: 'checkout_started', plan, cycle,
      amountInr: amountFor(plan, cycle, wanted), providerRef: session.session_id,
    });
    return { checkoutUrl: session.checkout_url };
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

  /** Standard Webhooks signature check (Dodo signs every delivery). */
  verifyWebhook(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>): string {
    const secret = env.dodo.webhookSecret;
    if (!secret) throw new HttpError(503, 'Billing webhook secret not configured');
    const id = String(headers['webhook-id'] ?? '');
    const ts = String(headers['webhook-timestamp'] ?? '');
    const sigHeader = String(headers['webhook-signature'] ?? '');
    if (!rawBody || !id || !ts || !sigHeader) throw new UnauthorizedError('Missing webhook signature');
    const ageSec = Math.abs(Date.now() / 1000 - Number(ts));
    if (!Number.isFinite(ageSec) || ageSec > 300) throw new UnauthorizedError('Webhook timestamp out of range');
    const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
    const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${rawBody.toString('utf8')}`).digest();
    const ok = sigHeader.split(' ').some((part) => {
      const [version, sig] = part.split(',');
      if (version !== 'v1' || !sig) return false;
      const given = Buffer.from(sig, 'base64');
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    });
    if (!ok) throw new UnauthorizedError('Bad webhook signature');
    return id;
  },

  async handleWebhook(webhookId: string, event: { type?: string; data?: Record<string, unknown> }): Promise<void> {
    const sql = db();
    if (!sql) return;
    const type = event.type ?? '';
    const data = event.data ?? {};
    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const subscriptionId = typeof data.subscription_id === 'string' ? data.subscription_id : null;
    const customer = (data.customer ?? {}) as Record<string, unknown>;
    const customerId = typeof customer.customer_id === 'string' ? customer.customer_id : null;
    const nextBilling = typeof data.next_billing_date === 'string' ? new Date(data.next_billing_date) : null;

    // Which firm: our metadata first, else the stored subscription id.
    let firmId = typeof meta.firm_id === 'string' ? meta.firm_id : null;
    if (!firmId && subscriptionId) {
      const [f] = await sql<{ id: string }[]>`select id from firms where dodo_subscription_id = ${subscriptionId} limit 1`;
      firmId = f?.id ?? null;
    }
    if (!firmId) {
      logger.warn({ type, subscriptionId }, 'dodo webhook: no firm for event, skipping');
      return;
    }
    // Which plan: metadata, else map the product id back.
    let plan = (meta.plan === 'solo' || meta.plan === 'practice') ? meta.plan as PaidPlanId : null;
    let cycle = (meta.cycle === 'monthly' || meta.cycle === 'annual') ? meta.cycle as BillingCycle : null;
    if (typeof data.product_id === 'string') {
      for (const p of ['solo', 'practice'] as const) {
        for (const c of ['monthly', 'annual'] as const) {
          if (productId(p, c) === data.product_id) { plan = p; cycle = c; }
        }
      }
    }
    const userId = typeof meta.user_id === 'string' ? meta.user_id : null;

    // Redelivery of an event we already handled: stop here.
    const [seen] = await sql<{ id: string }[]>`select id from billing_events where webhook_id = ${webhookId}`;
    if (seen) return;

    const base = { firmId, userId, plan, cycle, providerRef: subscriptionId, webhookId };
    const sameSubscription = async () => {
      const [f] = await sql<{ dodo_subscription_id: string | null }[]>`select dodo_subscription_id from firms where id = ${firmId}::uuid`;
      return !!subscriptionId && f?.dodo_subscription_id === subscriptionId;
    };

    switch (type) {
      case 'subscription.active':
      case 'subscription.renewed':
      case 'subscription.plan_changed':
      case 'subscription.unpaused': {
        if (!plan || !cycle) {
          logger.warn({ type, firmId, product: data.product_id }, 'dodo webhook: unknown product, skipping');
          return;
        }
        // Chamber seats come only from Dodo's add-on quantity, never the browser.
        const paidSeats = plan === 'practice' ? chamberSeatsFrom(data.addons) : null;
        const [cur] = await sql<{ seats: number | null }[]>`select seats from firms where id = ${firmId}::uuid`;
        const seatsNow = paidSeats ?? cur?.seats ?? CHAMBER_SEATS.included;
        await sql`
          update firms set
            plan_tier = ${PAID[plan].tier}::firm_plan_tier,
            plan_status = 'active',
            free_plan = false,
            trial_ends_at = null,
            renews_at = ${nextBilling},
            billing_cycle = ${cycle},
            selected_plan = ${plan},
            mrr_inr = ${mrrFor(plan, cycle, seatsNow)},
            seats = coalesce(${paidSeats}, seats),
            dodo_subscription_id = coalesce(${subscriptionId}, dodo_subscription_id),
            dodo_customer_id = coalesce(${customerId}, dodo_customer_id)
          where id = ${firmId}::uuid
        `;
        const kind: BillingEventKind = type === 'subscription.renewed' ? 'renewed'
          : type === 'subscription.plan_changed' ? 'plan_changed' : 'subscription_active';
        await logEvent({ ...base, kind, amountInr: amountFor(plan, cycle, seatsNow) });
        break;
      }
      case 'subscription.on_hold':
      case 'subscription.past_due': {
        if (await sameSubscription()) {
          await sql`update firms set plan_status = 'past_due' where id = ${firmId}::uuid`;
        }
        await logEvent({ ...base, kind: 'on_hold' });
        break;
      }
      case 'subscription.failed':
      case 'payment.failed':
        // A failed first payment leaves the firm on its free plan / trial.
        await logEvent({ ...base, kind: 'payment_failed' });
        break;
      case 'subscription.cancelled': {
        // Paid time is kept: access runs to the end of the period, then
        // requireActivePlan sees renews_at in the past (or `expired` lands).
        if (nextBilling && await sameSubscription()) {
          await sql`update firms set renews_at = ${nextBilling} where id = ${firmId}::uuid`;
        }
        await logEvent({ ...base, kind: 'cancelled' });
        break;
      }
      case 'subscription.expired': {
        if (await sameSubscription()) {
          // A lapsed Solo goes back to the free launch plan while it lasts.
          const backToFree = plan === 'solo' && Date.now() < FREE_PLAN_ENDS_AT.getTime();
          if (backToFree) {
            await sql`
              update firms set free_plan = true, plan_status = 'trial', trial_ends_at = ${FREE_PLAN_ENDS_AT},
                renews_at = null, mrr_inr = 0, selected_plan = 'free', dodo_subscription_id = null
              where id = ${firmId}::uuid`;
          } else {
            await sql`update firms set plan_status = 'cancelled', mrr_inr = 0 where id = ${firmId}::uuid`;
          }
        }
        await logEvent({ ...base, kind: 'expired' });
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
      from firms where dodo_subscription_id is not null and plan_status = 'active'`;
    const [trials] = await sql<{ n: number }[]>`
      select count(*)::int n from firms
      where plan_status = 'trial' and not coalesce(free_plan, false)
        and trial_ends_at between now() and now() + interval '7 days'`;
    const [abandoned] = await sql<{ n: number }[]>`
      select count(distinct e.firm_id)::int n
      from billing_events e join firms f on f.id = e.firm_id
      where e.kind = 'checkout_started' and e.created_at > now() - interval '30 days'
        and f.dodo_subscription_id is null`;
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
