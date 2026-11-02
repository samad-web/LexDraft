import { useEffect, useRef, useState } from 'react';
import { PortalModal, PortalTable } from '@/components/efiling/PortalKit';
import {
  portalError, useCaseFilingEfile, useCaseFilingList, useCaseFilingListAction, useCaseFilingPdf, useCaseFilingStep, useCaseFilingSuggest,
  type CaseFilingAction, type CaseFilingButton, type CaseFilingField, type CaseFilingRow, type CaseFilingScreen, type CaseFilingTab,
  type CaseFilingWizard, type CaseListActionResult, type CaseListKey, type FieldValue, type PortalTableData, type WizardStep,
} from '@/hooks/efiling/caseFiling';

// =============================================================================
// Case Filing on the eFiling portal, live: the portal's own New Case Filing
// page (its tabs, fields, buttons and lists, in its order, with its labels
// and its validation messages), its Draft Cases / eFiled Cases lists, and
// Manage Favourite Clients. Every step happens on the portal over the
// advocate's session; what is shown is what the portal shows afterwards.
// Monochrome; red only for a tab the portal marked as having a mandatory issue.
// =============================================================================

type View = 'new_case' | 'draft_cases' | 'filed_cases' | 'clients';

export function PortalCaseFiling({ sessionId, view }: { sessionId: string; view: View }) {
  if (view === 'new_case') return <Wizard key="new_case" sessionId={sessionId} screen="new_case" fresh />;
  if (view === 'draft_cases') return <CaseList key="draft" sessionId={sessionId} list="draft" />;
  if (view === 'filed_cases') return <CaseList key="filed" sessionId={sessionId} list="filed" />;
  return <FavouriteClients sessionId={sessionId} />;
}

// ---- the wizard / form screen ------------------------------------------------------

// The portal's own words before "eFile Case" (litigant.js submitEfileData).
const EFILE_CONFIRM = 'Do you want to submit the case? \n Once submitted, case details can not be modfied.';
// dashboard.js's delete confirm.
const DELETE_CONFIRM = 'Want to delete?';

interface Confirm { title: string; text: string; go: () => void }

