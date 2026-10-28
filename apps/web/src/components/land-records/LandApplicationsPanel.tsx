import { useState, type FormEvent } from 'react';
import { useCases } from '@/hooks/useCases';
import {
  useAddLandApplication,
  useLandApplications,
  useRemoveLandApplication,
  useUpdateLandApplication,
  type LandApplication,
} from '@/hooks/useLandRecords';
import { LField, LRow, Spinner, errorText } from './LandUi';

// Patta transfer / F-Line applications the firm follows. Land Records'
// Application Status page needs a captcha, so DifAi can't check them on
// its own: "Check status"
// opens Application Status with the Id filled in (the status is recorded).

const APP_ID_RE = /^[0-9]{4}\/[A-Z0-9][0-9]{3}\/[0-9]{2}\/[0-9]{6}$/;
const KIND_LABEL: Record<LandApplication['kind'], string> = { patta_transfer: 'Patta transfer', fline: 'F-Line', other: 'Other' };

function when(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function LandApplicationsPanel({ onCheck, prefill }: {
  onCheck: (a: LandApplication) => void;
  /** An Application Id to start following (from a search result). */
  prefill?: string;
}) {
  const apps = useLandApplications();
  const cases = useCases();
  const add = useAddLandApplication();
  const update = useUpdateLandApplication();
  const remove = useRemoveLandApplication();
  const [applicationId, setApplicationId] = useState(prefill ?? '');
  const [kind, setKind] = useState<LandApplication['kind']>('patta_transfer');
  const [caseId, setCaseId] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const pending = (apps.error as { response?: { data?: { code?: string } } } | null)?.response?.data?.code === 'LAND_TRACKING_PENDING';

  const onAdd = (e: FormEvent): void => {
    e.preventDefault();
    const id = applicationId.trim().toUpperCase();
    if (!APP_ID_RE.test(id)) return;
    setMessage(null);
    add.mutate(
      { applicationId: id, kind, caseId: caseId || null, note: note.trim() || null },
      {
        onSuccess: () => { setApplicationId(''); setNote(''); setMessage(`Following ${id}.`); },
        onError: (err) => setMessage(errorText(err, 'Could not follow this application.')),
      },
    );
  };

  if (pending) {
    return (
      <div className="card col" style={{ gap: 8, padding: 18 }}>
        <strong>My Applications</strong>
        <p className="body-sm muted" style={{ margin: 0 }}>
          Following applications needs a one-time database update (0093) that hasn't been applied yet. All searches work in the meantime.
        </p>
      </div>
    );
  }

  const open = (apps.data ?? []).filter((a) => !a.closedAt);
  const closed = (apps.data ?? []).filter((a) => a.closedAt);
  return (
    <div className="col" style={{ gap: 14 }}>
      <form className="card col" style={{ gap: 12, padding: 18 }} onSubmit={onAdd}>
        <strong>Follow an application</strong>
        <LRow>
          <LField label="Application Id" required>
            <input className="input" placeholder="eg:-0000/0000/00/000000" maxLength={21} value={applicationId} onChange={(e) => setApplicationId(e.target.value.toUpperCase())} />
          </LField>
          <LField label="Type">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as LandApplication['kind'])}>
              {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </LField>
          <LField label="Matter">
            <select className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Not linked</option>
              {(cases.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </LField>
          <LField label="Note">
            <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </LField>
        </LRow>
        <div>
          <button type="submit" className="btn btn-primary" disabled={!APP_ID_RE.test(applicationId.trim().toUpperCase()) || add.isPending}>
            {add.isPending ? <><Spinner size={12} /> Saving…</> : 'Follow'}
          </button>
        </div>
        {message ? <p className="body-sm" role="status" style={{ margin: 0, fontWeight: 600 }}>{message}</p> : null}
        <p className="body-sm muted" style={{ margin: 0 }}>
          Application Status on Land Records needs a captcha, so it can't be checked automatically. Use Check status whenever you need it; each check is one captcha and the status is saved here.
        </p>
      </form>

      <div className="card col" style={{ gap: 10, padding: 18 }}>
        <strong>My Applications{open.length ? ` (${open.length})` : ''}</strong>
        {apps.isLoading ? <div className="col" role="status" aria-label="Loading applications" style={{ gap: 8 }}>{[0, 1, 2].map((i) => <span key={i} className="lr-skel" style={{ width: '100%', height: 52 }} />)}</div> : null}
        {apps.isError && !pending ? <p className="body-sm">{errorText(apps.error, 'Could not load applications.')}</p> : null}
        {!apps.isLoading && open.length === 0 ? <p className="body-sm muted" style={{ margin: 0 }}>No applications followed yet.</p> : null}
        {open.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr><th>Application Id</th><th>Type</th><th>Matter</th><th>Last status</th><th>Last checked</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {open.map((a) => (
                  <tr key={a.id}>
                    <td className="tabular" style={{ fontWeight: 600 }}>{a.applicationId}{a.note ? <div className="body-sm muted">{a.note}</div> : null}</td>
                    <td>{KIND_LABEL[a.kind]}</td>
                    <td>{a.caseTitle ?? '—'}</td>
                    <td style={{ whiteSpace: 'normal' }}>{a.lastStatus ?? '—'}</td>
                    <td>{when(a.lastCheckedAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-sm" onClick={() => onCheck(a)}>Check status</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => update.mutate({ id: a.id, closed: true })}>Close</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {closed.length > 0 ? (
          <details>
            <summary className="body-sm" style={{ cursor: 'pointer' }}>Closed ({closed.length})</summary>
            <ul className="body-sm" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {closed.map((a) => (
                <li key={a.id} style={{ marginBottom: 4 }}>
                  {a.applicationId} · {a.lastStatus ?? 'no status recorded'}{' '}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => update.mutate({ id: a.id, closed: false })}>Reopen</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove.mutate(a.id)}>Remove</button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
