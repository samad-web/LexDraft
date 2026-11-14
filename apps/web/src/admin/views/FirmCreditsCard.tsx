import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditBalance } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';

/** A firm's AI credits, and a support / goodwill grant (audited server-side). */
export function FirmCreditsCard({ firmId }: { firmId: string }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { data } = useQuery({
    queryKey: ['admin', 'credits', firmId],
    queryFn: () => api.get<CreditBalance>(`/admin/firms/${firmId}/credits`),
  });
  const [amount, setAmount] = useState('5');
  const [note, setNote] = useState('');
  const grant = useMutation({
    mutationFn: () => api.post<CreditBalance>(`/admin/firms/${firmId}/credits`, { amount: Number(amount), note: note.trim(), days: 30 }),
    onSuccess: (b) => {
      qc.setQueryData(['admin', 'credits', firmId], b);
      setNote('');
      showToast({ type: 'sage', text: 'Credits added' });
    },
  });
  const n = Number(amount);
  const valid = Number.isInteger(n * 2) && n >= 0.5 && n <= 1000 && note.trim().length >= 3;
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
        <label className="body-sm">Add credits (valid 30 days)
          <input className="input" type="number" min={0.5} max={1000} step={0.5} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="body-sm">Reason (kept in the audit log)
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Goodwill for a failed draft" />
        </label>
        {grant.isError && <div role="alert" className="body-sm" style={{ color: 'var(--danger)' }}>{grant.error.message}</div>}
        <button type="submit" className="btn btn-primary" disabled={!valid || grant.isPending}>{grant.isPending ? 'Adding…' : 'Add credits'}</button>
      </form>
    </section>
  );
}
