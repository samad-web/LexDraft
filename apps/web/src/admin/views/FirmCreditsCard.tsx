import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditBalance } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { PAYMENT_MODES, type PaymentMode } from './CustomPlanCard';

const today = () => new Date().toISOString().slice(0, 10);

/** A firm's AI credits; add credits as goodwill, or sell them for an offline
 *  payment (then a GST invoice is issued). Audited server-side. */
export function FirmCreditsCard({ firmId }: { firmId: string }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { data } = useQuery({
    queryKey: ['admin', 'credits', firmId],
    queryFn: () => api.get<CreditBalance>(`/admin/firms/${firmId}/credits`),
  });
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState('5');
  const [days, setDays] = useState('30');
  const [note, setNote] = useState('');
  const [paidInr, setPaidInr] = useState('');
  const [mode, setMode] = useState<PaymentMode>('upi');
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(today());
  const paid = Number(paidInr || 0);
  const grant = useMutation({
    mutationFn: () => api.post<CreditBalance & { invoiceId: string | null }>(`/admin/firms/${firmId}/credits`, {
      key, amount: Number(amount), note: note.trim(), days: Number(days),
      ...(paid > 0 ? { paidInr: paid, payment: { mode, reference: reference.trim(), receivedOn } } : {}),
    }),
    onSuccess: (b) => {
      qc.setQueryData(['admin', 'credits', firmId], b);
      setKey(crypto.randomUUID());
      setNote(''); setPaidInr(''); setReference('');
      showToast({ type: 'sage', text: paid > 0 ? (b.invoiceId ? 'Credits added · GST invoice issued' : 'Credits added, invoice NOT issued (seller details missing)') : 'Credits added' });
    },
  });
  const n = Number(amount);
  const d = Number(days);
  const valid = Number.isInteger(n * 2) && n >= 0.5 && n <= 100000 && Number.isInteger(d) && d >= 1 && d <= 730
    && note.trim().length >= 3 && (paidInr === '' || (Number.isInteger(paid) && paid >= 1 && reference.trim().length > 0));
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
            <input className="input" type="number" min={0.5} max={100000} step={0.5} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="body-sm">Valid for (days)
            <input className="input" type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        </div>
        <label className="body-sm">Reason (kept in the audit log)
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Goodwill for a failed draft / Top-up sold" />
        </label>
        <label className="body-sm">Amount paid (₹ excl. GST, empty = free)
          <input className="input" type="number" min={1} step={1} value={paidInr} onChange={(e) => setPaidInr(e.target.value)} />
        </label>
        {paid > 0 && (
          <div className="grid-2" style={{ gap: 8 }}>
            <label className="body-sm">Mode
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>{PAYMENT_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            </label>
            <label className="body-sm">Reference<input className="input" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} /></label>
            <label className="body-sm">Received on<input className="input" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} /></label>
            <div className="body-sm muted" style={{ alignSelf: 'end' }}>Total incl. GST: ₹{(paid * 1.18).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        )}
        {grant.isError && <div role="alert" className="body-sm" style={{ color: 'var(--danger)' }}>{grant.error.message}</div>}
        <button type="submit" className="btn btn-primary" disabled={!valid || grant.isPending}>{grant.isPending ? 'Adding…' : paid > 0 ? 'Add credits + issue invoice' : 'Add credits'}</button>
      </form>
    </section>
  );
}
