import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  useEcourtsAdvocateCauseList,
  useEcourtsCaseTypes,
  useEcourtsCaveatHistory,
  useEcourtsCaveatSearch,
  useEcourtsPoliceStations,
  useEcourtsSearchAdvocate,
  useEcourtsSearchCaseNumber,
  useEcourtsSearchCaseType,
  useEcourtsSearchFilingNumber,
  useEcourtsSearchFir,
  useEcourtsSearchParty,
} from '@/hooks/useEcourts';
import { SearchableSelect } from '@/components/SearchableSelect';
import { EcourtsWebSearchPanel } from '@/components/ecourts/EcourtsWebSearchPanel';
import { L, useEcourtsT } from '@/hooks/useEcourtsLabels';
import { useEcourtsCourtStore } from '@/store/ecourtsCourt';
import {
  AppField,
  ComplexSelect,
  EstablishmentResults,
  FormGrid,
  GoReset,
  RadioRow,
  ScreenTitle,
  SectionBar,
  parseEstablishments,
  useComplexScope,
  type ComplexScope,
} from './AppUi';

// =============================================================================
// Case Status search screens, laid out exactly like the eCourts app:
// "Case Status : Search by …" -> Court Complex* -> the screen's fields ->
// Go | Reset -> totals -> one bar per establishment -> Sr No | Case Number |
// Party Name. Tapping a case number opens Case History in place (results
// stay behind it, as in the app's back navigation). Every search covers the
// whole court complex, as the app does.
// =============================================================================

export type AppSearchMode =
  | 'case-number' | 'party' | 'advocate' | 'fir' | 'filing' | 'caveat' | 'case-type' | 'advocate-causelist';

const TITLE: Record<AppSearchMode, { id?: number; text: string; section: 'status' | 'causelist' }> = {
  'case-number': { id: L.searchByCaseNumber, text: 'Search by Case Number', section: 'status' },
  party: { id: L.searchByPartyName, text: 'Search by Party Name', section: 'status' },
  advocate: { text: 'Search by Advocate Name', section: 'status' },
  fir: { id: L.searchByFirNumber, text: 'Search by FIR Number', section: 'status' },
  filing: { id: L.searchByFilingNumber, text: 'Search by Filing Number', section: 'status' },
  caveat: { text: 'Search by Caveat', section: 'status' },
  'case-type': { id: L.searchByCaseType, text: 'Search by Case Type', section: 'status' },
  'advocate-causelist': { text: 'Advocate\'s Cause List', section: 'causelist' },
};

type Stage = 'P' | 'D' | 'B';
type AdvocateBy = 'name' | 'bar' | 'date';

function thisYear(): string {
  return String(new Date().getFullYear());
}

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

function errorText(err: unknown): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? (err instanceof Error ? err.message : 'eCourts did not answer. Try again.');
}

