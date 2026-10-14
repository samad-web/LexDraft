import { useState, useRef, useEffect, useImperativeHandle, forwardRef, Fragment, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import {
  useEcourtsCnr, useDownloadOrderPdf, useAddEcourtsCaseToMatters,
  useEcourtsStates, useEcourtsDistricts, useEcourtsCourtComplexes, useEcourtsCourts,
  useEcourtsSearchCaseNumber, useEcourtsSearchParty, useEcourtsSearchAdvocate,
  useEcourtsSearchFir, useEcourtsSearchFilingNumber, useEcourtsSearchAct,
  useEcourtsCauseList, useEcourtsCaveatSearch, useEcourtsFilingHistory, useEcourtsJudgeBenches,
  useEcourtsIaBusiness, useEcourtsAppellateInfo, useEcourtsLowerCourtCaveat,
  useEcourtsBusinessNotes, useSaveEcourtsBusinessNote, useEcourtsCaveatHistory, useEcourtsCourtLocation,
  useStartCnrLiveSession, useOpenLiveCnrLookup, useRefreshCnrCaptcha, useSubmitCnrCaptcha,
  type EcourtsCaseHistory, type EcourtsHearing, type EcourtsOrder, type Court,
  type EcourtsCauseListEntry,
} from '@/hooks/useEcourts';
import { useUIStore } from '@/store/ui';
import { PillNav } from '@/components/PillNav';
import { NewHearingModal } from '@/components/NewHearingModal';

// =============================================================================
// EcourtsView
//
// Live data from the eCourts Services backend, entirely in-app - no external
// redirects. Case Status (CNR) is the reliable, verified-working path. The
// other search modes (case number / party / advocate / FIR / filing number /
// act / cause list / caveat) all call the real /api/ecourts/search/* routes
// directly, scoped to a court the advocate picks: State -> District are
// reliable dropdowns; the Court complex/establishment CODE is a required
// text field (not a dropdown - the establishment-directory lookup that would
// populate one is blocked server-side by eCourts for automated callers,
// verified exhaustively). The code is REQUIRED, not optional - without it
// eCourts searches zero establishments and replies with a response that reads
// exactly like "no matching cases" but actually means "searched nothing"
// (verified live: the identical query with a real code returns real cases).
// Each form surfaces the real backend result or a clear, honest error.
// =============================================================================

// eCourts CNRs are 16 chars: 2 letters (state) + 2 letters (district) + 2
// alphanumeric (establishment, e.g. `0B` for Alandur JM) + 6 digits (serial)
// + 4 digits (year). Real-world examples:
//   KLER010001682023  — Kerala, Ernakulam, est 01
//   TNCG0B0011172024  — Tamil Nadu, Chengalpattu, est 0B
// We accept a permissive shape: 4 letters then 12 alphanumeric. Anything
// stricter rejects valid CNRs like TNCG0B…
const CNR_RE = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/;

type PortalTab = 'case-status' | 'case-number' | 'party' | 'advocate' | 'fir' | 'filing' | 'act' | 'cause-list' | 'caveat';

const PORTAL_TABS: ReadonlyArray<{ id: PortalTab; label: string; title?: string }> = [
  { id: 'case-status', label: 'Case Status',   title: 'Look up a case by its CNR' },
  { id: 'case-number', label: 'Case Number',   title: 'Search by case type + registration number' },
  { id: 'party',       label: 'Party Name',    title: 'Search by petitioner/respondent name' },
  { id: 'advocate',    label: 'Advocate',      title: 'Search by advocate name' },
  { id: 'fir',         label: 'FIR',           title: 'Search by FIR number' },
  { id: 'filing',      label: 'Filing Number', title: 'Search by filing number' },
  { id: 'act',         label: 'Act',           title: 'Search by act/section (currently unavailable)' },
  { id: 'cause-list',  label: 'Cause List',    title: "Today's docket for a court" },
  { id: 'caveat',      label: 'Caveat',        title: 'Search caveats' },
];

export function EcourtsView() {
  const [tab, setTab] = useState<PortalTab>('case-status');

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>§ - CASE STATUS</div>
        <h1 className="heading-xl">Case Status</h1>
        <p className="body-md muted" style={{ marginTop: 8, maxWidth: 640 }}>
          Live case data across every district and high court in India, built into your workflow: nowhere else to go.
        </p>
      </div>

      <PillNav items={PORTAL_TABS} value={tab} onChange={setTab} ariaLabel="Case status sections" />

      {tab === 'case-status' ? <CaseStatusTab /> : null}
      {tab === 'case-number' ? <CourtScopeSearchTab mode="case-number" /> : null}
      {tab === 'party'       ? <CourtScopeSearchTab mode="party" /> : null}
      {tab === 'advocate'    ? <CourtScopeSearchTab mode="advocate" /> : null}
      {tab === 'fir'         ? <CourtScopeSearchTab mode="fir" /> : null}
      {tab === 'filing'      ? <CourtScopeSearchTab mode="filing" /> : null}
      {tab === 'act'         ? <CourtScopeSearchTab mode="act" /> : null}
      {tab === 'cause-list'  ? <CourtScopeSearchTab mode="cause-list" /> : null}
      {tab === 'caveat'      ? <CourtScopeSearchTab mode="caveat" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case Status tab — live CNR lookup (verified working against the backend).
// ---------------------------------------------------------------------------

function CaseStatusTab() {
  // Two pieces of state because the input is a draft until "Look up" lands —
  // we only want to fire the query against the *submitted* CNR, not on every
  // keystroke.
  const [draft, setDraft] = useState<string>('');
  const [submittedCnr, setSubmittedCnr] = useState<string>('');
  const [court, setCourt] = useState<Court>('DC');

  const { data: history, isLoading, isError, isNotFound, error, isFetching } = useEcourtsCnr(submittedCnr, court);

  const draftIsValid = CNR_RE.test(draft.trim().toUpperCase());

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleaned = draft.trim().toUpperCase();
    if (!CNR_RE.test(cleaned)) return;
    setSubmittedCnr(cleaned);
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <p className="body-sm muted" style={{ maxWidth: 640 }}>
        Search any matter by its CNR (Case Number Record), the 16-character national identifier.
      </p>

      <form onSubmit={onSubmit} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="search" size={18} />
        <input
          className="input"
          style={{ flex: 1, minWidth: 240, height: 48, fontSize: 16, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
          placeholder="Enter CNR · e.g. KLER010001682023"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="CNR search"
          maxLength={16}
        />
        <select
          className="input"
          style={{ height: 48, width: 120 }}
          value={court}
          onChange={(e) => setCourt(e.target.value as Court)}
          aria-label="Court tier"
        >
          <option value="DC">District</option>
          <option value="HC">High Court</option>
        </select>
        <button type="submit" className="btn btn-primary btn-lg" disabled={!draftIsValid}>
          Look up case <Icon name="arrow" size={14} />
        </button>
      </form>

      {!draftIsValid && draft.length > 0 && (
        <div className="body-sm muted" style={{ paddingLeft: 4 }}>
          CNR must be exactly 16 characters (4 letters followed by 12 alphanumeric).
        </div>
      )}

      {isLoading || isFetching ? <LoadingCard cnr={submittedCnr} /> : null}

      {/* A 404 ("no case found for this CNR") is an expected, well-formed
          answer, not a failure - it gets the dedicated amber card below.
          The red ErrorCard is reserved for genuine transport/server
          failures (5xx, network errors). */}
      {!isLoading && isError && !isNotFound ? <ErrorCard error={error} /> : null}

      {!isLoading && !isError && history ? <CaseCard h={history} court={court} /> : null}

      {submittedCnr && !isLoading && !isFetching && (isNotFound || (!isError && !history)) ? (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="dot dot-amber" />
            <div>
              <div className="heading-sm" style={{ marginBottom: 4 }}>No case found</div>
              <p className="body-sm muted">The eCourts backend did not return a record for this CNR.</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Court-scoped search — case number / party / advocate / FIR / filing number /
// act / cause list / caveat. All stay in-app: the form posts straight to
// LexDraft's own /api/ecourts/search/* routes.
//
// Every one of these searches is scoped to a specific court (state, district,
// court complex code, establishment code). State and district are reliable
// dropdowns (backed by /ecourts/reference/*). The court-complex/establishment
// *code* is a known-fragile lookup on eCourts' side today, so rather than a
// picker that can silently fail, the advocate enters it directly - it's
// printed on eCourts' own cause-list PDFs and case-status pages, and once
// known for a court it's reused for every future search there.
// ---------------------------------------------------------------------------

type SearchMode = 'case-number' | 'party' | 'advocate' | 'fir' | 'filing' | 'act' | 'cause-list' | 'caveat';

const MODE_COPY: Record<SearchMode, { title: string; blurb: string }> = {
  'case-number': { title: 'Search by case number', blurb: 'Enter the case type, registration number and year.' },
  party:         { title: 'Search by party name', blurb: 'Enter the petitioner or respondent name and year.' },
  advocate:      { title: 'Search by advocate name', blurb: 'Enter the advocate’s name and year.' },
  fir:           { title: 'Search by FIR number', blurb: 'Enter the police station code, FIR number and year.' },
  filing:        { title: 'Search by filing number', blurb: 'Enter the filing number and year.' },
  // KNOWN BROKEN server-side (see useEcourtsSearchAct's doc comment) - kept
  // in the UI with an honest label rather than hidden, since eCourts may fix
  // their endpoint without us shipping a client change.
  act:           { title: 'Search by act (currently unavailable)', blurb: 'eCourts’ own backend rejects every request to this search today. This is not a bug on our side. Try another search mode.' },
  'cause-list':  { title: 'Cause list', blurb: "Get today’s (or any date’s) docket for a court." },
  caveat:        { title: 'Caveat search', blurb: 'Search caveats by caveator or caveatee name.' },
};

function CourtScopeSearchTab({ mode }: { mode: SearchMode }) {
  const [court, setCourt] = useState<Court>('DC');
  const [stateCode, setStateCode] = useState<number | ''>('');
  const [distCode, setDistCode] = useState<number | ''>('');
  const [courtCode, setCourtCode] = useState('0');
  const [complexCode, setComplexCode] = useState('');
  const [estCode, setEstCode] = useState('');

  // A search result only carries a summary + CNR - viewing the full case
  // (hearings, orders, "Add to my cases") reuses the same CNR pipeline the
  // Case Status tab uses, so results and CNR lookup show identical detail.
  //
  // The detail card renders BELOW the result list, which can be long (dozens
  // of rows) - without an explicit scroll, clicking "View" updates state
  // correctly but the change happens off-screen and looks like nothing
  // happened. Scroll it into view the same way ClientAutocomplete/
  // SearchableSelect do elsewhere in this app.
  const [viewCnr, setViewCnr] = useState<string | null>(null);
  const viewCardRef = useRef<HTMLDivElement>(null);
  const {
    data: viewedCase, isLoading: viewLoading, isFetching: viewFetching,
    isError: viewError, isNotFound: viewNotFound, error: viewErrorObj,
  } = useEcourtsCnr(viewCnr, court);

  const handleViewCnr = (cnr: string) => {
    setViewCnr(cnr);
  };

  // Scroll the detail card into view only after React has committed the
  // mount triggered by viewCnr changing - a setTimeout here would race the
  // commit instead of guaranteeing it, same pattern as ClientAutocomplete.
  useEffect(() => {
    if (viewCnr) viewCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [viewCnr]);

  const [caseType, setCaseType] = useState('');
  const [regNo, setRegNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [advocateName, setAdvocateName] = useState('');
  const [policeStCode, setPoliceStCode] = useState('');
  const [firNo, setFirNo] = useState('');
  const [filingNo, setFilingNo] = useState('');
  const [actCode, setActCode] = useState('');
  const [section, setSection] = useState('');
  const [caveatorName, setCaveatorName] = useState('');
  const [caveateeName, setCaveateeName] = useState('');
  const [caveatSearchBy, setCaveatSearchBy] = useState<'Caveator' | 'Caveatee'>('Caveator');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: states, isLoading: statesLoading, isError: statesError, refetch: refetchStates } = useEcourtsStates(court);
  const {
    data: districts, isLoading: districtsLoading, isFetching: districtsFetching,
    isError: districtsError, refetch: refetchDistricts,
  } = useEcourtsDistricts(stateCode === '' ? null : stateCode, court);
  const { data: complexes, isFetching: complexesFetching } = useEcourtsCourtComplexes(
    stateCode === '' ? null : stateCode,
    distCode === '' ? null : distCode,
    court,
  );
  const { data: courts, isFetching: courtsFetching } = useEcourtsCourts(
    stateCode === '' ? null : stateCode,
    distCode === '' ? null : distCode,
    complexCode || null,
    court,
  );
  // Which judge(s) sit on the selected court - a 4th cascade level, live
  // (not DB-cached like courts/complexes). Purely informational for now: the
  // search itself still scopes by court, not by individual judge.
  const { data: judgeBenches, isFetching: judgeBenchesFetching } = useEcourtsJudgeBenches(
    stateCode === '' ? null : stateCode,
    distCode === '' ? null : distCode,
    courtCode && courtCode !== '0' ? courtCode : null,
    court,
  );
  // Court-complex geolocation - scoped to the complex (one building), not
  // the individual court, since every court inside shares one address.
  const { data: courtLocation } = useEcourtsCourtLocation(
    stateCode === '' ? null : stateCode,
    distCode === '' ? null : distCode,
    complexCode || null,
    court,
  );
  // Real court names (ecourts_courts) are only captured for a handful of
  // complexes so far - probing each court_code for its name is a live search
  // call per code, much slower than the complex-list capture. Until that
  // catches up, fall back to the court_codes already captured on the complex
  // itself (no name, just the code) so the field is still a dropdown instead
  // of free text.
  const selectedComplex = complexes?.find((c) => c.complexCode === complexCode);
  const codeOnlyCourts = selectedComplex?.courtCodes ?? [];

  const searchCaseNumber = useEcourtsSearchCaseNumber();
  const searchParty = useEcourtsSearchParty();
  const searchAdvocate = useEcourtsSearchAdvocate();
  const searchFir = useEcourtsSearchFir();
  const searchFiling = useEcourtsSearchFilingNumber();
  const searchAct = useEcourtsSearchAct();
  const causeList = useEcourtsCauseList();
  const caveatSearch = useEcourtsCaveatSearch();

  const mutation = {
    'case-number': searchCaseNumber,
    party: searchParty,
    advocate: searchAdvocate,
    fir: searchFir,
    filing: searchFiling,
    act: searchAct,
    'cause-list': causeList,
    caveat: caveatSearch,
  }[mode];

  // Court code is REQUIRED for every mode - it's what actually goes upstream
  // as `court_code_arr` (see ecourts.service.ts). Without it eCourts searches
  // zero establishments and returns a response that looks exactly like "no
  // matching cases" but means "searched nothing" (verified live). The Court
  // dropdown above auto-fills this; estCode alone is NOT enough to submit -
  // that was the bug (dropdown picked, courtCode left at '0', silent empty
  // search) this check now catches.
  const scopeReady = stateCode !== '' && distCode !== '' && estCode.trim().length > 0 && courtCode.trim().length > 0 && courtCode !== '0';
  const fieldsReady = (() => {
    switch (mode) {
      case 'case-number': return caseType.trim() && regNo.trim();
      case 'party': return partyName.trim();
      case 'advocate': return advocateName.trim();
      case 'fir': return policeStCode.trim() && firNo.trim();
      case 'filing': return filingNo.trim();
      case 'act': return actCode.trim();
      case 'cause-list': return Boolean(date);
      case 'caveat': return caveatorName.trim() || caveateeName.trim();
      default: return false;
    }
  })();
  const canSubmit = scopeReady && Boolean(fieldsReady);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    const scope = {
      stateCode: Number(stateCode), distCode: Number(distCode),
      courtCode: Number(courtCode) || 0,
      estCode: estCode.trim(),
      court,
    };
    const yr = Number(year);
    switch (mode) {
      case 'case-number':
        searchCaseNumber.mutate({ ...scope, caseType: caseType.trim(), regNo: regNo.trim(), year: yr });
        break;
      case 'party':
        searchParty.mutate({ ...scope, partyName: partyName.trim(), year: yr, stage: 'B' });
        break;
      case 'advocate':
        searchAdvocate.mutate({ ...scope, advocateName: advocateName.trim(), year: yr, stage: 'B' });
        break;
      case 'fir':
        searchFir.mutate({ ...scope, policeStCode: Number(policeStCode), firNo: firNo.trim(), firYear: yr });
        break;
      case 'filing':
        searchFiling.mutate({ ...scope, filingNo: filingNo.trim(), filingYear: yr });
        break;
      case 'act':
        searchAct.mutate({ ...scope, actCode: actCode.trim(), section: section.trim() || undefined, year: yr });
        break;
      case 'cause-list':
        causeList.mutate({ ...scope, date });
        break;
      case 'caveat':
        caveatSearch.mutate({ ...scope, caveatorName: caveatorName.trim() || undefined, caveateeName: caveateeName.trim() || undefined, searchBy: caveatSearchBy });
        break;
    }
  };

  const copy = MODE_COPY[mode];

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      {mode === 'act' ? (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="dot dot-amber" />
            <div>
              <div className="heading-sm" style={{ marginBottom: 4 }}>This search is currently unavailable</div>
              <p className="body-sm muted">eCourts' own backend rejects every request to this search today. This is not a bug on our side. Try another search mode.</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="col" style={{ gap: 16 }}>
          <div className="col" style={{ gap: 6 }}>
            <div className="heading-sm">{copy.title}</div>
            <p className="body-sm muted" style={{ maxWidth: 640 }}>{copy.blurb}</p>
          </div>

          <form onSubmit={onSubmit} className="col" style={{ gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <label className="col" style={{ gap: 4 }}>
                <span className="body-sm muted">Court tier</span>
                <select className="input" value={court} onChange={(e) => { setCourt(e.target.value as Court); setStateCode(''); setDistCode(''); }}>
                  <option value="DC">District</option>
                  <option value="HC">High Court</option>
                </select>
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="body-sm muted">
                  State {statesLoading ? '· loading…' : statesError ? '· failed to load' : ''}
                </span>
                <select
                  className="input"
                  value={stateCode}
                  onChange={(e) => { setStateCode(e.target.value ? Number(e.target.value) : ''); setDistCode(''); }}
                  disabled={statesLoading}
                >
                  <option value="">{statesLoading ? 'Loading states…' : 'Select state'}</option>
                  {(states ?? []).map((s) => <option key={s.state_code} value={s.state_code}>{s.state_name}</option>)}
                </select>
                {statesError ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refetchStates()} style={{ alignSelf: 'flex-start' }}>
                    eCourts didn't respond, retry
                  </button>
                ) : null}
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="body-sm muted">
                  District {districtsFetching ? '· loading…' : districtsError ? '· failed to load' : ''}
                </span>
                <select
                  className="input"
                  value={distCode}
                  onChange={(e) => setDistCode(e.target.value ? Number(e.target.value) : '')}
                  disabled={stateCode === '' || districtsLoading}
                >
                  <option value="">
                    {stateCode === '' ? 'Select a state first' : districtsFetching ? 'Loading districts…' : 'Select district'}
                  </option>
                  {(districts ?? []).map((d) => <option key={d.dist_code} value={d.dist_code}>{d.dist_name}</option>)}
                </select>
                {districtsError ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refetchDistricts()} style={{ alignSelf: 'flex-start' }}>
                    eCourts didn't respond, retry
                  </button>
                ) : null}
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="body-sm muted">
                  Court complex {complexesFetching ? '· loading…' : ''}
                </span>
                {complexes && complexes.length > 0 ? (
                  <select
                    className="input"
                    value={complexCode}
                    onChange={(e) => { setComplexCode(e.target.value); setEstCode(''); }}
                    disabled={distCode === ''}
                  >
                    <option value="">Select court complex</option>
                    {complexes.map((c) => (
                      <option key={c.complexCode} value={c.complexCode}>
                        {c.complexName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    value={estCode}
                    onChange={(e) => setEstCode(e.target.value)}
                    placeholder={distCode === '' ? 'Select a district first' : 'e.g. 12 (this district isn\'t in our list yet)'}
                    disabled={distCode === ''}
                  />
                )}
                {courtLocation ? (
                  <a
                    href={`https://www.google.com/maps?q=${courtLocation.latitude},${courtLocation.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="body-sm"
                    style={{ color: 'var(--text-secondary)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                  >
                    View court on map →
                  </a>
                ) : null}
              </label>
              {complexes && complexes.length > 0 ? (
                <label className="col" style={{ gap: 4 }}>
                  <span className="body-sm muted">
                    Court {courtsFetching ? '· loading…' : ''}
                  </span>
                  {courts && courts.length > 0 ? (
                    <select
                      className="input"
                      value={estCode}
                      onChange={(e) => { setEstCode(e.target.value); setCourtCode(e.target.value); }}
                      disabled={!complexCode}
                    >
                      <option value="">Select court</option>
                      {courts.map((c) => (
                        <option key={c.courtCode} value={c.courtCode}>{c.courtName}</option>
                      ))}
                    </select>
                  ) : codeOnlyCourts.length > 0 ? (
                    <select
                      className="input"
                      value={estCode}
                      onChange={(e) => { setEstCode(e.target.value); setCourtCode(e.target.value); }}
                      disabled={!complexCode}
                    >
                      <option value="">Select court</option>
                      {codeOnlyCourts.map((code) => (
                        <option key={code} value={code}>Court {code}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      value={estCode}
                      onChange={(e) => setEstCode(e.target.value)}
                      placeholder={!complexCode ? 'Select a court complex first' : "e.g. 17 (this complex isn't in our list yet)"}
                      disabled={!complexCode}
                    />
                  )}
                </label>
              ) : null}
              <label className="col" style={{ gap: 4 }}>
                <span className="body-sm muted">Court code</span>
                <input
                  className="input"
                  value={courtCode}
                  onChange={(e) => setCourtCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={complexes && complexes.length > 0 ? 'auto-filled from Court above' : 'e.g. 6'}
                />
              </label>
            </div>

            {courtCode && courtCode !== '0' ? (
              <div className="body-sm muted" style={{ marginTop: -4 }}>
                {judgeBenchesFetching ? (
                  'Loading judge/bench…'
                ) : judgeBenches && judgeBenches.length > 0 ? (
                  <>
                    <span style={{ color: 'var(--text-tertiary)' }}>Bench: </span>
                    {judgeBenches.map((jb, i) => (
                      <span key={jb.code}>
                        {jb.judgeName}{jb.designation ? ` (${jb.designation})` : ''}
                        {i < judgeBenches.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {mode === 'case-number' && (
                <>
                  <Labeled label="Case type"><input className="input" value={caseType} onChange={(e) => setCaseType(e.target.value)} /></Labeled>
                  <Labeled label="Registration number"><input className="input" value={regNo} onChange={(e) => setRegNo(e.target.value)} /></Labeled>
                  <Labeled label="Year"><input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" /></Labeled>
                </>
              )}
              {mode === 'party' && (
                <>
                  <Labeled label="Party name"><input className="input" value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="e.g. Ramesh Kumar" /></Labeled>
                  <Labeled label="Year"><input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" /></Labeled>
                </>
              )}
              {mode === 'advocate' && (
                <>
                  <Labeled label="Advocate name"><input className="input" value={advocateName} onChange={(e) => setAdvocateName(e.target.value)} /></Labeled>
                  <Labeled label="Year"><input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" /></Labeled>
                </>
              )}
              {mode === 'fir' && (
                <>
                  <Labeled label="Police station code"><input className="input" value={policeStCode} onChange={(e) => setPoliceStCode(e.target.value.replace(/\D/g, ''))} /></Labeled>
                  <Labeled label="FIR number"><input className="input" value={firNo} onChange={(e) => setFirNo(e.target.value)} /></Labeled>
                  <Labeled label="Year"><input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" /></Labeled>
                </>
              )}
              {mode === 'filing' && (
                <>
                  <Labeled label="Filing number"><input className="input" value={filingNo} onChange={(e) => setFilingNo(e.target.value)} /></Labeled>
                  <Labeled label="Year"><input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" /></Labeled>
                </>
              )}
              {mode === 'act' && (
                <>
                  <Labeled label="Act code"><input className="input" value={actCode} onChange={(e) => setActCode(e.target.value)} /></Labeled>
                  <Labeled label="Section (optional)"><input className="input" value={section} onChange={(e) => setSection(e.target.value)} /></Labeled>
                  <Labeled label="Year"><input className="input" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" /></Labeled>
                </>
              )}
              {mode === 'cause-list' && (
                <Labeled label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Labeled>
              )}
              {mode === 'caveat' && (
                <>
                  <Labeled label="Caveator name"><input className="input" value={caveatorName} onChange={(e) => setCaveatorName(e.target.value)} /></Labeled>
                  <Labeled label="Caveatee name"><input className="input" value={caveateeName} onChange={(e) => setCaveateeName(e.target.value)} /></Labeled>
                  <Labeled label="Search by">
                    <select className="input" value={caveatSearchBy} onChange={(e) => setCaveatSearchBy(e.target.value as 'Caveator' | 'Caveatee')}>
                      <option value="Caveator">Caveator</option>
                      <option value="Caveatee">Caveatee</option>
                    </select>
                  </Labeled>
                </>
              )}
            </div>

            <div>
              <button type="submit" className="btn btn-primary btn-lg" disabled={!canSubmit || mutation.isPending}>
                {mutation.isPending ? 'Searching…' : 'Search'} <Icon name="search" size={14} />
              </button>
              {!scopeReady && (
                <div className="body-sm muted" style={{ marginTop: 8 }}>
                  Select state, district and enter the court complex code to search.
                </div>
              )}
            </div>
          </form>
        </div>
      </div>

      {mutation.isPending ? <SearchLoadingCard /> : null}

      {mutation.isError ? (
        <div className="card" style={{ borderColor: 'var(--vermillion)' }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="dot dot-vermillion" />
            <div>
              <div className="heading-sm" style={{ marginBottom: 4 }}>Search failed</div>
              <p className="body-sm muted">
                {(mutation.error as { response?: { data?: { error?: string } } })?.response?.data?.error
                  ?? (mutation.error as Error)?.message
                  ?? 'The eCourts backend rejected this request. Double-check the establishment code for this court.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {mutation.isSuccess ? (
        <SearchResultRenderer
          mode={mode}
          data={mutation.data}
          onViewCnr={handleViewCnr}
          court={court}
          scope={{ stateCode: stateCode === '' ? 0 : stateCode, distCode: distCode === '' ? 0 : distCode, courtCode: Number(courtCode) || 0 }}
        />
      ) : null}

      {mode === 'caveat' && mutation.isSuccess && stateCode !== '' && distCode !== '' && courtCode && courtCode !== '0' ? (
        <LowerCourtCaveatSection stateCode={stateCode} distCode={distCode} courtCode={Number(courtCode)} court={court} />
      ) : null}

      {viewCnr ? (
        <div ref={viewCardRef}>
          {(viewLoading || viewFetching) ? <LoadingCard cnr={viewCnr} /> : null}
          {/* Same 404-vs-transport-failure split as CaseStatusTab: a 404 is
              an expected "no record for this CNR" answer, not a failure. */}
          {viewError && !viewNotFound ? <ErrorCard error={viewErrorObj} /> : null}
          {viewedCase ? <CaseCard h={viewedCase} court={court} onAdded={() => setViewCnr(null)} /> : null}
          {!viewLoading && !viewFetching && (viewNotFound || (!viewError && !viewedCase)) ? (
            <div className="card" style={{ borderColor: 'var(--warning)' }}>
              <div className="row" style={{ gap: 12 }}>
                <span className="dot dot-amber" />
                <div>
                  <div className="heading-sm" style={{ marginBottom: 4 }}>No case found</div>
                  <p className="body-sm muted">The eCourts backend did not return a record for this CNR.</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="col" style={{ gap: 4 }}>
      <span className="body-sm muted">{label}</span>
      {children}
    </label>
  );
}

// A GENUINE zero-result search (court searched, nothing matched - distinct
// from the "search never ran" amber warning above) used to just say "no
// matching cases" with nothing else - the advocate was left guessing why
// (wrong year? name spelled differently on the court record? wrong court
// entirely?) with no way to tell from the UI alone. Confirmed live this is a
// real gap, not a hypothetical: a real search (Kerala/Alappuzha/Sub Court
// Chengannur/"shahul"/2026) correctly reported zero matches - genuinely
// correct per the live eCourts data - but gave the advocate nothing to act
// on next. eCourts' own party-name matching is narrower than a human expects
// (closer to exact/prefix than fuzzy), so "check the name" is the single
// highest-value hint, not a generic "try again."
const ZERO_RESULT_HINTS: Record<SearchMode, string[]> = {
  'party': [
    'eCourts matches party names narrowly (closer to exact than fuzzy) - try just the surname, or the name exactly as it would appear on a court filing.',
    'Confirm the year - this searches filings registered in the year entered, not the case\'s current year.',
    'Double-check the court selected above - a case filed at a different court/complex in the same district won\'t show here.',
  ],
  'advocate': [
    'Try the advocate\'s name exactly as enrolled (eCourts matching is narrow, not fuzzy).',
    'Confirm the year - this searches filings registered in that year.',
    'Double-check the court selected above.',
  ],
  'case-number': [
    'Double-check the case type, number, and year match exactly what\'s on the filing.',
    'Confirm the court selected above is the one the case was actually filed at.',
  ],
  'fir': [
    'Confirm the FIR number and year exactly as registered.',
    'Double-check the police station and court selected above.',
  ],
  'filing': [
    'Confirm the filing number and year exactly as issued.',
    'Double-check the court selected above.',
  ],
  'act': [
    'Try a narrower or differently-worded act name - eCourts matching here is narrow.',
  ],
  'cause-list': [],
  'caveat': [
    'Try just the surname, or the name exactly as it would appear on a court filing.',
    'Double-check the court selected above.',
  ],
};

function ZeroResultHint({ mode }: { mode: SearchMode }) {
  const hints = ZERO_RESULT_HINTS[mode];
  if (!hints.length) return null;
  return (
    <ul className="body-sm muted" style={{ marginTop: 8, paddingLeft: 18 }}>
      {hints.map((h, i) => <li key={i}>{h}</li>)}
    </ul>
  );
}

// eCourts search endpoints return varying, loosely-typed shapes per mode
// (the PHP backend isn't uniform). Rather than guess a schema per mode and
// break on the first mismatch, we detect a `status:"N"` error envelope and
// otherwise render whatever list-shaped or object-shaped payload came back.
function SearchResultRenderer({
  mode, data, onViewCnr, court, scope,
}: {
  mode: SearchMode; data: unknown; onViewCnr: (cnr: string) => void; court: Court;
  scope: { stateCode: number; distCode: number; courtCode: number };
}) {
  const obj = data as Record<string, unknown> | null;
  if (obj && typeof obj === 'object' && obj.status === 'N') {
    return (
      <div className="card" style={{ borderColor: 'var(--warning)' }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="dot dot-amber" />
          <div>
            <div className="heading-sm" style={{ marginBottom: 4 }}>No result</div>
            <p className="body-sm muted">{String(obj.msg ?? 'eCourts did not return a match for this search.')}</p>
          </div>
        </div>
      </div>
    );
  }

  // `{"no_of_establishments":0}` with NO establishment keys at all is a
  // distinct failure mode, not a genuine "no matching cases" result: it
  // means eCourts searched zero establishments (a `court_code_arr` scoping
  // problem upstream), not that it searched the right court and found
  // nothing. A real empty result still comes back with establishment
  // entries present, just with empty `caseNos: []` inside them (handled
  // below). Surfacing this the same as "no cases matched" has misled users
  // before - call it out explicitly, same treatment as the Act-search
  // "currently unavailable" banner.
  if (
    obj && typeof obj === 'object' && !Array.isArray(obj)
    && obj.no_of_establishments === 0
    && !Object.keys(obj).some((k) => k !== 'token' && k !== 'no_of_establishments')
  ) {
    return (
      <div className="card" style={{ borderColor: 'var(--warning)' }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="dot dot-amber" />
          <div>
            <div className="heading-sm" style={{ marginBottom: 4 }}>Search did not run against any court</div>
            <p className="body-sm muted">
              eCourts reports it searched zero establishments for this request - this is not the same as
              "no matching cases", it means the search never actually ran against the court you selected.
              Double-check the establishment/court selected above, or try the search again; this is a
              known upstream quirk, not a sign that there's no such case.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'cause-list') {
    const items = (obj?.items as EcourtsCauseListEntry[] | undefined) ?? [];
    if (!items.length) {
      return <div className="card"><p className="body-sm muted">No cause-list entries for this date.</p></div>;
    }
    return (
      <div className="card">
        <div className="heading-sm" style={{ marginBottom: 10 }}>{items.length} {items.length === 1 ? 'entry' : 'entries'}</div>
        <table className="tbl">
          <thead><tr><th style={{ width: 100 }}>Court</th><th>Case</th><th>Parties</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="mono">{String(it.court_no ?? '—')}</td>
                <td>{String(it.case_no ?? '—')}</td>
                <td>{String(it.petparty_name ?? '')} v. {String(it.resparty_name ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Case-search endpoints (party/advocate/FIR/filing/case-number/act) share
  // this real, verified shape: an object keyed by establishment index
  // ("0", "1", ...), each holding { establishment_name, caseNos: [...] }, plus
  // a top-level `no_of_establishments` count and `token`. Those last two are
  // metadata, NOT a result - rendering them as if they were a case (as a
  // naive "dump every field" renderer would) is exactly what made a genuine
  // zero-establishments response look like "1 result" with a case named "NO
  // OF ESTABLISHMENTS: 0". Parse the real establishment/caseNos structure.
  interface CaseRow {
    cino?: string; case_no?: string; pet_name?: string; res_name?: string;
    extra_party?: string; type_name?: string; case_year?: number | string;
    date_of_decision?: string | null;
    [k: string]: unknown;
  }
  const establishments: Array<{ name: string; cases: CaseRow[] }> = [];
  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'token' || key === 'no_of_establishments') continue;
      if (val && typeof val === 'object' && Array.isArray((val as { caseNos?: unknown }).caseNos)) {
        const v = val as { establishment_name?: string; caseNos: CaseRow[] };
        establishments.push({ name: v.establishment_name ?? `Establishment ${key}`, cases: v.caseNos });
      }
    }
  }
  const totalCases = establishments.reduce((n, e) => n + e.cases.length, 0);

  if (establishments.length > 0) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <div className="body-sm muted">
          {totalCases > 0
            ? `${totalCases} ${totalCases === 1 ? 'case' : 'cases'} found across ${establishments.length} ${establishments.length === 1 ? 'court' : 'courts'}`
            : `Searched ${establishments.length} ${establishments.length === 1 ? 'court' : 'courts'}, no matching cases`}
        </div>
        {establishments.map((est, ei) => (
          <div key={ei} className="card">
            <div className="heading-sm" style={{ marginBottom: 10 }}>{est.name}</div>
            {est.cases.length === 0 ? (
              <div>
                <p className="body-sm muted">No cases matched this search in this court.</p>
                <ZeroResultHint mode={mode} />
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {est.cases.map((c, i) => (
                  <div key={i} className="col" style={{ gap: 8, padding: '8px 0', borderBottom: i < est.cases.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div className="row" style={{ gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                      <div className="col" style={{ gap: 2 }}>
                        <div className="body-sm" style={{ fontWeight: 600 }}>
                          {[c.pet_name, c.res_name].filter(Boolean).join(' v. ') || c.extra_party || c.case_no}
                        </div>
                        <div className="body-sm muted">
                          {c.type_name ? `${c.type_name} · ` : ''}{c.case_no}{c.case_year ? `/${c.case_year}` : ''}
                          {c.date_of_decision ? ` · Decided ${c.date_of_decision}` : ''}
                        </div>
                        {c.cino ? <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>CNR {c.cino}</span> : null}
                        {c.cino ? <ResultStatusBadge cino={c.cino} court={court} /> : null}
                      </div>
                      {c.cino ? (
                        <div className="row" style={{ gap: 8 }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onViewCnr(c.cino!)}>
                            View
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {c.cino ? <LiveBusinessInline cino={c.cino} /> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Fallback: an array (or object wrapping one) of case-like rows, for modes
  // that don't follow the establishment/caseNos shape above.
  const rows: Array<Record<string, unknown>> = Array.isArray(obj)
    ? (obj as unknown as Array<Record<string, unknown>>)
    : Array.isArray(obj?.data) ? (obj!.data as Array<Record<string, unknown>>)
    : [];

  if (!rows.length) {
    return (
      <div className="card">
        <p className="body-sm muted">No cases matched this search.</p>
        <ZeroResultHint mode={mode} />
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="body-sm muted">{rows.length} {rows.length === 1 ? 'result' : 'results'}</div>
      {rows.map((row, i) => (
        <div key={i} className="card">
          <div className="grid-2" style={{ gap: 12 }}>
            {Object.entries(row).filter(([k]) => !/^(token|status)$/i.test(k)).slice(0, 12).map(([k, v]) => (
              <Field key={k} label={k.replace(/_/g, ' ').toUpperCase()} value={String(v ?? '—')} />
            ))}
          </div>
          {mode === 'caveat' && row.caveat_no ? (
            <CaveatDetailButton caveatNumber={String(row.caveat_no)} scope={scope} court={court} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

// caveatCaseHistoryWebService.php - detail for one specific caveat result row
// (parties, subject, filing date). Found by re-auditing the full decompiled
// APK, see ecourts.service.ts's fetchCaveatHistory doc comment. A caveat
// number with nothing on record still returns a populated shape with every
// field null - rendered as "No further detail on record" rather than hidden,
// since the advocate explicitly asked to see it (unlike the auto-fetched
// IA/Appellate sections, this is click-triggered so showing SOME response is
// expected, not a silent no-op).
function CaveatDetailButton({ caveatNumber, scope, court }: { caveatNumber: string; scope: { stateCode: number; distCode: number; courtCode: number }; court: Court }) {
  const mutation = useEcourtsCaveatHistory();
  const [shown, setShown] = useState(false);

  const handleClick = () => {
    setShown(true);
    if (!mutation.data) mutation.mutate({ ...scope, caveatNumber, court });
  };

  if (!shown) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={handleClick}>
        View caveat detail
      </button>
    );
  }

  if (mutation.isPending) return <p className="body-sm muted" style={{ marginTop: 8 }}>Loading…</p>;
  if (mutation.isError) return <p className="body-sm muted" style={{ marginTop: 8 }}>Could not load caveat detail.</p>;

  const h = mutation.data?.history;
  const hasDetail = Boolean(h?.caveatorDetails.caveator_name || h?.caveateeDetails.caveatee_name || h?.caveatDetails.subject);
  return (
    <div className="col" style={{ marginTop: 8, gap: 4, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
      {hasDetail ? (
        <div className="grid-2" style={{ gap: 12 }}>
          <Field label="CAVEATOR" value={h?.caveatorDetails.caveator_name || '—'} />
          <Field label="CAVEATEE" value={h?.caveateeDetails.caveatee_name || '—'} />
          <Field label="SUBJECT" value={h?.caveatDetails.subject || '—'} />
          <Field label="DATE OF FILING" value={h?.caveatDetails.dt_filing || '—'} mono />
        </div>
      ) : (
        <p className="body-sm muted">No further detail on record for this caveat.</p>
      )}
    </div>
  );
}

// lowerCourtCaveat.php - whether a caveat exists at a LOWER court for the
// same matter, one of the 6 endpoints found by re-auditing the full
// decompiled APK (see ecourts.service.ts). Renders nothing on an empty
// result (verified live: that's a legitimate "no lower-court caveat" answer,
// not an error) - only appears after a caveat search has actually run.
function LowerCourtCaveatSection({ stateCode, distCode, courtCode, court }: { stateCode: number; distCode: number; courtCode: number; court: Court }) {
  const { data: items, isLoading } = useEcourtsLowerCourtCaveat(stateCode, distCode, courtCode, court);
  if (isLoading || !items || items.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="heading-sm" style={{ marginBottom: 10 }}>Lower-court caveat on record</div>
      <div className="col" style={{ gap: 8 }}>
        {items.map((row, i) => (
          <div key={i} className="grid-2" style={{ gap: 12 }}>
            {Object.entries(row).filter(([k]) => !/^(token)$/i.test(k)).slice(0, 8).map(([k, v]) => (
              <Field key={k} label={k.replace(/_/g, ' ').toUpperCase()} value={String(v ?? '—')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingCard({ cnr }: { cnr: string }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 12 }}>
        <span className="dot dot-amber" />
        <div>
          <div className="heading-sm" style={{ marginBottom: 4 }}>Fetching {cnr}…</div>
          <p className="body-sm muted">eCourts upstream is famously slow; this can take 5-15 seconds.</p>
        </div>
      </div>
    </div>
  );
}

// Court-scope searches (party/case-number/advocate/etc.) hit the same slow
// eCourts upstream but can run 20-30s+ (we've seen it time out at 30s) -
// longer than a single CNR fetch. Without a visible loading state here the
// page looks frozen/blank for that whole window; this fills it so the
// advocate can see the search is actually in flight.
function SearchLoadingCard() {
  return (
    <div className="card">
      <div className="row" style={{ gap: 12 }}>
        <span className="spinner" aria-hidden style={{
          width: 14, height: 14, borderRadius: '50%',
          border: '2px solid var(--border-subtle)', borderTopColor: 'var(--info)',
          animation: 'ecourts-spin 0.8s linear infinite', flexShrink: 0,
        }} />
        <div>
          <div className="heading-sm" style={{ marginBottom: 4 }}>Searching eCourts…</div>
          <p className="body-sm muted">
            eCourts' live upstream is slow and can take 20-30 seconds, sometimes longer. This isn't stuck -
            hang tight.
          </p>
        </div>
      </div>
      <style>{`
        @keyframes ecourts-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function ErrorCard({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  return (
    <div className="card" style={{ borderColor: 'var(--vermillion)' }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="dot dot-vermillion" />
        <div>
          <div className="heading-sm" style={{ marginBottom: 4 }}>Lookup failed</div>
          <p className="body-sm muted">{msg}</p>
        </div>
      </div>
    </div>
  );
}

function CaseCard({ h, court, onAdded }: { h: EcourtsCaseHistory; court: Court; onAdded?: () => void }) {
  const disposed = Boolean(h.date_of_decision && h.disp_name);
  const addToCases = useAddEcourtsCaseToMatters();
  const showToast = useUIStore((s) => s.showToast);
  const [added, setAdded] = useState(false);
  // One LiveBusinessInline instance per case card; both the "Latest
  // Business" purpose text and every hearing row trigger the SAME instance
  // via this ref, so clicking either jumps straight into its captcha/result
  // flow instead of needing the dedicated button first.
  const liveBusinessRef = useRef<LiveBusinessInlineHandle>(null);

  const [hearingOpen, setHearingOpen] = useState(false);
  // Must match useAddEcourtsCaseToMatters' title construction exactly - the
  // hearing modal resolves a matter by title string, so any divergence here
  // would create a second, duplicate case instead of attaching to the one
  // "Add to my cases" already created.
  const caseTitle = `${h.petName || h.pet_name || 'Unknown'} v. ${h.resName || h.res_name || 'Unknown'}`;

  const handleAdd = async () => {
    try {
      await addToCases.mutateAsync({ history: h, court });
      setAdded(true);
      showToast({ type: 'sage', text: 'Added to your matters and synced from eCourts' });
      onAdded?.();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not add to matters';
      // A case we already added isn't a failure the advocate needs to act
      // on - it's already in Cases/Calendar, so "Add hearing" below should
      // still work. Flip added=true on that one specific error instead of
      // leaving the button stuck on a retry state for an action that can't
      // succeed differently.
      if (msg.toLowerCase().includes('already in your matters')) setAdded(true);
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)', letterSpacing: '0.08em', marginBottom: 6 }}>
              CNR · {h.cino}
            </div>
            <h2 className="heading-lg" style={{ marginBottom: 4 }}>
              <em className="case-name">{(h.petName || h.pet_name) + ' v. ' + (h.resName || h.res_name)}</em>
            </h2>
            <p className="body-sm muted">{h.case_no} · {h.court_name}</p>
          </div>
          <div className="col" style={{ gap: 10, alignItems: 'flex-end' }}>
            {disposed
              ? <span className="badge badge-sage">{(h.disp_name ?? '').toUpperCase()}</span>
              : <span className="badge badge-amber">PENDING</span>}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => { void handleAdd(); }}
              disabled={addToCases.isPending || added}
              title="Save this matter to your Cases and pull its hearings from eCourts"
            >
              {added
                ? <><Icon name="check" size={14} /> Added</>
                : addToCases.isPending
                  ? <>Adding…</>
                  : <><Icon name="plus" size={14} /> Add to my cases</>}
            </button>
            {added ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setHearingOpen(true)}
                title="Add a hearing, deadline, or reminder for this matter - it shows up on your Calendar and triggers the same upcoming-hearing reminder as eCourts-synced dates"
              >
                <Icon name="calendar" size={14} /> Add hearing
              </button>
            ) : null}
          </div>
        </div>

        <hr className="hairline" style={{ margin: '20px 0' }} />

        <div className="grid-2" style={{ gap: 24 }}>
          <Field label="BENCH"          value={h.desgname || '—'} />
          <Field label="DISTRICT"       value={`${h.district_name}, ${h.state_name}`} />
          <Field label="DATE OF FILING" value={fmtDate(h.date_of_filing)} mono />
          <Field
            label={disposed ? 'DATE OF DECISION' : 'NEXT HEARING'}
            value={fmtDate(disposed ? h.date_of_decision : h.date_next_list) || '—'}
            mono
          />
          {h.purpose_name && <Field label="STAGE / PURPOSE" value={h.purpose_name} />}
          {h.pet_adv && <Field label="PETITIONER ADVOCATE" value={h.pet_adv.trim()} />}
          {h.res_adv && <Field label="RESPONDENT ADVOCATE" value={h.res_adv.trim()} />}
          {h.fir_no && <Field label="FIR"
            value={`${h.fir_no}/${h.fir_year}${h.fir_details ? ` · ${h.fir_details.split('^').filter(Boolean).join(' · ')}` : ''}`} />}
        </div>

        {h.act && h.act.length > 0 ? (
          <>
            <hr className="hairline" style={{ margin: '20px 0' }} />
            <div className="col" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
                ACTS & SECTIONS
              </span>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {h.act.map((a, i) => (
                  <span key={i} className="badge" style={{ fontFamily: 'var(--font-mono)' }}>
                    {a.actCodeName.trim().replace(/\\$/, '')} §{a.actSectionName}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {h.last_business_date && h.last_business_date.showbusiness === 'Y' ? (
          <>
            <hr className="hairline" style={{ margin: '20px 0' }} />
            <div className="col" style={{ gap: 8 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
                LATEST BUSINESS
              </span>
              <div className="grid-2" style={{ gap: 24 }}>
                <Field
                  label="PURPOSE"
                  value={h.last_business_date.purpose || '—'}
                  onClick={() => liveBusinessRef.current?.trigger()}
                  title="Click to fetch live Business details from eCourts"
                />
                <Field label="BENCH" value={h.last_business_date.judge_name || '—'} />
                <Field label="BUSINESS DATE" value={h.last_business_date.todays_date1 || h.last_business_date.todays_date} mono />
                <Field
                  label="NEXT DATE"
                  value={h.last_business_date.nextdate ? fmtNextDate(h.last_business_date.nextdate) : '—'}
                  mono
                />
              </div>
              {h.last_business_date.businessStatus === 'Disposed'
                ? <span className="badge badge-sage" style={{ alignSelf: 'flex-start' }}>DISPOSED</span>
                : <span className="badge badge-amber" style={{ alignSelf: 'flex-start' }}>{h.last_business_date.businessStatus?.toUpperCase()}</span>}
              <LiveBusinessInline ref={liveBusinessRef} cino={h.cino} eager />
            </div>
          </>
        ) : null}
      </div>

      {h.historyOfCaseHearing && h.historyOfCaseHearing.length > 0
        ? <HearingsTable
            hearings={h.historyOfCaseHearing}
            orders={[...(h.interimOrder ?? []), ...(h.finalOrder ?? [])]}
            cino={h.cino}
            onPurposeClick={() => liveBusinessRef.current?.trigger()}
          />
        : null}

      {((h.finalOrder?.length ?? 0) > 0 || (h.interimOrder?.length ?? 0) > 0)
        ? <OrdersList finalOrders={h.finalOrder ?? []} interimOrders={h.interimOrder ?? []} cino={h.cino} />
        : null}

      {h.transfer && h.transfer.length > 0 ? <TransferList transfers={h.transfer} /> : null}

      <IaBusinessSection cino={h.cino} court={court} />
      <AppellateInfoSection
        stateCode={h.state_code}
        distCode={h.district_code}
        courtCode={h.court_code}
        caseNumber1={h.case_no}
        appCsNo={String(h.reg_no ?? '')}
        court={court}
      />

      <NewHearingModal
        open={hearingOpen}
        onClose={() => setHearingOpen(false)}
        defaultCase={caseTitle}
        defaultCourt={h.court_name}
      />
    </div>
  );
}

function HearingsTable({ hearings, orders, cino, onPurposeClick }: { hearings: EcourtsHearing[]; orders: EcourtsOrder[]; cino: string; onPurposeClick: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const download = useDownloadOrderPdf();
  const showToast = useUIStore((s) => s.showToast);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const handleDownload = async (o: EcourtsOrder, rowKey: string) => {
    setPendingKey(rowKey);
    try {
      const fname = await download.mutateAsync({
        cino,
        filename: o.filename,
        stateCd:   o.state_cd,
        distCd:    o.dist_cd,
        courtCode: o.court_code,
        caseNo:    o.caseno,
        cCode:     o.cCode,
        bilingualFlag: o.bilingual_flag,
      });
      showToast({ type: 'sage', text: `Downloaded ${fname}` });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not download PDF';
      showToast({ type: 'vermillion', text: msg });
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Hearings</h2>
        <span className="spacer" />
        <span className="mono tabular" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
          {hearings.length} {hearings.length === 1 ? 'ENTRY' : 'ENTRIES'}
        </span>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Date</th>
              <th>Purpose</th>
              <th>Bench</th>
              <th style={{ width: 140 }}>Next date</th>
              <th style={{ width: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {hearings.map((hr, i) => {
              // A hearing's own date is the day's "business" at the court -
              // if an order was issued that same day, surface it inline
              // rather than making the advocate hunt for it in the separate
              // Orders section below.
              const hearingDate = hr.todays_date1 || hr.todays_date;
              const matchingOrder = orders.find((o) => o.order_date1f === hearingDate);
              const isOpen = expanded === i;
              const rowKey = `hearing-${hearingDate}-${i}`;
              return (
                <Fragment key={rowKey}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : i)}
                    style={{ cursor: 'pointer' }}
                    title="Click for this hearing's full detail"
                  >
                    <td className="mono tabular" style={{ fontSize: 12 }}>{hearingDate}</td>
                    <td>
                      <span
                        style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                        title="Click to fetch live Business details from eCourts"
                        onClick={(e) => { e.stopPropagation(); onPurposeClick(); }}
                      >
                        {hr.purpose}
                      </span>
                    </td>
                    <td>{hr.judge_name}</td>
                    <td className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {hr.nextdate ? fmtNextDate(hr.nextdate) : '—'}
                    </td>
                    <td>
                      {hr.businessStatus === 'Disposed'
                        ? <span className="badge badge-sage">DISPOSED</span>
                        : <span className="badge badge-amber">{hr.businessStatus?.toUpperCase()}</span>}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={5} style={{ background: 'var(--bg-subtle)', padding: '16px 12px' }}>
                        <div className="grid-2" style={{ gap: 16 }}>
                          <Field label="COURT NO" value={hr.court_no || '—'} />
                          <Field label="CASE NUMBER" value={hr.case_number || '—'} />
                          <Field label="BUSINESS STATUS" value={hr.businessStatus || '—'} />
                          <Field label="SHOW BUSINESS" value={hr.showbusiness === 'Y' ? 'Yes' : 'No'} />
                        </div>
                        {matchingOrder ? (
                          <div className="row" style={{ marginTop: 12, gap: 12, alignItems: 'center' }}>
                            <span className="body-sm muted">Order issued this date: {matchingOrder.order_details}</span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={(e) => { e.stopPropagation(); void handleDownload(matchingOrder, rowKey); }}
                              disabled={pendingKey === rowKey}
                            >
                              {pendingKey === rowKey ? <>Fetching…</> : <><Icon name="download" size={12} /> View order</>}
                            </button>
                          </div>
                        ) : (
                          <p className="body-sm muted" style={{ marginTop: 12 }}>No order/judgment filed for this date.</p>
                        )}
                        <div onClick={(e) => e.stopPropagation()}>
                          <BusinessNoteEditor cino={cino} hearingDate={hearingDate} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// BusinessNoteEditor — manual fallback for the captcha-gated "Business" text
// (see ecourts.service.ts's listBusinessNotes doc comment for why this can't
// be fetched automatically). The advocate reads the real Daily Status page
// via "Live Business (eCourts)" above, then pastes what they read here so it
// persists in LexDraft per hearing date instead of needing the captcha again
// every time they revisit this case.
function BusinessNoteEditor({ cino, hearingDate }: { cino: string; hearingDate: string }) {
  const { data: notes } = useEcourtsBusinessNotes(cino);
  const save = useSaveEcourtsBusinessNote(cino);
  const showToast = useUIStore((s) => s.showToast);
  const existing = notes?.find((n) => n.hearingDate === hearingDate);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = () => { setDraft(existing?.businessText ?? ''); setEditing(true); };

  const handleSave = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      await save.mutateAsync({ hearingDate, businessText: text });
      setEditing(false);
      showToast({ type: 'sage', text: 'Business note saved' });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not save note';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  if (editing) {
    return (
      <div className="col" style={{ marginTop: 12, gap: 8 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
          BUSINESS NOTE (pasted from eCourts Daily Status)
        </span>
        <textarea
          className="input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste what the eCourts Daily Status page shows for this date…"
        />
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={save.isPending || !draft.trim()}>
            {save.isPending ? 'Saving…' : 'Save note'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {existing ? (
        <div className="col" style={{ gap: 4 }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            BUSINESS NOTE
          </span>
          <p className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{existing.businessText}</p>
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={startEdit}>
            Edit note
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
          + Add business note for this date
        </button>
      )}
    </div>
  );
}

function OrdersList({ finalOrders, interimOrders, cino }: { finalOrders: EcourtsOrder[]; interimOrders: EcourtsOrder[]; cino: string }) {
  const rows = [
    ...interimOrders.map((o) => ({ ...o, kind: 'Interim' as const })),
    ...finalOrders.map((o) => ({ ...o, kind: 'Final' as const })),
  ];
  const download = useDownloadOrderPdf();
  const showToast = useUIStore((s) => s.showToast);
  // Track which row is in-flight so the button on that row alone shows
  // "Fetching…"; eCourts is too slow to leave the whole table looking idle.
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const handleDownload = async (o: EcourtsOrder, kind: 'Interim' | 'Final', rowKey: string) => {
    setPendingKey(rowKey);
    try {
      const fname = await download.mutateAsync({
        cino,
        filename: o.filename,
        stateCd:   o.state_cd,
        distCd:    o.dist_cd,
        courtCode: o.court_code,
        caseNo:    o.caseno,
        cCode:     o.cCode,
        bilingualFlag: o.bilingual_flag,
      });
      showToast({ type: 'sage', text: `Downloaded ${fname}` });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not download PDF';
      showToast({ type: 'vermillion', text: msg });
    } finally {
      setPendingKey(null);
    }
    // `kind` accepted just to keep the signature parallel for future filtering;
    // currently we don't differentiate the backend call by interim/final.
    void kind;
  };

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Orders & judgments</h2>
        <span className="spacer" />
        <span className="mono tabular" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
          {rows.length} {rows.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'}
        </span>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 80 }}>Kind</th>
              <th style={{ width: 140 }}>Date</th>
              <th>Description</th>
              <th style={{ width: 140 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => {
              const rowKey = `${o.order_id}-${i}`;
              const isPending = pendingKey === rowKey;
              return (
                <tr key={rowKey}>
                  <td>
                    {o.kind === 'Final'
                      ? <span className="badge badge-sage">FINAL</span>
                      : <span className="badge">INTERIM</span>}
                  </td>
                  <td className="mono tabular" style={{ fontSize: 12 }}>{o.order_date1f}</td>
                  <td>
                    <div>{o.order_details}</div>
                    <div className="mono tabular" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4, wordBreak: 'break-all' }}>
                      {o.filename}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => { void handleDownload(o, o.kind, rowKey); }}
                      disabled={isPending}
                      title="Fetch the order PDF from the eCourts gateway"
                    >
                      {isPending ? (
                        <>Fetching…</>
                      ) : (
                        <><Icon name="download" size={12} /> Download</>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransferList({ transfers }: { transfers: NonNullable<EcourtsCaseHistory['transfer']> }) {
  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Court transfers</h2>
      </div>
      <div className="card">
        <ul className="col stagger" style={{ gap: 12, listStyle: 'none', paddingLeft: 0 }}>
          {transfers.map((t, i) => (
            <li key={i} className="body-sm">
              <span className="mono tabular" style={{ color: 'var(--text-tertiary)' }}>{t.transfer_date}</span>
              <span style={{ marginLeft: 12 }}>{t.from_court} → {t.to_court}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// IA Business - Interim Application business/status, one of the 6 endpoints
// found by re-auditing the full decompiled APK (see ecourts.service.ts).
// Renders nothing if the case has no IAs (a legitimate empty answer, not an
// error) - same "don't show a blank section" discipline as TransferList.
function IaBusinessSection({ cino, court }: { cino: string; court: Court }) {
  const { data: items, isLoading } = useEcourtsIaBusiness(cino, court);
  if (isLoading || !items || items.length === 0) return null;
  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Interim applications</h2>
      </div>
      <div className="card">
        <ul className="col stagger" style={{ gap: 12, listStyle: 'none', paddingLeft: 0 }}>
          {items.map((ia, i) => (
            <li key={i} className="body-sm">
              <span className="mono tabular" style={{ color: 'var(--text-tertiary)' }}>{ia.ia_no ?? `IA ${i + 1}`}</span>
              <span style={{ marginLeft: 12 }}>{ia.purpose || '—'}</span>
              {ia.businessStatus ? <span className="badge badge-amber" style={{ marginLeft: 12 }}>{ia.businessStatus.toUpperCase()}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Appellate info - whether this case has been through an appeal, one of the
// 6 endpoints found by re-auditing the full decompiled APK. The backend
// route needs a request body (court/case scope), so this triggers once on
// mount rather than auto-querying by CNR like IaBusinessSection. Renders
// nothing if every field besides the heading comes back empty (confirmed
// live: that's eCourts' own "no appellate activity" answer, not missing
// data) - same quiet-fail discipline as the rest of this view.
function AppellateInfoSection({
  stateCode, distCode, courtCode, caseNumber1, appCsNo, court,
}: { stateCode: number; distCode: number; courtCode: number; caseNumber1: string; appCsNo: string; court: Court }) {
  const mutation = useEcourtsAppellateInfo();
  const { mutate } = mutation;
  useEffect(() => {
    if (!caseNumber1 || !appCsNo) return;
    mutate({ stateCode, distCode, courtCode, caseNumber1, appCsNo, court });
    // Only re-fetch if the underlying case identity actually changes - not
    // on every render (mutate/mutation identity is stable from TanStack
    // Query, but included for correctness).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCode, distCode, courtCode, caseNumber1, appCsNo, court]);

  const info = mutation.data?.writInfo;
  if (!info) return null;
  const hasContent = Boolean(info.app_auth_desc || info.app_aut || info.dt_of_recp || info.dt_of_oder || info.order_brief);
  if (!hasContent) return null;

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Appellate information</h2>
      </div>
      <div className="card">
        <p className="body-sm" style={{ marginBottom: 12 }}>{info.heading}</p>
        <div className="grid-2" style={{ gap: 16 }}>
          {info.app_aut ? <Field label="APPELLATE AUTHORITY" value={info.app_aut} /> : null}
          {info.app_auth_desc ? <Field label="AUTHORITY DESCRIPTION" value={info.app_auth_desc} /> : null}
          {info.dt_of_recp ? <Field label="DATE OF RECEIPT" value={info.dt_of_recp} mono /> : null}
          {info.dt_of_oder ? <Field label="DATE OF ORDER" value={info.dt_of_oder} mono /> : null}
        </div>
        {info.order_brief ? <p className="body-sm muted" style={{ marginTop: 12 }}>{info.order_brief}</p> : null}
      </div>
    </div>
  );
}

function Field({ label, value, mono, onClick, title }: { label: string; value: string; mono?: boolean; onClick?: () => void; title?: string }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        style={{
          fontSize: 14, fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          cursor: onClick ? 'pointer' : undefined,
          textDecoration: onClick ? 'underline' : undefined,
          textDecorationStyle: onClick ? 'dotted' : undefined,
        }}
        className={mono ? 'tabular' : ''}
        onClick={onClick}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '';
  // Accept YYYY-MM-DD or DD-MM-YYYY (eCourts mixes both).
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return iso;
}

function fmtNextDate(raw: string): string {
  // Hearings sometimes deliver `20230112` (compact YYYYMMDD).
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4); const m = raw.slice(4, 6); const d = raw.slice(6, 8);
    return fmtDate(`${y}-${m}-${d}`);
  }
  return raw;
}

// =============================================================================
// ResultStatusBadge — the Next/Disposal Date + status badge the official
// eCourts app shows INLINE on every search result row (confirmed against a
// real screenshot of the app: "Oct 01 2026 / Pending / Service Pending-
// Summon" sitting right next to the case number, no click-through needed).
// This portal previously only surfaced that after opening a case via
// LiveBusinessInline below — filingCaseHistory.php (found by re-auditing the
// decompiled APK, see ecourts.service.ts) carries date_next_list/
// purpose_next keyed by the same CNR every result row already has, so this
// auto-fetches per row instead of waiting for a click.
// =============================================================================
function ResultStatusBadge({ cino, court }: { cino: string; court: Court }) {
  const { data, isLoading, isError } = useEcourtsFilingHistory(cino, court);
  if (isLoading) return <span className="body-sm muted" style={{ fontSize: 11 }}>Loading status…</span>;
  // A transient/failed fetch shouldn't block the rest of the row - the
  // advocate still has case name/number/CNR and can open the case for the
  // same data via LiveBusinessInline/View. Fail quiet, not blank-with-no-
  // explanation (the exact silent-gap pattern this feature was built to fix).
  if (isError || !data) return null;
  const disposed = Boolean(data.date_of_decision);
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {data.date_next_list ? (
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Next: {data.date_next_list}
        </span>
      ) : null}
      <span className={`badge ${disposed ? 'badge-sage' : 'badge-amber'}`} style={{ fontSize: 10 }}>
        {disposed ? 'DISPOSED' : 'PENDING'}
      </span>
    </div>
  );
}

// =============================================================================
// LiveBusinessInline — fetches the free-text "Business" narrative for ONE
// case directly by its CNR, inline on a search result row (Party Name,
// Advocate, Case Number, etc. all already return a `cino` per case from the
// fast mobile API). No state/district/complex picking - the CNR already
// encodes the court, so this is a single eCourts page (home/index) with one
// captcha. Each case looked up this way needs its own captcha solve,
// because eCourts requires one per lookup; there's no way to batch it.
// =============================================================================

type LiveBusinessInlineStep = 'idle' | 'captcha' | 'result';

type PreconnectState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'ready'; sessionId: string; captchaImageBase64: string }
  | { phase: 'failed'; error: string };

export interface LiveBusinessInlineHandle {
  /** Starts (or jumps straight to) the captcha/result flow - used so clicking a
   *  hearing row or the Latest Business purpose text can trigger the same
   *  fetch as the inline button, without duplicating the connect logic. */
  trigger: () => void;
}

const LiveBusinessInline = forwardRef<LiveBusinessInlineHandle, { cino: string; eager?: boolean }>(function LiveBusinessInline({ cino, eager = false }, ref) {
  const [step, setStep] = useState<LiveBusinessInlineStep>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [historyHtml, setHistoryHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pre-connect state: started silently on mount so the advocate's click
  // usually lands on an already-open session instead of staring at a 15-30s
  // "Connecting…" spinner they triggered themselves. eCourts' own server is
  // what's slow/occasionally unresponsive - no code change fixes that - but
  // starting the connection before the advocate asks for it means the wait
  // happens while they're reading the case, not after they've clicked.
  const [preconnect, setPreconnect] = useState<PreconnectState>(eager ? { phase: 'connecting' } : { phase: 'idle' });
  const preconnectStarted = useRef(false);
  // This genuinely takes 10-20s (launching a real headless browser session
  // against the live eCourts site) - confirmed live, not a bug. With no
  // visible progress, a static "Preparing..." label for that long reads as
  // stuck/broken rather than working (confirmed: this exact confusion is
  // what prompted this fix). A ticking elapsed-seconds counter is enough to
  // show it's actively working without implying a fake progress bar.
  const [connectingSeconds, setConnectingSeconds] = useState(0);
  useEffect(() => {
    if (preconnect.phase !== 'connecting') { setConnectingSeconds(0); return; }
    const id = setInterval(() => setConnectingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [preconnect.phase]);

  const startSession = useStartCnrLiveSession();
  const openLookup = useOpenLiveCnrLookup();
  const refreshCaptcha = useRefreshCnrCaptcha();
  const submitCaptcha = useSubmitCnrCaptcha();

  // eCourts' anti-bot defenses intermittently block or crash the connection
  // (observed live: outright 405s, page crashes, alongside genuine 15-30s
  // slow-but-working loads) - one silent retry absorbs the transient case
  // before surfacing an error for something that often just works a few
  // seconds later.
  const connect = async (isRetry = false): Promise<void> => {
    try {
      const { sessionId: id } = await startSession.mutateAsync();
      // The backend may transparently restart the session on a page crash
      // and return a different id than the one just sent - always use what
      // openLookup actually hands back for every call after this.
      const { captchaImageBase64, sessionId: finalId } = await openLookup.mutateAsync({ sessionId: id, cino });
      setPreconnect({ phase: 'ready', sessionId: finalId, captchaImageBase64 });
    } catch (err) {
      if (!isRetry) {
        await new Promise((r) => setTimeout(r, 1500));
        return connect(true);
      }
      setPreconnect({ phase: 'failed', error: errMsg(err, "eCourts is not responding right now - this can happen when their site is slow or under heavy automated-access protection. Try 'Live Business' again in a minute.") });
    }
  };

  useEffect(() => {
    // `eager` is true only on the single-case CNR detail card, not on
    // search-result rows - a results list can have dozens of cases, and
    // pre-connecting every row the moment the page renders would launch
    // that many background eCourts browser sessions for cases the advocate
    // may never click into. Non-eager rows keep today's click-to-connect.
    if (!eager || preconnectStarted.current) return;
    preconnectStarted.current = true;
    void connect();
    // Only ever run once per case card, on mount - cino doesn't change for a
    // mounted instance of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = () => {
    setError(null);
    if (preconnect.phase === 'ready') {
      setSessionId(preconnect.sessionId);
      setCaptchaImage(preconnect.captchaImageBase64);
      setStep('captcha');
      return;
    }
    // 'idle' (non-eager row, first click) or 'failed' (retry) both connect
    // fresh now - the only difference from the eager path is this request
    // happens on click instead of having already started on mount.
    setPreconnect({ phase: 'connecting' });
    void connect();
  };

  useImperativeHandle(ref, () => ({ trigger: handleStart }));

  const handleRefresh = async () => {
    if (!sessionId) return;
    try {
      const { captchaImageBase64 } = await refreshCaptcha.mutateAsync(sessionId);
      setCaptchaImage(captchaImageBase64); setCaptchaCode(''); setCaptchaError(null);
    } catch (err) {
      setError(errMsg(err, 'Could not refresh the captcha'));
    }
  };

  const handleSubmit = async () => {
    if (!sessionId) return;
    setCaptchaError(null);
    try {
      const result = await submitCaptcha.mutateAsync({ sessionId, captchaCode, cino });
      if ('retry' in result) {
        setCaptchaImage(result.captchaImageBase64); setCaptchaCode(''); setCaptchaError(result.reason);
        return;
      }
      setHistoryHtml(result.historyHtml); setStep('result');
    } catch (err) {
      setError(errMsg(err, 'Could not submit the captcha'));
    }
  };

  if (step === 'idle') {
    // Pre-connect already ran silently on mount - by the time the advocate
    // is here reading the case, the session is often already 'ready', so
    // clicking shows the captcha instantly instead of waiting live.
    const stillConnecting = preconnect.phase === 'connecting';
    return (
      <div className="col" style={{ gap: 6, alignItems: 'flex-start' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleStart} disabled={stillConnecting}>
          {stillConnecting
            ? `Connecting to eCourts… (${connectingSeconds}s - this takes ~10-20s, a real government site)`
            : <><Icon name="eye" size={12} /> Live Business (eCourts)</>}
        </button>
        {preconnect.phase === 'failed' ? (
          <p className="body-sm muted">eCourts didn't respond while preparing this - click above to try again.</p>
        ) : null}
        {error ? (
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleStart}>Retry</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 8, padding: 12, background: 'var(--bg-subtle)', borderRadius: 6 }}>
      {step === 'captcha' && captchaImage ? (
        <>
          <span className="body-sm muted">Enter the code you see: eCourts requires this before showing live details.</span>
          <img
            src={`data:image/png;base64,${captchaImage}`}
            alt="eCourts captcha"
            style={{ border: '1px solid var(--border-default)', borderRadius: 4, width: 150 }}
          />
          {captchaError ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{captchaError}</p> : null}
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ maxWidth: 160 }}
              placeholder="Captcha code"
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              autoFocus
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void handleSubmit(); }} disabled={submitCaptcha.isPending || !captchaCode}>
              {submitCaptcha.isPending ? 'Submitting…' : 'Submit'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void handleRefresh(); }} disabled={refreshCaptcha.isPending}>
              New image
            </button>
          </div>
        </>
      ) : null}
      {step === 'result' && historyHtml !== null ? (
        // eCourts' own rendered case-history markup for this CNR - a simple
        // labelled layout (Business / Next Purpose / Next Hearing Date), not
        // arbitrary third-party HTML.
        <div className="body-sm" dangerouslySetInnerHTML={{ __html: historyHtml }} />
      ) : null}
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </div>
  );
});

function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? fallback;
}
