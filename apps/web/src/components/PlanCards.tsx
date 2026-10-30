import type { BillingCycle, BillingPlan, BillingPlanId } from '@lexdraft/types';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@lexdraft/ui';

// Plans as the sign-up page shows them before there is a session to ask the
// api. Keep in step with billingPlans() in api/src/services/billing.service.ts.
export const SIGNUP_PLANS: BillingPlan[] = [
  {
    id: 'free', name: 'Free', for: 'Solo advocates & law students',
    monthlyInr: 0, annualMonthlyInr: 0, note: 'Free till 1 June 2027',
    features: ['Unlimited AI drafting', 'Cases, hearings & eCourts sync', 'Diary and documents', '1 GB storage'],
    purchasable: false,
  },
  {
    id: 'solo', name: 'Solo', for: 'One advocate, everything unlocked',
    monthlyInr: 1499, annualMonthlyInr: 1199, note: 'Billed monthly or yearly',
    features: ['Everything in Free', 'Limitation tracker', 'Co-counsel handover', 'Practice analytics', 'Team chat', 'Unlimited storage'],
    purchasable: true,
  },
  {
    id: 'practice', name: 'Practice', for: 'Law firms · two to eight advocates',
    monthlyInr: 4999, annualMonthlyInr: 3999, note: '14-day free trial · no card needed',
    features: ['Everything in Solo', 'Up to eight seats', 'Roles and permissions', 'Firm dashboard', 'Priority support'],
    purchasable: true,
  },
  {
    id: 'firm', name: 'Firm', for: 'Nine advocates and above',
    monthlyInr: null, annualMonthlyInr: null, note: 'Custom pricing · book a demo',
    features: ['Unlimited seats', 'SSO and audit logs', 'Dedicated success manager', 'Bespoke integrations'],
    purchasable: false,
  },
];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function planPrice(p: BillingPlan, cycle: BillingCycle): { main: string; sub: string } {
  if (p.monthlyInr === null) return { main: 'Custom', sub: p.note };
  if (p.monthlyInr === 0) return { main: 'Free', sub: p.note };
  const perMonth = cycle === 'annual' ? p.annualMonthlyInr ?? p.monthlyInr : p.monthlyInr;
  return {
    main: `${inr(perMonth)}/mo`,
    sub: cycle === 'annual' ? `${inr(perMonth * 12)} billed yearly` : p.note,
  };
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
      {btn('annual', <>Yearly · <span className="cm-cycle-save">save 20%</span></>)}
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

/** "₹4,999/mo" -> figure "₹4,999" + unit "/mo" so the unit can be set small. */
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
              <ul className="cm-plan-feats">
                {p.features.map((f) => (
                  <li key={f}>
                    <Icon name="check" size={13} /> <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
          </button>
        );
      })}
    </div>
  );
}
