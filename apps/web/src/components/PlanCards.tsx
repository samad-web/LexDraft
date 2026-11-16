import type { BillingCycle, BillingPlan, BillingPlanId } from '@lexdraft/types';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@lexdraft/ui';

// Plans as the sign-up page shows them before there is a session to ask the
// api (pricing v5: prices exclude 18% GST). Keep in step with billingPlans() in
// api/src/services/billing.service.ts (pricing-v5.test checks they match).
export const SIGNUP_PLANS: BillingPlan[] = [
  {
    id: 'advocate', name: 'Advocate', for: 'One advocate · the full app with AI drafting',
    meaning: 'For an advocate practising on their own.',
    monthlyInr: 699, annualInr: 7689, note: '+ 18% GST · billed monthly or yearly',
    features: ['150 AI credits a month (1 credit = one 400-word page)', 'Cases, diary & eCourts sync', 'eFiling help, limitation & land records', 'Firm analytics', 'Add a Munshi seat for ₹149 + GST a month'],
    purchasable: true, pagesPerMonth: 150, advocates: 1, gst: 'exclusive', munshi: { monthlyInr: 149, annualInr: 1639, max: 4 },
  },
  {
    id: 'chambers', name: 'Chambers', for: 'Up to 3 advocates',
    meaning: 'For a chamber: a senior with a few advocates working together.',
    monthlyInr: 1699, annualInr: 18689, note: '+ 18% GST · billed monthly or yearly',
    features: ['350 AI credits a month, shared', 'Everything in Advocate', 'Roles and permissions', 'Firm dashboard and team chat'],
    purchasable: true, pagesPerMonth: 350, advocates: 3, gst: 'exclusive', munshi: { monthlyInr: 149, annualInr: 1639, max: 4 },
  },
  {
    id: 'law_firm', name: 'Firm', for: 'Up to 8 advocates',
    meaning: 'For a law firm with several advocates.',
    monthlyInr: 3699, annualInr: 40689, note: '+ 18% GST · billed monthly or yearly',
    features: ['750 AI credits a month, shared', 'Everything in Chambers', 'Up to 8 advocates'],
    purchasable: true, pagesPerMonth: 750, advocates: 8, gst: 'exclusive', munshi: { monthlyInr: 149, annualInr: 1639, max: 4 },
  },
  {
    id: 'enterprise', name: 'Enterprise', for: 'Nine advocates and above',
    meaning: 'For larger firms: seats and AI credits set to your size.',
    monthlyInr: null, annualInr: null, note: 'Custom quote · talk to us',
    features: ['Seats and AI credits set for your firm', 'Everything in Firm', 'Dedicated success manager'],
    purchasable: false, pagesPerMonth: null, advocates: null, gst: null,
  },
];

/** Plan names for every id, including older ones on old rows and invoices. */
export const PLAN_NAME: Record<string, string> = {
  free: 'Free', advocate: 'Advocate', chambers: 'Chambers', law_firm: 'Firm', enterprise: 'Enterprise',
  sanad: 'Sanad', vakalat: 'Vakalat', brief: 'Brief', associates: 'Associates', partners: 'Partners',
  solo: 'Solo', practice: 'Chamber', firm: 'Firm',
  pack_25: 'Brief Pack · 25 credits', pack_60: 'Brief Pack · 60 credits', pack_130: 'Brief Pack · 130 credits', pack_330: 'Brief Pack · 330 credits',
};

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
/** Rupees with paise, e.g. ₹824.82. */
export const inrPaise = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function planPrice(p: BillingPlan, cycle: BillingCycle): { main: string; sub: string } {
  if (p.monthlyInr === null) return { main: 'Custom', sub: p.note };
  if (p.monthlyInr === 0) return { main: 'Free', sub: p.note };
  if (cycle === 'annual' && p.annualInr) {
    return { main: `${inr(p.annualInr)}/yr`, sub: 'Billed yearly · + 18% GST' };
  }
  return { main: `${inr(p.monthlyInr)}/mo`, sub: p.note };
}

/** Price per billing period for a plan with Munshi seats, GST excluded. */
export function planTotal(p: BillingPlan, cycle: BillingCycle, munshi: number): number {
  const annual = cycle === 'annual';
  const each = (annual ? p.annualInr : p.monthlyInr) ?? 0;
  const clerk = p.munshi ? (annual ? p.munshi.annualInr : p.munshi.monthlyInr) : 0;
  return each + clerk * munshi;
}