function Wizard({ sessionId, screen, initial, pdeNo, fresh }: {
  sessionId: string; screen: CaseFilingScreen; initial?: CaseFilingWizard; pdeNo?: string | null; fresh?: boolean;
}) {
  const step = useCaseFilingStep(sessionId);
  const efile = useCaseFilingEfile(sessionId);
  const [wiz, setWiz] = useState<CaseFilingWizard | null>(initial ?? null);
  const [edits, setEdits] = useState<Record<string, string | boolean>>({});
  const [said, setSaid] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [efiled, setEfiled] = useState<string | null>(null);

  const ref = { ...(screen === 'clients' ? { screen } : {}), pdeNo: screen === 'new_case' ? (wiz?.pdeNo ?? pdeNo ?? null) : undefined };
  const run = async (s: WizardStep, clear: string[] = []) => {
    setFailed(null);
    try {
      const r = await step.mutateAsync(s);
      setWiz(r.wizard);
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !clear.includes(k))));
      const labels = new Map(r.wizard.tabs.flatMap((t) => t.sections ?? []).flatMap((x) => x.fields).map((f) => [f.key, f.label]));
      setSaid([...r.portal, ...(r.notApplied ?? []).map((n) => `${labels.get(n.key) || n.key}: ${n.reason}`)]);
    } catch (err) {
      setFailed(portalError(err, 'The portal did not answer. Try again.'));
    }
  };
  useEffect(() => {
    if (!initial) void run({ op: 'open', body: { ...(screen === 'clients' ? { screen } : {}), pdeNo: pdeNo ?? undefined, fresh } });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once, as the menu item does
  }, []);

  if (!wiz) {
    return failed
      ? <p className="body-sm">{failed} <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run({ op: 'open', body: { ...(screen === 'clients' ? { screen } : {}), fresh } })}>Try again</button></p>
      : <p className="body-sm muted">Opening {screen === 'clients' ? 'Manage Favourite Clients' : 'New Case Filing'} on filing.ecourts.gov.in…</p>;
  }

  const tab = wiz.tabs.find((t) => t.key === wiz.tab);
  const fields = (tab?.sections ?? []).flatMap((s) => s.fields);
  const pending = (): FieldValue[] => fields.filter((f) => f.key in edits).map((f) => ({ key: f.key, value: edits[f.key]! }));
  const busy = step.isPending || efile.isPending;

  const onField = (f: CaseFilingField, value: string | boolean) => {
    // Fields the page reacts to go to the portal at once, so its cascade runs there.
    if (f.live) void run({ op: 'fields', body: { ...ref, tab: wiz.tab, values: [{ key: f.key, value }] } }, [f.key]);
    else setEdits((e) => ({ ...e, [f.key]: value }));
  };
  const onButton = (b: CaseFilingButton) => {
    const values = pending();
    const keys = values.map((v) => v.key);
    if (b.kind === 'save') return void run({ op: 'save', body: { ...ref, tab: wiz.tab, values } }, keys);
    if (b.kind === 'efile') {
      return setConfirm({
        title: b.text, text: EFILE_CONFIRM,
        go: async () => {
          setConfirm(null);
          setFailed(null);
          try {
            const r = await efile.mutateAsync(wiz.pdeNo!);
            setSaid(r.portal);
            if (r.ok) setEfiled(r.pdeNo);
            else if (r.wizard) setWiz(r.wizard);
          } catch (err) {
            setFailed(portalError(err, 'The portal did not answer "eFile Case".'));
          }
        },
      });
    }
    if (b.kind === 'delete') {
      return setConfirm({ title: b.text, text: `${b.text}? The portal removes it.`, go: () => { setConfirm(null); void run({ op: 'button', body: { ...ref, tab: wiz.tab, key: b.key, text: b.text, values, confirmed: true } }, keys); } });
    }
    void run({ op: 'button', body: { ...ref, tab: wiz.tab, key: b.key, text: b.text, values } }, keys);
  };
  const onPartyAction = (list: 'parties' | 'prev_parties' | 'lh_parties', cells: string[], a: CaseFilingAction) => {
    const body = { pdeNo: wiz.pdeNo, list, match: cells.slice(0, 2), action: a.label };
    if (a.kind === 'delete') setConfirm({ title: a.label, text: DELETE_CONFIRM, go: () => { setConfirm(null); void run({ op: 'party', body: { ...body, confirmed: true } }); } });
    else void run({ op: 'party', body });
  };

  if (efiled) {
    return (
      <div className="col" style={{ gap: 10 }} role="status">
        <h3 style={{ margin: 0 }}>Case eFiled on the portal</h3>
        <p className="body-sm">e-filing number {efiled}. It is now in eFiled Cases.</p>
        {said.length ? <PortalSaid lines={said} /> : null}
      </div>
    );
  }

  const visibleTabs = wiz.tabs.filter((t) => t.present && t.shown);
  return (
    <div className="col" style={{ gap: 14 }} aria-busy={busy}>
      {screen === 'new_case' && (wiz.caseTitle || wiz.pdeNo) ? (
        <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '10px 14px', border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)' }}>
          <strong style={{ fontSize: 16 }}>{wiz.caseTitle}</strong>
          {wiz.pdeNo ? <span className="body-sm">Temporary e-filing number: <strong>{wiz.pdeNo}</strong></span> : null}
        </div>
      ) : null}
      <div className="row" role="tablist" style={{ gap: 4, flexWrap: 'wrap', padding: 4, background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)' }}>
        {visibleTabs.map((t) => (
          <TabButton key={t.key} t={t} active={t.key === wiz.tab} busy={busy} onClick={() => void run({ op: 'tab', body: { ...ref, tab: t.key } })} />
        ))}
      </div>
      {wiz.notice ? <p className="body-sm" style={{ fontWeight: 700, margin: 0 }}>{wiz.notice}</p> : null}
      {busy ? <p className="body-sm muted" style={{ margin: 0 }}>Working on filing.ecourts.gov.in…</p> : null}
      {failed ? <p className="body-sm" role="alert" style={{ margin: 0 }}>{failed}</p> : null}
      {said.length ? <PortalSaid lines={said} /> : null}

      {tab ? (
        <div className="col" style={{ gap: 16 }}>
          {(tab.sections ?? []).map((s, i) => (
            <section key={`${s.title}-${i}`} className="col" style={{ gap: 10 }}>
              {s.title ? <h4 style={{ margin: 0, fontSize: 17 }}>{s.title}</h4> : null}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px 18px' }}>
                {s.fields.map((f) => (
                  <FieldBox key={f.key} f={f} value={f.key in edits ? edits[f.key]! : f.kind === 'checkbox' ? !!f.checked : f.value} busy={busy}
                    onChange={(v) => onField(f, v)} sessionId={sessionId} pdeNo={wiz.pdeNo} tab={wiz.tab}
                    onPicked={(term, index) => void run({ op: 'pick', body: { pdeNo: wiz.pdeNo, tab: wiz.tab, key: f.key, term, index } }, [f.key])} />
                ))}
              </div>
            </section>
          ))}
          {(tab.lists ?? []).map((l) => (
            <section key={l.key} className="col" style={{ gap: 8 }}>
              <h4 style={{ margin: 0, fontSize: 17 }}>{l.title}{l.total != null ? ` (${l.total})` : ''}</h4>
              <ActionTable headers={l.table.headers} rows={l.table.rows} busy={busy} onAction={(cells, a) => onPartyAction(l.key, cells, a)} />
            </section>
          ))}
          {tab.key === 'efile' ? <EfileSummary tab={tab} allowed={wiz.efileAllowed} /> : null}
          {tab.buttons?.length ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              {tab.buttons.map((b) => (
                <button key={b.key} type="button" disabled={busy || b.disabled || (b.kind === 'efile' && (!wiz.pdeNo || !wiz.efileAllowed))}
                  className={b.kind === 'save' || b.kind === 'efile' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'} onClick={() => onButton(b)}>{b.text}</button>
              ))}
            </div>
          ) : null}
          {!tab.enabled ? <p className="body-sm muted">The portal opens this tab after the earlier tabs are saved.</p> : null}
        </div>
      ) : null}

      {confirm ? (
        <PortalModal level={3} title={confirm.title} onClose={() => setConfirm(null)}>
          <p style={{ whiteSpace: 'pre-line', fontSize: 16 }}>{confirm.text}</p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={confirm.go}>OK</button>
          </div>
        </PortalModal>
      ) : null}
    </div>
  );
}

