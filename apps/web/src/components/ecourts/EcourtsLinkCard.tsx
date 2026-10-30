import { useState, type FormEvent } from 'react';
import { SearchableSelect } from '@/components/SearchableSelect';
import {
  useLinkCaseToEcourts,
  type CaseWithPipeline,
  type EcourtsCnrCandidate,
  type LinkCaseResult,
} from '@/hooks/useCases';
import { useEcourtsCaseTypes } from '@/hooks/useEcourts';
import { useUIStore } from '@/store/ui';
import { CourtScopePicker, EMPTY_COURT_SCOPE, courtScopeReady, type CourtScopeValue } from './CourtScopePicker';

const CNR_RE = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/;

type LinkStatus = 'unlinked' | 'pending' | 'linked' | 'not_found' | 'error';

interface StatusCopy { badge: string; label: string; text: string }

const UNLINKED_COPY: StatusCopy = {
  badge: 'badge-cream',
  label: 'Not connected',
  text: 'This matter has no CNR yet, so it can\'t update from eCourts. Link it with its CNR, or find it by case type, number and year.',
};

const STATUS_COPY: Record<LinkStatus, StatusCopy> = {
  linked: {
    badge: 'badge-sage',
    label: 'Connected',
    text: 'This matter refreshes from eCourts automatically at 9 AM and 7 PM every day.',
  },
  pending: {
    badge: 'badge-amber',
    label: 'Waiting for eCourts',
    text: 'The CNR is saved. eCourts has not answered yet, usually because its server is down. DifAi keeps retrying automatically, and you will get a notification once it connects.',
  },
  not_found: {
    badge: 'badge-vermillion',
    label: 'CNR not found',
    text: 'eCourts answered but has no case with this CNR on the District or High Court system. Check the CNR below. A newly registered case can take a day or two to appear; DifAi keeps checking at each scheduled update.',
  },
  error: {
    badge: 'badge-vermillion',
    label: 'Could not sync',
    text: 'The last sync failed for a reason other than eCourts being down. Re-link the matter below, or contact support if it keeps happening.',
  },
  unlinked: UNLINKED_COPY,
};

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? (err instanceof Error ? err.message : fallback);
}

