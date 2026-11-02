import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { PortalModal, PortalTable } from '@/components/efiling/PortalKit';
import { PortalButton, PortalFormGrid, PortalFormRow, PortalInput, PortalSection, PortalSelect } from '@/components/efiling/PortalForm';
import {
  portalError, useCaseFilingEfile, useCaseFilingList, useCaseFilingListAction, useCaseFilingPdf, useCaseFilingStep, useCaseFilingSuggest,
  type CaseFilingAction, type CaseFilingButton, type CaseFilingField, type CaseFilingRow, type CaseFilingScreen, type CaseFilingTab,
  type CaseFilingTabKey, type CaseFilingWizard, type CaseListActionResult, type CaseListKey, type FieldValue, type PortalTableData, type WizardStep,
} from '@/hooks/efiling/caseFiling';

// =============================================================================
// Case Filing on the eFiling portal, live: the portal's own New Case Filing
// page (its tabs, fields, buttons and lists, in its order, with its labels
// and its validation messages), its Draft Cases / eFiled Cases lists, and
// Manage Favourite Clients. Every step happens on the portal over the
// advocate's session; what is shown is what the portal shows afterwards.
// Laid out as the portal lays these pages out: the round page tools in the
// grey strip, the tab strip with icons, full-width section bands, rows of
// "label * | field | label * | field", rounded Submit / Reset buttons.
// Monochrome; red only for a tab the portal marked as having a mandatory issue.
// =============================================================================

type View = 'new_case' | 'draft_cases' | 'filed_cases' | 'clients';

export function PortalCaseFiling({ sessionId, view }: { sessionId: string; view: View }) {
  if (view === 'new_case') return <Wizard key="new_case" sessionId={sessionId} screen="new_case" fresh tools={<CaseFilingTools active="new_case" />} />;
  if (view === 'draft_cases') return <CaseList key="draft" sessionId={sessionId} list="draft" />;
  if (view === 'filed_cases') return <CaseList key="filed" sessionId={sessionId} list="filed" />;
  return <FavouriteClients sessionId={sessionId} />;
}

// ---- icons (the portal's Font Awesome ones, drawn in currentColor) -------------------

const svg = { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const I = {
  plus: <svg {...svg}><path d="M12 5v14M5 12h14" /></svg>,
  edit: <svg {...svg}><path d="M11 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6" /><path d="M18 3l3 3-9 9H9v-3z" /></svg>,
  pdf: <svg {...svg}><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><path d="M9 17c2-1 4-4 4-7 0 3 2 5 3 6-2 0-5 0-7 1z" strokeWidth={1.6} /></svg>,
  trash: <svg {...svg}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>,
  star: <svg {...svg} fill="currentColor" stroke="none"><path d="M12 2l3 7 7.5.6-5.7 4.9 1.8 7.4L12 18l-6.6 3.9 1.8-7.4L1.5 9.6 9 9z" /></svg>,
  user: <svg {...svg} fill="currentColor" stroke="none"><circle cx="12" cy="7" r="5" /><path d="M3 22c0-5 4-8 9-8s9 3 9 8z" /></svg>,
  file: <svg {...svg} fill="currentColor" stroke="none"><path d="M5 2h9l5 5v15H5z" /></svg>,
  check: <svg {...svg} fill="currentColor" stroke="none"><path fillRule="evenodd" d="M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22zm-1.5 15.5l7-7-1.6-1.6-5.4 5.4-2.4-2.4-1.6 1.6z" /></svg>,
  save: <svg {...svg} fill="currentColor" stroke="none"><path fillRule="evenodd" d="M3 3h14l4 4v14H3zm4 2v5h9V5zm5 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /></svg>,
  undo: <svg {...svg}><path d="M4 4v6h6" /><path d="M5 15a8 8 0 1 0 1.5-8.5L4 10" /></svg>,
};

// The icon before each tab's name, as the portal has it.
const TAB_ICON: Partial<Record<CaseFilingTabKey, ReactNode>> = {
  initial: I.star, litigant: I.user, legal_heir: I.user, victim: I.user, complainant138: I.user, client: I.user, organisation: I.user,
  facts: I.user, case_details: I.file, police: I.file, caveat: I.file, mvc: I.file, accident: I.file, claim: I.file, subordinate: I.file,
  efile: I.check,
};

// Row buttons in the lists.
const ACTION_ICON: Record<string, ReactNode> = { Edit: I.edit, Delete: I.trash, View: I.pdf, Acknowledgement: I.pdf };

// ---- the page tools in the grey strip ------------------------------------------------

interface Tool { key: string; label: string; icon: ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void }

/** The portal's round page tools, at the right of the grey strip under the menu (beside Help). */
function PageTools({ tools }: { tools: Tool[] }) {
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    const help = document.querySelector<HTMLElement>('header[aria-label="eFiling Services"] button[aria-label="Help"]');
    setHost(help?.parentElement ?? null);
  }, []);
  if (host === undefined) return null;
  const row = (
    <span className="row" style={{ gap: 8, alignItems: 'center', order: -1, marginRight: 8 }}>
      {tools.map((t) => (
        <button key={t.key} type="button" aria-label={t.label} title={t.disabled ? undefined : t.label} aria-pressed={t.active} disabled={t.disabled} onClick={t.onClick}
          style={{
            width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', cursor: t.disabled ? 'default' : 'pointer',
            border: `2px solid ${t.active ? 'var(--bg-inverse)' : 'var(--border-default)'}`, boxShadow: '0 0 0 1px var(--bg-surface)',
            background: t.active ? 'var(--bg-inverse)' : 'var(--bg-surface)', color: t.active ? 'var(--text-inverse)' : 'var(--text-primary)',
          }}>{t.icon}</button>
      ))}
    </span>
  );
  return host ? createPortal(row, host) : <div className="row" style={{ justifyContent: 'flex-end' }}>{row}</div>;
}

