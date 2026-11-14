import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, Skeleton } from '@lexdraft/ui';
import type { BillingCycle, BillingPlanId, BillingStateResponse, PaidPlanId, SubscriptionInvoice } from '@lexdraft/types';
import { CycleToggle, MunshiPicker, PLAN_NAME, PlanCards, SeatPicker } from '@/components/PlanCards';
import { CreditMeter } from '@/components/DraftMeter';
import { BriefPacks } from '@/components/BriefPacks';
import { downloadSubscriptionInvoice, useBilling, useStartCheckout, useSubscriptionInvoices } from '@/hooks/useBilling';
import { isNativeApp } from '@/lib/google';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

const PAID_IDS: readonly BillingPlanId[] = ['sanad', 'vakalat', 'brief', 'associates'];
const isPaidId = (id: BillingPlanId | null | undefined): id is PaidPlanId => !!id && PAID_IDS.includes(id);

/** The plan the account is on, in the same ids the plan cards use. */
function currentPlanId(c: BillingStateResponse['current']): BillingPlanId | null {
  if (c.freePlan) return 'free';
  if (isPaidId(c.selectedPlan)) return c.selectedPlan;
  // Accounts from before pricing v4.
  if (c.planTier === 'Solo') return c.subscribed ? 'solo' : 'free';
  if (c.planTier === 'Practice') return 'practice';
  if (c.planTier === 'Firm') return 'partners';
  return null;
}

/** "Associates · 3 advocates + 1 Munshi seat" / "Vakalat". */
function planLabel(plan: string, advocates: number, munshi: number): string {
  const adv = plan === 'associates' || plan === 'practice' ? ` · ${advocates} advocates` : '';
  const mun = munshi > 0 ? ` + ${munshi} Munshi seat${munshi === 1 ? '' : 's'}` : '';
  return `${PLAN_NAME[plan] ?? plan}${adv}${mun}`;
}

/** Paid plan picked at onboarding, not paid yet (pricing v4: no free trial). */
const paymentPending = (c: BillingStateResponse['current']) =>
  c.planStatus === 'trial' && !c.freePlan && !c.subscribed && isPaidId(c.selectedPlan);