function TabButton({ t, active, busy, onClick }: { t: CaseFilingTab; active: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} aria-disabled={!t.enabled} disabled={busy || (!t.enabled && !active)} onClick={onClick}
      title={t.error ? 'The portal marked this tab: fill what it needs, then eFile again' : t.enabled ? undefined : 'The portal opens this tab after the earlier tabs are saved'}
      style={{
        padding: '8px 16px', fontSize: 15, cursor: t.enabled ? 'pointer' : 'not-allowed', borderRadius: 3,
        border: `1px solid ${t.error ? 'var(--danger)' : 'var(--border-default)'}`,
        background: active ? 'var(--bg-inverse)' : 'var(--bg-surface)',
        color: t.error ? 'var(--danger)' : active ? 'var(--text-inverse)' : 'inherit',
        opacity: t.enabled || active ? 1 : 0.45,
      }}>{t.label}</button>
  );
}

function PortalSaid({ lines }: { lines: string[] }) {
  return (
    <div role="status" style={{ border: '1px solid var(--border-default)', padding: '8px 12px', background: 'var(--bg-surface-2)' }}>
      <span className="body-sm" style={{ fontWeight: 700 }}>The portal says:</span>
      {lines.map((l, i) => <p key={i} className="body-sm" style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{l}</p>)}
    </div>
  );
}

