import type { BillingCycle, BriefPackId, FirmPlanTier, PaidPlanId } from '@lexdraft/types';

// =============================================================================
// Pricing v5 catalogue (build-docs/features/pricing-v5.md, owner 2026-11-16).
// Every price here EXCLUDES GST; 18% GST is added at checkout and shown on the
// invoice. Mirrored in web components/PlanCards.tsx (SIGNUP_PLANS);
// pricing-v5.test keeps them in step.
// =============================================================================

export const GST_PCT = 18;

export interface PaidPlanDef {
  name: string;
  /** Permission tier the plan maps to. */
  tier: FirmPlanTier;
  /** Rupees a month / a year, GST extra. Yearly = 11 x monthly. */
  monthlyInr: number;
  annualInr: number;
  /** AI credits a month, one shared pool for the firm (30% margin floor at full use). */
  credits: number;
  /** Advocate seats included (a fixed cap, not a count bought). */
  seats: number;
}

export const PLANS: Record<PaidPlanId, PaidPlanDef> = {
  advocate: { name: 'Advocate', tier: 'Solo',     monthlyInr: 699,  annualInr: 7689,  credits: 150, seats: 1 },
  chambers: { name: 'Chambers', tier: 'Practice', monthlyInr: 1699, annualInr: 18689, credits: 350, seats: 3 },
  law_firm: { name: 'Firm',     tier: 'Firm',     monthlyInr: 3699, annualInr: 40689, credits: 750, seats: 8 },
};

/** Munshi (clerk) seat: diary, cause list, eCourts and documents. Any paid plan. GST extra. */
export const MUNSHI = { monthlyInr: 149, annualInr: 1639, max: 4 } as const;

/** Brief Packs: one-time AI credit top-ups, GST extra, valid 12 months. */
export const BRIEF_PACKS: Record<BriefPackId, { credits: number; priceInr: number }> = {
  pack_25:  { credits: 25,  priceInr: 429 },
  pack_60:  { credits: 60,  priceInr: 849 },
  pack_130: { credits: 130, priceInr: 1699 },
  pack_330: { credits: 330, priceInr: 4249 },
};
export const BRIEF_PACK_DAYS = 365;

export function isBriefPack(id: unknown): id is BriefPackId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(BRIEF_PACKS, id);
}

/** The role a Munshi seat covers: the advocate's clerk (migration 0110). */
export const MUNSHI_ROLES: readonly string[] = ['Munshi'];

/** Names for every plan id, including older ones on old rows and invoices. */
export const PLAN_NAMES: Record<string, string> = {
  free: 'Free', advocate: 'Advocate', chambers: 'Chambers', law_firm: 'Firm', enterprise: 'Enterprise',
  sanad: 'Sanad', vakalat: 'Vakalat', brief: 'Brief', associates: 'Associates', partners: 'Partners',
  solo: 'Solo', practice: 'Chamber', firm: 'Firm',
};

export function isPaidPlan(id: unknown): id is PaidPlanId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PLANS, id);
}

/** Rupees per billing period, GST excluded (the taxable value). */
export function periodPriceInr(plan: PaidPlanId, cycle: BillingCycle, munshi: number): number {
  const annual = cycle === 'annual';
  return (annual ? PLANS[plan].annualInr : PLANS[plan].monthlyInr) + munshi * (annual ? MUNSHI.annualInr : MUNSHI.monthlyInr);
}

/** Paise charged for a whole-rupee price, 18% GST added. Integer maths: no rounding needed. */
export function withGstPaise(inr: number): number {
  return inr * (100 + GST_PCT);
}

/** Rupees a month, GST excluded (yearly spread over 12), for MRR. */
export function monthlyValueInr(plan: PaidPlanId, cycle: BillingCycle, munshi: number): number {
  const period = periodPriceInr(plan, cycle, munshi);
  return cycle === 'annual' ? Math.round(period / 12) : period;
}

// ---- Pricing v4 (GST-inclusive), for checkouts opened before v5 went live ----
// New code never creates an order with these ids or prices, so an order that
// carries one was opened before the switch. It is honoured at its v4 price and
// applied as the v5 plan it maps to (migration 0113 moves rows the same way).

const V4_PLANS: Record<string, { monthlyInr: number; annualInr: number; perAdvocate?: boolean }> = {
  sanad:      { monthlyInr: 199,  annualInr: 2190 },
  vakalat:    { monthlyInr: 399,  annualInr: 4490 },
  brief:      { monthlyInr: 1499, annualInr: 16490 },
  associates: { monthlyInr: 649,  annualInr: 7140, perAdvocate: true },
};
const V4_MUNSHI = { monthlyInr: 149, annualInr: 1590 };
export const V4_PACK_PRICES: Record<BriefPackId, number> = { pack_25: 499, pack_60: 999, pack_130: 1999, pack_330: 4999 };

export function isV4Plan(id: unknown): boolean {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(V4_PLANS, id);
}

/** Paise a v4 order charged (GST included). */
export function v4ChargePaise(plan: string, cycle: BillingCycle, advocates: number, munshi: number): number {
  const p = V4_PLANS[plan]!;
  const annual = cycle === 'annual';
  return ((annual ? p.annualInr : p.monthlyInr) * (p.perAdvocate ? advocates : 1)
    + munshi * (annual ? V4_MUNSHI.annualInr : V4_MUNSHI.monthlyInr)) * 100;
}

/** The v5 plan a v4 plan moves to: one advocate -> Advocate; Associates for
 *  2-3 advocates -> Chambers, 4-8 -> Firm. */
export function v5PlanFor(v4: string, advocates: number): PaidPlanId {
  if (v4 !== 'associates') return 'advocate';
  return advocates <= PLANS.chambers.seats ? 'chambers' : 'law_firm';
}

/** "Chambers (up to 3 advocates) + 1 Munshi seat" / "Advocate". */
export function planLabel(plan: string, advocates: number, munshi: number): string {
  if (isBriefPack(plan)) return `Brief Pack (${BRIEF_PACKS[plan].credits} AI credits)`;
  const name = PLAN_NAMES[plan] ?? plan;
  const adv = plan === 'chambers' || plan === 'law_firm' ? ` (up to ${PLANS[plan].seats} advocates)`
    : plan === 'associates' || plan === 'practice' || plan === 'enterprise' ? `, ${advocates} advocates` : '';
  const mun = munshi > 0 ? ` + ${munshi} Munshi seat${munshi === 1 ? '' : 's'}` : '';
  return `${name}${adv}${mun}`;
}
