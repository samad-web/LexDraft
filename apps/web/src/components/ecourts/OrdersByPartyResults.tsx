import { useState } from 'react';
import { orderDateOf, useDownloadOrderPdf, type EcourtsOrder, type OrdersByPartyResult } from '@/hooks/useEcourts';
import { useUIStore } from '@/store/ui';

// Results of "Orders · party" fetched through the eCourts mobile API (no
// captcha): one block per matching case, each order downloadable through the
// same order-PDF route the CNR view uses.

export function OrdersByPartyResults({ result, onOpenCnr }: { result: OrdersByPartyResult; onOpenCnr: (cnr: string) => void }) {
  const download = useDownloadOrderPdf();
  const showToast = useUIStore((s) => s.showToast);
  const [pending, setPending] = useState<string | null>(null);

  const onDownload = async (cino: string, o: EcourtsOrder, key: string) => {
    setPending(key);
    try {
      const fname = await download.mutateAsync({
        cino,
        filename: o.filename,
        stateCd: o.state_cd,
        distCd: o.dist_cd,
        courtCode: o.court_code,
        caseNo: o.caseno,
        cCode: o.cCode,
        bilingualFlag: o.bilingual_flag,
      });
      showToast({ type: 'sage', text: `Downloaded ${fname}` });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message ?? 'Could not download PDF';
      showToast({ type: 'vermillion', text: msg });
    } finally {
      setPending(null);
    }
  };

  const withOrders = result.cases.filter((c) => c.interimOrders.length + c.finalOrders.length > 0).length;

  return (
    <div className="card col" style={{ gap: 16 }}>
      <div className="col" style={{ gap: 4 }}>
        <div className="heading-sm">Court orders</div>
        <p className="body-sm muted">
          {result.casesFound === 0
            ? 'No cases with this party name in this court for that year.'
            : `${result.casesFound} case${result.casesFound === 1 ? '' : 's'} found, ${withOrders} with orders.`}
          {result.truncated ? ` Showing the first ${result.casesOpened}. Type more of the name to narrow it down.` : ''}
        </p>
      </div>

      {result.cases.map((c) => {
        const rows = [
          ...c.interimOrders.map((o) => ({ o, kind: 'Interim' as const })),
          ...c.finalOrders.map((o) => ({ o, kind: 'Final' as const })),
        ];
        return (
          <div key={c.cino} className="col" style={{ gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-default)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{c.title}</span>
              <button type="button" className="btn btn-ghost btn-sm mono" onClick={() => onOpenCnr(c.cino)}>{c.cino}</button>
              {c.caseNo ? <span className="body-sm muted">Case no. {c.caseNo}</span> : null}
            </div>
            {c.error ? <p className="body-sm" style={{ color: 'var(--warning)' }}>{c.error}</p> : null}
            {!c.error && rows.length === 0 ? <p className="body-sm muted">No orders uploaded for this case yet.</p> : null}
            {rows.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Kind</th>
                    <th style={{ width: 120 }}>Date</th>
                    <th>Description</th>
                    <th style={{ width: 130 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ o, kind }, i) => {
                    const key = `${c.cino}-${o.order_id}-${i}`;
                    return (
                      <tr key={key}>
                        <td>{kind === 'Final' ? <span className="badge badge-sage">FINAL</span> : <span className="badge">INTERIM</span>}</td>
                        <td className="mono tabular" style={{ fontSize: 12 }}>{orderDateOf(o) || '—'}</td>
                        <td>{o.order_details}</td>
                        <td>
                          <button type="button" className="btn btn-sm" disabled={pending === key} onClick={() => { void onDownload(c.cino, o, key); }}>
                            {pending === key ? 'Fetching…' : 'Download PDF'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