/** One portal field: its label (with its * when required), its control, its message. */
function FieldBox({ f, value, busy, onChange, sessionId, pdeNo, tab, onPicked }: {
  f: CaseFilingField; value: string | boolean; busy: boolean; onChange: (v: string | boolean) => void;
  sessionId: string; pdeNo: string | null; tab: CaseFilingWizard['tab']; onPicked: (term: string, index: number) => void;
}) {
  const id = `cf-${f.key.replace(/[^\w-]/g, '_')}`;
  const off = busy || f.disabled || f.readOnly;
  const wide = f.kind === 'textarea';
  const label = <>{f.required ? '* ' : ''}{f.label}</>;
  let control: React.ReactNode;
  if (f.kind === 'select') {
    control = (
      <select id={id} className="input" value={String(value)} disabled={off} onChange={(e) => onChange(e.target.value)}>
        {(f.options ?? []).map((o, i) => <option key={`${o.value}-${i}`} value={o.value} disabled={o.disabled}>{o.text}</option>)}
      </select>
    );
  } else if (f.kind === 'radio') {
    control = (
      <div role="radiogroup" aria-labelledby={`${id}-l`} className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        {(f.options ?? []).map((o) => (
          <label key={o.value} className="row body-sm" style={{ gap: 6, alignItems: 'center' }}>
            <input type="radio" name={id} value={o.value} checked={String(value) === o.value} disabled={off || o.disabled} onChange={() => onChange(o.value)} />{o.text}
          </label>
        ))}
      </div>
    );
  } else if (f.kind === 'checkbox') {
    return (
      <label className="row body-sm" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={value === true} disabled={off} onChange={(e) => onChange(e.target.checked)} />{label}
        {f.error ? <FieldError text={f.error} /> : null}
      </label>
    );
  } else if (f.suggest) {
    control = <SuggestBox id={id} f={f} value={String(value)} busy={off} onChange={onChange} sessionId={sessionId} pdeNo={pdeNo} tab={tab} onPicked={onPicked} />;
  } else if (f.kind === 'textarea') {
    control = <textarea id={id} className="input" rows={4} value={String(value)} disabled={off} maxLength={f.maxLength ?? undefined} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  } else {
    control = (
      <input id={id} className="input" type={f.kind === 'date' ? 'text' : f.kind} value={String(value)} disabled={off} maxLength={f.maxLength ?? undefined}
        placeholder={f.kind === 'date' ? 'dd-mm-yyyy' : f.placeholder} onChange={(e) => onChange(e.target.value)} />
    );
  }
  return (
    <div className="col" style={{ gap: 4, gridColumn: wide ? '1 / -1' : undefined }}>
      <label id={`${id}-l`} htmlFor={f.kind === 'radio' ? undefined : id} className="body-sm" style={{ fontWeight: 700 }}>{label}</label>
      {control}
      {f.error ? <FieldError text={f.error} /> : null}
    </div>
  );
}

function FieldError({ text }: { text: string }) {
  return <span className="body-sm" role="alert" style={{ fontWeight: 700 }}>{text}</span>;
}

