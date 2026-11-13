import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, Skeleton } from '@lexdraft/ui';
import type { BillingCycle, BillingPlanId, BillingStateResponse, SubscriptionInvoice } from '@lexdraft/types';
import { CycleToggle, PlanCards, SeatPicker } from '@/components/PlanCards';
import { DraftMeter } from '@/components/DraftMeter';
import { downloadSubscriptionInvoice, useBilling, useStartCheckout, useSubscriptionInvoices } from '@/hooks/useBilling';
import { isNativeApp } from '@/lib/google';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Plan names as advocates see them (`Practice` is sold as Chamber). */
function tierLabel(tier: string | null): string {
  return tier === 'Practice' ? 'Chamber' : tier ?? '';
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
  const tier = tierLabel(c.planTier);
  if (c.freePlan) return `Free plan · free till ${formatDate(c.trialEndsAt)}`;
  if (c.planStatus === 'trial') return `${tier} trial · ends ${formatDate(c.trialEndsAt)}`;
  if (c.planStatus === 'past_due') return `${tier} · payment due. Update your payment to keep access.`;
  if (c.planStatus === 'cancelled') return `${tier} · cancelled`;
  const cycle = c.billingCycle === 'annual' ? 'yearly' : c.billingCycle === 'monthly' ? 'monthly' : null;
  const seats = c.planTier === 'Practice' ? ` · ${c.seats} advocates` : '';
  return `${tier}${seats}${cycle ? ` · billed ${cycle}` : ''}${c.renewsAt ? ` · renews ${formatDate(c.renewsAt)}` : ''}`;
}

const PLAN_NAME: Record<string, string> = { solo: 'Solo', practice: 'Chamber' };

/** GST tax invoices for this practice's payments, newest first. Hidden until there is one. */
function SubscriptionInvoices() {
  const { data: items } = useSubscriptionInvoices(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!items?.length) return null;
  const download = async (inv: SubscriptionInvoice) => {
    setBusy(inv.id);
    setFailed(null);
    try {
      await downloadSubscriptionInvoice(inv);
    } catch {
      setFailed(inv.id);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section aria-label="Invoices" style={{ marginTop: 24 }}>
      <h2 className="cm-plans-title" style={{ marginBottom: 12 }}>Invoices</h2>
      <div className="card cm-table-card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Date</th>
              <th>Invoice no.</th>
              <th className="col-hide-mobile">Plan</th>
              <th style={{ textAlign: 'right' }}>Amount (incl. GST)</th>
              <th aria-label="Download" />
            </tr>
          </thead>
          <tbody>
            {items.map((inv) => (
              <tr key={inv.id}>
                <td>{formatDate(inv.issuedAt)}</td>
                <td>{inv.invoiceNo}</td>
                <td className="col-hide-mobile">
                  {PLAN_NAME[inv.plan] ?? inv.plan}{inv.plan === 'practice' ? ` · ${inv.seats} advocates` : ''} · {inv.cycle === 'annual' ? 'yearly' : 'monthly'}
                </td>
                <td style={{ textAlign: 'right' }}>₹{inv.totalInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="cm-row-actions">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy === inv.id} onClick={() => void download(inv)}>
                    {busy === inv.id ? 'Preparing…' : failed === inv.id ? 'Retry' : 'Download PDF'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function BillingView() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const returned = params.get('checkout');
  // Back from Razorpay: the plan flips when the webhook lands, so poll briefly.
  const [waiting, setWaiting] = useState(returned === 'done');
  const { data, isLoading } = useBilling({ refetchInterval: waiting ? 3000 : false });
  const checkout = useStartCheckout();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [selected, setSelected] = useState<BillingPlanId | null>(null);
  const [seats, setSeats] = useState(2);
  const native = isNativeApp();

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

  // A Chamber firm starts the picker at the advocates it already pays for.
  useEffect(() => {
    if (data?.current.planTier === 'Practice') setSeats(Math.min(8, Math.max(2, data.current.seats)));
  }, [data?.current.planTier, data?.current.seats]);

  const clearReturn = () => {
    const next = new URLSearchParams(params);
    next.delete('checkout');
    setParams(next, { replace: true });
  };

  const chosen = data?.plans.find((p) => p.id === selected) ?? null;
  const sameAsNow = !!chosen && chosen.id === current && paid && data?.current.billingCycle === cycle
    && (chosen.id !== 'practice' || data?.current.seats === seats);

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
                {data.current.freePlan ? 'Free' : tierLabel(data.current.planTier)}
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
              {!native && <div className="cm-current-note">UPI, cards and netbanking via Razorpay</div>}
            </div>
          </section>

          <section className="cm-usage" aria-label="Drafts this month">
            <DraftMeter />
          </section>

          {data.canManage && <SubscriptionInvoices />}

          {/* Android app: plan status only. No plan picker or checkout until Play
              Billing exists (Play payments policy). */}
          {!native && (<>
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
                      : `Pay securely with Razorpay (UPI Autopay, cards, netbanking). Your plan switches as soon as the payment goes through.`
                )}
              </span>
              {chosen.id === 'firm' && (
                <button type="button" className="btn btn-primary" onClick={() => navigate('/signup?intent=demo')}>Book a demo</button>
              )}
              {chosen.seats && (
                <SeatPicker plan={chosen} cycle={cycle} seats={seats} min={2} onChange={setSeats} />
              )}
              {(chosen.id === 'solo' || chosen.id === 'practice') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={sameAsNow || !data.paymentsEnabled || !chosen.purchasable || checkout.isPending}
                  onClick={() => checkout.mutate(
                    chosen.id === 'practice' ? { plan: 'practice', cycle, seats } : { plan: 'solo', cycle },
                  )}
                >
                  {checkout.isPending ? 'Opening payment…' : `Upgrade to ${chosen.name}`}
                </button>
              )}
            </div>
          )}
          {checkout.isError && (
            <div role="alert" className="cm-error-line"><Icon name="flag" size={13} /> {checkout.error.message}</div>
          )}
          </>)}
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
