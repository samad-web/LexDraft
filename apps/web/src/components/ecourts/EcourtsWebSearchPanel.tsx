import { useState, type FormEvent } from 'react';
import { SearchableSelect } from '@/components/SearchableSelect';
import {
  useEcourtsActs,
  useEcourtsCaseTypes,
  useEcourtsOrdersByParty,
  useRefreshEcourtsWebSearchCaptcha,
  useStartEcourtsWebSearch,
  useSubmitEcourtsWebSearch,
  type EcourtsWebSearchChoice,
  type EcourtsWebSearchFields,
  type EcourtsWebSearchResult,
  type OrdersByPartyResult,
} from '@/hooks/useEcourts';
import { useEcourtsCourtStore } from '@/store/ecourtsCourt';
import { CourtScopePicker, EMPTY_COURT_SCOPE, courtScopeReady, type CourtScopeValue } from './CourtScopePicker';
import { OrdersByPartyResults } from './OrdersByPartyResults';
import { ProcessDetailsPanel } from './ProcessDetailsPanel';
import { WebSearchResults } from './WebSearchResults';

/** Searches served by the eCourts mobile API - no captcha. The website
 *  (captcha) version stays available as a fallback. */
const NO_CAPTCHA_KINDS: ReadonlySet<string> = new Set(['orders-party']);

// Searches that only the eCourts WEBSITE offers. Each needs the advocate to
// read a CAPTCHA once; LexDraft runs the rest of the site's flow.

type Kind = EcourtsWebSearchFields['kind'];
type Section = Kind | 'process';
type OrderType = 'both' | 'finalorder' | 'interim';
type Status = 'Pending' | 'Disposed' | 'Both';

const SECTIONS: ReadonlyArray<{ id: Section; label: string; blurb: string }> = [
  { id: 'party-status',  label: 'Party (pending/disposed)', blurb: 'Party-name search with the Pending / Disposed filter the regular search can\'t apply.' },
  { id: 'advocate-name', label: 'Advocate (pending/disposed)', blurb: 'Advocate-name search with the Pending / Disposed filter.' },
  { id: 'advocate-bar',  label: 'Advocate (Bar no.)', blurb: 'Cases of an advocate by Bar Council registration, e.g. KL / 1234 / 2010. More precise than name search.' },
  { id: 'advocate-causelist', label: 'Advocate\'s Cause List', blurb: 'Every case of an advocate listed in this court on a date, by Bar Council registration (7 days back to 1 month ahead).' },
  { id: 'case-type',     label: 'Case type',         blurb: 'Every pending or disposed case of one type and year in a court.' },
  { id: 'act',           label: 'Act',               blurb: 'Cases filed under an act (and optionally a section).' },
  { id: 'cause-list',    label: 'Cause list',        blurb: 'The civil or criminal cause list of one court for a date (up to a month ahead).' },
  { id: 'orders-party',  label: 'Orders · party',    blurb: 'Court orders and judgments by party name and year. No captcha: fetched through the eCourts app service.' },
  { id: 'orders-case',   label: 'Orders · case no.', blurb: 'Court orders and judgments for one case number.' },
  { id: 'orders-date',   label: 'Orders · date',     blurb: 'All orders a court passed between two dates.' },
  { id: 'orders-court',  label: 'Orders · court no.', blurb: 'Orders passed by one court / judge. Pick the court after the captcha loads.' },
  { id: 'process',       label: 'Process details',   blurb: 'Summons, warrants and notices by process ID. eCourts sends a verification code to the process recipient.' },
];

const STATUS_KINDS: Kind[] = ['party-status', 'advocate-name', 'advocate-bar', 'case-type', 'act'];
const BOTH_ALLOWED: Kind[] = ['party-status', 'advocate-name', 'advocate-bar'];
const ORDER_KINDS: Kind[] = ['orders-party', 'orders-case', 'orders-date', 'orders-court'];

function toDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}-${m}-${y}` : '';
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? (err instanceof Error ? err.message : fallback);
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="col" style={{ gap: 4 }}>
    <span className="body-sm muted">{label}</span>
    {children}
  </label>
);

export type WebSearchSection = Section;

interface PanelProps {
  onOpenCnr: (cnr: string) => void;
  /** Which searches this panel offers (sub-tabs when more than one). */
  sections?: ReadonlyArray<Section>;
  initialSection?: Section;
  title?: string;
  /** Short explanation under the title. */
  intro?: string;
}

export function EcourtsWebSearchPanel({ onOpenCnr, sections, initialSection, title, intro }: PanelProps) {
  const offered = sections ? SECTIONS.filter((s) => sections.includes(s.id)) : SECTIONS;
  const [section, setSection] = useState<Section>(initialSection ?? offered[0]?.id ?? 'party-status');
  // Shared with every other eCourts search and remembered between visits.
  const sharedScope = useEcourtsCourtStore((s) => s.scope);
  const setSharedScope = useEcourtsCourtStore((s) => s.setScope);
  // Tier always follows the page's District Court | High Court switch.
  const [scope, setScopeLocal] = useState<CourtScopeValue>(
    sharedScope.stateCode === '' ? { ...EMPTY_COURT_SCOPE, court: sharedScope.court } : sharedScope,
  );
  const setScope = (v: CourtScopeValue) => {
    setScopeLocal(v);
    setSharedScope(v);
  };
  const thisYear = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);

  const [caseType, setCaseType] = useState('');
  const [actCode, setActCode] = useState('');
  const [section_, setSectionNo] = useState('');
  const [year, setYear] = useState(String(thisYear));
  const [status, setStatus] = useState<Status>('Pending');
  const [barState, setBarState] = useState('');
  const [barCode, setBarCode] = useState('');
  const [barYear, setBarYear] = useState('');
  const [name, setName] = useState('');
  const [regNo, setRegNo] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [listDate, setListDate] = useState(today);
  const [listType, setListType] = useState<'civ' | 'cri'>('civ');
  const [orderType, setOrderType] = useState<OrderType>('both');

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState('');
  const [choice, setChoice] = useState<EcourtsWebSearchChoice | null>(null);
  const [picked, setPicked] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<EcourtsWebSearchResult | null>(null);
  const [ordersResult, setOrdersResult] = useState<OrdersByPartyResult | null>(null);
  // Advocate chose the eCourts website (captcha) instead of the direct search.
  const [useWebsite, setUseWebsite] = useState(false);

  const ordersByParty = useEcourtsOrdersByParty();
  const start = useStartEcourtsWebSearch();
  const submit = useSubmitEcourtsWebSearch();
  const refresh = useRefreshEcourtsWebSearchCaptcha();

  const kind = section === 'process' ? null : section;
  const needsCaseType = kind === 'case-type' || kind === 'orders-case';
  const caseTypes = useEcourtsCaseTypes(scope.stateCode, scope.distCode, needsCaseType ? scope.courtCode : null, scope.court);
  const acts = useEcourtsActs(scope.stateCode, scope.distCode, kind === 'act' ? scope.courtCode : null, scope.court);
  const caseTypeName = caseTypes.data?.find((t) => t.code === caseType)?.name;
  const actName = acts.data?.find((a) => a.code === actCode)?.name;

  const reset = (): void => {
    setSessionId(null);
    setCaptchaImg(null);
    setCaptcha('');
    setChoice(null);
    setPicked('');
    setResult(null);
    setOrdersResult(null);
    setMessage(null);
  };

  const yr = Number(year);
  const validYear = /^\d{4}$/.test(year);
  const fieldsReady = ((): boolean => {
    switch (kind) {
      case 'case-type': return Boolean(caseType) && validYear;
      case 'advocate-bar': return /^[A-Za-z]{1,4}$/.test(barState) && /^\d+$/.test(barCode) && /^\d{4}$/.test(barYear);
      case 'advocate-name': return name.trim().length >= 3;
      case 'advocate-causelist':
        return /^[A-Za-z]{1,4}$/.test(barState) && /^\d+$/.test(barCode) && /^\d{4}$/.test(barYear)
          && Boolean(listDate) && listDate >= addDays(today, -7) && listDate <= addDays(today, 31);
      case 'party-status': return name.trim().length >= 3 && validYear;
      case 'act': return Boolean(actCode);
      case 'orders-party': return name.trim().length >= 3 && validYear;
      case 'orders-case': return Boolean(caseType) && /^\d+$/.test(regNo) && validYear;
      case 'orders-date': return Boolean(fromDate && toDate) && fromDate <= toDate && toDate <= today;
      case 'orders-court': return true;
      case 'cause-list': return Boolean(listDate) && listDate >= addDays(today, -30) && listDate <= addDays(today, 30);
      default: return false;
    }
  })();
  const direct = kind !== null && NO_CAPTCHA_KINDS.has(kind) && !useWebsite;
  // The website flow selects the court complex on the site itself; the
  // direct (app service) search only needs the court.
  const scopeReady = direct
    ? courtScopeReady(scope)
    : courtScopeReady(scope) && scope.complexCode.length > 0 && scope.court === 'DC';
  const statusValue = (s: Status): 'Pending' | 'Disposed' => (s === 'Disposed' ? 'Disposed' : 'Pending');

  const buildFields = (): EcourtsWebSearchFields | null => {
    switch (kind) {
      case 'case-type': return { kind, caseTypeCode: caseType, caseTypeName, year: yr, status: statusValue(status) };
      case 'advocate-bar': return { kind, barState: barState.toUpperCase(), barCode, barYear, status };
      case 'advocate-name': return { kind, advocateName: name.trim(), status };
      case 'advocate-causelist': return { kind, barState: barState.toUpperCase(), barCode, barYear, date: toDdMmYyyy(listDate) };
      case 'party-status': return { kind, partyName: name.trim(), year: yr, status };
      case 'act': return { kind, actCode, actName, section: section_.trim() || undefined, status: statusValue(status) };
      case 'orders-party': return { kind, partyName: name.trim(), year: yr, orderType };
      case 'orders-case': return { kind, caseTypeCode: caseType, caseTypeName, regNo, year: yr, orderType };
      case 'orders-date': return { kind, fromDate: toDdMmYyyy(fromDate), toDate: toDdMmYyyy(toDate), orderType };
      case 'orders-court': return { kind, orderType };
      case 'cause-list': return { kind, date: toDdMmYyyy(listDate), listType };
      default: return null;
    }
  };

  const onStart = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const fields = buildFields();
    if (!scopeReady || !fieldsReady || !fields) return;
    reset();
    if (direct && fields.kind === 'orders-party') {
      ordersByParty.mutate(
        {
          stateCode: Number(scope.stateCode),
          distCode: Number(scope.distCode),
          courtCode: Number(scope.courtCode),
          estCode: scope.estCode.trim(),
          partyName: fields.partyName,
          year: fields.year,
          orderType: fields.orderType,
          court: scope.court,
        },
        {
          onSuccess: setOrdersResult,
          onError: (err) => setMessage(errorText(err, 'eCourts did not answer the search')),
        },
      );
      return;
    }
    start.mutate(
      {
        scope: {
          stateCode: Number(scope.stateCode),
          distCode: Number(scope.distCode),
          complexCode: scope.complexCode,
          courtCode: Number(scope.courtCode),
        },
        fields,
      },
      {
        onSuccess: (r) => {
          setSessionId(r.sessionId);
          setCaptchaImg(r.captchaImageBase64);
          setChoice(r.choice ?? null);
        },
        onError: (err) => setMessage(errorText(err, 'Could not open the eCourts search')),
      },
    );
  };

  const onSubmitCaptcha = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!sessionId || !captcha.trim() || (choice && !picked)) return;
    setMessage(null);
    submit.mutate(
      { sessionId, captchaCode: captcha.trim(), choice: picked || undefined },
      {
        onSuccess: (r) => {
          setCaptcha('');
          if (r.status === 'retry') {
            setCaptchaImg(r.captchaImageBase64);
            setMessage(r.reason);
          } else {
            setResult(r.result);
            setCaptchaImg(null);
          }
        },
        onError: (err) => setMessage(errorText(err, 'eCourts did not answer the search')),
      },
    );
  };

  const copy = SECTIONS.find((k) => k.id === section)!;
  const needsCaptcha = section === 'process' || !(kind && NO_CAPTCHA_KINDS.has(kind) && !useWebsite);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="card">
        <div className="col" style={{ gap: 16 }}>
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="heading-sm">{title ?? copy.label}</div>
              {needsCaptcha ? <span className="badge badge-amber">Captcha</span> : <span className="badge badge-sage">Instant</span>}
            </div>
            <p className="body-sm muted" style={{ maxWidth: 680 }}>
              {intro ?? (offered.length > 1 ? '' : copy.blurb)}
              {needsCaptcha && section !== 'process'
                ? ' This one runs on the eCourts website, which shows a captcha: type the characters once and LexDraft does the rest. District courts only.'
                : ''}
            </p>
          </div>

          {offered.length > 1 ? (
            <div className="row" role="tablist" style={{ gap: 6, flexWrap: 'wrap' }}>
              {offered.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="tab"
                  aria-selected={section === k.id}
                  className={`btn btn-sm${section === k.id ? ' btn-primary' : ''}`}
                  onClick={() => { setSection(k.id); reset(); }}
                >
                  {/* Inside "Orders & judgments" the prefix is redundant. */}
                  {k.label.replace(/^Orders · /, 'By ')}
                </button>
              ))}
            </div>
          ) : null}
          {offered.length > 1 ? <p className="body-sm muted">{copy.blurb}</p> : null}

          {section === 'process' ? (
            <ProcessDetailsPanel />
          ) : (
            <>
              <form onSubmit={onStart} className="col" style={{ gap: 14 }}>
                <CourtScopePicker hideTier value={scope} onChange={(v) => { setScope(v); setCaseType(''); setActCode(''); reset(); }} />
                {scope.court === 'HC' && !direct ? <p className="body-sm" style={{ color: 'var(--warning)' }}>These searches are for district courts only.</p> : null}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                  {needsCaseType ? (
                    <Field label={`Case type${caseTypes.isFetching ? ' · loading…' : ''}`}>
                      <SearchableSelect
                        value={caseType}
                        onChange={setCaseType}
                        disabled={!courtScopeReady(scope)}
                        placeholder={courtScopeReady(scope) ? 'Search case types…' : 'Select a court first'}
                        options={(caseTypes.data ?? []).map((t) => ({ value: t.code, label: t.name }))}
                      />
                    </Field>
                  ) : null}
                  {kind === 'act' ? (
                    <>
                      <Field label={`Act${acts.isFetching ? ' · loading…' : ''}`}>
                        <SearchableSelect
                          value={actCode}
                          onChange={setActCode}
                          disabled={!courtScopeReady(scope)}
                          placeholder={courtScopeReady(scope) ? 'Search acts…' : 'Select a court first'}
                          options={(acts.data ?? []).map((a) => ({ value: a.code, label: a.name }))}
                        />
                      </Field>
                      <Field label="Section (optional)">
                        <input className="input" value={section_} maxLength={40} onChange={(e) => setSectionNo(e.target.value)} />
                      </Field>
                    </>
                  ) : null}
                  {kind === 'orders-case' ? (
                    <Field label="Registration number">
                      <input className="input" value={regNo} inputMode="numeric" onChange={(e) => setRegNo(e.target.value.replace(/\D/g, ''))} />
                    </Field>
                  ) : null}
                  {kind === 'party-status' || kind === 'orders-party' ? (
                    <Field label="Party name">
                      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="At least 3 letters" />
                    </Field>
                  ) : null}
                  {kind === 'advocate-name' ? (
                    <Field label="Advocate name">
                      <input className="input" value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z ._]/g, ''))} placeholder="At least 3 letters" />
                    </Field>
                  ) : null}
                  {kind === 'advocate-bar' || kind === 'advocate-causelist' ? (
                    <>
                      <Field label="Bar state code">
                        <input className="input" value={barState} maxLength={4} placeholder="e.g. KL" onChange={(e) => setBarState(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())} />
                      </Field>
                      <Field label="Registration no.">
                        <input className="input" value={barCode} inputMode="numeric" onChange={(e) => setBarCode(e.target.value.replace(/\D/g, ''))} />
                      </Field>
                      <Field label="Enrolment year">
                        <input className="input" value={barYear} inputMode="numeric" maxLength={4} onChange={(e) => setBarYear(e.target.value.replace(/\D/g, ''))} />
                      </Field>
                    </>
                  ) : null}
                  {kind === 'case-type' || kind === 'party-status' || kind === 'orders-party' || kind === 'orders-case' ? (
                    <Field label="Year">
                      <input className="input" value={year} inputMode="numeric" maxLength={4} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} />
                    </Field>
                  ) : null}
                  {kind === 'orders-date' ? (
                    <>
                      <Field label="From">
                        <input className="input" type="date" value={fromDate} max={today} onChange={(e) => setFromDate(e.target.value)} />
                      </Field>
                      <Field label="To">
                        <input className="input" type="date" value={toDate} max={today} onChange={(e) => setToDate(e.target.value)} />
                      </Field>
                    </>
                  ) : null}
                  {kind === 'advocate-causelist' ? (
                    <Field label="Cause list date">
                      <input className="input" type="date" value={listDate} min={addDays(today, -7)} max={addDays(today, 31)} onChange={(e) => setListDate(e.target.value)} />
                    </Field>
                  ) : null}
                  {kind === 'cause-list' ? (
                    <>
                      <Field label="Date">
                        <input className="input" type="date" value={listDate} min={addDays(today, -30)} max={addDays(today, 30)} onChange={(e) => setListDate(e.target.value)} />
                      </Field>
                      <Field label="List">
                        <select className="input" value={listType} onChange={(e) => setListType(e.target.value as 'civ' | 'cri')}>
                          <option value="civ">Civil</option>
                          <option value="cri">Criminal</option>
                        </select>
                      </Field>
                    </>
                  ) : null}
                  {kind && STATUS_KINDS.includes(kind) ? (
                    <Field label="Cases">
                      <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                        <option value="Pending">Pending</option>
                        <option value="Disposed">Disposed</option>
                        {BOTH_ALLOWED.includes(kind) ? <option value="Both">Both</option> : null}
                      </select>
                    </Field>
                  ) : null}
                  {kind && ORDER_KINDS.includes(kind) ? (
                    <Field label="Orders">
                      <select className="input" value={orderType} onChange={(e) => setOrderType(e.target.value as OrderType)}>
                        <option value="both">Interim and final</option>
                        <option value="finalorder">Final orders / judgments</option>
                        <option value="interim">Interim orders</option>
                      </select>
                    </Field>
                  ) : null}
                </div>

                <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  {direct ? (
                    <button type="submit" className="btn btn-primary" disabled={!scopeReady || !fieldsReady || ordersByParty.isPending}>
                      {ordersByParty.isPending ? 'Searching eCourts…' : 'Search'}
                    </button>
                  ) : (
                    <button type="submit" className="btn btn-primary" disabled={!scopeReady || !fieldsReady || start.isPending}>
                      {start.isPending ? 'Opening eCourts…' : 'Continue to captcha'}
                    </button>
                  )}
                  {kind && NO_CAPTCHA_KINDS.has(kind) ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setUseWebsite((v) => !v); reset(); }}>
                      {useWebsite ? 'Search without captcha instead' : 'Use the eCourts website instead (captcha)'}
                    </button>
                  ) : null}
                </div>
              </form>

              {captchaImg && sessionId ? (
                <form onSubmit={onSubmitCaptcha} className="col" style={{ gap: 12 }}>
                  {choice ? (
                    <div style={{ maxWidth: 480 }}>
                      <Field label={choice.label}>
                        <SearchableSelect
                          value={picked}
                          onChange={setPicked}
                          placeholder={`Search ${choice.label.toLowerCase()}…`}
                          options={choice.options.map((o) => ({ value: o.value, label: o.label }))}
                        />
                      </Field>
                    </div>
                  ) : null}
                  <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <img src={`data:image/png;base64,${captchaImg}`} alt="eCourts captcha" style={{ border: '1px solid var(--border)', borderRadius: 6 }} />
                    <input
                      className="input mono"
                      value={captcha}
                      autoFocus
                      placeholder="Type the characters"
                      onChange={(e) => setCaptcha(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                      style={{ width: 180 }}
                    />
                    <button type="submit" className="btn btn-primary" disabled={!captcha || (choice !== null && !picked) || submit.isPending}>
                      {submit.isPending ? 'Searching…' : 'Search'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={refresh.isPending}
                      onClick={() => refresh.mutate(sessionId, {
                        onSuccess: (r) => setCaptchaImg(r.captchaImageBase64),
                        onError: (err) => setMessage(errorText(err, 'Could not load a new captcha')),
                      })}
                    >
                      New captcha
                    </button>
                  </div>
                </form>
              ) : null}

              {message ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{message}</p> : null}
            </>
          )}
        </div>
      </div>

      {result && section !== 'process' ? <WebSearchResults result={result} onOpenCnr={onOpenCnr} /> : null}
      {ordersResult && section === 'orders-party' ? <OrdersByPartyResults result={ordersResult} onOpenCnr={onOpenCnr} /> : null}
    </div>
  );
}
