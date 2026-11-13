import type { BillingCycle, BillingPlan, BillingPlanId } from '@lexdraft/types';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@lexdraft/ui';

// Plans as the sign-up page shows them before there is a session to ask the
// api (pricing v4). Keep in step with billingPlans() in
// api/src/services/billing.service.ts (pricing-v4.test checks they match).
export const SIGNUP_PLANS: BillingPlan[] = [
  {
    id: 'sanad', name: 'Sanad', for: 'Starting out · the full app with some drafting',
    meaning: 'Sanad: the enrolment certificate every advocate gets from the Bar Council.',
    monthlyInr: 199, annualInr: 2190, note: 'Incl. GST · billed monthly or yearly',
    features: ['25 pages of AI drafting a month', 'Cases, diary & eCourts sync', 'eFiling help, limitation & land records', 'Add a Munshi seat for ₹149/month'],
    purchasable: true, pagesPerMonth: 25, gst: 'inclusive', munshi: { monthlyInr: 149, annualInr: 1590, max: 4 },
  },
  {
    id: 'vakalat', name: 'Vakalat', for: 'A practising advocate taking cases',
    meaning: 'Vakalat: the vakalatnama a client signs so you can act in the case.',
    monthlyInr: 399, annualInr: 4490, note: 'Incl. GST · billed monthly or yearly',
    features: ['75 pages of AI drafting a month', 'Everything in Sanad'],
    purchasable: true, pagesPerMonth: 75, gst: 'inclusive', munshi: { monthlyInr: 149, annualInr: 1590, max: 4 },
  },
  {
    id: 'brief', name: 'Brief', for: 'Heavy drafting · lowest price per page',
    meaning: 'Brief: a case handed to an advocate. Many briefs, a busy practice.',
    monthlyInr: 1499, annualInr: 16490, note: 'Incl. GST · billed monthly or yearly',
    features: ['200 pages of AI drafting a month', 'Everything in Vakalat'],
    purchasable: true, pagesPerMonth: 200, gst: 'inclusive', munshi: { monthlyInr: 149, annualInr: 1590, max: 4 },
  },
  {
    id: 'associates', name: 'Associates', for: 'Chambers with 2 to 8 advocates',
    meaning: 'Associates: as in "X & Associates", advocates working together.',
    monthlyInr: 649, annualInr: 7140, note: 'Per advocate · incl. GST · 2 to 8 advocates',
    features: ['75 pages per advocate a month, shared', 'Everything in Vakalat', 'Roles and permissions', 'Firm dashboard and team chat'],
    purchasable: true, pagesPerMonth: 75, gst: 'inclusive', munshi: { monthlyInr: 149, annualInr: 1590, max: 4 },
    seats: { min: 2, max: 8 },
  },
  {
    id: 'partners', name: 'Partners', for: 'Nine advocates and above',
    meaning: 'Partners: the partners of a larger firm.',
    monthlyInr: null, annualInr: null, note: 'Custom pricing · book a demo',
    features: ['Unlimited seats', 'SSO and audit logs', 'Dedicated success manager', 'Bespoke integrations'],
    purchasable: false, pagesPerMonth: null, gst: null,
  },
];

/** Plan names for every id, including pre-v4 ones on old rows. */
export const PLAN_NAME: Record<string, string> = {
  free: 'Free', sanad: 'Sanad', vakalat: 'Vakalat', brief: 'Brief', associates: 'Associates', partners: 'Partners',
  solo: 'Solo', practice: 'Chamber', firm: 'Firm',
};

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function planPrice(p: BillingPlan, cycle: BillingCycle): { main: string; sub: string } {
  if (p.monthlyInr === null) return { main: 'Custom', sub: p.note };
  if (p.monthlyInr === 0) return { main: 'Free', sub: p.note };
  const each = p.seats ? ' per advocate' : '';
  if (cycle === 'annual' && p.annualInr) {
    return { main: `${inr(p.annualInr)}/yr`, sub: `Billed yearly${each} · incl. GST` };
  }
  return { main: `${inr(p.monthlyInr)}/mo`, sub: p.note };
}

/** Total per billing period for a plan with advocates and Munshi seats. */
export function planTotal(p: BillingPlan, cycle: BillingCycle, advocates: number, munshi: number): number {
  const annual = cycle === 'annual';
  const each = (annual ? p.annualInr : p.monthlyInr) ?? 0;
  const clerk = p.munshi ? (annual ? p.munshi.annualInr : p.munshi.monthlyInr) : 0;
  return each * (p.seats ? advocates : 1) + clerk * munshi;
}

const per = (cycle: BillingCycle) => (cycle === 'annual' ? '/yr' : '/mo');

/** Advocate count picker for Associates checkout (2-8). */
export function SeatPicker({ plan, cycle, seats, min, onChange }: {
  plan: BillingPlan; cycle: BillingCycle; seats: number; min: number; onChange: (n: number) => void;
}) {
  if (!plan.seats) return null;
  const { min: lo0, max } = plan.seats;
  const lo = Math.max(lo0, min);
  const options = Array.from({ length: max - lo0 + 1 }, (_, i) => lo0 + i);
  return (
    <label className="cm-seats">
      <span>Advocates</span>
      <select value={seats} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((n) => (
          <option key={n} value={n} disabled={n < lo}>{n}</option>
        ))}
      </select>
      <span className="cm-seats-total">{inr(planTotal(plan, cycle, seats, 0))}{per(cycle)} · incl. GST</span>
    </label>
  );
}

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
      <span className="cm-seats-total">{inr(price)}{per(cycle)} each · for a clerk or secretary, no AI</span>
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
