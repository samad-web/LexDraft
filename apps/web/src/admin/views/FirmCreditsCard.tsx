import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditBalance } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { PAYMENT_MODES, type PaymentMode } from './CustomPlanCard';

const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Price for `credits` at `rate` ₹/credit: whole rupees ex-GST (what the
 *  invoice needs), 18% GST, total to collect. */
export function creditPrice(credits: number, rate: number): { amount: number; gst: number; total: number } {
  if (!Number.isFinite(credits) || !Number.isFinite(rate) || credits <= 0 || rate <= 0) return { amount: 0, gst: 0, total: 0 };
  const amount = Math.round(credits * rate);
  return { amount, gst: Math.round(amount * 18) / 100, total: Math.round(amount * 118) / 100 };
}

type Balance = CreditBalance & { pricePerCreditInr?: number };

/** A firm's AI credits; add credits free (goodwill) or sell them for an
 *  offline payment, priced per credit (then a GST invoice is issued). Audited. */
export function FirmCreditsCard({ firmId }: { firmId: string }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { data } = useQuery({
    queryKey: ['admin', 'credits', firmId],
    queryFn: () => api.get<Balance>(`/admin/firms/${firmId}/credits`),
  });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState('5');
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const [free, setFree] = useState(false);
  const [rate, setRate] = useState<string | null>(null); // null = server's suggested rate
  const [override, setOverride] = useState<string | null>(null); // typed amount, else calculated
  const [mode, setMode] = useState<PaymentMode>('upi');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());

  const n = Number(amount);
  const d = Number(days);
  const rateVal = rate ?? String(data?.pricePerCreditInr ?? '');
  const calc = creditPrice(n, Number(rateVal));
  const paid = free ? 0 : override !== null ? Number(override || 0) : calc.amount;
  const shown = override !== null ? creditPrice(paid, 1) : calc; // GST/total for what will be charged

  const grant = useMutation({
    mutationFn: () => api.post<Balance & { invoiceId: string | null }>(`/admin/firms/${firmId}/credits`, {
      key, amount: n, note: note.trim(), days: d,
      ...(paid > 0 ? { paidInr: paid, payment: { mode, reference: reference.trim(), receivedOn } } : {}),
    }),
    onSuccess: (b) => {
      qc.setQueryData(['admin', 'credits', firmId], (old: Balance | undefined) => ({ ...b, pricePerCreditInr: old?.pricePerCreditInr }));
      setKey(crypto.randomUUID());
      setNote(''); setReference(''); setOverride(null);
      showToast({ type: 'sage', text: paid > 0 ? (b.invoiceId ? 'Credits added · GST invoice issued' : 'Credits added, invoice NOT issued (seller details missing)') : 'Credits added' });
    },
  });

  const problems: string[] = [];
  if (!(Number.isInteger(n * 2) && n >= 0.5 && n <= 100000)) problems.push('Credits: 0.5 to 100,000.');
  if (!(Number.isInteger(d) && d >= 1 && d <= 730)) problems.push('Valid for: 1 to 730 days.');
  if (note.trim().length < 3) problems.push('Add a reason (at least 3 characters).');
  if (!free) {
    if (!(Number.isInteger(paid) && paid >= 1)) problems.push('Amount must be whole rupees, at least ₹1 (or tick Free).');
    if (!reference.trim()) problems.push('Add the payment reference (UTR / UPI / cheque no.).');
  }
  const valid = problems.length === 0;

  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="heading-lg" style={{ marginBottom: 12 }}>AI credits</h2>
      {data && (
        <div className="row" style={{ gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
          <div><div className="eyebrow">Left</div><div className="mono tabular" style={{ fontSize: 20, fontWeight: 600 }}>{data.balance}</div></div>
          <div><div className="eyebrow">This month</div><div className="mono tabular">{data.usedThisCycle} / {data.allowance}</div></div>
          <div><div className="eyebrow">Packs / grants</div><div className="mono tabular">{data.topup}</div></div>
        </div>
      )}
      <form className="col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (valid) grant.mutate(); }}>
        <div className="grid-2" style={{ gap: 8 }}>
          <label className="body-sm">Add credits
            <input className="input" type="number" min={0.5} max={100000} step={0.5} value={amount} onChange={(e) => { setAmount(e.target.value); setOverride(null); }} />
          </label>
          <label className="body-sm">Valid for (days)
            <input className="input" type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        </div>
        <label className="body-sm">Reason (kept in the audit log)
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Enterprise top-up / Goodwill for a failed draft" />
        </label>
        <label className="body-sm row" style={{ gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
          Free (goodwill): no payment, no invoice
        </label>
        {!free && (
          <>
            <div className="grid-2" style={{ gap: 8 }}>
              <label className="body-sm">Price per credit (₹, excl. GST)
                <input className="input" type="number" min={0.01} step={0.01} value={rateVal} onChange={(e) => { setRate(e.target.value); setOverride(null); }} />
              </label>
              <label className="body-sm">Amount (₹, excl. GST)
                <input className="input" type="number" min={1} step={1} value={override ?? String(calc.amount)} onChange={(e) => setOverride(e.target.value)} />
              </label>
            </div>
            <div className="body-sm" aria-live="polite" style={{ lineHeight: 1.6 }}>
              {override === null
                ? <>{n || 0} credits × {money(Number(rateVal) || 0)} = <strong>{money(calc.amount)}</strong></>
                : <>Amount typed by hand: <strong>{money(paid)}</strong> <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOverride(null)}>Use the calculated {money(calc.amount)}</button></>}
              <br />GST 18%: {money(shown.gst)} · <strong>Total to collect: {money(shown.total)}</strong>
              {data?.pricePerCreditInr && rate === null && <span className="muted"> · rate = best Brief Pack price</span>}
            </div>
            <div className="grid-2" style={{ gap: 8 }}>
              <label className="body-sm">Mode
                <select className="input" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>{PAYMENT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
              </label>
              <label className="body-sm">Reference (UTR / UPI / cheque no.)<input className="input" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} /></label>
              <label className="body-sm">Received on<input className="input" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></label>
            </div>
          </>
        )}
        {!valid && <ul className="body-sm muted" style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {grant.isError && <div role="alert" className="body-sm" style={{ color: 'var(--danger)' }}>{grant.error.message}</div>}
        <button type="submit" className="btn btn-primary" disabled={!valid || grant.isPending}>
          {grant.isPending ? 'Adding…' : free ? 'Add free credits' : `Add credits + issue invoice (${money(shown.total)})`}
        </button>
      </form>
    </section>
  );
}
