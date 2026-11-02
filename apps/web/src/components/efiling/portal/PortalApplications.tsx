import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PortalModal } from '@/components/efiling/PortalKit';
import {
  PortalButton as PortalBtn, PortalFormGrid, PortalFormRow, PortalInput, PortalPage, PortalSearchCase, PortalSelect, PortalTabs,
} from '@/components/efiling/PortalForm';
import {
  useApplicationsDocument,
  useApplicationsScreen,
  useApplicationsStep,
  type AppControl,
  type AppItem,
  type AppRow,
  type AppsScreen,
  type AppsScreenKey,
  type AppsStep,
} from '@/hooks/efiling/applications';

// =============================================================================
// Applications > Interlocutory Application Filing / Submitted Applications,
// live on the advocate's own portal page. The portal draws these screens on
// its server (their HTML is not public), so DifAi shows exactly what the
// portal page shows - its tabs, headings, fields with their labels and
// choices, tables with the tick boxes and buttons in each row, its pop-ups
// (the OTP window) - in the portal's order, and every choice, tick, typed
// text and button press is done on the portal page itself. Buttons that
// submit, delete, pay, update or verify ask first; the portal's own
// "Do you want to ...?" questions are shown to the advocate word for word.
// OTPs are typed by the advocate. Monochrome.
// =============================================================================

const SCREEN_LABEL: Record<AppsScreenKey, string> = {
  applications: 'Interlocutory Application Filing',
  submitted: 'Submitted Applications',
};

// The portal's page heading when its own heading is not read.
const SCREEN_TITLE: Record<AppsScreenKey, string> = {
  applications: 'Applications',
  submitted: 'Submitted Applications',
};

// The tab strip of Applications > Interlocutory Application Filing
// (applications.js: #epay_tab, #otp_tab), shown as the portal shows it when a
// read did not bring the strip back.
const IA_TABS = ['Applications', 'Pay Fees', 'Authentication'];

// The portal's links that open a document (an application) rather than a step.
const DOC_LINK = /^view\b/i;
const HELP = /^help$/i;

// The portal's Font Awesome icons on these pages, drawn in currentColor.
const ico = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const ICON = {
  file: <svg {...ico} fill="currentColor" stroke="none"><path d="M5 2h9l5 5v15H5zM13 3v5h5" /><path d="M8 12h8M8 15.5h8M8 19h5" stroke="var(--bg-surface)" strokeWidth={1.6} /></svg>,
  rupee: <svg {...ico}><path d="M6 4h12M6 9h12M9 4c6 0 6 10 0 10H6l9 7" /></svg>,
  usersLock: <svg {...ico} fill="currentColor" stroke="none"><circle cx="8" cy="7" r="4" /><path d="M1 21c0-4.5 3-7.5 7-7.5 1.6 0 3 .4 4.1 1.2V21z" /><rect x="14" y="15" width="9" height="7" rx="1" /><path d="M16 15v-2a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth={2} /></svg>,
  search: <svg {...ico} width={15} height={15} strokeWidth={3}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></svg>,
  calendar: <svg {...ico} width={20} height={20} strokeWidth={1.8}><rect x="3" y="5" width="18" height="16" rx="1.5" /><path d="M3 10h18M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2" /></svg>,
};
const tabIcon = (text: string) => (/pay|fee/i.test(text) ? ICON.rupee : /auth/i.test(text) ? ICON.usersLock : ICON.file);

/** The portal writes some labels with their " *" in the text ("Search Keyword *"). */
const bare = (l: string) => l.replace(/\s*\*\s*$/, '');
const starred = (l: string) => /\*\s*$/.test(l);

// Words the portal keeps for screen readers only (chosen's keyboard hint).
const SR_ONLY = /^use arrow keys to navigate/i;
const srOnly: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

/** Every control of a screen in page order (tabs, items, tables, pop-ups). */
function controlsOf(s: AppsScreen): AppControl[] {
  const fromItems = (items: AppItem[]): AppControl[] => items.flatMap((i) => {
    if (i.kind === 'field' || i.kind === 'button') return [i.control];
    if (i.kind === 'table') return i.rows.flatMap((r) => ('cells' in r ? r.cells.flatMap((c) => c.controls) : []));
    return [];
  });
  return [...fromItems(s.items), ...s.modals.flatMap((m) => fromItems(m.items))];
}

