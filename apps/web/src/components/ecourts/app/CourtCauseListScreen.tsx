import { useMemo, useState } from 'react';
import { useEcourtsCourtCauseList, useEcourtsJudgeBenches } from '@/hooks/useEcourts';
import { L, useEcourtsT } from '@/hooks/useEcourtsLabels';
import { AppField, ComplexSelect, FormGrid, ScreenTitle, TextSearchBox, useComplexScope } from './AppUi';

// The eCourts app's Cause List ("Cause list / Daily Board"): Court Complex*
// -> Court Name* -> Causelist Date* -> [Civil] [Criminal]. The list shows the
// judge, "Civil Cases Listed on dd-mm-yyyy", a text search, and Sr No | Case
// Number | Party Name | Advocate grouped under each purpose - as the app
// renders it (cases_new.php; no captcha).

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}

const strip = (v: unknown) => String(v ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();

export function CourtCauseListScreen({ onOpenCase, extra }: { onOpenCase?: (cnr: string) => void; extra?: React.ReactNode }) {
  const { t } = useEcourtsT();
  const { scope } = useComplexScope();
  const [bench, setBench] = useState('');
  const [date, setDate] = useState(todayIso());
  // High Courts list the benches sitting on the chosen date.
  const benches = useEcourtsJudgeBenches(scope?.stateCode, scope?.distCode, scope?.courtCodes ?? null, scope?.court, date);
  const hc = scope?.court === 'HC';
  const [filter, setFilter] = useState('');
  const list = useEcourtsCourtCauseList();

  const picked = benches.data?.find((b) => `${b.code}^${b.courtNo ?? ''}` === bench);
  const ready = Boolean(scope && picked?.courtNo && date);

  const run = (kind: 'civil' | 'criminal') => {
    if (!scope || !picked?.courtNo) return;
    setFilter('');
    list.mutate({ stateCode: scope.stateCode, distCode: scope.distCode, courtCode: Number(picked.code), courtNo: picked.courtNo, kind, date, court: scope.court });
  };

  // Group rows under their purpose, like the app's sub-headings.
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out: Array<{ heading: string; rows: Array<Record<string, unknown>> }> = [];
    for (const r of list.data?.rows ?? []) {
      const text = [r.case_number, r.cause_title, r.main_advocate_names, r.purpose_name].map(strip).join(' ').toLowerCase();
      if (q && !text.includes(q)) continue;
      const heading = strip(r.purpose_name) || '';
      let g = out.find((x) => x.heading === heading);
      if (!g) { g = { heading, rows: [] }; out.push(g); }
      g.rows.push(r);
    }
    return out;
  }, [list.data, filter]);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card col" style={{ gap: 16 }}>
        <ScreenTitle section={t(L.causeList, 'Cause List')} title={t(L.dailyBoard, 'Daily Board')} />
        <FormGrid>
          <ComplexSelect />
          <AppField label={t(L.courtName, 'Court Name')} required>
            <select className="input" value={bench} disabled={!scope || benches.isFetching} onChange={(e) => setBench(e.target.value)}>
              <option value="">
                {!scope
                  ? (hc ? 'Select the High Court and bench above' : 'Select court complex first')
                  : benches.isFetching ? 'Loading…'
                  : hc && benches.data && benches.data.filter((b) => b.courtNo).length === 0 ? 'No benches listed on this date'
                  : t(L.selectCourtNumber, 'Select court name')}
              </option>
              {(benches.data ?? []).filter((b) => b.courtNo).map((b) => (
                <option key={`${b.code}^${b.courtNo}`} value={`${b.code}^${b.courtNo ?? ''}`}>
                  {b.courtNo}-{b.judgeName}{b.designation ? `-${b.designation}` : ''}
                </option>
              ))}
            </select>
          </AppField>
          <AppField label={t(L.causeListDate, 'Causelist Date')} required>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </AppField>
        </FormGrid>
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn btn-primary btn-lg" style={{ minWidth: 120 }} disabled={!ready || list.isPending} onClick={() => run('civil')}>
            {t(L.civil, 'Civil')}
          </button>
          <button type="button" className="btn btn-primary btn-lg" style={{ minWidth: 120 }} disabled={!ready || list.isPending} onClick={() => run('criminal')}>
            {t(L.criminal, 'Criminal')}
          </button>
        </div>
        {benches.isError ? <p className="body-sm muted">eCourts did not return the court names for this complex.</p> : null}
        <p className="body-sm muted">{t(L.causeListDisclaimer, 'Cause list displayed may differ from the actual cause list. For further queries, contact court administrator.')}</p>
        {extra}
      </div>

      {list.isPending ? <div className="card"><p className="body-md muted">Getting the cause list from eCourts…</p></div> : null}
      {list.isError ? (
        <div className="card">
          <p className="body-md" style={{ color: 'var(--danger)' }}>
            {(list.error as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'eCourts did not answer. Try again.'}
          </p>
        </div>
      ) : null}

      {list.data ? (
        <div className="card col" style={{ gap: 10 }}>
          <div className="col" style={{ gap: 2, alignItems: 'center', textAlign: 'center' }}>
            <span className="body-md" style={{ fontWeight: 600 }}>{list.data.judgeName}</span>
            <span className="body-md">{list.data.designation}</span>
            <span className="body-md">{list.data.heading}</span>
          </div>
          {list.data.rows.length > 0 ? <TextSearchBox value={filter} onChange={setFilter} /> : null}
          {list.data.rows.length === 0 ? (
            <p className="body-md muted" style={{ textAlign: 'center' }}>No cases are listed in this court on this date.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>{t(L.srNo, 'Sr No')}</th>
                    <th>{t(L.caseNumber, 'Case Number')}</th>
                    <th>{t(L.partyName, 'Party Name')}</th>
                    <th>{t(L.advocate, 'Advocate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, gi) => (
                    <FragmentRows key={gi} heading={g.heading} rows={g.rows} onOpenCase={onOpenCase} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data.causeListUrl ? (
            <a className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} href={list.data.causeListUrl} target="_blank" rel="noreferrer">
              View cause list ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FragmentRows({ heading, rows, onOpenCase }: { heading: string; rows: Array<Record<string, unknown>>; onOpenCase?: (cnr: string) => void }) {
  return (
    <>
      {heading ? (
        <tr>
          <td colSpan={4} style={{ fontWeight: 700, background: 'var(--bg-surface-2)' }}>{heading}</td>
        </tr>
      ) : null}
      {rows.map((r, i) => {
        const parties = strip(r.cause_title).split('\n').map((s) => s.trim()).filter(Boolean);
        const advocates = [strip(r.main_advocate_names), strip(r.main_advocate_names_extra)].filter(Boolean).join('\n');
        const cnr = String(r.cino ?? r.cnr ?? '').toUpperCase();
        return (
          <tr key={i}>
            <td className="tabular">{strip(r.sr_no) || i + 1}{String(r.urgent ?? '') === 'Y' ? ' ⚑' : ''}</td>
            <td>
              {onOpenCase && /^[A-Z]{4}[A-Z0-9]{12}$/.test(cnr) ? (
                <button type="button" onClick={() => onOpenCase(cnr)} style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 600 }}>
                  {strip(r.case_number)}
                </button>
              ) : <span style={{ fontWeight: 600 }}>{strip(r.case_number) || '—'}</span>}
              {strip(r.time_slot_name) ? <div className="body-sm muted">{strip(r.time_slot_name)}</div> : null}
            </td>
            <td style={{ whiteSpace: 'pre-line' }}>{parties.join('\n') || '—'}{strip(r.cause_title_extra) ? `\n${strip(r.cause_title_extra)}` : ''}</td>
            <td style={{ whiteSpace: 'pre-line' }}>{advocates || '—'}</td>
          </tr>
        );
      })}
    </>
  );
}
