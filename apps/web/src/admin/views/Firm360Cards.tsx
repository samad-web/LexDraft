import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminFirmLedgerPage, AdminFirmPayments } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';
import { downloadPdf } from './BillingView';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const rupees = (n: number | null) => (n == null ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** Payments (online + manual) and GST invoices for one firm (admin-firm-360). */
export function FirmPaymentsCard({ firmId }: { firmId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'firm-payments', firmId],
    queryFn: () => api.get<AdminFirmPayments>(`/admin/firms/${firmId}/payments`),
  });
  return (
    <section className="card" style={{ padding: 24 }} aria-labelledby={`pay-${firmId}`}>
      <h2 id={`pay-${firmId}`} className="heading-lg" style={{ marginBottom: 12 }}>Payments & invoices</h2>
      {isLoading ? <div className="muted">Loading…</div> : isError || !data ? <div role="alert">Could not load payments.</div> : (
        <>
          {data.events.length === 0 ? <div className="muted body-sm">No payments yet.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>When</th><th>Event</th><th>Plan</th><th style={{ textAlign: 'right' }}>Amount</th><th>Paid via</th></tr></thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td className="mono body-sm">{when(e.createdAt)}</td>
                      <td>{e.kind.replace(/_/g, ' ')}</td>
                      <td>{e.plan ?? '—'}{e.cycle ? ` · ${e.cycle}` : ''}</td>
                      <td className="mono tabular" style={{ textAlign: 'right' }}>{rupees(e.amountInr)}</td>
                      <td className="body-sm">{e.provider === 'manual' ? e.note ?? 'manual' : e.provider}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className="eyebrow" style={{ margin: '16px 0 8px' }}>GST invoices</h3>
          {data.invoices.length === 0 ? <div className="muted body-sm">No invoices.</div> : (
            <ul className="col" style={{ gap: 6, listStyle: 'none', padding: 0, margin: 0 }}>
              {data.invoices.map((i) => (
                <li key={i.id} className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="mono">{i.invoiceNo}</span>
                  <span className="body-sm muted">{new Date(i.issuedAt).toLocaleDateString('en-IN')}</span>
                  <span className="mono tabular">{rupees(i.totalInr)}</span>
                  <button type="button" className="btn btn-sm" onClick={() => void downloadPdf(i.id, i.invoiceNo)}>PDF</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Who spent which credits on what (admin-firm-360), 50 a page. */
export function FirmLedgerCard({ firmId }: { firmId: string }) {
  const q = useInfiniteQuery({
    queryKey: ['admin', 'firm-ledger', firmId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<AdminFirmLedgerPage>(`/admin/firms/${firmId}/ledger`, pageParam ? { before: pageParam } : {}),
    getNextPageParam: (last) => last.next,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="card" style={{ padding: 24 }} aria-labelledby={`led-${firmId}`}>
      <h2 id={`led-${firmId}`} className="heading-lg" style={{ marginBottom: 12 }}>Credit history</h2>
      {q.isLoading ? <div className="muted">Loading…</div> : q.isError ? <div role="alert">Could not load credit history.</div>
        : rows.length === 0 ? <div className="muted body-sm">No credits used yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th style={{ textAlign: 'right' }}>Credits</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono body-sm">{when(r.createdAt)}</td>
                    <td>{r.userName ?? '—'}</td>
                    <td>{r.action.replace(/_/g, ' ')}{r.kind === 'refund' ? ' (refund)' : ''}</td>
                    <td className="mono tabular" style={{ textAlign: 'right' }}>{r.credits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {q.hasNextPage && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {q.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </button>
      )}
    </section>
  );
}

/** Free extension by whole months (keeps the credit month), audited. */
export function ExtendPlanCard({ firmId, renewsAt }: { firmId: string; renewsAt: string | null }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const [months, setMonths] = useState('1');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ renewsAt: string }>(`/admin/firms/${firmId}/extend`, { months: Number(months), reason: reason.trim() }),
    onSuccess: (r) => {
      setReason('');
      void qc.invalidateQueries({ queryKey: ['admin'] });
      showToast({ type: 'sage', text: `Paid until ${new Date(r.renewsAt).toLocaleDateString('en-IN')}` });
    },
  });
  const valid = reason.trim().length >= 3;
  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="heading-lg" style={{ marginBottom: 4 }}>Extend plan (no charge)</h2>
      <p className="body-sm muted" style={{ marginBottom: 12 }}>Paid until {renewsAt ?? '—'}. Adds whole months; no payment, no invoice, credits keep their monthly cycle.</p>
      <form className="col" style={{ gap: 8 }} onSubmit={(e) => {
        e.preventDefault();
        if (valid && window.confirm(`Extend this firm's plan by ${months} month(s) at no charge?`)) m.mutate();
      }}>
        <label className="body-sm">Months
          <select className="input" value={months} onChange={(e) => setMonths(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="body-sm">Reason (kept in the audit log)
          <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Goodwill after an outage" />
        </label>
        {m.isError && <div role="alert" className="body-sm">{m.error.message}</div>}
        <button type="submit" className="btn" disabled={!valid || m.isPending}>{m.isPending ? 'Saving…' : 'Extend'}</button>
      </form>
    </section>
  );
}

/** Land Records platform switch (land-records-tn-gate): TN advocates only. */
export function LandRecordsSwitchCard() {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const { data } = useQuery({ queryKey: ['admin', 'land-records'], queryFn: () => api.get<{ enabled: boolean }>('/admin/land-records') });
  const m = useMutation({
    mutationFn: (enabled: boolean) => api.patch<{ enabled: boolean }>('/admin/land-records', { enabled }),
    onSuccess: (r) => { qc.setQueryData(['admin', 'land-records'], r); showToast({ type: 'sage', text: r.enabled ? 'Land Records on for TN advocates' : 'Land Records switched off' }); },
  });
  if (!data) return null;
  return (
    <section className="card" style={{ padding: 24 }}>
      <div className="row" style={{ alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 className="heading-lg">Land Records</h2>
        <span className="spacer" />
        <span className="badge">{data.enabled ? 'ON' : 'OFF'}</span>
      </div>
      <p className="body-sm muted" style={{ margin: '8px 0 12px' }}>
        For Tamil Nadu advocates only; other states see "coming soon". Override one firm on its page.
      </p>
      <button type="button" className="btn" disabled={m.isPending}
        onClick={() => { if (window.confirm(data.enabled ? 'Switch Land Records off for everyone?' : 'Switch Land Records on for Tamil Nadu advocates?')) m.mutate(!data.enabled); }}>
        {m.isPending ? 'Saving…' : data.enabled ? 'Switch off' : 'Switch on'}
      </button>
      {m.isError && <div role="alert" className="body-sm" style={{ marginTop: 8 }}>{m.error.message}</div>}
    </section>
  );
}

/** Per-firm Land Records override: follow the rules / always on / off. */
export function FirmLandRecordsCard({ firmId, mode }: { firmId: string; mode: 'on' | 'off' | null }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const m = useMutation({
    mutationFn: (next: 'on' | 'off' | null) => api.patch(`/admin/firms/${firmId}/land-records`, { mode: next }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin'] }); showToast({ type: 'sage', text: 'Land Records setting saved' }); },
  });
  return (
    <section className="card" style={{ padding: 24 }}>
      <h2 className="heading-lg" style={{ marginBottom: 8 }}>Land Records for this firm</h2>
      <label className="body-sm">Access
        <select className="input" value={mode ?? 'rules'} disabled={m.isPending}
          onChange={(e) => m.mutate(e.target.value === 'rules' ? null : (e.target.value as 'on' | 'off'))}>
          <option value="rules">Follow the rules (Tamil Nadu advocates only)</option>
          <option value="on">Always on for this firm</option>
          <option value="off">Off for this firm</option>
        </select>
      </label>
      {m.isError && <div role="alert" className="body-sm" style={{ marginTop: 8 }}>{m.error.message}</div>}
    </section>
  );
}
