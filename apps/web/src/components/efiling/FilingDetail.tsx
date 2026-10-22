import { useEffect, useState } from 'react';
import {
  useAddFilingPayment,
  useAvailableFilingDocuments,
  useBuildFilingBundle,
  useChooseEfilingCnr,
  useDeleteEfiling,
  useDeleteFilingPayment,
  useDownloadFilingBundle,
  useEfilingFiling,
  useEfilingPortalSteps,
  useEfilingReadiness,
  useRunEfilingTracking,
  useSetFilingDocuments,
  useTransitionEfiling,
  useUpdateEfiling,
  type BundleResult,
  type FilingDetail as FilingDetailDto,
  type FilingStatus,
  type PaymentPurpose,
  type PortalStepKey,
  type PortalStepState,
  type ReadinessIssue,
} from '@/hooks/useEfiling';
import { EpayHandoff } from './EpayHandoff';
import { ParticularsEditor } from './ParticularsEditor';
import {
  KIND_LABEL, STATUS_LABEL, STATUS_TONE, TRACKING_LABEL,
  errMsg, formatBytes, formatDateTime, formatInr, numOrNull, orNull,
} from './format';

const PORTAL_URL = 'https://filing.ecourts.gov.in/pdedev/';

const SECTION_LABEL: Record<ReadinessIssue['section'], string> = {
  initial: 'Court and case type',
  parties: 'Parties',
  facts: 'Facts',
  case_details: 'Case details',
  mact: 'Motor accident claim',
  documents: 'Documents',
};

function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card col" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h3 className="h5">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function FilingDetail({ filingId, onClose }: { filingId: string; onClose: () => void }) {
  const { data: f, isLoading, isError } = useEfilingFiling(filingId);
  if (isLoading) return <div className="card"><span className="muted">Loading filing…</span></div>;
  if (isError || !f) return <div className="card"><span style={{ color: 'var(--danger)' }}>Could not load this filing.</span></div>;
  const preparing = ['draft', 'ready'].includes(f.status);
  // Documents can still change after "eFile Case" (uploads come later on the
  // portal) and while curing objections.
  const docsEditable = ['draft', 'ready', 'efiled', 'objected'].includes(f.status);
  const beforeCourt = ['submitted', 'objected', 'refiled', 'accepted', 'registered'].includes(f.status);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Header f={f} onClose={onClose} />
      <StageTracker f={f} />
      {/* While on the portal, the checklist IS the work - put it first. */}
      {f.status === 'efiled' ? <PortalStepsCard f={f} /> : null}
      {f.kind === 'new_case' && beforeCourt ? <TrackingCard f={f} /> : null}
      {preparing ? <ReadinessCard filingId={f.id} /> : null}
      {f.kind === 'new_case' && (preparing || f.status === 'efiled') ? (
        <Card title={preparing ? 'Filing particulars (portal New Case tabs 1–6)' : 'Filing particulars (as entered on the portal)'}>
          <ParticularsEditor caseId={f.caseId} />
        </Card>
      ) : null}
      <DocumentsCard f={f} editable={docsEditable} />
      {f.status !== 'efiled' ? <PortalStepsCard f={f} /> : null}
      <PaymentsCard f={f} />
      <HistoryCard f={f} />
    </div>
  );
}

// ---- Stage tracker ---------------------------------------------------------------
// The portal's sequence at a glance, so it's always clear what comes next.

