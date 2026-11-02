import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLinkPortalFiling, usePortalSync, useRunPortalSync, type PortalSyncItem } from '@/hooks/efiling/sync';
import { PortalModal } from './PortalKit';
import { STATUS_LABEL, errMsg, formatDateTime } from './format';

// =============================================================================
// "Synced to DifAi" - a DifAi window (opened from the advocate's name menu, so
// the portal area itself stays as the portal has it): every filing DifAi read
// from filing.ecourts.gov.in, the matter it is saved on, its DifAi status and
// last change; Link / Create matter for the ones DifAi couldn't place; Sync
// now. Black and white, like the rest of the eFiling screens.
// =============================================================================

const th: React.CSSProperties = { padding: '10px 8px', border: '1px solid var(--border-default)', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, textAlign: 'left', fontSize: 14 };
const td: React.CSSProperties = { padding: '10px 8px', border: '1px solid var(--border-default)', verticalAlign: 'top', fontSize: 14 };

export function PortalSyncWindow({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { data, isLoading } = usePortalSync(sessionId);
  const run = useRunPortalSync(sessionId);
  const s = data?.summary ?? null;
  const running = !!data?.running || run.isPending;
  const unlinked = s?.unlinked ?? [];
  const linked = (s?.items ?? []).filter((i) => i.filingId);

  return (
    <PortalModal title="Synced to DifAi" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <p className="body-sm" style={{ flex: 1, minWidth: 260, margin: 0 }}>
            What you have on filing.ecourts.gov.in is saved into your DifAi matters: status, objections, court fee GRNs, the Acknowledgement,
            and the CNR once the court registers the case (the matter then follows eCourts at 9 AM and 7 PM). DifAi only reads the portal.
          </p>
          <button type="button" className="btn btn-primary btn-sm" disabled={running} onClick={() => run.mutate()}>
            {running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        <p className="body-sm muted" role="status" style={{ margin: 0 }}>
          {isLoading ? 'Loading…'
            : s ? `Last synced ${formatDateTime(s.at)} · ${s.linked} linked${s.created ? ` · ${s.created} new` : ''}${s.updated ? ` · ${s.updated} updated` : ''}${unlinked.length ? ` · ${unlinked.length} to link` : ''}`
              : running ? 'Reading your portal…' : 'Not synced yet.'}
        </p>
        {run.isError ? <p className="body-sm" role="alert" style={{ margin: 0 }}>{errMsg(run.error, 'The sync did not finish.')}</p> : null}

        {unlinked.length ? (
          <section className="col" style={{ gap: 8 }} aria-label="To link">
            <h3 className="heading-sm" style={{ margin: 0 }}>To link ({unlinked.length})</h3>
            <p className="body-sm muted" style={{ margin: 0 }}>DifAi found no matter for these. Link each to its matter, or create the matter from the portal&apos;s details.</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>eFiling No.</th><th style={th}>Cause Title</th><th style={th}>On the portal</th><th style={th}>DifAi matter</th></tr></thead>
                <tbody>{unlinked.map((i) => <UnlinkedRow key={i.efilingNo} sessionId={sessionId} item={i} />)}</tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="col" style={{ gap: 8 }} aria-label="Saved in DifAi">
          <h3 className="heading-sm" style={{ margin: 0 }}>Saved in DifAi ({linked.length})</h3>
          {linked.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>eFiling No.</th><th style={th}>Cause Title</th><th style={th}>On the portal</th><th style={th}>DifAi matter</th><th style={th}>Status</th><th style={th}>Last change</th></tr></thead>
                <tbody>{linked.map((i) => <LinkedRow key={i.efilingNo} item={i} />)}</tbody>
              </table>
            </div>
          ) : <p className="body-sm muted" style={{ margin: 0 }}>{s ? 'No portal filing is on a DifAi matter yet.' : '—'}</p>}
        </section>

        {s?.errors.length ? (
          <details>
            <summary className="body-sm">Not read this time ({s.errors.length})</summary>
            <ul className="body-sm" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{s.errors.map((e, n) => <li key={n}>{e}</li>)}</ul>
          </details>
        ) : null}
      </div>
    </PortalModal>
  );
}

function LinkedRow({ item: i }: { item: PortalSyncItem }) {
  const navigate = useNavigate();
  return (
    <tr>
      <td style={td}>{i.efilingNo}{i.caseNo ? <><br />{i.caseNo}</> : null}{i.cnr ? <><br />CNR {i.cnr}</> : null}</td>
      <td style={td}>{i.title}</td>
      <td style={td}>{i.portal}</td>
      <td style={td}>
        {i.caseId ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/app/cases/${i.caseId}?tab=filings`)}>{i.caseTitle}</button> : null}
      </td>
      <td style={td}>
        {i.status ? STATUS_LABEL[i.status] : ''}
        {i.filingId ? <><br /><button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/app/efiling?filing=${encodeURIComponent(i.filingId!)}`)}>Open filing</button></> : null}
      </td>
      <td style={td}>
        {i.changes.length ? <strong>{i.changes.join('; ')}</strong> : i.lastChange}
        {i.lastChangeAt ? <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(i.lastChangeAt)}</div> : null}
      </td>
    </tr>
  );
}

function UnlinkedRow({ sessionId, item: i }: { sessionId: string; item: PortalSyncItem }) {
  const link = useLinkPortalFiling(sessionId);
  const [caseId, setCaseId] = useState(i.candidates?.[0]?.caseId ?? '');
  return (
    <tr>
      <td style={td}>{i.efilingNo}{i.caseNo ? <><br />{i.caseNo}</> : null}{i.cnr ? <><br />CNR {i.cnr}</> : null}</td>
      <td style={td}>{i.title}{i.establishment ? <div className="muted" style={{ fontSize: 12 }}>{i.establishment}</div> : null}</td>
      <td style={td}>{i.portal}</td>
      <td style={td}>
        <div className="col" style={{ gap: 6 }}>
          {i.candidates?.length ? (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select className="input" aria-label={`Matter for ${i.efilingNo}`} value={caseId} onChange={(e) => setCaseId(e.target.value)} style={{ minWidth: 200 }}>
                {i.candidates.map((c) => <option key={c.caseId} value={c.caseId}>{c.title}{c.cnr ? ` (${c.cnr})` : ''}</option>)}
              </select>
              <button type="button" className="btn btn-sm" disabled={!caseId || link.isPending}
                onClick={() => link.mutate({ portalEfilingNo: i.efilingNo, caseId })}>Link</button>
            </div>
          ) : <span className="body-sm muted">No matching matter in DifAi.</span>}
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} disabled={link.isPending}
            onClick={() => link.mutate({ portalEfilingNo: i.efilingNo, createCase: true })}>
            {link.isPending ? 'Saving…' : 'Create matter'}
          </button>
          {link.isError ? <span className="body-sm" role="alert">{errMsg(link.error, 'Could not link it.')}</span> : null}
        </div>
      </td>
    </tr>
  );
}