/** Case Filing's tools: + New Case Filing, edit = Draft Cases, PDF = eFiled Cases, and its delete tool. */
function CaseFilingTools({ active, onActive }: { active: 'new_case' | 'draft_cases' | 'filed_cases' | null; onActive?: () => void }) {
  const [, setParams] = useSearchParams();
  const go = (m: string) => () => { if (m === active && onActive) onActive(); else setParams(new URLSearchParams({ m })); };
  return (
    <PageTools tools={[
      { key: 'new', label: 'New Case Filing', icon: I.plus, active: active === 'new_case', onClick: go('new_case') },
      { key: 'draft', label: 'Draft Cases', icon: I.edit, active: active === 'draft_cases', onClick: go('draft_cases') },
      { key: 'filed', label: 'eFiled Cases', icon: I.pdf, active: active === 'filed_cases', onClick: go('filed_cases') },
      { key: 'delete', label: 'Delete', icon: I.trash, disabled: true },
    ]} />
  );
}

// ---- the portal's pop-ups: its "Loading..." box, its alerts and confirms --------------

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 16px' };
const popup: React.CSSProperties = { background: 'var(--bg-surface)', color: 'var(--text-primary)', borderRadius: 6, boxShadow: '0 10px 40px rgba(0,0,0,0.35)', width: 'min(460px, 100%)', padding: '26px 24px 20px', textAlign: 'center' };

function PortalLoading() {
  return (
    <div role="status" aria-live="polite" style={{ ...overlay, background: 'rgba(0,0,0,0.3)' }}>
      <div className="col" style={{ ...popup, width: 300, alignItems: 'center', gap: 14 }}>
        <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden>
          <circle cx="40" cy="40" r="32" fill="none" stroke="var(--bg-surface-2)" strokeWidth="14" />
          <circle cx="40" cy="40" r="32" fill="none" stroke="var(--text-primary)" strokeWidth="14" strokeDasharray="60 141">
            <animateTransform attributeName="transform" type="rotate" from="0 40 40" to="360 40 40" dur="1s" repeatCount="indefinite" />
          </circle>
        </svg>
        <span style={{ fontSize: 14 }}>Loading...</span>
      </div>
    </div>
  );
}