// A control's identity across reads (refs are renumbered on every read).
const identity = (c: AppControl) => [c.tag, c.type, c.id, c.name, c.label, c.type === 'radio' || c.type === 'checkbox' ? c.value : ''].join('|');

function locate(s: AppsScreen, ref: string): { key: string; nth: number } | null {
  const all = controlsOf(s);
  const c = all.find((x) => x.ref === ref);
  if (!c) {
    const t = s.tabs.find((x) => x.ref === ref);
    return t ? { key: `tab|${t.text}`, nth: s.tabs.filter((x) => x.text === t.text).indexOf(t) } : null;
  }
  const key = identity(c);
  return { key, nth: all.filter((x) => identity(x) === key).indexOf(c) };
}

function resolve(s: AppsScreen, at: { key: string; nth: number }): string | null {
  if (at.key.startsWith('tab|')) return s.tabs.filter((t) => `tab|${t.text}` === at.key)[at.nth]?.ref ?? null;
  return controlsOf(s).filter((c) => identity(c) === at.key)[at.nth]?.ref ?? null;
}

const errText = (err: unknown, fallback: string) =>
  ((err as { response?: { data?: { error?: string } } })?.response?.data?.error) || (err as Error)?.message || fallback;

export function PortalApplications({ sessionId, view }: { sessionId: string; view: 'applications' | 'submitted_ias' }) {
  const screen: AppsScreenKey = view === 'submitted_ias' ? 'submitted' : 'applications';
  const qc = useQueryClient();
  const q = useApplicationsScreen(sessionId, screen);
  const step = useApplicationsStep(sessionId, screen);
  const doc = useApplicationsDocument(sessionId, screen);
  const s = q.data;

  // Typed text, sent to the portal when the field is left.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => { setDrafts({}); }, [s]);

  // One portal step at a time, in the order the advocate did them; each step
  // finds its control again in the latest read (refs change on every read).
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const latest = () => qc.getQueryData<AppsScreen>(['efiling', 'live', sessionId, 'applications', screen]);
  const run = (make: (now: AppsScreen) => AppsStep | null) => {
    setPending((n) => n + 1);
    queue.current = queue.current
      .then(() => {
        const now = latest();
        const st = now ? make(now) : null;
        return st ? step.mutateAsync(st) : undefined;
      })
      .catch(() => { /* shown from step.error */ })
      .finally(() => setPending((n) => n - 1));
  };
  const onControl = (ref: string, make: (ref: string) => AppsStep) => {
    const at = s ? locate(s, ref) : null;
    run((now) => {
      const r = at ? resolve(now, at) : ref;
      return r ? make(r) : null;
    });
  };
  const busy = pending > 0 || q.isFetching || doc.isPending;

  // Ask before a step that changes the filing; the portal's own questions word for word.
  const [ask, setAsk] = useState<{ text: string; ok: () => void } | null>(null);
  const asked = useRef<AppsScreen | null>(null);
  useEffect(() => {
    if (!s?.confirm || asked.current === s) return;
    asked.current = s;
    const ref = s.confirmRef;
    setAsk({ text: s.confirm, ok: () => { if (ref) onControl(ref, (r) => ({ kind: 'press', ref: r, confirmed: true })); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per portal answer
  }, [s]);

  const press = (c: AppControl) => {
    if (c.tag === 'a' && DOC_LINK.test(c.label)) {
      setFileName(c.label);
      doc.mutate({ ref: c.ref, name: `${c.label}.pdf` });
      return;
    }
    if (c.risky) {
      setAsk({ text: `"${c.label}" changes your application on the eFiling portal. Go ahead?`, ok: () => onControl(c.ref, (r) => ({ kind: 'press', ref: r, confirmed: true })) });
      return;
    }
    onControl(c.ref, (r) => ({ kind: 'press', ref: r }));
  };
  const set = (c: AppControl, v: { value?: string; checked?: boolean }) => onControl(c.ref, (r) => ({ kind: 'field', ref: r, ...v }));
  const commit = (c: AppControl) => {
    const v = drafts[c.ref];
    if (v !== undefined && v !== c.value) set(c, { value: v });
  };

  const [fileName, setFileName] = useState<string | null>(null);
  const closeFile = () => {
    if (doc.data) URL.revokeObjectURL(doc.data.url);
    setFileName(null);
    doc.reset();
  };

  const ctx: RenderCtx = { busy, drafts, setDraft: (ref, v) => setDrafts((d) => ({ ...d, [ref]: v })), commit, set, press, centred: screen === 'submitted' };

  // The page as the portal lays it out: its heading (with the round ? help at
  // the side), the tab strip, then the open tab's box.
  const items = s?.items ?? [];
  const titleAt = items.findIndex((i) => i.kind === 'heading');
  const title = titleAt >= 0 ? (items[titleAt] as { text: string }).text : SCREEN_TITLE[screen];
  const helpTab = s?.tabs.find((t) => HELP.test(t.text)) ?? null;
  const helpBtn = items.find((i): i is Extract<AppItem, { kind: 'button' }> => i.kind === 'button' && HELP.test(i.control.label)) ?? null;
  const helpRef = helpTab?.ref ?? helpBtn?.control.ref ?? null;
  const body = items.filter((i, n) => n !== titleAt && i !== helpBtn);
  const portalTabs = (s?.tabs ?? []).filter((t) => t !== helpTab);
  const tabs = portalTabs.length
    ? portalTabs.map((t) => ({ key: t.ref, label: t.text, icon: tabIcon(t.text), active: t.active, ref: t.ref as string | null }))
    : screen === 'applications' && s
      ? IA_TABS.map((label, n) => ({ key: `ia-${n}`, label, icon: tabIcon(label), active: n === 0, ref: null }))
      : [];
  const activeTab = tabs.find((t) => t.active)?.key ?? tabs[0]?.key ?? '';

  // The portal's heading line: the title centred, its round ? on the side the
  // portal puts it (right on Applications, left on Submitted Applications).
  const help = helpRef ? (
    <button type="button" aria-label="Help" title="Help" disabled={busy} onClick={() => onControl(helpRef, (r) => ({ kind: 'press', ref: r }))}
      style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, cursor: 'pointer', flex: '0 0 auto' }}>?</button>
  ) : null;
  const helpLeft = screen === 'submitted';
  const heading = (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-default)' }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>{helpLeft ? help : null}</div>
      <h2 style={{ margin: 0, textAlign: 'center', fontSize: 20, fontWeight: 700 }}>{title}</h2>
      <div className="row" style={{ alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => ({ kind: 'reopen' }))}>
          {busy ? 'Working on the portal…' : 'Refresh from portal'}
        </button>
        {helpLeft ? null : help}
      </div>
    </div>
  );

  return (
    <section aria-label={SCREEN_LABEL[screen]}>
    <PortalPage required={null}>
      {heading}
      {q.isLoading ? <p className="body-sm muted">Opening Applications &gt; {SCREEN_LABEL[screen]} on filing.ecourts.gov.in…</p> : null}
      {q.isError ? <p className="body-sm" role="alert">{errText(q.error, 'Could not open this screen on the portal.')}</p> : null}
      {step.isError ? <p className="body-sm" role="alert">{errText(step.error, 'The portal did not take that step.')}</p> : null}
      {doc.isError ? <p className="body-sm" role="alert">{errText(doc.error, 'Could not open the document.')}</p> : null}

      {s?.messages.length ? (
        <div role="status" style={{ border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)', padding: '10px 14px' }}>
          <span className="body-sm" style={{ fontWeight: 700 }}>The portal says: </span>
          {s.messages.map((m, i) => <span key={i} className="body-sm" style={{ display: 'block' }}>{m}</span>)}
        </div>
      ) : null}

      {s && !s.onScreen ? (
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap', border: '1px solid var(--border-default)', padding: '10px 14px' }}>
          <span className="body-sm">Your portal page has moved on from {SCREEN_LABEL[screen]}.</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => ({ kind: 'reopen' }))}>Open it again</button>
        </div>
      ) : null}

      {s && tabs.length ? (
        <div aria-busy={busy}>
          <PortalTabs bold active={activeTab}
            tabs={tabs.map((t) => ({ key: t.key, label: t.label, icon: t.icon, disabled: !t.ref && !t.active }))}
            onPick={(k) => {
              const t = tabs.find((x) => x.key === k);
              if (!busy && t?.ref && !t.active) onControl(t.ref, (r) => ({ kind: 'press', ref: r }));
            }} />
          <div className="col" style={{ gap: 12, border: '1px solid var(--border-default)', borderTop: 'none', background: 'var(--bg-surface)', padding: '12px 8px 18px' }}>
            <Items items={body} ctx={ctx} />
          </div>
        </div>
      ) : s ? (
        <div className="col" style={{ gap: 14 }} aria-busy={busy}>
          <Items items={body} ctx={ctx} />
        </div>
      ) : null}

      {s?.modals.map((m) => (
        <PortalModal key={m.id || m.title} level={2} title={m.title}
          onClose={() => { if (m.closeRef) onControl(m.closeRef, (r) => ({ kind: 'press', ref: r })); }}>
          <div className="col" style={{ gap: 12 }}>
            <Items items={m.items} ctx={ctx} />
          </div>
        </PortalModal>
      ))}

      {ask ? (
        <PortalModal level={3} title="Please confirm" onClose={() => setAsk(null)}>
          <div className="col" style={{ gap: 16 }}>
            <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{ask.text}</p>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsk(null)}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { const ok = ask.ok; setAsk(null); ok(); }}>OK</button>
            </div>
          </div>
        </PortalModal>
      ) : null}

      {fileName ? (
        <PortalModal level={3} title={fileName} onClose={closeFile}>
          {doc.isPending ? <p className="body-sm muted">Opening the document on the portal…</p> : null}
          {doc.data ? (
            <div className="col" style={{ gap: 8 }}>
              <iframe title={fileName} src={doc.data.url} style={{ width: '100%', height: '75vh', border: '1px solid var(--border-default)' }} />
              <a className="body-sm" href={doc.data.url} download={doc.data.name}>Download</a>
            </div>
          ) : null}
        </PortalModal>
      ) : null}
    </PortalPage>
    </section>
  );
}

