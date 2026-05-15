import { useMemo, useState, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';

interface CaseRecord {
  cnr: string;
  title: string;
  court: string;
  parties: string;
  lastOrder: string;
  nextHearing: string;
  stage: string;
}

interface SyncEvent {
  id: string;
  timestamp: string;
  cnr: string;
  case: string;
  type: 'Hearing posted' | 'Order uploaded' | 'Stage updated' | 'Daily refresh' | 'Judgment uploaded';
  status: 'success' | 'pending' | 'failed';
}

const CASE_INDEX: Record<string, CaseRecord> = {
  'DLHC010120251': {
    cnr: 'DLHC010120251',
    title: 'Mehta v. Verma',
    court: 'Delhi High Court · Court Room 12',
    parties: 'Anjali Mehta vs. Rajesh Verma & Ors.',
    lastOrder: '24 April 2026 - adjourned for cross-examination',
    nextHearing: '01 May 2026, 10:30',
    stage: 'Cross-examination of PW-1',
  },
  'KAHC020120253': {
    cnr: 'KAHC020120253',
    title: 'Patel v. Reliance Infra',
    court: 'Karnataka High Court · Court Room 4',
    parties: 'Hemant Patel vs. Reliance Infrastructure Ltd.',
    lastOrder: '18 April 2026 - plaint received, defects raised',
    nextHearing: '04 May 2026, 11:00',
    stage: 'Plaint registration',
  },
};

const SYNC_EVENTS: SyncEvent[] = [
  { id: 'e1', timestamp: '02 May · 09:14', cnr: 'DLHC010120251', case: 'Mehta v. Verma',          type: 'Hearing posted',  status: 'success' },
  { id: 'e2', timestamp: '02 May · 08:30', cnr: 'KAHC020120253', case: 'Patel v. Reliance Infra', type: 'Order uploaded',  status: 'success' },
  { id: 'e3', timestamp: '02 May · 06:00', cnr: '-',             case: 'Daily index refresh',     type: 'Daily refresh',   status: 'success' },
  { id: 'e4', timestamp: '01 May · 18:42', cnr: 'MHHC030120252', case: 'State v. Khanna',         type: 'Stage updated',   status: 'success' },
  { id: 'e5', timestamp: '01 May · 16:08', cnr: 'DLDC080120254', case: 'Rao v. HDFC Bank',        type: 'Judgment uploaded', status: 'pending' },
  { id: 'e6', timestamp: '01 May · 11:55', cnr: 'KAHC050120256', case: 'Reddy Properties - IBC',  type: 'Hearing posted',  status: 'failed'  },
  { id: 'e7', timestamp: '30 Apr · 19:20', cnr: 'DLHC120120255', case: 'Iyer v. ICICI Lombard',   type: 'Order uploaded',  status: 'success' },
  { id: 'e8', timestamp: '30 Apr · 06:00', cnr: '-',             case: 'Daily index refresh',     type: 'Daily refresh',   status: 'success' },
];

export function EcourtsView() {
  const [query, setQuery] = useState<string>('DLHC010120251');
  const [submitted, setSubmitted] = useState<string>('DLHC010120251');

  const result = useMemo<CaseRecord | null>(() => {
    const key = submitted.trim().toUpperCase();
    return CASE_INDEX[key] ?? null;
  }, [submitted]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitted(query);
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>§ - ECOURTS GATEWAY</div>
        <h1 className="heading-xl">eCourts lookup</h1>
        <p className="body-md muted" style={{ marginTop: 8, maxWidth: 640 }}>
          Search any matter by its CNR (Case Number Record). Live indexed across district and High Courts via the eCourts services API.
        </p>
      </div>

      <form onSubmit={onSubmit} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="search" size={18} />
        <input
          className="input"
          style={{ flex: 1, minWidth: 240, height: 48, fontSize: 16, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
          placeholder="Enter CNR · e.g. DLHC010120251"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="CNR search"
        />
        <button type="submit" className="btn btn-primary btn-lg">
          Look up case <Icon name="arrow" size={14} />
        </button>
      </form>

      {result ? (
        <div className="card">
          <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '0.08em', marginBottom: 6 }}>
                CNR · {result.cnr}
              </div>
              <h2 className="heading-lg" style={{ marginBottom: 4 }}>
                <em className="case-name">{result.title}</em>
              </h2>
              <p className="body-sm muted">{result.parties}</p>
            </div>
            <span className="badge badge-sage">SYNCED</span>
          </div>
          <hr className="hairline" style={{ margin: '20px 0' }} />
          <div className="grid-2" style={{ gap: 24 }}>
            <Field label="COURT"         value={result.court} />
            <Field label="STAGE"         value={result.stage} />
            <Field label="LAST ORDER"    value={result.lastOrder} />
            <Field label="NEXT HEARING"  value={result.nextHearing} mono />
          </div>
        </div>
      ) : (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="dot dot-amber" />
            <div>
              <div className="heading-sm" style={{ marginBottom: 4 }}>No matter found for that CNR</div>
              <p className="body-sm muted">Try DLHC010120251 or KAHC020120253 - sample records carried in this gateway demo.</p>
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
          <h2 className="heading-lg">Recent sync events</h2>
          <span className="spacer" />
          <span className="mono tabular" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
            LAST 48 HOURS · {SYNC_EVENTS.length} EVENTS
          </span>
        </div>
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 160 }}>Timestamp</th>
                <th>Case / source</th>
                <th>Event</th>
                <th style={{ width: 120 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {SYNC_EVENTS.map((ev) => (
                <tr key={ev.id}>
                  <td className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ev.timestamp}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>
                      {ev.case === 'Daily index refresh' ? ev.case : <em className="case-name">{ev.case}</em>}
                    </div>
                    <div className="mono tabular" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{ev.cnr}</div>
                  </td>
                  <td>{ev.type}</td>
                  <td><StatusBadge status={ev.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)' }} className={mono ? 'tabular' : ''}>
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: SyncEvent['status'] }) {
  if (status === 'success') return <span className="badge badge-sage">SUCCESS</span>;
  if (status === 'pending') return <span className="badge badge-amber">PENDING</span>;
  return <span className="badge badge-vermillion">FAILED</span>;
}
