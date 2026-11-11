import type { BillingCycle, BillingPlan, BillingPlanId } from '@lexdraft/types';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@lexdraft/ui';

// Plans as the sign-up page shows them before there is a session to ask the
// api. Keep in step with billingPlans() in api/src/services/billing.service.ts.
export const SIGNUP_PLANS: BillingPlan[] = [
  {
    id: 'free', name: 'Free', for: 'Solo advocates & law students',
    monthlyInr: 0, annualMonthlyInr: 0, note: 'Free till 1 June 2027',
    features: ['30 drafts a month', 'Cases, hearings & eCourts sync', 'Diary and documents', '1 GB storage'],
    purchasable: false, draftsPerMonth: 30, gst: null,
  },
  {
    id: 'solo', name: 'Solo', for: 'One advocate, everything unlocked',
    monthlyInr: 1499, annualMonthlyInr: 1199, note: 'Incl. GST · billed monthly or yearly',
    features: ['50 drafts a month', 'Everything in Free', 'Limitation tracker', 'Co-counsel handover', 'Practice analytics', 'Team chat', 'Unlimited storage'],
    purchasable: true, draftsPerMonth: 50, gst: 'inclusive',
  },
  {
    id: 'practice', name: 'Chamber', for: 'Chambers and firms · two to eight advocates',
    monthlyInr: 2999, annualMonthlyInr: 2399, note: '+18% GST · 2 advocates included · 14-day free trial',
    features: ['40 drafts per advocate a month', 'Everything in Solo', 'Extra advocate ₹899/month, up to 8', 'Roles and permissions', 'Firm dashboard', 'Priority support'],
    purchasable: true, draftsPerMonth: 40, gst: 'exclusive',
    seats: { included: 2, max: 8, extraMonthlyInr: 899, extraAnnualMonthlyInr: 719 },
  },
  {
    id: 'firm', name: 'Firm', for: 'Nine advocates and above',
    monthlyInr: null, annualMonthlyInr: null, note: 'Custom pricing · book a demo',
    features: ['Unlimited seats', 'SSO and audit logs', 'Dedicated success manager', 'Bespoke integrations'],
    purchasable: false, draftsPerMonth: null, gst: null,
  },
];

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function planPrice(p: BillingPlan, cycle: BillingCycle): { main: string; sub: string } {
  if (p.monthlyInr === null) return { main: 'Custom', sub: p.note };
  if (p.monthlyInr === 0) return { main: 'Free', sub: p.note };
  const perMonth = cycle === 'annual' ? p.annualMonthlyInr ?? p.monthlyInr : p.monthlyInr;
  const gst = p.gst === 'inclusive' ? ' · incl. GST' : p.gst === 'exclusive' ? ' · +18% GST' : '';
  return {
    main: `${inr(perMonth)}/mo`,
    sub: cycle === 'annual' ? `${inr(perMonth * 12)} billed yearly${gst}` : p.note,
  };
}

/** Chamber price for a seat count: base covers the included advocates. */
export function chamberMonthly(p: BillingPlan, cycle: BillingCycle, seats: number): number | null {
  if (!p.seats || p.monthlyInr === null) return null;
  const annual = cycle === 'annual';
  const base = annual ? p.annualMonthlyInr ?? p.monthlyInr : p.monthlyInr;
  const extra = Math.max(0, seats - p.seats.included);
  return base + extra * (annual ? p.seats.extraAnnualMonthlyInr : p.seats.extraMonthlyInr);
}

/** Advocate count picker for Chamber checkout (2-8). */
export function SeatPicker({ plan, cycle, seats, min, onChange }: {
  plan: BillingPlan; cycle: BillingCycle; seats: number; min: number; onChange: (n: number) => void;
}) {
  if (!plan.seats) return null;
  const lo = Math.max(plan.seats.included, min);
  const options = Array.from({ length: plan.seats.max - plan.seats.included + 1 }, (_, i) => plan.seats!.included + i);
  const monthly = chamberMonthly(plan, cycle, seats) ?? 0;
  return (
    <label className="cm-seats">
      <span>Advocates</span>
      <select value={seats} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((n) => (
          <option key={n} value={n} disabled={n < lo}>{n}</option>
        ))}
      </select>
      <span className="cm-seats-total">
        {inr(monthly)}/mo{cycle === 'annual' ? `, ${inr(monthly * 12)} billed yearly` : ''} · +18% GST
      </span>
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
