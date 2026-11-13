import { useMemo, useState } from 'react';
import { Select, Skeleton } from '@lexdraft/ui';
import type { AdminBillingEvent, BillingEventKind } from '@lexdraft/types';
import { useAdminBilling, useAdminInvoices } from '../queries';
import { adminApi } from '../api';

// =============================================================================
// Billing - self-serve plan sign-ups and payments (Razorpay). The rows
// worth acting on are checkouts that never turned into a payment: the owner's
// WhatsApp number is one click away.
// =============================================================================

type Filter = '' | 'follow_up' | 'signup' | 'paid' | 'problems';

const KIND_LABEL: Record<BillingEventKind, string> = {
  signup: 'Signed up',
  checkout_started: 'Opened checkout',
  subscription_active: 'Paid · plan active',
  renewed: 'Renewed',
  plan_changed: 'Changed plan',
  payment_failed: 'Payment failed',
  on_hold: 'Payment on hold',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

const PLAN_LABEL: Record<string, string> = { free: 'Free', solo: 'Solo', practice: 'Practice', firm: 'Firm' };

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Paying right now (not on the free plan, not on a trial). */
function isPaying(e: AdminBillingEvent): boolean {
  return !e.freePlan && e.planStatus === 'active';
}

function nowOn(e: AdminBillingEvent): string {
  if (e.freePlan) return 'Free plan';
  if (e.planStatus === 'trial') return `${e.planTier ?? ''} trial`;
  return [e.planTier, e.planStatus && e.planStatus !== 'active' ? e.planStatus.replace('_', ' ') : null].filter(Boolean).join(' · ');
}

async function downloadPdf(id: string, invoiceNo: string): Promise<void> {
  const url = URL.createObjectURL(await adminApi.billingInvoicePdf(id));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${invoiceNo.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function BillingView() {
  const { data, isLoading } = useAdminBilling();
  const { data: invoices } = useAdminInvoices();
  const [filter, setFilter] = useState<Filter>('');

  const events = useMemo(() => {
    const all = data?.events ?? [];
    switch (filter) {
      case 'follow_up': {
        // Latest checkout per firm that did not end in a payment.
        const seen = new Set<string>();
        return all.filter((e) => {
          if (e.kind !== 'checkout_started' || isPaying(e) || seen.has(e.firmId)) return false;
          seen.add(e.firmId);
          return true;
        });
      }
      case 'signup': return all.filter((e) => e.kind === 'signup');
      case 'paid': return all.filter((e) => e.kind === 'subscription_active' || e.kind === 'renewed' || e.kind === 'plan_changed');
      case 'problems': return all.filter((e) => ['payment_failed', 'on_hold', 'cancelled', 'expired'].includes(e.kind));
      default: return all;
    }
  }, [data, filter]);

  const s = data?.summary;
  const tiles: Array<[string, string, string]> = s ? [
    ['Paying firms', String(s.payingFirms), 'Active Razorpay subscriptions'],
    ['Monthly revenue', inr(s.mrrInr), 'Yearly plans counted per month'],
    ['Trials ending', String(s.trialsEndingSoon), 'Firm trials ending in 7 days'],
    ['Follow up', String(s.abandonedCheckouts), 'Opened checkout, not paying (30 days)'],
  ] : [];

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Billing</div>
        <h1 className="display-md">Plans and payments</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 640, lineHeight: 1.55 }}>
          Every plan picked at sign-up, every checkout opened and every payment from Razorpay.
          &ldquo;Follow up&rdquo; lists people who opened the payment page but are not paying yet.
        </p>
      </header>

      {isLoading || !s ? (
        <Skeleton width="100%" height={96} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {tiles.map(([label, value, hint]) => (
              <div key={label} className="card" style={{ padding: 16 }}>
                <div className="eyebrow">{label}</div>
                <div className="display" style={{ fontSize: 26, fontWeight: 600, marginTop: 6 }}>{value}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{hint}</div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Sign-ups in the last 30 days:{' '}
            {Object.keys(s.signupsByPlan).length === 0
              ? 'none yet'
              : Object.entries(s.signupsByPlan).map(([p, n]) => `${PLAN_LABEL[p] ?? p} ${n}`).join(' · ')}
          </p>
        </>
      )}

      <div style={{ width: 240 }}>
        <Select
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { value: '', label: 'All activity' },
            { value: 'follow_up', label: 'Follow up (not paid)' },
            { value: 'signup', label: 'Sign-ups' },
            { value: 'paid', label: 'Payments' },
            { value: 'problems', label: 'Failed / cancelled' },
          ]}
        />
      </div>

      <table className="tbl">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>WhatsApp</th>
            <th>What happened</th>
            <th>Plan</th>
            <th>Amount</th>
            <th>Now on</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatWhen(e.createdAt)}</td>
              <td>
                {e.userName ?? '-'}
                <div className="muted mono" style={{ fontSize: 11 }}>{e.email ?? ''}</div>
                {e.firmName && <div className="muted" style={{ fontSize: 11 }}>{e.firmName}</div>}
              </td>
              <td className="mono" style={{ fontSize: 12 }}>
                {e.phone ? <a href={`https://wa.me/${e.phone.replace(/^\+/, '')}`} target="_blank" rel="noreferrer">{e.phone}</a> : '-'}
              </td>
              <td style={{ fontSize: 12 }}>{KIND_LABEL[e.kind] ?? e.kind}</td>
              <td style={{ fontSize: 12 }}>
                {e.plan ? PLAN_LABEL[e.plan] ?? e.plan : '-'}
                {e.cycle && <span className="muted"> · {e.cycle === 'annual' ? 'yearly' : 'monthly'}</span>}
              </td>
              <td className="mono" style={{ fontSize: 12 }}>{e.amountInr ? inr(e.amountInr) : '-'}</td>
              <td style={{ fontSize: 12 }}>{nowOn(e)}</td>
            </tr>
          ))}
          {!isLoading && events.length === 0 && (
            <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 32 }}>Nothing here yet.</td></tr>
          )}
        </tbody>
      </table>

      <section className="col" style={{ gap: 12 }}>
        <h2 className="eyebrow" style={{ margin: 0 }}>GST invoices issued</h2>
        <table className="tbl">
          <thead>
            <tr><th>Date</th><th>Invoice no.</th><th>Practice</th><th>Plan</th><th>Total</th><th>GST</th><th /></tr>
          </thead>
          <tbody>
            {(invoices ?? []).map((inv) => (
              <tr key={inv.id}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatWhen(inv.issuedAt)}</td>
                <td className="mono" style={{ fontSize: 12 }}>{inv.invoiceNo}</td>
                <td style={{ fontSize: 12 }}>{inv.practice ?? '-'}</td>
                <td style={{ fontSize: 12 }}>{PLAN_LABEL[inv.plan] ?? inv.plan}<span className="muted"> · {inv.cycle === 'annual' ? 'yearly' : 'monthly'}</span></td>
                <td className="mono" style={{ fontSize: 12 }}>{inr(inv.totalInr)}</td>
                <td className="mono" style={{ fontSize: 12 }}>{inr(inv.taxInr)}</td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => void downloadPdf(inv.id, inv.invoiceNo)}>PDF</button></td>
              </tr>
            ))}
            {invoices && invoices.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