/** The portal's alert (its messages after a step) or confirm (OK / Cancel). */
function PortalAlert({ lines, onOk, onCancel }: { lines: string[]; onOk: () => void; onCancel?: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') (onCancel ?? onOk)(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onOk, onCancel]);
  return (
    <div role={onCancel ? 'alertdialog' : 'alert'} aria-modal="true" style={overlay}>
      <div className="col" style={{ ...popup, gap: 16 }}>
        {lines.map((l, i) => <p key={i} style={{ margin: 0, fontSize: 16, whiteSpace: 'pre-line' }}>{l}</p>)}
        <span className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <PortalButton onClick={onOk}>OK</PortalButton>
          {onCancel ? <PortalButton outline onClick={onCancel}>Cancel</PortalButton> : null}
        </span>
      </div>
    </div>
  );
}

// ---- the wizard / form screen ------------------------------------------------------

// The portal's own words before "eFile Case" (litigant.js submitEfileData).
const EFILE_CONFIRM = 'Do you want to submit the case? \n Once submitted, case details can not be modfied.';
// dashboard.js's delete confirm.
const DELETE_CONFIRM = 'Want to delete?';

interface Confirm { text: string; go: () => void }

/** The bordered box of a tabbed page, its tab strip on top. */
function TabBox({ tabs, children }: { tabs?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {tabs}
      <div style={{ border: '1px solid var(--border-default)', padding: '16px 0 14px', background: 'var(--bg-surface)' }}>{children}</div>
    </div>
  );
}

function Wizard({ sessionId, screen, initial, pdeNo, fresh, tools, heading }: {
  sessionId: string; screen: CaseFilingScreen; initial?: CaseFilingWizard; pdeNo?: string | null; fresh?: boolean;
  /** The page's tools (not when the form opens inside a window). */
  tools?: ReactNode;
  /** The page's own heading (Manage Favourite Clients: "Add Client"). */
  heading?: string;
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
    return (
      <>
        {tools}
        {failed
          ? <p className="body-sm">{failed} <PortalButton onClick={() => void run({ op: 'open', body: { ...(screen === 'clients' ? { screen } : {}), fresh } })}>Try again</PortalButton></p>
          : <PortalLoading />}
      </>
    );
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
        text: EFILE_CONFIRM,
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
      return setConfirm({ text: `${b.text}?`, go: () => { setConfirm(null); void run({ op: 'button', body: { ...ref, tab: wiz.tab, key: b.key, text: b.text, values, confirmed: true } }, keys); } });
    }
    void run({ op: 'button', body: { ...ref, tab: wiz.tab, key: b.key, text: b.text, values } }, keys);
  };
  const onPartyAction = (list: 'parties' | 'prev_parties' | 'lh_parties', cells: string[], a: CaseFilingAction) => {
    const body = { pdeNo: wiz.pdeNo, list, match: cells.slice(0, 2), action: a.label };
    if (a.kind === 'delete') setConfirm({ text: DELETE_CONFIRM, go: () => { setConfirm(null); void run({ op: 'party', body: { ...body, confirmed: true } }); } });
    else void run({ op: 'party', body });
  };

  if (efiled) {
    return (
      <div className="col" style={{ gap: 10 }} role="status">
        {tools}
        <h3 style={{ margin: 0 }}>Case eFiled on the portal</h3>
        <p className="body-sm">e-filing number {efiled}. It is now in eFiled Cases.</p>
        {said.length ? <PortalAlert lines={said} onOk={() => setSaid([])} /> : null}
      </div>
    );
  }

  const visibleTabs = wiz.tabs.filter((t) => t.present && t.shown);
  const showTabs = screen === 'new_case' || visibleTabs.length > 1;
  const sections = layoutSections(tab?.sections ?? []);
  const anyRequired = sections.some((s) => s.rows.some((r) => r.some((c) => c.f.required)));
  return (
    <div className="col" style={{ gap: 10 }} aria-busy={busy}>
      {tools}
      {screen === 'new_case' && (wiz.caseTitle || wiz.pdeNo) ? (
        <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: '8px 14px', border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)' }}>
          <strong style={{ fontSize: 16 }}>{wiz.caseTitle}</strong>
          {wiz.pdeNo ? <span className="body-sm">Temporary e-filing number: <strong>{wiz.pdeNo}</strong></span> : null}
        </div>
      ) : null}
      <TabBox tabs={showTabs ? (
        <CfTabs tabs={visibleTabs} active={wiz.tab} busy={busy} onPick={(k) => void run({ op: 'tab', body: { ...ref, tab: k } })} />
      ) : undefined}>
        {tab ? (
          <div className="col" style={{ gap: 12 }}>
            {heading ? <h2 style={{ margin: 0, textAlign: 'center', fontSize: 24, fontWeight: 700 }}>{heading}</h2> : null}
            {anyRequired ? (
              <p style={{ margin: '0 2px', fontSize: 14, fontWeight: 700 }}>{screen === 'clients' ? 'Fields marked with * are required.' : 'Fields marked with * are mandatory.'}</p>
            ) : null}
            {wiz.notice ? <p style={{ margin: '0 2px', fontSize: 14, fontWeight: 700 }}>{wiz.notice}</p> : null}
            {failed ? <p className="body-sm" role="alert" style={{ margin: '0 2px' }}>{failed}</p> : null}

            {sections.map((s, i) => {
              const rows = s.rows.map((r, j) => (
                <PortalFormGrid key={j}>
                  {r.map((c) => (
                    <FieldRow key={c.f.key} c={c} edits={edits} busy={busy} onField={onField} sessionId={sessionId} pdeNo={wiz.pdeNo} tab={wiz.tab}
                      onPicked={(f, term, index) => void run({ op: 'pick', body: { pdeNo: wiz.pdeNo, tab: wiz.tab, key: f.key, term, index } }, [f.key])} />
                  ))}
                  {r.length === 1 ? <span aria-hidden /> : null}
                </PortalFormGrid>
              ));
              return s.title
                ? <PortalSection key={`${s.title}-${i}`} title={s.title} note={s.note}>{rows}</PortalSection>
                : <div key={`s-${i}`}>{rows}</div>;
            })}
            {(tab.lists ?? []).map((l) => (
              <PortalSection key={l.key} title={`${l.title}${l.total != null ? ` (${l.total})` : ''}`}>
                <div style={{ padding: '0 8px' }}>
                  <ActionTable headers={l.table.headers} rows={l.table.rows} busy={busy} onAction={(cells, a) => onPartyAction(l.key, cells, a)} />
                </div>
              </PortalSection>
            ))}
            {tab.key === 'efile' ? <EfileSummary tab={tab} allowed={wiz.efileAllowed} /> : null}
            {tab.buttons?.length ? (
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center', paddingTop: 4 }}>
                {tab.buttons.map((b) => (
                  <PortalButton key={b.key} disabled={busy || b.disabled || (b.kind === 'efile' && (!wiz.pdeNo || !wiz.efileAllowed))}
                    icon={b.kind === 'save' ? I.save : /^reset$/i.test(b.text) ? I.undo : b.kind === 'efile' ? I.check : b.kind === 'delete' ? I.trash : undefined}
                    onClick={() => onButton(b)}>{b.text}</PortalButton>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </TabBox>

      {busy ? <PortalLoading /> : null}
      {said.length && !busy ? <PortalAlert lines={said} onOk={() => setSaid([])} /> : null}
      {confirm ? <PortalAlert lines={[confirm.text]} onOk={confirm.go} onCancel={() => setConfirm(null)} /> : null}
    </div>
  );
}

/** The portal's tab strip: an icon and the name on each tab, the open one filled. */
function CfTabs({ tabs, active, busy, onPick, onlyFirst }: {
  tabs: CaseFilingTab[]; active: CaseFilingTabKey | null; busy?: boolean; onPick: (k: CaseFilingTabKey) => void;
  /** The tabs shown over a list (Draft Cases): only the first one opens (a new case). */
  onlyFirst?: boolean;
}) {
  return (
    <div role="tablist" className="row" style={{ gap: 4, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: -1, position: 'relative' }}>
      {tabs.map((t, i) => {
        const on = t.key === active;
        const can = onlyFirst ? i === 0 : t.enabled;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} aria-disabled={!can} disabled={busy || (!can && !on)} onClick={() => onPick(t.key)}
            title={t.error ? 'The portal marked this tab: fill what it needs, then eFile again' : can || on ? undefined : 'The portal opens this tab after the earlier tabs are saved'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 9px', fontSize: 14.5, cursor: can ? 'pointer' : 'default', borderRadius: '4px 4px 0 0',
              border: `1px solid ${t.error ? 'var(--danger)' : 'var(--border-default)'}`, borderBottomColor: on ? 'var(--bg-inverse)' : 'var(--border-default)',
              background: on ? 'var(--bg-inverse)' : 'var(--bg-surface)',
              color: t.error ? 'var(--danger)' : on ? 'var(--text-inverse)' : 'var(--text-primary)',
              fontWeight: onlyFirst && i === 0 ? 700 : 400,
            }}>
            {TAB_ICON[t.key] ?? I.file}{t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- the form rows ---------------------------------------------------------------------

/** One cell of a row: a field, with the controls the portal puts in the same cell. */
interface Cell { f: CaseFilingField; lead?: CaseFilingField; trail?: CaseFilingField[] }
interface LaidSection { title: string; note?: string; rows: Cell[][] }

/** "(required)" in a label is the portal's *. */
function norm(f: CaseFilingField): CaseFilingField {
  return /\(required\)/i.test(f.label) ? { ...f, label: f.label.replace(/\s*\(required\)\s*/i, ' ').trim(), required: true } : f;
}

/**
 * The portal's rows: two "label * | field" pairs per row, in its order; its
 * section notes on the band's right; a heading that only names its one field
 * (Nature) is that field's own row in the next section; a check box after a
 * field sits in that field's cell (Age · Differently Abled); the salutation
 * picker sits before the name box; check boxes and Occupation have a row
 * of their own.
 */
function layoutSections(input: Array<{ title: string; fields: CaseFilingField[] }>): LaidSection[] {
  const out: Array<{ title: string; note?: string; fields: CaseFilingField[]; alone: Set<string> }> = [];
  let carry: CaseFilingField[] = [];
  input.forEach((s, i) => {
    const fields = s.fields.map(norm);
    const own = fields.length === 1 && fields[0]!.kind === 'radio' && s.title.trim().toLowerCase() === fields[0]!.label.trim().toLowerCase();
    if (own && i < input.length - 1) { carry = [...carry, ...fields]; return; }
    const m = /^(.*?)\s*(Note\s*:.*)$/i.exec(s.title);
    out.push({ title: m ? m[1]! : s.title, note: m ? m[2] : undefined, fields: [...carry, ...fields], alone: new Set(carry.map((f) => f.key)) });
    carry = [];
  });
  return out.map((s) => {
    const cells: Cell[] = [];
    for (let i = 0; i < s.fields.length; i++) {
      const f = s.fields[i]!;
      const next = s.fields[i + 1];
      const prev = cells[cells.length - 1];
      if (/salutation/i.test(f.label) && f.kind === 'select' && next && next.kind === 'text') { cells.push({ f: next, lead: f }); i++; continue; }
      if (f.kind === 'checkbox' && prev && prev.f.kind !== 'checkbox' && !s.alone.has(prev.f.key) && i > 0 && s.fields[i - 1]!.kind !== 'checkbox') {
        prev.trail = [...(prev.trail ?? []), f];
        continue;
      }
      cells.push({ f });
    }
    const rows: Cell[][] = [];
    let row: Cell[] = [];
    const isAlone = (c: Cell) => s.alone.has(c.f.key) || (c.f.kind === 'checkbox' && !c.trail) || /occu/i.test(c.f.key);
    for (const c of cells) {
      if (isAlone(c)) { if (row.length) rows.push(row); rows.push([c]); row = []; continue; }
      row.push(c);
      if (row.length === 2) { rows.push(row); row = []; }
    }
    if (row.length) rows.push(row);
    return { title: s.title, note: s.note, rows };
  });
}

function FieldRow({ c, edits, busy, onField, sessionId, pdeNo, tab, onPicked }: {
  c: Cell; edits: Record<string, string | boolean>; busy: boolean; onField: (f: CaseFilingField, v: string | boolean) => void;
  sessionId: string; pdeNo: string | null; tab: CaseFilingTabKey; onPicked: (f: CaseFilingField, term: string, index: number) => void;
}) {
  const valueOf = (f: CaseFilingField) => (f.key in edits ? edits[f.key]! : f.kind === 'checkbox' ? !!f.checked : f.value);
  const box = (f: CaseFilingField) => (
    <FieldControl f={f} value={valueOf(f)} busy={busy} onChange={(v) => onField(f, v)} sessionId={sessionId} pdeNo={pdeNo} tab={tab}
      onPicked={(term, index) => onPicked(f, term, index)} />
  );
  const errors = [c.lead, c.f, ...(c.trail ?? [])].filter((f): f is CaseFilingField => !!f?.error);
  return (
    <PortalFormRow label={<label htmlFor={c.f.kind === 'radio' ? undefined : fieldId(c.f)} id={`${fieldId(c.f)}-l`} style={{ fontWeight: 700 }}>{c.f.label}</label>} required={c.f.required}>
      <span className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {c.lead ? <span style={{ width: 80, flex: '0 0 auto' }}>{box(c.lead)}</span> : null}
        <span style={{ flex: c.f.kind === 'radio' || c.f.kind === 'checkbox' ? '0 0 auto' : c.lead ? '1 1 120px' : '0 1 250px', maxWidth: c.lead ? 250 : c.trail ? 80 : undefined, minWidth: 0, width: c.lead || c.f.kind === 'radio' || c.f.kind === 'checkbox' ? undefined : '100%' }}>{box(c.f)}</span>
        {(c.trail ?? []).map((t) => (
          <label key={t.key} className="row" style={{ gap: 8, alignItems: 'center', fontWeight: 700, fontSize: 14, marginLeft: 6 }}>
            {t.label}{t.required ? ' *' : ''}
            <input type="checkbox" checked={valueOf(t) === true} disabled={busy || t.disabled || t.readOnly} onChange={(e) => onField(t, e.target.checked)} />
          </label>
        ))}
      </span>
      {errors.map((f) => <FieldError key={f.key} text={f.error!} />)}
    </PortalFormRow>
  );
}

const fieldId = (f: CaseFilingField) => `cf-${f.key.replace(/[^\w-]/g, '_')}`;

/** One portal control, sized as the portal's. */
function FieldControl({ f, value, busy, onChange, sessionId, pdeNo, tab, onPicked }: {
  f: CaseFilingField; value: string | boolean; busy: boolean; onChange: (v: string | boolean) => void;
  sessionId: string; pdeNo: string | null; tab: CaseFilingTabKey; onPicked: (term: string, index: number) => void;
}) {
  const id = fieldId(f);
  const off = busy || f.disabled || f.readOnly;
  if (f.kind === 'select') {
    return (
      <PortalSelect id={id} aria-label={f.label} value={String(value)} disabled={off} onChange={(e) => onChange(e.target.value)}>
        {(f.options ?? []).map((o, i) => <option key={`${o.value}-${i}`} value={o.value} disabled={o.disabled}>{o.text}</option>)}
      </PortalSelect>
    );
  }
  if (f.kind === 'radio') {
    return (
      <span role="radiogroup" aria-labelledby={`${id}-l`} className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center', minHeight: 32 }}>
        {(f.options ?? []).map((o) => (
          <label key={o.value} className="row" style={{ gap: 5, alignItems: 'center', fontWeight: 700, fontSize: 14 }}>
            <input type="radio" name={id} value={o.value} checked={String(value) === o.value} disabled={off || o.disabled} onChange={() => onChange(o.value)} />{o.text}
          </label>
        ))}
      </span>
    );
  }
  if (f.kind === 'checkbox') {
    return <input id={id} type="checkbox" checked={value === true} disabled={off} onChange={(e) => onChange(e.target.checked)} style={{ margin: '8px 0' }} />;
  }
  if (f.suggest) return <SuggestBox id={id} f={f} value={String(value)} busy={off} onChange={onChange} sessionId={sessionId} pdeNo={pdeNo} tab={tab} onPicked={onPicked} />;
  if (f.kind === 'textarea') {
    return (
      <textarea id={id} rows={3} value={String(value)} disabled={off} maxLength={f.maxLength ?? undefined} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: '4px 6px', fontSize: 14, border: '1px solid var(--text-primary)', borderRadius: 3, background: 'var(--bg-surface)', color: 'var(--text-primary)', font: 'inherit' }} />
    );
  }
  return (
    <PortalInput id={id} type={f.kind === 'date' ? 'text' : f.kind} value={String(value)} disabled={off} maxLength={f.maxLength ?? undefined}
      placeholder={f.kind === 'date' ? (f.placeholder || 'DD-MM-YYYY') : f.placeholder.trim()} onChange={(e) => onChange(e.target.value)} style={{ height: 26, borderRadius: 0 }} />
  );
}

function FieldError({ text }: { text: string }) {
  return <span role="alert" style={{ display: 'block', fontWeight: 700, fontSize: 13, marginTop: 3 }}>{text}</span>;
}

/** Act / section box: the portal's suggestions after 3 letters (its autocomplete's min_length), picked as on the portal. */
function SuggestBox({ id, f, value, busy, onChange, sessionId, pdeNo, tab, onPicked }: {
  id: string; f: CaseFilingField; value: string; busy: boolean; onChange: (v: string) => void;
  sessionId: string; pdeNo: string | null; tab: CaseFilingTabKey; onPicked: (term: string, index: number) => void;
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
      <PortalInput id={id} value={value} disabled={busy} placeholder={f.placeholder} autoComplete="off" onChange={(e) => type(e.target.value)} style={{ height: 26, borderRadius: 0 }} />
      {suggest.isPending ? <span style={{ fontSize: 13 }}>Loading...</span> : null}
      {items && items.list.length ? (
        <ul role="listbox" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: 0, padding: 0, listStyle: 'none', background: 'var(--bg-surface)', border: '1px solid var(--border-default)', maxHeight: 240, overflowY: 'auto' }}>
          {items.list.map((it, i) => (
            <li key={`${it}-${i}`} role="option" aria-selected={false}>
              <button type="button" onClick={() => { onPicked(items.term, i); setItems(null); }}
                style={{ width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', borderBottom: '1px solid var(--border-default)', color: 'inherit', cursor: 'pointer' }}>{it}</button>
            </li>
          ))}
        </ul>
      ) : items ? <span style={{ fontSize: 13 }}>No match found</span> : null}
    </div>
  );
}

/** e-File tab: what each tab saved, as the portal summarises it. */
function EfileSummary({ tab, allowed }: { tab: CaseFilingTab; allowed: boolean }) {
  return (
    <div className="col" style={{ gap: 12 }}>
      {(tab.summary ?? []).map((s) => (
        <PortalSection key={s.title} title={s.title}>
          <div className="col" style={{ gap: 6, padding: '0 8px' }}>
            {s.tables.map((t, i) => <PortalTable key={i} headers={t.headers} rows={t.rows} />)}
            {s.text ? <p className="body-sm" style={{ margin: 0 }}>{s.text}</p> : null}
          </div>
        </PortalSection>
      ))}
      {!allowed ? <p className="body-sm" style={{ margin: '0 8px' }}>This case was filed by another advocate: the portal does not let you eFile it here.</p> : null}
    </div>
  );
}

// ---- lists ---------------------------------------------------------------------------

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BADGE = /\s*(CIS verified eFiled case)\s*$/i;

/** A portal table with its row buttons in the cells where the portal has them. */
function ActionTable({ headers, rows, busy, onAction }: {
  headers: string[]; rows: CaseFilingRow[]; busy?: boolean; onAction: (cells: string[], a: CaseFilingAction) => void;
}) {
  const cols = Math.max(headers.length, ...rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const hasData = rows.some((r) => 'cells' in r);
  const td: React.CSSProperties = { padding: '8px 6px', borderRight: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'left', whiteSpace: 'pre-line', fontSize: 13 };
  let n = 0;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid var(--border-default)' }}>
        {headers.length ? (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 14, textAlign: 'center', verticalAlign: 'bottom', borderRight: '1px solid var(--bg-surface)', padding: '6px 8px', lineHeight: 1.3 }}>{h}</th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((r, i) => {
            if ('group' in r) {
              // The first heading of a run (date / court) centred, the next (court / relief) indented, as on the portal.
              const first = i === 0 || !('group' in rows[i - 1]!);
              const style: React.CSSProperties = !hasData ? { ...td, fontSize: 14 }
                : first ? { ...td, textAlign: 'center', fontWeight: 700, fontSize: 16, background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--bg-surface)' }
                  : { ...td, fontSize: 16, paddingLeft: 32, background: 'var(--bg-surface-2)' };
              return <tr key={i}><td colSpan={cols} style={style}>{r.group}</td></tr>;
            }
            n += 1;
            return (
              <tr key={i} style={{ background: n % 2 ? 'var(--bg-surface-2)' : undefined, borderBottom: '1px solid var(--border-default)' }}>
                {r.cells.map((c, j) => {
                  const acts = (r.actions ?? []).filter((a) => a.cell === j || (a.cell < 0 && j === r.cells.length - 1));
                  let text = c;
                  for (const a of acts) text = text.replace(new RegExp(`(^|\\s)${escRe(a.label)}(?=\\s|$)`), '$1');
                  text = text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
                  const badge = BADGE.exec(text);
                  if (badge) text = text.slice(0, badge.index);
                  return (
                    <td key={j} style={{ ...td, textAlign: acts.length ? 'center' : 'left' }}>
                      {text}
                      {badge ? (
                        <span style={{ display: 'inline-block', marginTop: 3, padding: '0 6px', border: '1px solid var(--text-primary)', borderRadius: 4, fontSize: 10.5, fontWeight: 700 }}>{badge[1]}</span>
                      ) : null}
                      {acts.length ? (
                        <span className="row" style={{ gap: 4, justifyContent: 'center', flexWrap: 'nowrap', whiteSpace: 'nowrap', marginTop: text ? 6 : 0 }}>
                          {acts.map((a) => (
                            <button key={a.label} type="button" disabled={busy} onClick={() => onAction(r.cells, a)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 12, padding: '3px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                              {ACTION_ICON[a.label] ?? null}{a.label}
                            </button>
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

const searchBtn: React.CSSProperties = { padding: '5px 9px', borderRadius: 4, border: 'none', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 15, cursor: 'pointer' };

// The note beside each list's Search / Clear, in the portal's words.
const SEARCH_NOTE: Partial<Record<CaseListKey, string>> = {
  draft: 'Search by E-Filing number OR Petitioner Name OR Relief Sought OR Case Type',
  filed: 'Search by E-Filing number OR Petitioner Name OR Respondent Name',
};

// The New Case Filing tabs the portal keeps over the Draft Cases list.
const DRAFT_TABS: CaseFilingTab[] = ([['initial', 'Initial Inputs'], ['litigant', 'Litigant'], ['facts', 'Fact Details'], ['case_details', 'Case Details'], ['efile', 'e-File']] as const)
  .map(([key, label]) => ({ key, label, present: true, shown: true, enabled: false, active: false, error: false, paneId: '' }));

/** Draft Cases / eFiled Cases / favourite clients: the portal's Search, its server pages, its rows and buttons. */
function CaseList({ sessionId, list, onEdit, tools }: { sessionId: string; list: CaseListKey; onEdit?: (r: CaseListActionResult) => void; tools?: ReactNode }) {
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
  const [, setParams] = useSearchParams();
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
    if (a.kind === 'delete') setConfirm({ text: DELETE_CONFIRM, go: () => { setConfirm(null); void doAction(cells, a, true); } });
    else void doAction(cells, a);
  };
  const closePdf = () => { if (pdf.data) URL.revokeObjectURL(pdf.data.url); setPdfOf(null); pdf.reset(); };
  const pages = data?.pages ?? 1;
  const go = (p: number) => setPage(Math.min(Math.max(1, p), pages));
  const note = SEARCH_NOTE[list];
  const closeOpened = () => { setOpened(null); void q.refetch(); };
  const pageTools = list === 'clients' ? tools : <CaseFilingTools active={list === 'draft' ? 'draft_cases' : 'filed_cases'} onActive={opened ? closeOpened : undefined} />;

  // A draft's Edit opens it in New Case Filing's tabs, on the page itself, as on the portal.
  if (opened?.result.wizard && list === 'draft') {
    return <>
      <Wizard key={opened.result.wizard.pdeNo ?? 'draft'} sessionId={sessionId} screen={opened.result.wizard.screen} initial={opened.result.wizard} pdeNo={opened.result.wizard.pdeNo} tools={pageTools} />
    </>;
  }

  const body = (
    <div className="col" style={{ gap: 12 }}>
      {note ? (
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <PortalInput aria-label="Search" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 250, height: 26, borderRadius: 0 }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setSearch(draft.trim()); setPage(1); } }} />
          <span style={{ width: 10 }} />
          <button type="button" style={searchBtn} onClick={() => { setSearch(draft.trim()); setPage(1); }}>Search</button>
          <button type="button" style={searchBtn} onClick={() => { setDraft(''); setSearch(''); setPage(1); }}>Clear</button>
          <span style={{ fontSize: 14, background: 'var(--bg-surface-2)', padding: '2px 2px' }}><strong>Note:</strong> {note}</span>
        </div>
      ) : null}
      {q.isError ? <p className="body-sm" style={{ margin: 0 }}>{portalError(q.error, 'Could not open this list on the portal.')}</p> : null}
      {data ? (
        data.error && !data.rows.length ? <p className="body-sm" style={{ margin: 0 }}>{data.error}</p>
          : <ActionTable headers={data.headers} rows={data.rows.length ? data.rows : [{ group: 'No record found' }]} busy={busy} onAction={onAction} />
      ) : null}
      {data && (pages > 1 || data.info) ? (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>{data.info}</span>
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
    </div>
  );

  return (
    <div className="col" style={{ gap: 14 }}>
      {pageTools}
      {list === 'draft' ? (
        <TabBox tabs={<CfTabs tabs={DRAFT_TABS} active={null} onlyFirst onPick={() => setParams(new URLSearchParams({ m: 'new_case' }))} />}>
          <div style={{ padding: '0 0 0 0' }}>{body}</div>
        </TabBox>
      ) : list === 'filed' ? (
        <div style={{ border: '1px solid var(--border-default)', borderRadius: 4, padding: '20px 20px 24px', margin: '16px 24px' }}>{body}</div>
      ) : (
        <div style={{ paddingTop: 50 }}>{body}</div>
      )}

      {busy ? <PortalLoading /> : null}
      {said.length && !busy ? <PortalAlert lines={said} onOk={() => setSaid([])} /> : null}
      {opened ? (
        <PortalModal title={opened.result.wizard?.pdeNo ? `${opened.title} - ${opened.result.wizard.pdeNo}` : opened.title} onClose={closeOpened}>
          {opened.result.wizard
            ? <Wizard sessionId={sessionId} screen={opened.result.wizard.screen} initial={opened.result.wizard} pdeNo={opened.result.wizard.pdeNo} />
            : <OpenedView text={opened.result.text ?? ''} tables={opened.result.tables ?? []} />}
        </PortalModal>
      ) : null}
      {pdfOf ? (
        <PortalModal level={2} title={pdfOf} onClose={closePdf}>
          {pdf.isPending ? <p className="body-sm">Loading...</p> : null}
          {pdf.isError ? <p className="body-sm">{portalError(pdf.error, 'The portal did not make the case PDF.')} <PortalButton onClick={() => pdf.mutate(pdfOf)}>Try again</PortalButton></p> : null}
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
      {confirm ? <PortalAlert lines={[confirm.text]} onOk={confirm.go} onCancel={() => setConfirm(null)} /> : null}
    </div>
  );
}

function OpenedView({ text, tables }: { text: string; tables: PortalTableData[] }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      {text ? <p className="body-sm" style={{ whiteSpace: 'pre-line' }}>{text}</p> : null}
      {tables.map((t, i) => <PortalTable key={i} headers={t.headers} rows={t.rows} />)}
      {!text && !tables.length ? <p className="body-sm">No record found</p> : null}
    </div>
  );
}

// ---- Manage Favourite Clients ------------------------------------------------------

/** The page's two tools: + "Add Client" (the Client form) and edit (its client list). */
function FavouriteClients({ sessionId }: { sessionId: string }) {
  const [view, setView] = useState<'form' | 'list'>('form');
  // A client's Edit fills the form on the portal: show that form.
  const [edited, setEdited] = useState<{ n: number; wizard: CaseFilingWizard } | null>(null);
  const tools = (
    <PageTools tools={[
      { key: 'add', label: 'Add Client', icon: I.plus, active: view === 'form', onClick: () => { if (view === 'form' && edited) setEdited(null); setView('form'); } },
      { key: 'list', label: 'Favourite Clients', icon: I.edit, active: view === 'list', onClick: () => setView('list') },
    ]} />
  );
  return (
    <Fragment>
      {view === 'form'
        ? <Wizard key={edited ? `edit-${edited.n}` : 'new'} sessionId={sessionId} screen="clients" initial={edited?.wizard} fresh={!edited} tools={tools} heading={edited ? 'Update Client' : 'Add Client'} />
        : <CaseList sessionId={sessionId} list="clients" tools={tools} onEdit={(r) => { if (r.wizard) { setEdited((e) => ({ n: (e?.n ?? 0) + 1, wizard: r.wizard! })); setView('form'); } }} />}
    </Fragment>
  );
}
