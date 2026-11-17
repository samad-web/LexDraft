import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';

export type PaymentMode = 'upi' | 'bank_transfer' | 'cheque' | 'cash';
export const PAYMENT_MODES: Array<{ id: PaymentMode; label: string }> = [
  { id: 'upi', label: 'UPI' }, { id: 'bank_transfer', label: 'Bank transfer' }, { id: 'cheque', label: 'Cheque' }, { id: 'cash', label: 'Cash' },
];
const today = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Result { periodEnd: string; mrrInr: number; invoiceIssued: boolean; duplicate: boolean }

/**
 * Custom (Enterprise) plan recorded against an offline payment; DifAi issues
 * the GST invoice (admin-custom-plan.md). Prices are typed ex-GST, whole ₹.
 */
export function CustomPlanCard({ firmId }: { firmId: string }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [f, setF] = useState({
    name: 'Enterprise', seats: '9', munshiSeats: '0', credits: '1000', price: '', cycle: 'annual' as 'monthly' | 'annual' | 'custom',
    startDate: today(), endDate: '', mode: 'bank_transfer' as PaymentMode, reference: '', receivedOn: today(),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((o) => ({ ...o, [k]: e.target.value }));

  const price = Number(f.price || 0);
  const nums = { seats: Number(f.seats), munshi: Number(f.munshiSeats), credits: Number(f.credits) };
  const errors = useMemo(() => {
    const e: string[] = [];
    if (f.name.trim().length < 2) e.push('Plan name is too short.');
    if (!Number.isInteger(nums.seats) || nums.seats < 1 || nums.seats > 500) e.push('Advocate seats: 1–500.');
    if (!Number.isInteger(nums.munshi) || nums.munshi < 0 || nums.munshi > 100) e.push('Munshi seats: 0–100.');
    if (!Number.isInteger(nums.credits * 2) || nums.credits < 0 || nums.credits > 100000) e.push('Credits: 0–100,000 in steps of ½.');
    if (!Number.isInteger(price) || price < 0 || price > 10_000_000) e.push('Price: whole rupees, 0–1,00,00,000.');
    if (f.cycle === 'custom' && (!f.endDate || f.endDate <= f.startDate)) e.push('End date must be after the start date.');
    if (price > 0 && !f.reference.trim()) e.push('Payment reference is required.');
    return e;
  }, [f, price, nums.seats, nums.munshi, nums.credits]);

  const save = useMutation({
    mutationFn: () => api.post<Result>(`/admin/firms/${firmId}/custom-plan`, {
      key, name: f.name.trim(), seats: nums.seats, munshiSeats: nums.munshi, creditsPerMonth: nums.credits, priceInr: price,
      cycle: f.cycle, startDate: f.startDate, ...(f.cycle === 'custom' ? { endDate: f.endDate } : {}),
      payment: price > 0 ? { mode: f.mode, reference: f.reference.trim(), receivedOn: f.receivedOn } : null,
    }),
    onSuccess: (r) => {
      setKey(crypto.randomUUID());
      void qc.invalidateQueries({ queryKey: ['admin'] });
      showToast({
        type: r.invoiceIssued || price === 0 ? 'sage' : 'amber',
        text: r.duplicate ? 'Already saved' : price > 0 && !r.invoiceIssued
          ? 'Plan saved, but the GST invoice was NOT issued (seller details missing on the server).'
          : `Custom plan active until ${new Date(r.periodEnd).toLocaleDateString('en-IN')}${price > 0 ? ' · GST invoice issued' : ''}`,
      });
    },
  });

  const submit = () => {
    if (errors.length) return;
    if (!window.confirm(`Start "${f.name.trim()}" for this firm now? The current plan period ends today: no refund or carry-over.${price > 0 ? ` A GST invoice for ${inr(price * 1.18)} will be issued.` : ''}`)) return;
    save.mutate();
  };

  return (
    <section className="card" style={{ padding: 24 }} aria-labelledby={`cp-${firmId}`}>
      <h2 id={`cp-${firmId}`} className="heading-lg" style={{ marginBottom: 4 }}>Custom plan</h2>
      <p className="body-sm muted" style={{ marginBottom: 12 }}>For Enterprise and special deals: type the price and credits, record the payment, DifAi issues the GST invoice.</p>
      <form className="col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="body-sm">Plan name (printed on the invoice)<input className="input" value={f.name} maxLength={80} onChange={set('name')} /></label>
        <div className="grid-2" style={{ gap: 8 }}>
          <label className="body-sm">Advocate seats<input className="input" type="number" min={1} max={500} value={f.seats} onChange={set('seats')} /></label>
          <label className="body-sm">Munshi seats<input className="input" type="number" min={0} max={100} value={f.munshiSeats} onChange={set('munshiSeats')} /></label>
          <label className="body-sm">AI credits a month<input className="input" type="number" min={0} max={100000} step={0.5} value={f.credits} onChange={set('credits')} /></label>
          <label className="body-sm">Price for the period (₹, excl. GST)<input className="input" type="number" min={0} step={1} value={f.price} onChange={set('price')} placeholder="0 = complimentary" /></label>
        </div>
        <div className="body-sm muted" aria-live="polite">
          {price > 0 ? `GST 18%: ${inr(price * 0.18)} · Total to collect: ${inr(price * 1.18)}` : 'Complimentary: no invoice, MRR 0.'}
        </div>
        <div className="grid-2" style={{ gap: 8 }}>
          <label className="body-sm">Period
            <select className="input" value={f.cycle} onChange={set('cycle')}>
              <option value="monthly">One month</option><option value="annual">One year</option><option value="custom">Custom end date</option>
            </select>
          </label>
          <label className="body-sm">Starts<input className="input" type="date" value={f.startDate} onChange={set('startDate')} /></label>
          {f.cycle === 'custom' && <label className="body-sm">Ends<input className="input" type="date" value={f.endDate} min={f.startDate} onChange={set('endDate')} /></label>}
        </div>
        {price > 0 && (
          <fieldset className="col" style={{ gap: 8, border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow" style={{ marginBottom: 4 }}>Payment received</legend>
            <div className="grid-2" style={{ gap: 8 }}>
              <label className="body-sm">Mode
                <select className="input" value={f.mode} onChange={set('mode')}>{PAYMENT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
              </label>
              <label className="body-sm">Reference (UTR / UPI / cheque no.)<input className="input" value={f.reference} maxLength={100} onChange={set('reference')} /></label>
              <label className="body-sm">Received on<input className="input" type="date" value={f.receivedOn} onChange={set('receivedOn')} /></label>
            </div>
          </fieldset>
        )}
        {errors.length > 0 && f.price !== '' && <ul className="body-sm" style={{ margin: 0, paddingLeft: 18 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {save.isError && <div role="alert" className="body-sm">{save.error.message}</div>}
        <button type="submit" className="btn btn-primary" disabled={errors.length > 0 || save.isPending}>{save.isPending ? 'Saving…' : 'Start custom plan'}</button>
      </form>
    </section>
  );
}
