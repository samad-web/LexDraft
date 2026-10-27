import type { BillingCycle, BillingPlan, BillingPlanId } from '@lexdraft/types';
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
  const btn = (c: BillingCycle, label: string) => (
    <button
      type="button"
      onClick={() => onChange(c)}
      aria-pressed={cycle === c}
      style={{
        padding: '6px 14px', border: 0, cursor: 'pointer', fontSize: 13, fontWeight: 500,
        borderRadius: 'var(--radius-full)',
        background: cycle === c ? 'var(--text-primary)' : 'transparent',
        color: cycle === c ? 'var(--bg-base)' : 'var(--text-secondary)',
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Billing cycle"
      style={{
        display: 'inline-flex', gap: 2, padding: 3, alignSelf: 'center',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-full)',
      }}
    >
      {btn('monthly', 'Monthly')}
      {btn('annual', 'Yearly · save 20%')}
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

export function PlanCards({ plans, cycle, selected, onSelect, currentId, compact, columns }: Props) {
  return (
    <div
      className={columns ? undefined : 'facts-grid-2'}
      style={columns
        ? { display: 'grid', gap: 12, gridTemplateColumns: `repeat(auto-fit, minmax(${columns >= 4 ? 190 : 220}px, 1fr))` }
        : { gap: 10 }}
    >
      {plans.map((p) => {
        const active = selected === p.id;
        const price = planPrice(p, cycle);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            aria-pressed={active}
            style={{
              padding: 16, textAlign: 'left', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 6,
              background: active ? 'var(--text-primary)' : 'var(--bg-surface)',
              color: active ? 'var(--bg-base)' : 'var(--text-primary)',
              border: `1px solid ${active ? 'var(--text-primary)' : 'var(--border-default)'}`,
              borderRadius: 'var(--radius-lg)',
              transition: 'border-color 150ms, background 150ms, color 150ms',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>{p.name}</span>
              {currentId === p.id && (
                <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', border: '1px solid currentColor', borderRadius: 'var(--radius-full)', padding: '2px 6px' }}>
                  CURRENT
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, opacity: 0.75 }}>{p.for}</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, marginTop: 4 }}>{price.main}</span>
            <span className="mono" style={{ fontSize: 10, opacity: 0.7 }}>{price.sub}</span>
            {!compact && (
              <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {p.features.map((f) => (
                  <li key={f} style={{ display: 'flex', gap: 6, fontSize: 12, alignItems: 'flex-start' }}>
                    <Icon name="check" size={12} /> <span>{f}</span>
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