export function AppSearchScreen({ mode, related = [], renderCase }: {
  mode: AppSearchMode;
  related?: ReadonlyArray<{ label: string; onClick: () => void }>;
  /** Case History for a CNR, with a back action - rendered over the results. */
  renderCase: (cnr: string, onBack: () => void) => ReactNode;
}) {
  const { t } = useEcourtsT();
  const { scope } = useComplexScope();
  const tier = useEcourtsCourtStore((s) => s.scope.court);
  const [openCnr, setOpenCnr] = useState<string | null>(null);

  // Fields, named as on the app's screens.
  const [caseType, setCaseType] = useState('');
  const [regNo, setRegNo] = useState('');
  const [partyName, setPartyName] = useState('');
  const [advocateName, setAdvocateName] = useState('');
  const [advocateBy, setAdvocateBy] = useState<AdvocateBy>(mode === 'advocate-causelist' ? 'date' : 'name');
  const [policeSt, setPoliceSt] = useState('');
  const [firNo, setFirNo] = useState('');
  const [filingNo, setFilingNo] = useState('');
  const [caveatBy, setCaveatBy] = useState<'Caveator' | 'Caveatee'>('Caveator');
  const [caveatorName, setCaveatorName] = useState('');
  const [caveateeName, setCaveateeName] = useState('');
  const [year, setYear] = useState(thisYear());
  const [date, setDate] = useState(todayIso());
  const [stage, setStage] = useState<Stage>('P');
  const [pendingDisposed, setPendingDisposed] = useState<'Pending' | 'Disposed'>('Pending');
  const [searched, setSearched] = useState<{ mode: string; header?: ReactNode; stage?: Stage } | null>(null);

  const caseTypes = useEcourtsCaseTypes(scope?.stateCode, scope?.distCode, mode === 'case-number' || mode === 'case-type' ? scope?.courtCodes : null, scope?.court);
  const stations = useEcourtsPoliceStations(scope?.stateCode, scope?.distCode, mode === 'fir' ? scope?.courtCodes : null, scope?.court);

  const searchCaseNumber = useEcourtsSearchCaseNumber();
  const searchParty = useEcourtsSearchParty();
  const searchAdvocate = useEcourtsSearchAdvocate();
  const searchFir = useEcourtsSearchFir();
  const searchFiling = useEcourtsSearchFilingNumber();
  const searchCaseType = useEcourtsSearchCaseType();
  const advocateCauseList = useEcourtsAdvocateCauseList();
  const caveatSearch = useEcourtsCaveatSearch();

  const effective: string = mode === 'advocate' && advocateBy === 'date' ? 'advocate-causelist' : mode;
  const mutation = {
    'case-number': searchCaseNumber,
    party: searchParty,
    advocate: searchAdvocate,
    fir: searchFir,
    filing: searchFiling,
    caveat: caveatSearch,
    'case-type': searchCaseType,
    'advocate-causelist': advocateCauseList,
  }[effective as AppSearchMode];

  const yearOk = /^\d{4}$/.test(year);
  const fieldsOk = (() => {
    switch (effective) {
      case 'case-number': return Boolean(caseType && regNo.trim() && yearOk);
      case 'party': return partyName.trim().length >= 3 && yearOk;
      case 'advocate': return advocateName.trim().length >= 3 && yearOk;
      case 'fir': return Boolean(policeSt && firNo.trim() && yearOk);
      case 'filing': return Boolean(filingNo.trim() && yearOk);
      case 'caveat': return Boolean(caveatorName.trim() || caveateeName.trim());
      case 'case-type': return Boolean(caseType && yearOk);
      case 'advocate-causelist': return advocateName.trim().length >= 3 && Boolean(date);
      default: return false;
    }
  })();

  const reset = () => {
    setCaseType(''); setRegNo(''); setPartyName(''); setAdvocateName(''); setPoliceSt('');
    setFirNo(''); setFilingNo(''); setCaveatorName(''); setCaveateeName('');
    setYear(thisYear()); setDate(todayIso()); setStage('P'); setPendingDisposed('Pending');
    setSearched(null);
    mutation?.reset();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!scope || !fieldsOk || !mutation) return;
    const base = {
      stateCode: scope.stateCode, distCode: scope.distCode, courtCode: scope.courtCode,
      courtCodes: scope.courtCodes, estCode: scope.estCode, court: scope.court,
    };
    const yr = Number(year);
    setOpenCnr(null);
    switch (effective) {
      case 'case-number':
        searchCaseNumber.mutate({ ...base, caseType, regNo: regNo.trim(), year: yr });
        setSearched({ mode: effective });
        break;
      // Both are fetched and Pending / Disposed is applied to the rows (the
      // app service answers reliably for 'B'; a decided case carries its
      // date_of_decision).
      case 'party':
        searchParty.mutate({ ...base, partyName: partyName.trim(), year: yr, stage: 'B' });
        setSearched({ mode: effective, stage });
        break;
      case 'advocate':
        searchAdvocate.mutate({ ...base, advocateName: advocateName.trim(), year: yr, stage: 'B' });
        setSearched({ mode: effective, stage, header: <span className="body-md">{t(L.advocate, 'Advocate')}: {advocateName.trim().toUpperCase()}</span> });
        break;
      case 'fir':
        searchFir.mutate({ ...base, policeStCode: Number(policeSt), firNo: firNo.trim(), firYear: yr });
        setSearched({ mode: effective });
        break;
      case 'filing':
        searchFiling.mutate({ ...base, filingNo: filingNo.trim(), filingYear: yr });
        setSearched({ mode: effective });
        break;
      case 'caveat':
        caveatSearch.mutate({ ...base, caveatorName: caveatorName.trim() || undefined, caveateeName: caveateeName.trim() || undefined, searchBy: caveatBy });
        setSearched({ mode: effective });
        break;
      case 'case-type':
        searchCaseType.mutate({ ...base, caseType, year: yr, status: pendingDisposed });
        setSearched({ mode: effective });
        break;
      case 'advocate-causelist': {
        const [y, m, d] = date.split('-');
        const dmy = `${d}-${m}-${y}`;
        advocateCauseList.mutate({ ...base, advocateName: advocateName.trim(), date: dmy });
        setSearched({
          mode: effective,
          header: (
            <>
              <span className="body-md">{t(L.caseListDate, 'Advocate\'s Cause list')}: {dmy}</span>
              <span className="body-md">{t(L.advocate, 'Advocate')}: {advocateName.trim().toUpperCase()}</span>
            </>
          ),
        });
        break;
      }
    }
  };

  const title = TITLE[mode];
  const section = title.section === 'status' ? t(L.caseStatus, 'Case Status') : t(L.causeList, 'Cause List');
  const yearInput = (label = t(L.year, 'Year')) => (
    <AppField label={label} required>
      <input className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
    </AppField>
  );
  const stageRadios = (
    <RadioRow<Stage>
      name={`${mode}-stage`}
      value={stage}
      onChange={setStage}
      options={[
        { value: 'P', label: t(L.pending, 'Pending') },
        { value: 'D', label: t(L.disposed, 'Disposed') },
        { value: 'B', label: t(L.both, 'Both') },
      ]}
    />
  );
  const caseTypeSelect = (
    <AppField label={t(L.caseType, 'Case Type')} required>
      {caseTypes.data && caseTypes.data.length > 0 ? (
        <SearchableSelect
          value={caseType}
          onChange={setCaseType}
          placeholder={t(L.selectCaseType, 'Select case type')}
          options={caseTypes.data.map((c) => ({ value: c.code, label: c.name }))}
        />
      ) : (
        <select className="input" disabled value="">
          <option value="">{!scope ? 'Select court complex first' : caseTypes.isFetching ? 'Loading…' : caseTypes.isError ? 'eCourts did not answer' : t(L.selectCaseType, 'Select case type')}</option>
        </select>
      )}
    </AppField>
  );

  const showForm = !(mode === 'advocate' && advocateBy === 'bar');

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* Case History opens over the results, which stay as they were. */}
      {openCnr ? renderCase(openCnr, () => setOpenCnr(null)) : null}

      <div className="col" style={{ gap: 16, display: openCnr ? 'none' : undefined }}>
        <div className="card col" style={{ gap: 16 }}>
          <ScreenTitle section={section} title={title.id ? t(title.id, title.text) : title.text} />

          {mode === 'advocate' ? (
            <RadioRow<AdvocateBy>
              name="advocate-by"
              label={t(L.searchBy, 'Search By')}
              value={advocateBy}
              onChange={(v) => { setAdvocateBy(v); setSearched(null); }}
              options={[
                { value: 'name', label: t(L.advocateName, 'Advocate Name') },
                { value: 'bar', label: t(L.barCode, 'Bar Code') },
                { value: 'date', label: t(L.dateCaseList, 'Date Case List') },
              ]}
            />
          ) : null}

          {showForm ? (
            <form onSubmit={onSubmit} className="col" style={{ gap: 16 }}>
              <FormGrid>
                <ComplexSelect />
                {effective === 'case-number' ? (
                  <>
                    {caseTypeSelect}
                    <AppField label={t(L.caseNumber, 'Case Number')} required>
                      <input className="input" value={regNo} inputMode="numeric" onChange={(e) => setRegNo(e.target.value.replace(/[^\dA-Za-z]/g, ''))} />
                    </AppField>
                    {yearInput()}
                  </>
                ) : null}
                {effective === 'party' ? (
                  <>
                    <AppField label={t(L.petRes, 'Petitioner/Respondent')} required>
                      <input className="input" value={partyName} maxLength={99} placeholder="At least 3 letters" onChange={(e) => setPartyName(e.target.value)} />
                    </AppField>
                    {yearInput(t(L.registrationYear, 'Registration Year'))}
                  </>
                ) : null}
                {effective === 'advocate' ? (
                  <>
                    <AppField label={t(L.advocateName, 'Advocate Name')} required>
                      <input className="input" value={advocateName} maxLength={99} placeholder="At least 3 letters" onChange={(e) => setAdvocateName(e.target.value)} />
                    </AppField>
                    {yearInput()}
                  </>
                ) : null}
                {effective === 'advocate-causelist' ? (
                  <>
                    <AppField label={t(L.advocateName, 'Advocate Name')} required>
                      <input className="input" value={advocateName} maxLength={99} placeholder="At least 3 letters" onChange={(e) => setAdvocateName(e.target.value)} />
                    </AppField>
                    <AppField label={t(L.caseListDate, 'Case List Date')} required>
                      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </AppField>
                  </>
                ) : null}
                {effective === 'fir' ? (
                  <>
                    <AppField label={t(L.policeStation, 'Police Station')} required>
                      {stations.data && stations.data.length > 0 ? (
                        <SearchableSelect
                          value={policeSt}
                          onChange={setPoliceSt}
                          placeholder="Select police station"
                          options={stations.data.map((p) => ({ value: p.code, label: p.name }))}
                        />
                      ) : (
                        <select className="input" disabled value="">
                          <option value="">{!scope ? 'Select court complex first' : stations.isFetching ? 'Loading…' : 'Select police station'}</option>
                        </select>
                      )}
                    </AppField>
                    <AppField label={t(L.firNumber, 'FIR Number')} required>
                      <input className="input" value={firNo} onChange={(e) => setFirNo(e.target.value.replace(/[^\dA-Za-z/-]/g, ''))} />
                    </AppField>
                    {yearInput()}
                  </>
                ) : null}
                {effective === 'filing' ? (
                  <>
                    <AppField label={t(L.filingNumber, 'Filing Number')} required>
                      <input className="input" inputMode="numeric" value={filingNo} onChange={(e) => setFilingNo(e.target.value.replace(/\D/g, ''))} />
                    </AppField>
                    {yearInput()}
                  </>
                ) : null}
                {effective === 'case-type' ? (
                  <>
                    {caseTypeSelect}
                    {yearInput()}
                  </>
                ) : null}
                {effective === 'caveat' ? (
                  <>
                    <AppField label={t(L.searchType, 'Search Type')} required>
                      <select className="input" value={caveatBy} onChange={(e) => setCaveatBy(e.target.value as 'Caveator' | 'Caveatee')}>
                        <option value="Caveator">{t(L.caveator, 'Caveator')}</option>
                        <option value="Caveatee">{t(L.caveatee, 'Caveatee')}</option>
                      </select>
                    </AppField>
                    <AppField label="Caveator Name" required={caveatBy === 'Caveator'}>
                      <input className="input" maxLength={99} value={caveatorName} placeholder="Enter caveator name" onChange={(e) => setCaveatorName(e.target.value)} />
                    </AppField>
                    <AppField label="Caveatee Name" required={caveatBy === 'Caveatee'}>
                      <input className="input" maxLength={99} value={caveateeName} placeholder="Enter caveatee name" onChange={(e) => setCaveateeName(e.target.value)} />
                    </AppField>
                  </>
                ) : null}
              </FormGrid>

              {effective === 'party' || effective === 'advocate' ? stageRadios : null}
              {effective === 'case-type' ? (
                <RadioRow<'Pending' | 'Disposed'>
                  name="case-type-status"
                  value={pendingDisposed}
                  onChange={setPendingDisposed}
                  options={[{ value: 'Pending', label: t(L.pending, 'Pending') }, { value: 'Disposed', label: t(L.disposed, 'Disposed') }]}
                />
              ) : null}

              <GoReset disabled={!scope || !fieldsOk} pending={mutation?.isPending} onReset={reset} />
              {!scope ? (
                <p className="body-sm muted">
                  {tier === 'HC'
                    ? 'Select the High Court and bench above.'
                    : 'Select the state and district above, then the court complex.'}
                </p>
              ) : null}
            </form>
          ) : (
            <EcourtsWebSearchPanel key="advocate-bar" sections={['advocate-bar']} title="Advocate Bar Code" onOpenCnr={setOpenCnr} />
          )}

          {related.length > 0 ? (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {related.map((r) => (
                <button key={r.label} type="button" className="btn btn-ghost btn-sm" onClick={r.onClick}>{r.label} →</button>
              ))}
            </div>
          ) : null}
        </div>

        {showForm && searched && mutation?.isPending ? (
          <div className="card">
            <p className="body-md">Searching eCourts…</p>
            <p className="body-sm muted">eCourts can take 20–30 seconds for a whole court complex.</p>
          </div>
        ) : null}

        {showForm && searched && mutation?.isError ? (
          <div className="card"><p className="body-md" style={{ color: 'var(--danger)' }}>{errorText(mutation.error)}</p></div>
        ) : null}

        {showForm && searched && mutation?.isSuccess ? (
          <div className="card">
            <SearchResults mode={searched.mode as AppSearchMode} data={mutation.data} header={searched.header} stage={searched.stage} onOpenCase={setOpenCnr} scope={scope} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SearchResults({ mode, data, header, stage, onOpenCase, scope }: {
  mode: AppSearchMode;
  data: unknown;
  header?: ReactNode;
  stage?: Stage;
  onOpenCase: (cnr: string) => void;
  scope: ComplexScope | null;
}) {
  const obj = data as Record<string, unknown> | null;
  if (obj && obj.status === 'N') {
    return <p className="body-md muted">{String(obj.msg ?? 'No cases found.')}</p>;
  }
  if (mode === 'caveat') return <CaveatResults data={data} scope={scope} />;
  const { establishments } = parseEstablishments(data);
  if (establishments.length > 0 || mode !== 'advocate-causelist') {
    return <EstablishmentResults data={data} onOpenCase={onOpenCase} extraHeader={header} stage={stage} />;
  }
  // Advocate's cause list answered as a flat list.
  const list = (Array.isArray(obj?.causeList) ? obj!.causeList : Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
  return (
    <div className="col" style={{ gap: 8 }}>
      {header}
      <span className="body-md" style={{ fontWeight: 700 }}>Total Number of Cases: {list.length}</span>
      {list.length > 0 ? (
        <table className="tbl">
          <thead><tr><th>Case Number</th><th>Party Name</th><th>Court Name</th></tr></thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i}>
                <td>{String(r.case_no ?? r.case_number ?? '—')}</td>
                <td>{String(r.petparty_name ?? r.pet_name ?? '')}{r.resparty_name || r.res_name ? <><br /><span className="muted">vs</span><br />{String(r.resparty_name ?? r.res_name)}</> : null}</td>
                <td>{String(r.court_name ?? r.court_no ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/** Caveat results as in the app: Caveat No | Matched Case No | Date of
 *  Filing | Caveator/Caveatee Details, per establishment; tap a caveat
 *  number for its Caveat Details. */
function CaveatResults({ data, scope }: { data: unknown; scope: ComplexScope | null }) {
  const { t } = useEcourtsT();
  const { establishments, searched } = parseEstablishments(data);
  const [open, setOpen] = useState<number | null>(() => {
    const i = establishments.findIndex((e) => e.rows.length > 0);
    return i >= 0 ? i : null;
  });
  const [detail, setDetail] = useState<string | null>(null);
  const total = establishments.reduce((n, e) => n + e.rows.length, 0);
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).replace(/<br\s*\/?>/gi, ', ').trim());
  return (
    <div className="col" style={{ gap: 10 }}>
      <span className="body-md">{t(L.totalEstablishments, 'Total Number of Establishments in Court Complex')}: {searched ?? establishments.length}</span>
      <span className="body-md" style={{ fontWeight: 700 }}>{t(L.totalCases, 'Total Number of Cases')}: {total}</span>
      {establishments.map((e, i) => e.rows.length === 0 ? null : (
        <div key={i} className="col">
          <SectionBar title={`${e.name} : ${e.rows.length}`} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          {open === i ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t(L.caveatNumber, 'Caveat No.')}</th>
                    <th>{t(L.matchedCaseNumber, 'Matched Case No.')}</th>
                    <th>{t(L.dateOfFiling, 'Date of Filing')}</th>
                    <th>{t(L.caveatorCaveateeDetails, 'Caveator/Caveatee Details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {e.rows.map((r, j) => {
                    const no = s(r.caveat_no ?? r.caveatno) + (r.caveat_year ? `/${s(r.caveat_year)}` : '');
                    const parties = [s(r.caveator_name ?? r.caveatorName ?? r.pet_name), s(r.caveatee_name ?? r.caveateeName ?? r.res_name)].filter(Boolean).join(' / ');
                    return (
                      <tr key={j}>
                        <td>
                          {r.caveat_no ? (
                            <button type="button" onClick={() => setDetail(detail === s(r.caveat_no) ? null : s(r.caveat_no))} style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 600 }}>
                              {no}
                            </button>
                          ) : no || '—'}
                          {detail === s(r.caveat_no) && scope ? <CaveatDetail caveatNumber={s(r.caveat_no)} scope={scope} /> : null}
                        </td>
                        <td>{s(r.matched_case_no ?? r.case_no ?? r.matchedCaseNo) || '-'}</td>
                        <td>{s(r.dt_filing ?? r.date_of_filing ?? r.filing_date) || '—'}</td>
                        <td>{parties || s(r.extra_party) || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ))}
      {total === 0 ? <p className="body-md muted">No caveats found.</p> : null}
    </div>
  );
}

function CaveatDetail({ caveatNumber, scope }: { caveatNumber: string; scope: ComplexScope }) {
  const q = useEcourtsCaveatHistory();
  const { mutate } = q;
  useEffect(() => {
    mutate({ stateCode: scope.stateCode, distCode: scope.distCode, courtCode: scope.courtCode, caveatNumber, court: scope.court });
  }, [mutate, caveatNumber, scope.stateCode, scope.distCode, scope.courtCode, scope.court]);
  if (q.isPending || q.isIdle) return <div className="body-sm muted">Loading…</div>;
  const h = q.data?.history;
  if (!h) return <div className="body-sm muted">No further detail on record.</div>;
  return (
    <div className="body-sm" style={{ marginTop: 6 }}>
      {h.caveatorDetails.caveator_name ? <div>Caveator: {h.caveatorDetails.caveator_name}</div> : null}
      {h.caveateeDetails.caveatee_name ? <div>Caveatee: {h.caveateeDetails.caveatee_name}</div> : null}
      {h.caveatDetails.subject ? <div>Subject: {h.caveatDetails.subject}</div> : null}
    </div>
  );
}
