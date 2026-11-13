import type { BillingCycle, FirmPlanTier, PaidPlanId } from '@lexdraft/types';

// =============================================================================
// Pricing v4 catalogue (build-docs/features/pricing-v4.md). DRAFT prices, not
// final: change them here only. Every price includes 18% GST. Mirrored in web
// components/PlanCards.tsx (SIGNUP_PLANS); pricing-v4.test keeps them in step.
// =============================================================================

export interface PaidPlanDef {
  name: string;
  /** Permission tier the plan maps to (permissions are unchanged by v4). */
  tier: FirmPlanTier;
  monthlyInr: number;
  annualInr: number;
  /** AI drafting pages a month (per advocate on Associates, shared pool). */
  pages: number;
  /** Associates: priced per advocate, bought for min..max advocates. */
  perAdvocate?: { min: number; max: number };
}

export const PLANS: Record<PaidPlanId, PaidPlanDef> = {
  sanad:      { name: 'Sanad',      tier: 'Solo',     monthlyInr: 199,  annualInr: 2190,  pages: 25 },
  vakalat:    { name: 'Vakalat',    tier: 'Solo',     monthlyInr: 399,  annualInr: 4490,  pages: 75 },
  brief:      { name: 'Brief',      tier: 'Solo',     monthlyInr: 1499, annualInr: 16490, pages: 200 },
  associates: { name: 'Associates', tier: 'Practice', monthlyInr: 649,  annualInr: 7140,  pages: 75, perAdvocate: { min: 2, max: 8 } },
};

/** Munshi (clerk) seat: diary, cause list, eCourts and documents. Any paid plan. */
export const MUNSHI = { monthlyInr: 149, annualInr: 1590, max: 4 } as const;

/** Roles a Munshi seat covers (decision 2a: existing roles, no new one). */
export const MUNSHI_ROLES: readonly string[] = ['Paralegal', 'Legal Secretary'];

/** Names for every plan id, including pre-v4 ones on old rows. */
export const PLAN_NAMES: Record<string, string> = {
  free: 'Free', sanad: 'Sanad', vakalat: 'Vakalat', brief: 'Brief', associates: 'Associates', partners: 'Partners',
  solo: 'Solo', practice: 'Chamber', firm: 'Firm',
};

export function isPaidPlan(id: unknown): id is PaidPlanId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PLANS, id);
}

/** Rupees per billing period, GST included. */
export function periodPriceInr(plan: PaidPlanId, cycle: BillingCycle, advocates: number, munshi: number): number {
  const p = PLANS[plan];
  const annual = cycle === 'annual';
  const each = annual ? p.annualInr : p.monthlyInr;
  return each * (p.perAdvocate ? advocates : 1) + munshi * (annual ? MUNSHI.annualInr : MUNSHI.monthlyInr);
}

/** Rupees a month (yearly spread over 12), for MRR. */
export function monthlyValueInr(plan: PaidPlanId, cycle: BillingCycle, advocates: number, munshi: number): number {
  const period = periodPriceInr(plan, cycle, advocates, munshi);
  return cycle === 'annual' ? Math.round(period / 12) : period;
}

/** "Associates, 3 advocates + 1 Munshi seat" / "Vakalat". */
export function planLabel(plan: string, advocates: number, munshi: number): string {
  const name = PLAN_NAMES[plan] ?? plan;
  const adv = plan === 'associates' || plan === 'practice' ? `, ${advocates} advocates` : '';
  const mun = munshi > 0 ? ` + ${munshi} Munshi seat${munshi === 1 ? '' : 's'}` : '';
  return `${name}${adv}${mun}`;
}
