import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, Skeleton } from '@lexdraft/ui';
import type { BillingCycle, BillingPlanId, BillingStateResponse } from '@lexdraft/types';
import { CycleToggle, PlanCards } from '@/components/PlanCards';
import { useBilling, useStartCheckout } from '@/hooks/useBilling';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The plan the account is on, in the same ids the plan cards use. */
function currentPlanId(c: BillingStateResponse['current']): BillingPlanId | null {
  if (c.freePlan) return 'free';
  if (c.planTier === 'Solo') return c.subscribed ? 'solo' : 'free';
  if (c.planTier === 'Practice') return 'practice';
  if (c.planTier === 'Firm') return 'firm';
  return null;
}

function statusLine(c: BillingStateResponse['current']): string {
  if (c.freePlan) return `Free plan · free till ${formatDate(c.trialEndsAt)}`;
  if (c.planStatus === 'trial') return `${c.planTier} trial · ends ${formatDate(c.trialEndsAt)}`;
  if (c.planStatus === 'past_due') return `${c.planTier} · payment due. Update your payment to keep access.`;
  if (c.planStatus === 'cancelled') return `${c.planTier} · cancelled`;
  const cycle = c.billingCycle === 'annual' ? 'yearly' : c.billingCycle === 'monthly' ? 'monthly' : null;
  return `${c.planTier}${cycle ? ` · billed ${cycle}` : ''}${c.renewsAt ? ` · renews ${formatDate(c.renewsAt)}` : ''}`;
}

