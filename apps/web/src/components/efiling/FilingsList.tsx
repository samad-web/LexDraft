import { useState } from 'react';
import { useCases } from '@/hooks/useCases';
import { useCreateEfiling, useEfilingFilings, useRunEfilingTracking, type FilingKind } from '@/hooks/useEfiling';
import { KIND_LABEL, STATUS_LABEL, STATUS_TONE, TRACKING_LABEL, errMsg, formatDateTime } from './format';

// =============================================================================
// FilingsList — every eFiling in the firm (or one matter), newest activity
// first, with what needs the advocate's attention flagged. Creating a filing
// for a new case seeds its particulars from the matter (server-side prefill).
// =============================================================================

export function FilingsList({ caseId, onOpen, initialNewCaseId }: {
  caseId?: string;
  onOpen: (id: string) => void;
  initialNewCaseId?: string | null;
}) {
  const { data: filings, isLoading, isError } = useEfilingFilings(caseId);
  const run = useRunEfilingTracking();
  const [creating, setCreating] = useState(Boolean(initialNewCaseId));
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const attention = (filings ?? []).filter((f) =>
    f.status === 'objected' || f.tracking.status === 'ambiguous' || f.tracking.status === 'error').length;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <p className="body-sm muted" style={{ maxWidth: 620 }}>
          Prepare each filing here, file it on the portal, then record the eFiling number. LexDraft checks eCourts at 9 AM and 7 PM
          and connects the matter as soon as the court registers it. You get a notification after every check.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={run.isPending}
            onClick={() => run.mutate(undefined, {
              onSuccess: () => setRunMessage('eCourts check queued. Results arrive as a notification.'),
              onError: (err) => setRunMessage(errMsg(err, 'Could not start the check')),
            })}>
            Check eCourts now
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ New filing</button>
        </div>
      </div>
      {runMessage ? <p className="body-sm muted">{runMessage}</p> : null}

      {creating ? (
        <NewFilingForm defaultCaseId={initialNewCaseId ?? caseId ?? ''} onCreated={(id) => { setCreating(false); onOpen(id); }} onCancel={() => setCreating(false)} />
      ) : null}

      {attention > 0 ? <span className="badge badge-amber" style={{ alignSelf: 'flex-start' }}>{attention} need your attention</span> : null}

      {isLoading ? <p className="body-sm muted">Loading filings…</p> : null}
      {isError ? <p className="body-sm" style={{ color: 'var(--danger)' }}>Could not load filings.</p> : null}
      {filings && filings.length === 0 && !creating ? (
        <div className="card"><p className="body-sm muted">No filings yet. Start one with “New filing”.</p></div>
      ) : null}

      <div className="col" style={{ gap: 8 }}>
        {(filings ?? []).map((f) => (
          <button
            key={f.id}
            type="button"
            className="card"
            style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}
            onClick={() => onOpen(f.id)}
          >
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</span>
              <span className="body-sm" style={{ fontWeight: 600 }}>{f.title}</span>
            </div>
            <span className="body-sm muted">
              {[KIND_LABEL[f.kind], f.caseTitle, f.efilingNo ? `eFiling ${f.efilingNo}` : null, f.cnr ? `CNR ${f.cnr}` : null]
                .filter(Boolean).join(' · ')}
            </span>
            {f.kind === 'new_case' && ['submitted', 'refiled', 'accepted', 'objected'].includes(f.status) ? (
              <span className="body-sm" style={{ color: ['ambiguous', 'error'].includes(f.tracking.status) ? 'var(--warning)' : 'var(--text-muted)' }}>
                {TRACKING_LABEL[f.tracking.status]}
                {f.tracking.lastAttemptAt ? ` · checked ${formatDateTime(f.tracking.lastAttemptAt)}` : ''}
              </span>
            ) : null}
            {f.status === 'objected' ? <span className="body-sm" style={{ color: 'var(--warning)' }}>Objections to cure</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function NewFilingForm({ defaultCaseId, onCreated, onCancel }: { defaultCaseId: string; onCreated: (id: string) => void; onCancel: () => void }) {
  const { data: cases, isLoading } = useCases();
  const create = useCreateEfiling();
  const [caseId, setCaseId] = useState(defaultCaseId);
  const [kind, setKind] = useState<FilingKind>('new_case');
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setError(null);
    if (!caseId) {
      setError('Pick the matter this filing belongs to.');
      return;
    }
    try {
      const f = await create.mutateAsync({ caseId, kind });
      onCreated(f.id);
    } catch (err) {
      setError(errMsg(err, 'Could not create the filing'));
    }
  };

  return (
    <div className="card col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="col" style={{ gap: 4, minWidth: 260, flex: 1 }}>
          <span className="body-sm muted">Matter</span>
          <select className="input" value={caseId} onChange={(e) => setCaseId(e.target.value)} disabled={isLoading}>
            <option value="">{isLoading ? 'Loading matters…' : 'Select matter'}</option>
            {(cases ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">What are you filing?</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as FilingKind)}>
            {(Object.keys(KIND_LABEL) as FilingKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { void onCreate(); }} disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create filing'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      {kind === 'new_case' ? (
        <p className="body-sm muted">The court, parties and acts already on the matter are copied in. You add what eFiling needs on top.</p>
      ) : null}
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </div>
  );
}