function fmt(ts: string | null | undefined): string | null {
  if (!ts) return null;
  return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function EcourtsLinkCard({
  c,
  onLinked,
}: {
  c: CaseWithPipeline;
  /** Called after a successful link ('pending' = CNR saved, eCourts down). */
  onLinked?: (status: 'linked' | 'pending') => void;
}) {
  const status: LinkStatus = c.ecourtsLinkStatus ?? (c.ecourtsSyncedAt ? 'linked' : 'unlinked');
  const copy = STATUS_COPY[status] ?? UNLINKED_COPY;
  const needsLink = status === 'unlinked' || status === 'not_found' || status === 'error';
  const [open, setOpen] = useState(needsLink);
  const [mode, setMode] = useState<'cnr' | 'number'>('cnr');
  const [cnr, setCnr] = useState(CNR_RE.test(c.cnr ?? '') ? c.cnr : '');
  const [scope, setScope] = useState<CourtScopeValue>(EMPTY_COURT_SCOPE);
  const [caseType, setCaseType] = useState('');
  const [regNo, setRegNo] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [candidates, setCandidates] = useState<EcourtsCnrCandidate[] | null>(null);
  const link = useLinkCaseToEcourts();
  const showToast = useUIStore((s) => s.showToast);
  const caseTypes = useEcourtsCaseTypes(scope.stateCode, scope.distCode, scope.courtCode, scope.court);

  const onResult = (r: LinkCaseResult): void => {
    if (r.status === 'choose') {
      setCandidates(r.candidates);
      return;
    }
    setCandidates(null);
    if (r.status === 'linked') {
      showToast({ type: 'sage', text: `Connected to eCourts (CNR ${r.cnr})` });
      setOpen(false);
    } else {
      showToast({ type: 'amber', text: r.message });
    }
    onLinked?.(r.status);
  };

  const linkCnr = (value: string): void => {
    link.mutate(
      { id: c.id, cnr: value.trim().toUpperCase(), court: scope.stateCode !== '' ? scope.court : undefined },
      { onSuccess: onResult, onError: (err) => showToast({ type: 'vermillion', text: errorText(err, 'Could not link to eCourts') }) },
    );
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (mode === 'cnr') {
      if (CNR_RE.test(cnr.trim())) linkCnr(cnr);
      return;
    }
    if (!courtScopeReady(scope) || !caseType || !regNo.trim()) return;
    link.mutate(
      {
        id: c.id,
        court: scope.court,
        stateCode: Number(scope.stateCode),
        distCode: Number(scope.distCode),
        courtCode: Number(scope.courtCode),
        estCode: scope.estCode.trim(),
        caseType,
        regNo: regNo.trim(),
        year: Number(year),
      },
      { onSuccess: onResult, onError: (err) => showToast({ type: 'vermillion', text: errorText(err, 'Could not find the case on eCourts') }) },
    );
  };

  const canSubmit = mode === 'cnr'
    ? CNR_RE.test(cnr.trim())
    : courtScopeReady(scope) && Boolean(caseType) && regNo.trim().length > 0 && /^\d{4}$/.test(year);

  return (
    <div className="card" id="ecourts-connection" style={{ scrollMarginTop: 96 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>eCourts</div>
          <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <h2 className="heading-md">Link to eCourts</h2>
            <span className={`badge ${copy.badge}`}>{copy.label.toUpperCase()}</span>
            {c.ecourtsCourtTier ? <span className="badge">{c.ecourtsCourtTier === 'HC' ? 'HIGH COURT' : 'DISTRICT'}</span> : null}
          </div>
        </div>
        {!needsLink ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
            {open ? 'Cancel' : 'Change CNR'}
          </button>
        ) : null}
      </div>
      <p className="body-sm muted" style={{ maxWidth: 640 }}>{copy.text}</p>
      {status !== 'linked' && (fmt(c.ecourtsLastAttemptAt) || c.ecourtsLastError) ? (
        <p className="body-sm" style={{ marginTop: 6, color: 'var(--text-tertiary)' }}>
          {fmt(c.ecourtsLastAttemptAt) ? `Last attempt ${fmt(c.ecourtsLastAttemptAt)}` : ''}
          {c.ecourtsLastError ? ` · ${c.ecourtsLastError}` : ''}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={onSubmit} className="col" style={{ gap: 12, marginTop: 14 }}>
          <div className="row" role="tablist" style={{ gap: 6 }}>
            <button type="button" role="tab" aria-selected={mode === 'cnr'} className={`btn btn-sm${mode === 'cnr' ? ' btn-primary' : ''}`} onClick={() => setMode('cnr')}>
              I have the CNR
            </button>
            <button type="button" role="tab" aria-selected={mode === 'number'} className={`btn btn-sm${mode === 'number' ? ' btn-primary' : ''}`} onClick={() => setMode('number')}>
              Find by case number
            </button>
          </div>

          {mode === 'cnr' ? (
            <label className="col" style={{ gap: 4, maxWidth: 360 }}>
              <span className="body-sm muted">CNR (16 characters)</span>
              <input
                className="input mono"
                value={cnr}
                maxLength={16}
                placeholder="e.g. KLER010001682023"
                onChange={(e) => setCnr(e.target.value.replace(/\s/g, '').toUpperCase())}
              />
            </label>
          ) : (
            <>
              <CourtScopePicker value={scope} onChange={(v) => { setScope(v); setCaseType(''); setCandidates(null); }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <label className="col" style={{ gap: 4 }}>
                  <span className="body-sm muted">
                    Case type {caseTypes.isFetching ? '· loading…' : caseTypes.isError ? '· eCourts not responding' : ''}
                  </span>
                  <SearchableSelect
                    value={caseType}
                    onChange={setCaseType}
                    disabled={!courtScopeReady(scope) || caseTypes.isFetching}
                    placeholder={courtScopeReady(scope) ? 'Search case types…' : 'Select a court first'}
                    options={(caseTypes.data ?? []).map((t) => ({ value: t.code, label: t.name }))}
                  />
                </label>
                <label className="col" style={{ gap: 4 }}>
                  <span className="body-sm muted">Registration number</span>
                  <input className="input" value={regNo} onChange={(e) => setRegNo(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" />
                </label>
                <label className="col" style={{ gap: 4 }}>
                  <span className="body-sm muted">Year</span>
                  <input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" />
                </label>
              </div>
            </>
          )}

          {candidates ? (
            <div className="col" style={{ gap: 8 }}>
              <div className="body-sm">eCourts found {candidates.length} matching cases. Pick the right one:</div>
              {candidates.map((k) => (
                <div key={k.cino} className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div>
                    <div className="body-sm"><em className="case-name">{k.title}</em></div>
                    <div className="body-sm muted mono">{k.cino}{k.establishment ? ` · ${k.establishment}` : ''}{k.caseNo ? ` · ${k.caseNo}` : ''}</div>
                  </div>
                  <button type="button" className="btn btn-sm" disabled={link.isPending} onClick={() => linkCnr(k.cino)}>Use this</button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || link.isPending}>
              {link.isPending ? 'Connecting…' : mode === 'cnr' ? 'Link with eCourts' : 'Find on eCourts'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