/** Act / section box: the portal's suggestions after 3 letters (its autocomplete's min_length), picked as on the portal. */
function SuggestBox({ id, f, value, busy, onChange, sessionId, pdeNo, tab, onPicked }: {
  id: string; f: CaseFilingField; value: string; busy: boolean; onChange: (v: string) => void;
  sessionId: string; pdeNo: string | null; tab: CaseFilingWizard['tab']; onPicked: (term: string, index: number) => void;
}) {
  const suggest = useCaseFilingSuggest(sessionId);
  const [items, setItems] = useState<{ term: string; list: string[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const type = (v: string) => {
    onChange(v);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) { setItems(null); return; }
    timer.current = setTimeout(() => {
      suggest.mutate({ pdeNo, tab, key: f.key, term: v }, { onSuccess: (r) => setItems({ term: v, list: r.items }) });
    }, 400);
  };
  return (
    <div style={{ position: 'relative' }}>
      <input id={id} className="input" value={value} disabled={busy} placeholder={f.placeholder} autoComplete="off" onChange={(e) => type(e.target.value)} />
      {suggest.isPending ? <span className="body-sm muted">Asking the portal…</span> : null}
      {items && items.list.length ? (
        <ul role="listbox" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', maxHeight: 240, overflowY: 'auto' }}>
          {items.list.map((it, i) => (
            <li key={`${it}-${i}`} role="option" aria-selected={false}>
              <button type="button" onClick={() => { onPicked(items.term, i); setItems(null); }}
                style={{ width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-default)', color: 'inherit', cursor: 'pointer' }}>{it}</button>
            </li>
          ))}
        </ul>
      ) : items ? <span className="body-sm muted">The portal has no match.</span> : null}
    </div>
  );
}

/** e-File tab: what each tab saved, as the portal summarises it. */
function EfileSummary({ tab, allowed }: { tab: CaseFilingTab; allowed: boolean }) {
  return (
    <div className="col" style={{ gap: 12 }}>
      {(tab.summary ?? []).map((s) => (
        <section key={s.title} className="col" style={{ gap: 6 }}>
          <h4 style={{ margin: 0, fontSize: 17 }}>{s.title}</h4>
          {s.tables.map((t, i) => <PortalTable key={i} headers={t.headers} rows={t.rows} />)}
          {s.text ? <p className="body-sm" style={{ margin: 0 }}>{s.text}</p> : null}
        </section>
      ))}
      {!allowed ? <p className="body-sm">This case was filed by another advocate: the portal does not let you eFile it here.</p> : null}
    </div>
  );
}

// ---- lists ---------------------------------------------------------------------------

/** A portal table with its row buttons in the cells where the portal has them. */
function ActionTable({ headers, rows, busy, onAction }: {
  headers: string[]; rows: CaseFilingRow[]; busy?: boolean; onAction: (cells: string[], a: CaseFilingAction) => void;
}) {
  const cols = Math.max(headers.length, ...rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', whiteSpace: 'pre-line', fontSize: 14 };
  let n = 0;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {headers.length ? (
          <thead><tr>{headers.map((h, i) => <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 15 }}>{h}</th>)}</tr></thead>
        ) : null}
        <tbody>
          {rows.map((r, i) => {
            if ('group' in r) return <tr key={i}><td colSpan={cols} style={{ ...td, textAlign: 'left', fontWeight: 700, background: 'var(--bg-surface-2)' }}>{r.group}</td></tr>;
            n += 1;
            return (
              <tr key={i} style={{ background: n % 2 ? 'var(--bg-surface-2)' : undefined }}>
                {r.cells.map((c, j) => {
                  const acts = (r.actions ?? []).filter((a) => a.cell === j || (a.cell < 0 && j === r.cells.length - 1));
                  const lines = c.split('\n').filter((l) => l && !acts.some((a) => a.label === l));
                  return (
                    <td key={j} style={td}>
                      {lines.join('\n')}
                      {acts.length ? (
                        <span className="row" style={{ gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: lines.length ? 6 : 0 }}>
                          {acts.map((a) => (
                            <button key={a.label} type="button" disabled={busy} onClick={() => onAction(r.cells, a)}
                              style={{ background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{a.label}</button>
                          ))}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const pagerBtn = (on: boolean): React.CSSProperties => ({
  padding: '6px 14px', border: 'none', borderLeft: '1px solid var(--border-default)', cursor: 'pointer', fontWeight: 600,
  background: on ? 'var(--bg-inverse)' : 'var(--bg-surface-2)', color: on ? 'var(--text-inverse)' : 'inherit',
});

/** Draft Cases / eFiled Cases / favourite clients: the portal's Search, its server pages, its rows and buttons. */
function CaseList({ sessionId, list, onEdit }: { sessionId: string; list: CaseListKey; onEdit?: (r: CaseListActionResult) => void }) {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const q = useCaseFilingList(sessionId, list, { page, search });
  const act = useCaseFilingListAction(sessionId, list);
  const pdf = useCaseFilingPdf(sessionId);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [opened, setOpened] = useState<{ title: string; result: CaseListActionResult } | null>(null);
  const [pdfOf, setPdfOf] = useState<string | null>(null);
  const [said, setSaid] = useState<string[]>([]);
  const data = q.data;
  const busy = act.isPending || pdf.isPending || q.isFetching;

  const doAction = async (cells: string[], a: CaseFilingAction, confirmed = false) => {
    setSaid([]);
    try {
      const r = await act.mutateAsync({ match: cells.slice(0, 2), action: a.label, confirmed, page, search });
      setSaid(r.portal);
      if (r.kind === 'pdf' && r.pdeNo) { setPdfOf(r.pdeNo); pdf.mutate(r.pdeNo); return; }
      if (r.kind === 'edit' && onEdit) { onEdit(r); return; }
      if (r.kind === 'open' || r.kind === 'status' || r.kind === 'other' || r.kind === 'edit') setOpened({ title: r.kind === 'open' ? 'New Case Filing' : a.label, result: r });
    } catch (err) {
      setSaid([portalError(err, 'The portal did not answer. Try again.')]);
    }
  };
  const onAction = (cells: string[], a: CaseFilingAction) => {
    if (a.kind === 'delete') setConfirm({ title: a.label, text: DELETE_CONFIRM, go: () => { setConfirm(null); void doAction(cells, a, true); } });
    else void doAction(cells, a);
  };
  const closePdf = () => { if (pdf.data) URL.revokeObjectURL(pdf.data.url); setPdfOf(null); pdf.reset(); };
  const pages = data?.pages ?? 1;
  const go = (p: number) => setPage(Math.min(Math.max(1, p), pages));
  const hasSearch = list !== 'clients';

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {hasSearch ? (
          <span className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input aria-label="Search" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 240 }}
              onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(draft.trim()); setPage(1); } }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearch(draft.trim()); setPage(1); }}>Search</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(''); setSearch(''); setPage(1); }}>Clear</button>
          </span>
        ) : <span />}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void q.refetch()} disabled={busy}>{q.isFetching ? 'Reading…' : 'Refresh from portal'}</button>
      </div>
      {q.isLoading ? <p className="body-sm muted">Opening {data?.label ?? 'the list'} on filing.ecourts.gov.in…</p> : null}
      {q.isError ? <p className="body-sm">{portalError(q.error, 'Could not open this list on the portal.')}</p> : null}
      {said.length ? <PortalSaid lines={said} /> : null}
      {data ? (
        data.error && !data.rows.length ? <p className="body-sm">{data.error}</p>
          : data.rows.length ? <ActionTable headers={data.headers} rows={data.rows} busy={busy} onAction={onAction} />
            : <p className="body-sm muted">{search ? 'No matching entries.' : `No ${data.label.toLowerCase()} on your portal account.`}</p>
      ) : null}
      {data && (pages > 1 || data.info) ? (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="body-sm">{data.info}</span>
          {pages > 1 ? (
            <span className="row" style={{ border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden' }}>
              <button type="button" style={pagerBtn(false)} disabled={page === 1 || busy} onClick={() => go(1)}>First</button>
              <button type="button" style={pagerBtn(false)} disabled={page === 1 || busy} onClick={() => go(page - 1)}>Prev</button>
              {Array.from({ length: pages }, (_, i) => i + 1).filter((p) => Math.abs(p - page) < 3).map((p) => (
                <button key={p} type="button" style={pagerBtn(p === page)} aria-current={p === page ? 'page' : undefined} disabled={busy} onClick={() => go(p)}>{p}</button>
              ))}
              <button type="button" style={pagerBtn(false)} disabled={page >= pages || busy} onClick={() => go(page + 1)}>Next</button>
              <button type="button" style={pagerBtn(false)} disabled={page >= pages || busy} onClick={() => go(pages)}>Last</button>
            </span>
          ) : null}
        </div>
      ) : null}

      {opened ? (
        <PortalModal title={opened.result.wizard?.pdeNo ? `${opened.title} - ${opened.result.wizard.pdeNo}` : opened.title} onClose={() => { setOpened(null); void q.refetch(); }}>
          {opened.result.wizard
            ? <Wizard sessionId={sessionId} screen={opened.result.wizard.screen} initial={opened.result.wizard} pdeNo={opened.result.wizard.pdeNo} />
            : <OpenedView text={opened.result.text ?? ''} tables={opened.result.tables ?? []} />}
        </PortalModal>
      ) : null}
      {pdfOf ? (
        <PortalModal level={2} title={pdfOf} onClose={closePdf}>
          {pdf.isPending ? <p className="body-sm muted">Opening the case PDF on filing.ecourts.gov.in…</p> : null}
          {pdf.isError ? <p className="body-sm">{portalError(pdf.error, 'The portal did not make the case PDF.')} <button type="button" className="btn btn-ghost btn-sm" onClick={() => pdf.mutate(pdfOf)}>Try again</button></p> : null}
          {pdf.data ? (
            <div className="col" style={{ gap: 10 }}>
              <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <a className="btn btn-ghost btn-sm" href={pdf.data.url} target="_blank" rel="noreferrer">Open in new tab</a>
                <a className="btn btn-ghost btn-sm" href={pdf.data.url} download={pdf.data.name}>Download</a>
              </span>
              <iframe title={pdfOf} src={pdf.data.url} style={{ width: '100%', height: '78vh', border: '1px solid var(--border-default)' }} />
            </div>
          ) : null}
        </PortalModal>
      ) : null}
      {confirm ? (
        <PortalModal level={3} title={confirm.title} onClose={() => setConfirm(null)}>
          <p style={{ fontSize: 16 }}>{confirm.text}</p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={confirm.go}>OK</button>
          </div>
        </PortalModal>
      ) : null}
    </div>
  );
}

function OpenedView({ text, tables }: { text: string; tables: PortalTableData[] }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      {text ? <p className="body-sm" style={{ whiteSpace: 'pre-line' }}>{text}</p> : null}
      {tables.map((t, i) => <PortalTable key={i} headers={t.headers} rows={t.rows} />)}
      {!text && !tables.length ? <p className="body-sm muted">The portal showed nothing for this.</p> : null}
    </div>
  );
}

// ---- Manage Favourite Clients ------------------------------------------------------

/** The page's two tabs: "Add Client" (Client / Organization forms) and its client list. */
function FavouriteClients({ sessionId }: { sessionId: string }) {
  const [tab, setTab] = useState<'form' | 'list'>('form');
  // A client's Edit fills the form on the portal: show that form.
  const [edited, setEdited] = useState<{ n: number; wizard: CaseFilingWizard } | null>(null);
  const tabStyle = (on: boolean): React.CSSProperties => ({
    padding: '8px 18px', fontSize: 16, cursor: 'pointer', border: '1px solid var(--border-default)', borderRadius: 3,
    background: on ? 'var(--bg-inverse)' : 'var(--bg-surface)', color: on ? 'var(--text-inverse)' : 'inherit',
  });
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" role="tablist" style={{ gap: 4, padding: 4, background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)' }}>
        <button type="button" role="tab" aria-selected={tab === 'form'} style={tabStyle(tab === 'form')} onClick={() => setTab('form')}>{edited ? 'Update Client' : 'Add Client'}</button>
        <button type="button" role="tab" aria-selected={tab === 'list'} style={tabStyle(tab === 'list')} onClick={() => setTab('list')}>Favourite Clients</button>
      </div>
      {tab === 'form'
        ? <Wizard key={edited ? `edit-${edited.n}` : 'new'} sessionId={sessionId} screen="clients" initial={edited?.wizard} fresh={!edited} />
        : <CaseList sessionId={sessionId} list="clients" onEdit={(r) => { if (r.wizard) { setEdited((e) => ({ n: (e?.n ?? 0) + 1, wizard: r.wizard! })); setTab('form'); } }} />}
    </div>
  );
}