function statusLine(c: BillingStateResponse['current']): string {
  const id = currentPlanId(c);
  const name = id ? PLAN_NAME[id] ?? id : '';
  if (c.freePlan) return `Free plan · free till ${formatDate(c.trialEndsAt)}`;
  if (paymentPending(c)) return `${name} · payment not finished yet. Pay below to keep using DifAi.`;
  if (c.planStatus === 'trial') return `${name} trial · ends ${formatDate(c.trialEndsAt)}`;
  if (c.planStatus === 'past_due') return `${name} · payment due. Update your payment to keep access.`;
  if (c.planStatus === 'cancelled') return `${name} · cancelled`;
  const cycle = c.billingCycle === 'annual' ? 'yearly' : c.billingCycle === 'monthly' ? 'monthly' : null;
  return `${planLabel(id ?? '', c.seats, c.munshiSeats)}${cycle ? ` · billed ${cycle}` : ''}${c.renewsAt ? ` · paid until ${formatDate(c.renewsAt)}` : ''}`;
}

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
                  {planLabel(inv.plan, inv.seats, inv.munshiSeats)} · {inv.cycle === 'annual' ? 'yearly' : inv.cycle === 'one-time' ? 'one-time' : 'monthly'}
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
  const [waiting, setWaiting] = useState(returned === 'done' || returned === 'paid');
  const { data, isLoading } = useBilling({ refetchInterval: waiting ? 3000 : false });
  const checkout = useStartCheckout();
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [selected, setSelected] = useState<BillingPlanId | null>(null);
  const [seats, setSeats] = useState(2);
  const [munshi, setMunshi] = useState(0);
  const [coupon, setCoupon] = useState('');
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

  // Back from paying for a Brief Pack: the credits land with the webhook.
  useEffect(() => {
    if (returned !== 'pack-done') return;
    const ts = [2000, 5000, 10000, 20000].map((ms) => setTimeout(() => void qc.invalidateQueries({ queryKey: ['credits'] }), ms));
    return () => ts.forEach(clearTimeout);
  }, [returned, qc]);

  useEffect(() => {
    if (data?.current.billingCycle) setCycle(data.current.billingCycle);
  }, [data?.current.billingCycle]);

  // The pickers start at the advocates and Munshi seats the firm already pays for.
  useEffect(() => {
    if (data?.current.planTier === 'Practice') setSeats(Math.min(8, Math.max(2, data.current.seats)));
    if (data) setMunshi(Math.min(4, data.current.munshiSeats));
  }, [data?.current.planTier, data?.current.seats, data?.current.munshiSeats]);

  const clearReturn = () => {
    const next = new URLSearchParams(params);
    next.delete('checkout');
    setParams(next, { replace: true });
  };

  const chosen = data?.plans.find((p) => p.id === selected) ?? null;
  // Pay per period (no Autopay): the same plan again adds a period after the
  // current end; a different plan starts today and the days left on the
  // current one are not carried over.
  const renewing = !!chosen && chosen.id === current && paid
    && (!chosen.seats || data?.current.seats === seats) && data?.current.munshiSeats === munshi;
  const switching = !!chosen && paid && !renewing;

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
      {returned === 'paid' && (
        <div role="status" className="cm-notice">
          <span className="cm-notice-icon" aria-hidden><Icon name="check" size={14} /></span>
          <span>Payment received. Your plan or credits update in a few seconds.</span>
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
                {current ? PLAN_NAME[current] ?? current : 'Free'}
                <span className={data.current.planStatus === 'active' ? 'cm-pill cm-pill--ink' : 'cm-pill cm-pill--line'}>
                  {STATUS_WORD[data.current.planStatus ?? ''] ?? data.current.planStatus ?? 'Free'}
                </span>
              </div>
              <div className="cm-current-note">{data.plans.find((p) => p.id === current)?.for ?? 'Plan & billing'}</div>
            </div>
            <div>
              <div className="cm-label">
                {data.current.freePlan ? 'Free until' : paymentPending(data.current) ? 'Pay by' : data.current.planStatus === 'trial' ? 'Trial ends' : 'Paid until'}
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

          <section className="cm-usage" aria-label="AI credits this month">
            <CreditMeter />
          </section>

          {!native && <BriefPacks packs={data.packs ?? []} canBuy={data.canManage} coupon={coupon.trim()} />}

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
                {chosen.id === 'partners' && 'Firms with nine or more advocates get custom pricing. Book a demo and we will set it up.'}
                {isPaidId(chosen.id) && (
                  !data.paymentsEnabled || !chosen.purchasable
                    ? 'Online payment is being switched on. Please try again soon.'
                    : `One payment covers one ${cycle === 'annual' ? 'year' : 'month'}; nothing is charged automatically. Pay with UPI, card or netbanking through Razorpay.`
                      + (renewing ? ` It adds a ${cycle === 'annual' ? 'year' : 'month'} after ${formatDate(data.current.renewsAt)}.` : '')
                      + (switching ? ' It starts today; the days left on your current plan are not carried over.' : '')
                )}
              </span>
              {chosen.id === 'partners' && (
                <button type="button" className="btn btn-primary" onClick={() => navigate('/signup?intent=demo')}>Book a demo</button>
              )}
              <SeatPicker plan={chosen} cycle={cycle} seats={seats} min={2} onChange={setSeats} />
              <MunshiPicker plan={chosen} cycle={cycle} munshi={munshi} min={0} onChange={setMunshi} />
              {isPaidId(chosen.id) && (
                <label className="cm-seats">
                  <span>Code</span>
                  <input className="input" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder="Optional" maxLength={40} style={{ maxWidth: 160 }} />
                </label>
              )}
              {isPaidId(chosen.id) && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!data.paymentsEnabled || !chosen.purchasable || checkout.isPending}
                  onClick={() => isPaidId(chosen.id) && checkout.mutate(
                    { plan: chosen.id, cycle, munshi, ...(chosen.seats ? { seats } : {}), ...(coupon.trim() ? { coupon: coupon.trim() } : {}) },
                  )}
                >
                  {checkout.isPending ? 'Opening payment…' : renewing ? `Renew ${chosen.name}` : paid ? `Switch to ${chosen.name}` : `Pay for ${chosen.name}`}
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