export function BillingView() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const returned = params.get('checkout');
  // Back from Dodo: the plan flips when the webhook lands, so poll briefly.
  const [waiting, setWaiting] = useState(returned === 'done');
  const { data, isLoading } = useBilling({ refetchInterval: waiting ? 3000 : false });
  const checkout = useStartCheckout();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [selected, setSelected] = useState<BillingPlanId | null>(null);

  const current = data ? currentPlanId(data.current) : null;
  const paid = !!data?.current.subscribed && data.current.planStatus === 'active';

  useEffect(() => {
    if (!waiting) return;
    if (paid) {
      setWaiting(false);
      // Features and limits come from the new plan: refetch everything.
      void qc.invalidateQueries();
      return;
    }
    const t = setTimeout(() => setWaiting(false), 60_000);
    return () => clearTimeout(t);
  }, [waiting, paid, qc]);

  useEffect(() => {
    if (data?.current.billingCycle) setCycle(data.current.billingCycle);
  }, [data?.current.billingCycle]);

  const clearReturn = () => {
    const next = new URLSearchParams(params);
    next.delete('checkout');
    setParams(next, { replace: true });
  };

  const chosen = data?.plans.find((p) => p.id === selected) ?? null;
  const sameAsNow = !!chosen && chosen.id === current && paid && data?.current.billingCycle === cycle;

  return (
    <div className="col stagger cm-billing" style={{ gap: 24 }}>
      <header className="page-header">
        <div className="page-header-row">
          <div className="page-header-text">
            <div className="cm-label" style={{ marginBottom: 10 }}>Plan &amp; billing</div>
            <h1 className="heading-xl">Your plan</h1>
            {data && <p className="body-sm muted page-header-desc">{statusLine(data.current)}</p>}
          </div>
        </div>
      </header>

      {returned === 'done' && (
        <div role="status" className="cm-notice">
          <span className="cm-notice-icon" aria-hidden><Icon name="check" size={14} /></span>
          <span>
            {paid
              ? 'Payment received. Your plan is active.'
              : waiting
                ? 'Payment received. Activating your plan…'
                : 'We have not heard from the payment provider yet. Refresh in a minute; if your plan still shows the old one, write to support.'}
          </span>
          <button type="button" className="btn btn-sm" onClick={clearReturn}>Dismiss</button>
        </div>
      )}
      {returned === 'cancelled' && (
        <div role="status" className="cm-notice">
          <span className="cm-notice-icon" aria-hidden><Icon name="close" size={13} /></span>
          <span>Payment cancelled. Nothing was charged.</span>
          <button type="button" className="btn btn-sm" onClick={clearReturn}>Dismiss</button>
        </div>
      )}

      {isLoading || !data ? (
        <div className="col" style={{ gap: 16 }} aria-busy="true">
          <Skeleton width="100%" height={120} />
          <Skeleton width="100%" height={320} />
        </div>
      ) : (
        <>
          <section className="cm-current" aria-label="Current plan">
            <div>
              <div className="cm-label">Current plan</div>
              <div className="cm-current-plan">
                {data.current.freePlan ? 'Free' : data.current.planTier}
                <span className={data.current.planStatus === 'active' ? 'cm-pill cm-pill--ink' : 'cm-pill cm-pill--line'}>
                  {STATUS_WORD[data.current.planStatus ?? ''] ?? data.current.planStatus ?? 'Free'}
                </span>
              </div>
              <div className="cm-current-note">{data.plans.find((p) => p.id === current)?.for ?? 'Plan & billing'}</div>
            </div>
            <div>
              <div className="cm-label">
                {data.current.planStatus === 'trial' || data.current.freePlan ? 'Free until' : 'Renews'}
              </div>
              <div className="cm-current-v">
                {formatDate(data.current.planStatus === 'trial' || data.current.freePlan ? data.current.trialEndsAt : data.current.renewsAt)}
              </div>
              <div className="cm-current-note">{daysLeftNote(data.current)}</div>
            </div>
            <div>
              <div className="cm-label">Billing</div>
              <div className="cm-current-v">
                {data.current.billingCycle === 'annual' ? 'Yearly' : data.current.billingCycle === 'monthly' ? 'Monthly' : 'Not set up'}
              </div>
              <div className="cm-current-note">UPI, cards and netbanking via Dodo Payments</div>
            </div>
          </section>

          <div className="cm-plans-head">
            <h2 className="cm-plans-title">Choose a plan</h2>
            <CycleToggle cycle={cycle} onChange={setCycle} />
          </div>
          <PlanCards plans={data.plans} cycle={cycle} selected={selected} onSelect={setSelected} currentId={current} columns={4} />

          {!data.canManage && (
            <p className="body-sm muted">Only the account owner can change the plan. Ask them to upgrade from this page.</p>
          )}
          {data.canManage && chosen && (
            <div className="cm-checkout">
              <span className="cm-checkout-text">
                <strong>{chosen.name}</strong>
                {chosen.id === 'free' && 'The free plan is what you get when no paid plan is active.'}
                {chosen.id === 'firm' && 'Firms with nine or more advocates get custom pricing. Book a demo and we will set it up.'}
                {(chosen.id === 'solo' || chosen.id === 'practice') && (
                  sameAsNow ? 'You are already on this plan.'
                    : !data.paymentsEnabled || !chosen.purchasable
                      ? 'Online payment is being switched on. Please try again soon.'
                      : `Pay securely on Dodo Payments (UPI, cards, netbanking). Your plan switches as soon as the payment goes through.`
                )}
              </span>
              {chosen.id === 'firm' && (
                <button type="button" className="btn btn-primary" onClick={() => navigate('/signup?intent=demo')}>Book a demo</button>
              )}
              {(chosen.id === 'solo' || chosen.id === 'practice') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={sameAsNow || !data.paymentsEnabled || !chosen.purchasable || checkout.isPending}
                  onClick={() => checkout.mutate({ plan: chosen.id as 'solo' | 'practice', cycle })}
                >
                  {checkout.isPending ? 'Opening payment…' : `Upgrade to ${chosen.name}`}
                </button>
              )}
            </div>
          )}
          {checkout.isError && (
            <div role="alert" className="cm-error-line"><Icon name="flag" size={13} /> {checkout.error.message}</div>
          )}
        </>
      )}
    </div>
  );
}

const STATUS_WORD: Record<string, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Payment due',
  cancelled: 'Cancelled',
};

function daysLeftNote(c: BillingStateResponse['current']): string {
  const iso = c.planStatus === 'trial' || c.freePlan ? c.trialEndsAt : c.renewsAt;
  if (!iso) return c.planStatus === 'cancelled' ? 'Pick a plan to continue' : '—';
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return '—';
  if (days < 0) return 'Ended';
  if (days === 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}
