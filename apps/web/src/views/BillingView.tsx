import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@lexdraft/ui';
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
    <div className="col stagger" style={{ gap: 24, maxWidth: 980 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Plan &amp; billing</div>
        <h1 className="display-md">Your plan</h1>
        {data && <p className="body" style={{ marginTop: 8, color: 'var(--text-secondary)' }}>{statusLine(data.current)}</p>}
      </header>

      {returned === 'done' && (
        <div role="status" className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>
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
        <div role="status" className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Payment cancelled. Nothing was charged.</span>
          <button type="button" className="btn btn-sm" onClick={clearReturn}>Dismiss</button>
        </div>
      )}

      {isLoading || !data ? (
        <Skeleton width="100%" height={320} />
      ) : (
        <>
          <CycleToggle cycle={cycle} onChange={setCycle} />
          <PlanCards plans={data.plans} cycle={cycle} selected={selected} onSelect={setSelected} currentId={current} columns={4} />

          {!data.canManage && (
            <p className="body-sm muted">Only the account owner can change the plan. Ask them to upgrade from this page.</p>
          )}
          {data.canManage && chosen && (
            <div className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 220 }}>
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
          {checkout.isError && <div role="alert" className="body-sm" style={{ color: 'var(--danger)' }}>{checkout.error.message}</div>}
        </>
      )}
    </div>
  );
}