// ---- drawing what the portal shows -------------------------------------------------

interface RenderCtx {
  busy: boolean;
  drafts: Record<string, string>;
  setDraft: (ref: string, v: string) => void;
  commit: (c: AppControl) => void;
  set: (c: AppControl, v: { value?: string; checked?: boolean }) => void;
  press: (c: AppControl) => void;
  /** The page centres its choices and date line (Submitted Applications). */
  centred: boolean;
}

const isRadio = (i: AppItem | undefined): boolean => i?.kind === 'field' && i.control.type === 'radio';
const isDate = (c: AppControl) => /date/i.test(`${c.id} ${c.name}`);
/** A field that takes a value (not a tick box, not a button). */
const isValueField = (i: AppItem | undefined): i is Extract<AppItem, { kind: 'field' }> =>
  i?.kind === 'field' && i.control.type !== 'radio' && i.control.type !== 'checkbox' && i.control.type !== 'file';

/** The portal's items in its order, grouped the way the portal draws them. */
function Items({ items, ctx }: { items: AppItem[]; ctx: RenderCtx }) {
  const out: React.ReactNode[] = [];
  const radiosFrom = (i: number): AppControl[] => {
    const first = (items[i] as Extract<AppItem, { kind: 'field' }>).control;
    const group = [first];
    while (isRadio(items[i + group.length]) && (items[i + group.length] as Extract<AppItem, { kind: 'field' }>).control.name === first.name) {
      group.push((items[i + group.length] as Extract<AppItem, { kind: 'field' }>).control);
    }
    return group;
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;

    // "Search Case | ○ … ○ … | Search Keyword * | [Select]": the portal's bordered case box.
    if (it.kind === 'text' && !it.label && it.text.length < 60 && !/[.:]$/.test(it.text) && isRadio(items[i + 1])) {
      const group = radiosFrom(i + 1);
      const pick = items[i + 1 + group.length];
      if (isValueField(pick)) {
        out.push(
          <div key={`sc${i}`} style={{ padding: '0 3%' }}>
            <PortalSearchCase label={it.text}
              choices={<Radios group={group} ctx={ctx} />}
              pickerLabel={bare(pick.control.label)} required={starred(pick.control.label)}
              picker={<div className="col" style={{ gap: 4, width: '100%' }}>
                <FieldInput id={`pa-${pick.control.ref}`} c={pick.control} ctx={ctx} />
                <FieldError c={pick.control} />
              </div>} />
          </div>,
        );
        i += group.length + 1;
        continue;
      }
    }

    if (isRadio(it)) {
      const group = radiosFrom(i);
      out.push(
        <div key={`r${i}`} className="row" style={{ justifyContent: ctx.centred ? 'center' : 'flex-start', padding: ctx.centred ? '4px 0 10px' : undefined }}>
          <Radios group={group} ctx={ctx} bold={ctx.centred} />
        </div>,
      );
      i += group.length - 1;
      continue;
    }

    // "From Date: [DD-MM-YYYY] 📅  To Date: [DD-MM-YYYY] 📅  [🔍]": one centred line, as on the portal.
    if (isValueField(it) && isDate(it.control) && it.control.tag === 'input') {
      const run: AppControl[] = [];
      let j = i;
      while (isValueField(items[j]) && isDate((items[j] as Extract<AppItem, { kind: 'field' }>).control)) run.push((items[j++] as Extract<AppItem, { kind: 'field' }>).control);
      const btns: AppControl[] = [];
      while (items[j]?.kind === 'button') btns.push((items[j++] as Extract<AppItem, { kind: 'button' }>).control);
      out.push(
        <div key={`d${i}`} className="row" style={{ justifyContent: ctx.centred ? 'center' : 'flex-start', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 0' }}>
          {run.map((c) => (
            <span key={c.ref} className="row" style={{ alignItems: 'center', gap: 8 }}>
              <label htmlFor={`pa-${c.ref}`} style={{ fontWeight: 700, fontSize: 14 }}>{bare(c.label)}{starred(c.label) ? ' *' : ''}</label>
              <FieldInput id={`pa-${c.ref}`} c={c} ctx={ctx} />
              <span aria-hidden style={{ display: 'inline-flex' }}>{ICON.calendar}</span>
              <FieldError c={c} />
            </span>
          ))}
          {btns.map((c) => <CtlButton key={c.ref} c={c} ctx={ctx} iconOnly={/^search$/i.test(c.label)} />)}
        </div>,
      );
      i = j - 1;
      continue;
    }

    // Consecutive label | field rows: one grid, labels right-aligned with their * after.
    if (isValueField(it) || (it.kind === 'text' && !!it.label)) {
      const rows: AppItem[] = [];
      let j = i;
      while (isValueField(items[j]) || (items[j]?.kind === 'text' && !!(items[j] as Extract<AppItem, { kind: 'text' }>).label)) rows.push(items[j++]!);
      out.push(
        <PortalFormGrid key={`g${i}`} columns={1}>
          {rows.map((r, n) => (r.kind === 'field' ? (
            <PortalFormRow key={n} label={<label htmlFor={`pa-${r.control.ref}`}>{bare(r.control.label)}</label>} required={starred(r.control.label)}>
              <span className="col" style={{ gap: 4 }}>
                <FieldInput id={`pa-${r.control.ref}`} c={r.control} ctx={ctx} />
                <FieldError c={r.control} />
              </span>
            </PortalFormRow>
          ) : r.kind === 'text' ? (
            <PortalFormRow key={n} label={r.label}><span style={{ whiteSpace: 'pre-line', fontSize: 14 }}>{r.text}</span></PortalFormRow>
          ) : null))}
        </PortalFormGrid>,
      );
      i = j - 1;
      continue;
    }

    // A run of the portal's buttons: one centred line.
    if (it.kind === 'button') {
      const btns: AppControl[] = [];
      let j = i;
      while (items[j]?.kind === 'button') btns.push((items[j++] as Extract<AppItem, { kind: 'button' }>).control);
      out.push(
        <div key={`b${i}`} className="row" style={{ justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
          {btns.map((c) => <CtlButton key={c.ref} c={c} ctx={ctx} />)}
        </div>,
      );
      i = j - 1;
      continue;
    }

    out.push(<Item key={i} it={it} ctx={ctx} />);
  }
  return <>{out}</>;
}

function Radios({ group, ctx, bold }: { group: AppControl[]; ctx: RenderCtx; bold?: boolean }) {
  return (
    <span role="radiogroup" className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
      {group.map((c) => (
        <label key={c.ref} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 14, fontWeight: bold ? 700 : undefined, cursor: c.disabled ? 'default' : 'pointer' }}>
          <input type="radio" name={`difai-${c.name}`} checked={!!c.checked} disabled={ctx.busy || c.disabled} onChange={() => ctx.set(c, { checked: true })} />
          <span>{c.label}</span>
        </label>
      ))}
    </span>
  );
}

function FieldError({ c }: { c: AppControl }) {
  return c.error ? <span className="body-sm" role="alert" style={{ fontWeight: 700 }}>{c.error}</span> : null;
}

function Item({ it, ctx }: { it: AppItem; ctx: RenderCtx }) {
  switch (it.kind) {
    case 'heading':
      return <h3 style={{ margin: '4px 0 0', fontSize: 18, fontWeight: 700 }}>{it.text}</h3>;
    case 'text':
      // Words the portal keeps for screen readers stay for screen readers.
      if (SR_ONLY.test(it.text)) return <span style={srOnly}>{it.text}</span>;
      return <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-line', fontWeight: /:$/.test(it.text) || /are required\.?$/i.test(it.text) ? 700 : undefined }}>{it.text}</p>;
    case 'button':
      return <div className="row" style={{ justifyContent: 'center' }}><CtlButton c={it.control} ctx={ctx} /></div>;
    case 'field':
      // Tick boxes (the rest are grouped in Items).
      return (
        <label className="row" style={{ gap: 8, alignItems: 'center', fontSize: 14 }}>
          {it.control.type === 'checkbox'
            ? <input type="checkbox" checked={!!it.control.checked} disabled={ctx.busy || it.control.disabled} onChange={(e) => ctx.set(it.control, { checked: e.target.checked })} />
            : <FieldInput id={`pa-${it.control.ref}`} c={it.control} ctx={ctx} />}
          <span>{it.control.label}</span>
          <FieldError c={it.control} />
        </label>
      );
    case 'table':
      return <AppTable headers={it.headers} rows={it.rows} ctx={ctx} />;
  }
}

/** One of the portal's buttons: its rounded button, a link where it has a link, the square 🔍 for Search. */
function CtlButton({ c, ctx, small, iconOnly }: { c: AppControl; ctx: RenderCtx; small?: boolean; iconOnly?: boolean }) {
  if (c.tag === 'a') {
    // A link where the portal has one (View, a page number ...).
    return (
      <button type="button" disabled={ctx.busy || c.disabled} onClick={() => ctx.press(c)}
        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', color: 'inherit', cursor: 'pointer' }}>{c.label || 'Open'}</button>
    );
  }
  if (iconOnly) {
    return (
      <button type="button" aria-label={c.label} title={c.label} disabled={ctx.busy || c.disabled} onClick={() => ctx.press(c)}
        style={{ width: 36, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, border: 'none', background: 'var(--bg-inverse)', color: 'var(--text-inverse)', cursor: 'pointer', opacity: ctx.busy || c.disabled ? 0.5 : 1 }}>
        {ICON.search}
      </button>
    );
  }
  return (
    <PortalBtn outline={small} disabled={ctx.busy || c.disabled} onClick={() => ctx.press(c)}>
      {c.label || 'Go'}
    </PortalBtn>
  );
}

function FieldInput({ id, c, ctx }: { id: string; c: AppControl; ctx: RenderCtx }) {
  const off = ctx.busy || c.disabled;
  if (c.tag === 'select') {
    return (
      <PortalSelect id={id} value={c.value} disabled={off} onChange={(e) => ctx.set(c, { value: e.target.value })}>
        {(c.options ?? []).map((o, i) => <option key={`${o.value}-${i}`} value={o.value}>{o.text}</option>)}
      </PortalSelect>
    );
  }
  if (c.type === 'file') return <span className="body-sm muted">Attach this file on the portal page itself.</span>;
  const value = ctx.drafts[c.ref] ?? c.value;
  const common = {
    id, value, disabled: off, readOnly: c.readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => ctx.setDraft(c.ref, e.target.value),
    onBlur: () => ctx.commit(c),
  };
  if (c.tag === 'textarea') {
    return <textarea rows={4} {...common} style={{ width: '100%', resize: 'vertical', padding: '6px 8px', fontSize: 14, border: '1px solid var(--text-primary)', borderRadius: 3, background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />;
  }
  const otp = c.id === 'user_otp';
  const date = isDate(c);
  return (
    <PortalInput type="text" {...common}
      placeholder={date ? 'DD-MM-YYYY' : undefined}
      inputMode={otp ? 'numeric' : undefined} autoComplete={otp ? 'one-time-code' : 'off'}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ width: date ? 120 : otp ? 220 : '100%', height: 30, borderRadius: date ? 0 : 3 }} />
  );
}

/** The portal's table: dark header, group rows, each cell's lines and the controls in it. */
function AppTable({ headers, rows, ctx }: { headers: string[]; rows: AppRow[]; ctx: RenderCtx }) {
  const cols = Math.max(headers.length, ...rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', whiteSpace: 'pre-line', fontSize: 14 };
  if (!rows.length) return <p className="body-sm muted">No entries.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {headers.length ? (
          <thead>
            <tr>{headers.map((h, i) => <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 15, verticalAlign: 'middle' }}>{h}</th>)}</tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((r, i) => ('group' in r ? (
            <tr key={i}><td colSpan={cols} style={{ ...td, textAlign: 'left', fontWeight: 700, background: 'var(--bg-surface-2)' }}>{r.group}</td></tr>
          ) : (
            <tr key={i}>
              {r.cells.map((cell, j) => (
                <td key={j} colSpan={r.cells.length === 1 && cols > 1 ? cols : undefined} style={{ ...td, textAlign: r.cells.length === 1 ? 'left' : 'center' }}>
                  <CellControls cell={cell} ctx={ctx} />
                </td>
              ))}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

function CellControls({ cell, ctx }: { cell: { text: string; controls: AppControl[] }; ctx: RenderCtx }) {
  // A tick box's own words are already in the cell's text: show it once.
  const checks = cell.controls.filter((c) => c.type === 'checkbox' || c.type === 'radio');
  const others = cell.controls.filter((c) => !checks.includes(c));
  return (
    <div className="col" style={{ gap: 6, alignItems: 'inherit' }}>
      {checks.length ? (
        <div className="row" style={{ gap: 8, alignItems: 'flex-start', justifyContent: 'inherit' }}>
          {checks.map((c) => (
            <input key={c.ref} type={c.type} aria-label={c.label || 'Select'} checked={!!c.checked} disabled={ctx.busy || c.disabled}
              onChange={(e) => ctx.set(c, { checked: c.type === 'radio' ? true : e.target.checked })} style={{ marginTop: 3 }} />
          ))}
          {cell.text ? <span style={{ whiteSpace: 'pre-line' }}>{cell.text}</span> : null}
        </div>
      ) : cell.text ? <span>{cell.text}</span> : null}
      {others.map((c) => (
        c.tag === 'select' || c.tag === 'textarea' || (c.tag === 'input' && !['button', 'submit', 'reset'].includes(c.type))
          ? <FieldInput key={c.ref} id={`pa-${c.ref}`} c={c} ctx={ctx} />
          : <span key={c.ref} style={{ opacity: c.disabled ? 0.5 : 1 }}><CtlButton c={c} ctx={ctx} small /></span>
      ))}
    </div>
  );
}