/** What is charged: the price + 18% GST, in rupees with paise (integer maths, like the server). */
export function withGst(inrExGst: number): { gst: number; total: number } {
  const totalPaise = inrExGst * 118;
  return { gst: (totalPaise - inrExGst * 100) / 100, total: totalPaise / 100 };
}

/** "₹699 + ₹125.82 GST (18%) = ₹824.82" */
export function gstLine(inrExGst: number): string {
  const { gst, total } = withGst(inrExGst);
  return `${inr(inrExGst)} + ${inrPaise(gst)} GST (18%) = ${inrPaise(total)}`;
}

const per = (cycle: BillingCycle) => (cycle === 'annual' ? '/yr' : '/mo');

/** Munshi (clerk) seats to add to any paid plan: diary, cause list, eCourts and documents, no AI. */
export function MunshiPicker({ plan, cycle, munshi, min, onChange }: {
  plan: BillingPlan; cycle: BillingCycle; munshi: number; min: number; onChange: (n: number) => void;
}) {
  if (!plan.munshi) return null;
  const price = cycle === 'annual' ? plan.munshi.annualInr : plan.munshi.monthlyInr;
  return (
    <label className="cm-seats">
      <span>Munshi seats</span>
      <select value={munshi} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: plan.munshi.max + 1 }, (_, n) => (
          <option key={n} value={n} disabled={n < min}>{n}</option>
        ))}
      </select>
      <span className="cm-seats-total">{inr(price)}{per(cycle)} + GST each · for your munshi (clerk): diary, hearings, eCourts, eFiling, no AI</span>
    </label>
  );
}

export function CycleToggle({ cycle, onChange }: { cycle: BillingCycle; onChange: (c: BillingCycle) => void }) {
  const btn = (c: BillingCycle, label: ReactNode) => (
    <button type="button" onClick={() => onChange(c)} aria-pressed={cycle === c}>
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Billing cycle" className="cm-cycle">
      {btn('monthly', 'Monthly')}
      {btn('annual', <>Yearly · <span className="cm-cycle-save">about 1 month free</span></>)}
    </div>
  );
}

interface Props {
  plans: BillingPlan[];
  cycle: BillingCycle;
  selected: BillingPlanId | null;
  onSelect: (id: BillingPlanId) => void;
  /** Badge the plan the account is on now (in-app plan page). */
  currentId?: BillingPlanId | null;
  /** Hide feature lists (narrow places). */
  compact?: boolean;
  /** Wide pages: up to this many cards per row (default two). */
  columns?: number;
}

/** "₹2,999/mo" -> figure "₹4,999" + unit "/mo" so the unit can be set small. */
function splitPrice(main: string): { figure: string; unit: string } {
  const i = main.indexOf('/');
  return i > 0 ? { figure: main.slice(0, i), unit: main.slice(i) } : { figure: main, unit: '' };
}

export function PlanCards({ plans, cycle, selected, onSelect, currentId, compact, columns }: Props) {
  const cls = [
    'cm-plans',
    columns ? 'cm-plans--cols' : 'cm-plans--two',
    compact ? 'cm-plans--compact' : '',
  ].filter(Boolean).join(' ');
  return (
    <div
      className={cls}
      style={columns ? ({ '--cm-plan-min': `${columns >= 4 ? 200 : 220}px` } as CSSProperties) : undefined}
    >
      {plans.map((p) => {
        const active = selected === p.id;
        const price = planPrice(p, cycle);
        const { figure, unit } = splitPrice(price.main);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-pressed={active}
            className={`cm-plan${active ? ' is-selected' : ''}`}
          >
            <span className="cm-plan-top">
              <span className="cm-plan-name">{p.name}</span>
              {currentId === p.id && <span className="cm-plan-tag">Current</span>}
            </span>
            <span className="cm-plan-for">{p.for}</span>
            <span className="cm-plan-price">
              {figure}
              {unit && <small>{unit}</small>}
            </span>
            <span className="cm-plan-sub">{price.sub}</span>
            {!compact && (
              <>
                <ul className="cm-plan-feats">
                  {p.features.map((f) => (
                    <li key={f}>
                      <Icon name="check" size={13} /> <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <span className="cm-plan-sub">{p.meaning}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
