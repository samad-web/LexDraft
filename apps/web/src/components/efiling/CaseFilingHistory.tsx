import { useState } from 'react';
import { api } from '@/lib/api';
import { useEfilingFiling, useEfilingFilings, type FilingStatus } from '@/hooks/useEfiling';
import { STATUS_LABEL, errMsg, formatDateTime } from './format';

// =============================================================================
// On the matter's eFiling tab: each filing with its status, history (what the
// advocate recorded and what DifAi read from filing.ecourts.gov.in), court-fee
// payments and the documents saved on it (the portal's Acknowledgement, the
// eFiled case PDF, the bundle's documents). Read-only; the filing itself is
// worked on in eFiling.
// =============================================================================

export function CaseFilingHistory({ caseId, frame }: { caseId: string; frame: (body: React.ReactNode) => React.ReactNode }) {
  const { data: filings } = useEfilingFilings(caseId);
  if (!filings?.length) return null;
  return frame(
    <div className="col" style={{ gap: 8 }} aria-label="eFiling history">
      {filings.map((f, n) => (
        <details key={f.id} open={n === 0} className="card" style={{ padding: '10px 14px' }}>
          <summary className="body-sm" style={{ cursor: 'pointer' }}>
            <strong>{STATUS_LABEL[f.status]}</strong>
            {' · '}{f.efilingNo ? `eFiling ${f.efilingNo}` : f.title}
            {f.registrationNo ? ` · ${f.registrationNo}` : ''}
            {f.cnr ? ` · CNR ${f.cnr}` : ''}
          </summary>
          <FilingBody id={f.id} />
        </details>
      ))}
    </div>,
  );
}

const head: React.CSSProperties = { margin: '12px 0 4px', fontSize: 13, fontWeight: 700 };

function FilingBody({ id }: { id: string }) {
  const { data: f, isLoading } = useEfilingFiling(id);
  const [openErr, setOpenErr] = useState<string | null>(null);
  if (isLoading || !f) return <p className="body-sm muted">Loading…</p>;
  const open = async (documentId: string) => {
    setOpenErr(null);
    try {
      const r = await api.get<{ downloadUrl: string }>(`/documents/${documentId}/download-url`);
      window.open(r.downloadUrl, '_blank', 'noopener');
    } catch (e) {
      setOpenErr(errMsg(e, 'Could not open the document.'));
    }
  };
  return (
    <div className="col" style={{ gap: 2 }}>
      {f.status === 'objected' && f.objections ? (
        <>
          <h4 style={head}>Objections</h4>
          <p className="body-sm" style={{ margin: 0, whiteSpace: 'pre-line' }}>{f.objections}</p>
        </>
      ) : null}

      <h4 style={head}>Payments</h4>
      {f.payments.length ? f.payments.map((p) => (
        <span key={p.id} className="body-sm">
          ₹{p.amountInr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}{p.grn ? ` · GRN ${p.grn}` : ''}{p.mode ? ` · ${p.mode === 'epay' ? 'ePay' : p.mode}` : ''}{p.paidOn ? ` · ${p.paidOn}` : ''}
        </span>
      )) : <span className="body-sm muted">None recorded.</span>}

      <h4 style={head}>Documents</h4>
      {f.documents.length ? f.documents.map((d) => (
        <span key={d.id} className="row body-sm" style={{ gap: 8, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{d.label}</span>
          {d.sourceKind === 'document' ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void open(d.sourceId); }}>Open</button> : null}
        </span>
      )) : <span className="body-sm muted">None yet.</span>}
      {openErr ? <span className="body-sm" role="alert">{openErr}</span> : null}

      <h4 style={head}>History</h4>
      {f.events.length ? f.events.map((e) => (
        <div key={e.id} className="row" style={{ gap: 10 }}>
          <span className="body-sm muted" style={{ width: 160, flexShrink: 0 }}>{formatDateTime(e.createdAt)}</span>
          <span className="body-sm">
            {e.toStatus && e.fromStatus !== e.toStatus ? `${STATUS_LABEL[e.toStatus as FilingStatus] ?? e.toStatus}. ` : ''}
            {e.note}
            {e.source === 'tracker' ? <span className="muted"> (automatic)</span> : null}
          </span>
        </div>
      )) : <span className="body-sm muted">Nothing yet.</span>}
    </div>
  );
}