export function StageTracker({ f }: { f: FilingDetailDto }) {
  const isIa = f.kind === 'ia';
  const stages: Array<{ label: string; sub: string; reached: boolean; current: boolean }> = [];
  const order: Record<string, number> = {
    draft: 0, ready: 0, efiled: 1, submitted: 2, objected: 3, refiled: 3, accepted: 3, registered: 4, rejected: 3, withdrawn: -1,
  };
  const at = order[f.status] ?? 0;
  const labels = isIa
    ? [['Prepare', 'In LexDraft'], ['Added on portal', 'Application + fee'], ['Authenticated', 'Advocate + litigant OTP'], ['Scrutiny', f.status === 'objected' ? 'Objections to cure' : 'With the court'], ['Numbered', 'IA registered']]
    : [['Prepare', 'Particulars + bundle'], ['On the portal', f.efilingNo ? `eFiling ${f.efilingNo}` : 'eFile Case'], ['Final submit', 'GRN selected'], ['Scrutiny', f.status === 'objected' ? 'Objections to cure' : f.status === 'rejected' ? 'Rejected' : 'With the registry'], ['Registered', f.cnr ? `CNR ${f.cnr}` : 'Case number + CNR']];
  labels.forEach(([label, sub], i) => stages.push({ label: label!, sub: sub!, reached: at >= i, current: at === i }));

  if (f.status === 'withdrawn') {
    return <div className="card"><span className="body-sm muted">This filing was withdrawn. Reopen it as a draft to file again.</span></div>;
  }
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <ol style={{ display: 'grid', gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))`, gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
        {stages.map((s, i) => (
          <li key={s.label} className="col" style={{ gap: 4, minWidth: 0 }}>
            <div
              style={{
                height: 4, borderRadius: 2,
                background: s.reached ? (f.status === 'objected' && s.current ? 'var(--warning)' : f.status === 'rejected' && s.current ? 'var(--danger)' : 'var(--success)') : 'var(--border-default)',
              }}
            />
            <span className="body-sm" style={{ fontWeight: s.current ? 700 : 500, color: s.reached ? 'inherit' : 'var(--text-tertiary)' }}>
              {i + 1}. {s.label}
            </span>
            <span className="body-sm" style={{ fontSize: 12, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sub}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---- Header + status actions --------------------------------------------------

function Header({ f, onClose }: { f: FilingDetailDto; onClose: () => void }) {
  const transition = useTransitionEfiling(f.id);
  const remove = useDeleteEfiling();
  const [form, setForm] = useState<null | 'efiled' | 'submitted' | 'objected' | 'registered'>(null);
  const [efilingNo, setEfilingNo] = useState(f.efilingNo ?? '');
  const [submittedOn, setSubmittedOn] = useState(new Date().toISOString().slice(0, 10));
  const isIa = f.kind === 'ia';
  const needsEfilingNo = f.kind === 'new_case' || f.kind === 'caveat';
  const [objections, setObjections] = useState(f.objections ?? '');
  const [cnr, setCnr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const go = async (to: FilingStatus, extra: Record<string, unknown> = {}) => {
    setError(null);
    try {
      await transition.mutateAsync({ to, ...extra });
      setForm(null);
    } catch (err) {
      setError(errMsg(err, 'Could not update the filing'));
    }
  };

  const btn = (label: string, onClick: () => void, primary = false) => (
    <button type="button" className={`btn btn-sm ${primary ? 'btn-primary' : 'btn-ghost'}`} onClick={onClick} disabled={transition.isPending}>
      {label}
    </button>
  );

  const actions: React.ReactNode[] = [];
  const efiledLabel = isIa ? 'Added on the portal' : 'Entered on the portal';
  const submitLabel = isIa ? 'Authenticated & submitted' : 'Final submitted';
  switch (f.status) {
    case 'draft':
      actions.push(btn('Mark ready', () => { void go('ready'); }, true), btn(efiledLabel, () => setForm('efiled')));
      break;
    case 'ready':
      actions.push(btn(efiledLabel, () => setForm('efiled'), true), btn('Back to draft', () => { void go('draft'); }));
      break;
    case 'efiled':
      actions.push(btn(submitLabel, () => setForm('submitted'), true));
      break;
    case 'submitted':
    case 'refiled':
      actions.push(
        btn('Accepted by the court', () => { void go('accepted'); }, true),
        btn('Objections raised', () => setForm('objected')),
        btn('Registered (I have the CNR)', () => setForm('registered')),
        btn('Rejected', () => { if (window.confirm('Mark this filing as rejected?')) void go('rejected'); }),
      );
      break;
    case 'accepted':
      actions.push(btn('Registered (I have the CNR)', () => setForm('registered'), true), btn('Objections raised', () => setForm('objected')));
      break;
    case 'objected':
      actions.push(btn('Re-filed after curing', () => { void go('refiled'); }, true));
      break;
    case 'rejected':
    case 'withdrawn':
      actions.push(btn('Reopen as draft', () => { void go('draft'); }));
      break;
    default:
      break;
  }
  if (!['registered', 'rejected', 'withdrawn'].includes(f.status)) {
    actions.push(btn('Withdraw', () => { if (window.confirm('Withdraw this filing?')) void go('withdrawn'); }));
  }
  if (['draft', 'ready', 'withdrawn', 'rejected'].includes(f.status)) {
    actions.push(btn('Delete', () => {
      if (window.confirm('Delete this filing? Its documents list, payments and history go with it.')) {
        // Leave the screen once deleted. (A mutate() callback would never
        // fire here: this component unmounts as soon as the filing is gone.)
        remove.mutateAsync(f.id).then(onClose, (err) => setError(errMsg(err, 'Could not delete the filing')));
      }
    }));
  }

  return (
    <section className="card col" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 4 }}>
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onClose}>← All filings</button>
          <h2 className="h4">{f.title}</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</span>
            <span className="badge">{KIND_LABEL[f.kind]}</span>
            <span className="body-sm muted">{f.caseTitle}</span>
          </div>
          <span className="body-sm muted">
            {[f.efilingNo ? `eFiling no. ${f.efilingNo}` : null,
              f.submittedAt ? `submitted ${formatDateTime(f.submittedAt)}` : null,
              f.cnr ? `CNR ${f.cnr}` : null].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{actions}</div>
      </div>

      {f.status === 'objected' && f.objections ? (
        <div className="col" style={{ gap: 4, padding: 12, background: 'var(--bg-subtle)', borderRadius: 6 }}>
          <span className="body-sm" style={{ fontWeight: 600 }}>Objections to cure (raised {formatDateTime(f.objectionsRaisedAt)})</span>
          <span className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{f.objections}</span>
        </div>
      ) : null}

      {form === 'efiled' ? (
        <div className="col" style={{ gap: 8 }}>
          <p className="body-sm muted">
            {isIa
              ? 'After Applications > Interlocutory Applications Filing > Submit on the portal ("Application Added Successfully").'
              : 'After e-File > "eFile Case" on the portal, which shows "Case registration is Successful" with the eFiling number.'}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="body-sm muted">eFiling number{needsEfilingNo ? '' : ' (if shown)'}</span>
              <input className="input" value={efilingNo} onChange={(e) => setEfilingNo(e.target.value)} placeholder="e.g. KL02010045672026" />
            </label>
            <label className="col" style={{ gap: 4 }}>
              <span className="body-sm muted">Date</span>
              <input className="input" type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} />
            </label>
            {btn('Save', () => { void go('efiled', { efilingNo: efilingNo || null, submittedAt: new Date(`${submittedOn}T12:00:00`).toISOString() }); }, true)}
            {btn('Cancel', () => setForm(null))}
          </div>
        </div>
      ) : null}
      {form === 'submitted' ? (
        <div className="col" style={{ gap: 8 }}>
          <p className="body-sm muted">
            {isIa
              ? 'Once both the advocate and the litigant have authenticated by OTP, the portal submits the IA to the court.'
              : 'Dashboard > Draft Pleadings on the portal: select the GRN against the documents and press Submit. LexDraft checks the steps below are done first.'}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="col" style={{ gap: 4 }}>
              <span className="body-sm muted">Submitted on</span>
              <input className="input" type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} />
            </label>
            {btn('Save', () => { void go('submitted', { submittedAt: new Date(`${submittedOn}T12:00:00`).toISOString() }); }, true)}
            {btn('Cancel', () => setForm(null))}
          </div>
        </div>
      ) : null}
      {form === 'objected' ? (
        <div className="col" style={{ gap: 8 }}>
          <textarea className="input" rows={3} value={objections} onChange={(e) => setObjections(e.target.value)} placeholder="Copy the registry's objections here" />
          <div className="row" style={{ gap: 8 }}>
            {btn('Save objections', () => { void go('objected', { objections }); }, true)}
            {btn('Cancel', () => setForm(null))}
          </div>
        </div>
      ) : null}
      {form === 'registered' ? (
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">CNR (16 characters)</span>
            <input className="input" value={cnr} onChange={(e) => setCnr(e.target.value.toUpperCase())} maxLength={16} />
          </label>
          {btn('Save and connect to eCourts', () => { void go('registered', { cnr }); }, true)}
          {btn('Cancel', () => setForm(null))}
        </div>
      ) : null}
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </section>
  );
}

// ---- eCourts tracking -------------------------------------------------------------

export function TrackingCard({ f }: { f: FilingDetailDto }) {
  const update = useUpdateEfiling(f.id);
  const choose = useChooseEfilingCnr(f.id);
  const run = useRunEfilingTracking();
  const [filingNo, setFilingNo] = useState(f.courtFilingNo ?? '');
  const [filingYear, setFilingYear] = useState(f.courtFilingYear ? String(f.courtFilingYear) : '');
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setFilingNo(f.courtFilingNo ?? '');
    setFilingYear(f.courtFilingYear ? String(f.courtFilingYear) : '');
  }, [f.courtFilingNo, f.courtFilingYear]);

  if (f.status === 'registered') {
    return (
      <Card title="eCourts">
        <p className="body-sm">
          Registered{f.registeredAt ? ` on ${formatDateTime(f.registeredAt)}` : ''}. CNR <strong>{f.cnr}</strong>. The matter is
          connected to eCourts and refreshes with your other cases at 9 AM and 7 PM.
        </p>
      </Card>
    );
  }

  return (
    <Card
      title="Connecting to eCourts"
      aside={
        <button type="button" className="btn btn-ghost btn-sm" disabled={run.isPending}
          onClick={() => run.mutate(undefined, { onSuccess: () => setMessage('Check queued. You will get a notification when it finishes.') })}>
          {run.isPending ? 'Queuing…' : 'Check eCourts now'}
        </button>
      }
    >
      <p className="body-sm muted">
        LexDraft looks for this case on eCourts every day at 9 AM and 7 PM, and links the matter as soon as the court registers it.
        If eCourts is down, it retries every 30 minutes.
      </p>
      <div className="col" style={{ gap: 2 }}>
        <span className="body-sm">{TRACKING_LABEL[f.tracking.status]}</span>
        {f.tracking.lastError ? <span className="body-sm muted">{f.tracking.lastError}</span> : null}
        {f.tracking.lastAttemptAt ? <span className="body-sm muted">Last checked {formatDateTime(f.tracking.lastAttemptAt)}</span> : null}
      </div>

      {f.tracking.status === 'ambiguous' && f.tracking.candidates.length > 0 ? (
        <div className="col" style={{ gap: 6 }}>
          <span className="body-sm" style={{ fontWeight: 600 }}>Which of these is your case?</span>
          {f.tracking.candidates.map((c) => (
            <div key={c.cino} className="row" style={{ gap: 8, alignItems: 'center', padding: '6px 10px', background: 'var(--bg-subtle)', borderRadius: 6 }}>
              <div className="col" style={{ flex: 1 }}>
                <span className="body-sm">{c.title}</span>
                <span className="body-sm muted">{[c.cino, c.caseNo, c.establishment].filter(Boolean).join(' · ')}</span>
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={choose.isPending}
                onClick={() => { if (window.confirm(`Link this matter to ${c.cino}?`)) choose.mutate(c.cino); }}>
                This one
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">Court filing no. (from the court's SMS)</span>
          <input className="input" value={filingNo} onChange={(e) => setFilingNo(e.target.value)} />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">Year</span>
          <input className="input" style={{ width: 90 }} inputMode="numeric" value={filingYear} onChange={(e) => setFilingYear(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" disabled={update.isPending}
          onClick={() => update.mutate(
            { courtFilingNo: orNull(filingNo), courtFilingYear: numOrNull(filingYear) },
            { onSuccess: () => setMessage('Saved. The next check searches by this filing number, which is the most reliable way to find it.') },
          )}>
          Save
        </button>
      </div>
      {message ? <p className="body-sm muted">{message}</p> : null}
    </Card>
  );
}

// ---- Readiness ---------------------------------------------------------------------

export function ReadinessCard({ filingId }: { filingId: string }) {
  const { data, isLoading } = useEfilingReadiness(filingId);
  if (isLoading || !data) return null;
  const bySection = new Map<string, ReadinessIssue[]>();
  for (const i of data.issues) bySection.set(i.section, [...(bySection.get(i.section) ?? []), i]);
  return (
    <Card
      title="Ready for the portal?"
      aside={<span className={data.ready ? 'badge badge-sage' : 'badge badge-amber'}>{data.ready ? 'Ready' : `${data.errors} to fix`}</span>}
    >
      {data.issues.length === 0 ? <p className="body-sm">Everything the portal's New Case form asks for is filled in.</p> : null}
      {[...bySection.entries()].map(([section, issues]) => (
        <div key={section} className="col" style={{ gap: 4 }}>
          <span className="body-sm" style={{ fontWeight: 600 }}>{SECTION_LABEL[section as ReadinessIssue['section']]}</span>
          {issues.map((i, n) => (
            <span key={n} className="body-sm" style={{ color: i.severity === 'error' ? 'var(--danger)' : 'var(--text-muted)' }}>
              {i.severity === 'error' ? '● ' : '○ '}{i.message}
            </span>
          ))}
        </div>
      ))}
    </Card>
  );
}

// ---- Documents + bundle ------------------------------------------------------------

export function DocumentsCard({ f, editable }: { f: FilingDetailDto; editable: boolean }) {
  const available = useAvailableFilingDocuments(editable ? f.id : null);
  const setDocs = useSetFilingDocuments(f.id);
  const build = useBuildFilingBundle(f.id);
  const download = useDownloadFilingBundle(f.id);
  const [list, setList] = useState(f.documents.map((d) => ({ label: d.label, sourceKind: d.sourceKind, sourceId: d.sourceId })));
  const [dirty, setDirty] = useState(false);
  const [bundleInfo, setBundleInfo] = useState<BundleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-sync from the server only when the SAVED list actually changed and the
  // advocate has nothing unsaved - a background refetch (window focus, other
  // edits) used to wipe documents that were added but not yet saved.
  const serverKey = JSON.stringify(f.documents.map((d) => [d.label, d.sourceKind, d.sourceId]));
  useEffect(() => {
    if (dirty) return;
    setList(f.documents.map((d) => ({ label: d.label, sourceKind: d.sourceKind, sourceId: d.sourceId })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverKey]);

  // Functional updates: two quick changes (e.g. adding two documents back to
  // back) must build on each other, not on a stale copy of the list.
  type DocRow = (typeof list)[number];
  const update = (fn: (cur: DocRow[]) => DocRow[]) => { setList(fn); setDirty(true); };
  const move = (i: number, d: -1 | 1) => update((cur) => {
    const j = i + d;
    if (j < 0 || j >= cur.length) return cur;
    const next = [...cur];
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  });
  const unused = (available.data ?? []).filter((a) => !list.some((l) => l.sourceKind === 'document' && l.sourceId === a.id));

  const onSave = async () => {
    setError(null);
    try {
      await setDocs.mutateAsync(list);
      setDirty(false);
    } catch (err) {
      setError(errMsg(err, 'Could not save the documents'));
    }
  };
  const onBuild = async () => {
    setError(null);
    try {
      setBundleInfo(await build.mutateAsync());
    } catch (err) {
      setError(errMsg(err, 'Could not build the bundle'));
    }
  };

  return (
    <Card
      title="Documents and filing bundle"
      aside={f.bundle ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => download.mutate()} disabled={download.isPending}>
          Download bundle ({f.bundle.pages} pages, {formatBytes(f.bundle.sizeBytes)})
        </button>
      ) : null}
    >
      <p className="body-sm muted">
        In filing order. LexDraft merges them into one PDF behind an index page, with page numbers and a bookmark per document,
        ready for the portal's Pleading Upload. Use the index page ranges in the portal's Indexing tab.
      </p>
      {list.length === 0 ? <p className="body-sm muted">No documents yet.</p> : null}
      {list.map((d, i) => (
        <div key={`${d.sourceId}-${i}`} className="row" style={{ gap: 6, alignItems: 'center' }}>
          <span className="body-sm muted" style={{ width: 20 }}>{i + 1}.</span>
          <input className="input" style={{ flex: 1 }} value={d.label} disabled={!editable}
            onChange={(e) => { const label = e.target.value; update((cur) => cur.map((x, j) => (j === i ? { ...x, label } : x))); }} />
          {editable ? (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
            </>
          ) : null}
        </div>
      ))}

      {editable ? (
        <div className="col" style={{ gap: 6 }}>
          {unused.length > 0 ? (
            <select className="input" value="" onChange={(e) => {
              const doc = unused.find((a) => a.id === e.target.value);
              if (doc) update((cur) => (cur.some((x) => x.sourceId === doc.id) ? cur : [...cur, { label: doc.name, sourceKind: 'document' as const, sourceId: doc.id }]));
            }}>
              <option value="">+ Add a PDF from this matter's documents…</option>
              {unused.map((a) => <option key={a.id} value={a.id}>{a.name}{a.sizeBytes ? ` (${formatBytes(a.sizeBytes)})` : ''}</option>)}
            </select>
          ) : (
            <p className="body-sm muted">
              {available.isLoading ? 'Loading documents…' : "No more PDFs on this matter. Upload them under Documents (PDF only, no password protection) and they'll appear here."}
            </p>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void onSave(); }} disabled={!dirty || setDocs.isPending}>
              {setDocs.isPending ? 'Saving…' : 'Save order'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void onBuild(); }} disabled={dirty || list.length === 0 || build.isPending}>
              {build.isPending ? 'Building…' : f.bundle ? 'Rebuild bundle' : 'Build bundle'}
            </button>
          </div>
        </div>
      ) : null}

      {bundleInfo ? (
        <div className="col" style={{ gap: 2, padding: 10, background: 'var(--bg-subtle)', borderRadius: 6 }}>
          <span className="body-sm" style={{ fontWeight: 600 }}>
            Bundle: {bundleInfo.pages} pages, {formatBytes(bundleInfo.sizeBytes)}
            {bundleInfo.oversize ? ' (over the portal\'s upload limit; split it into parts)' : ''}
          </span>
          {bundleInfo.index.map((e) => (
            <span key={e.label} className="body-sm muted">{e.label}: pages {e.fromPage}{e.toPage !== e.fromPage ? `–${e.toPage}` : ''}</span>
          ))}
        </div>
      ) : null}
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </Card>
  );
}

// ---- Portal steps ------------------------------------------------------------------

export function PortalStepsCard({ f }: { f: FilingDetailDto }) {
  const steps = useEfilingPortalSteps(f.kind);
  const update = useUpdateEfiling(f.id);
  const [error, setError] = useState<string | null>(null);
  const list = steps.data ?? [];
  const done = list.filter((s) => (f.steps[s.key] ?? 'pending') !== 'pending').length;
  // The first step still pending is "what to do next".
  const nextKey = list.find((s) => (f.steps[s.key] ?? 'pending') === 'pending')?.key;
  const locked = ['submitted', 'objected', 'refiled', 'accepted', 'registered', 'rejected', 'withdrawn'].includes(f.status);

  const set = (key: PortalStepKey, value: PortalStepState) => {
    setError(null);
    update.mutate({ steps: { [key]: value } }, { onError: (err) => setError(errMsg(err, 'Could not update the step')) });
  };

  return (
    <Card
      title={`Steps on the eFiling portal · ${done} of ${list.length}`}
      aside={<a className="btn btn-ghost btn-sm" href={PORTAL_URL} target="_blank" rel="noopener noreferrer">Open eFiling portal ↗</a>}
    >
      <p className="body-sm muted">
        In the portal’s own order. These happen on the portal, by you or your client. Aadhaar eSign, OTPs, the oath video and
        payment can’t be done on your behalf. Tick each one off so the whole team sees where the filing stands.
      </p>
      <ol className="col" style={{ gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
        {list.map((s, i) => {
          const state: PortalStepState = f.steps[s.key] ?? 'pending';
          const isNext = s.key === nextKey && !locked;
          return (
            <li
              key={s.key}
              className="row"
              style={{
                gap: 12, alignItems: 'flex-start', padding: 10, borderRadius: 8,
                background: isNext ? 'var(--bg-subtle)' : 'transparent',
                border: isNext ? '1px solid var(--border-default)' : '1px solid transparent',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 26, height: 26, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
                  background: state === 'done' ? 'var(--success)' : 'transparent',
                  color: state === 'done' ? 'var(--bg-base, #000)' : 'inherit',
                  border: state === 'done' ? 'none' : '1px solid var(--border-default)',
                }}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <span className="body-sm" style={{ fontWeight: 600, color: state === 'not_applicable' ? 'var(--text-tertiary)' : undefined }}>
                  {s.label}
                  {s.required ? <span className="muted" style={{ fontWeight: 400 }}> · required</span> : null}
                  {isNext ? <span className="badge badge-cobalt" style={{ marginLeft: 8, fontSize: 10 }}>Next</span> : null}
                  {state === 'not_applicable' ? <span className="muted" style={{ fontWeight: 400 }}> · not needed</span> : null}
                </span>
                <span className="body-sm muted">{s.hint}</span>
              </div>
              <select
                className="input"
                style={{ width: 140, flexShrink: 0 }}
                value={state}
                disabled={update.isPending || locked}
                aria-label={`${s.label} status`}
                onChange={(e) => set(s.key, e.target.value as PortalStepState)}
              >
                <option value="pending">Pending</option>
                <option value="done">Done</option>
                {!s.required ? <option value="not_applicable">Not needed</option> : null}
              </select>
            </li>
          );
        })}
      </ol>
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </Card>
  );
}

// ---- Payments ------------------------------------------------------------------------

const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  court_fee: 'Court fee',
  deficit_court_fee: 'Deficit court fee',
  process_fee: 'Process fee',
  judicial_deposit: 'Judicial deposit',
  other: 'Other',
};

export function PaymentsCard({ f }: { f: FilingDetailDto }) {
  const add = useAddFilingPayment(f.id);
  const del = useDeleteFilingPayment(f.id);
  const [purpose, setPurpose] = useState<PaymentPurpose>(f.kind === 'deficit_court_fee' ? 'deficit_court_fee' : 'court_fee');
  const [amount, setAmount] = useState('');
  const [grn, setGrn] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [mode, setMode] = useState<'epay' | 'wallet' | 'challan'>(f.kind === 'ia' ? 'wallet' : 'epay');
  const [error, setError] = useState<string | null>(null);

  const onAdd = async () => {
    setError(null);
    const amountInr = numOrNull(amount);
    if (amountInr == null) {
      setError('Enter the amount paid.');
      return;
    }
    try {
      await add.mutateAsync({ purpose, amountInr, grn: orNull(grn), paidOn: paidOn || null, mode });
      setAmount('');
      setGrn('');
      setPaidOn('');
    } catch (err) {
      setError(errMsg(err, 'Could not record the payment'));
    }
  };

  return (
    <Card title="Court fee and payments">
      <p className="body-sm muted">
        Pay on pay.ecourts.gov.in (or from your court-fee wallet on the portal), then record the GRN here. The registry matches it at scrutiny.
        Use the Court Fee calculator under Tools for the amount.
      </p>
      {mode === 'epay' ? <EpayHandoff f={f} amount={amount} /> : null}
      {f.payments.map((p) => (
        <div key={p.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="body-sm" style={{ flex: 1 }}>
            {PURPOSE_LABEL[p.purpose]}: {formatInr(p.amountInr)}{p.grn ? ` · GRN ${p.grn}` : ' · no GRN yet'}{p.paidOn ? ` · ${p.paidOn}` : ''}
            {p.mode ? ` · ${p.mode === 'wallet' ? 'court fee wallet' : p.mode === 'challan' ? 'challan' : 'ePay'}` : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={del.isPending}
            onClick={() => { if (window.confirm('Remove this payment record?')) del.mutate(p.id); }}>Remove</button>
        </div>
      ))}
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">For</span>
          <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value as PaymentPurpose)}>
            {Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">Amount (₹)</span>
          <input className="input" style={{ width: 120 }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">GRN</span>
          <input className="input" value={grn} onChange={(e) => setGrn(e.target.value)} />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">Paid on</span>
          <input className="input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </label>
        <label className="col" style={{ gap: 4 }}>
          <span className="body-sm muted">Paid via</span>
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="epay">ePay</option>
            <option value="wallet">Court fee wallet</option>
            <option value="challan">Challan</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => { void onAdd(); }} disabled={add.isPending}>
          {add.isPending ? 'Saving…' : 'Record payment'}
        </button>
      </div>
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </Card>
  );
}

// ---- History ---------------------------------------------------------------------------

export function HistoryCard({ f }: { f: FilingDetailDto }) {
  if (f.events.length === 0) return null;
  return (
    <Card title="History">
      {f.events.map((e) => (
        <div key={e.id} className="row" style={{ gap: 10 }}>
          <span className="body-sm muted" style={{ width: 170, flexShrink: 0 }}>{formatDateTime(e.createdAt)}</span>
          <span className="body-sm">
            {e.toStatus && e.fromStatus !== e.toStatus ? `${STATUS_LABEL[e.toStatus as FilingStatus] ?? e.toStatus}. ` : ''}
            {e.note}
            {e.source === 'tracker' ? <span className="muted"> (automatic)</span> : null}
          </span>
        </div>
      ))}
    </Card>
  );
}
