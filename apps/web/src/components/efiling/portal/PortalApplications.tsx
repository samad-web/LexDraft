import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PortalModal } from '@/components/efiling/PortalKit';
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

// The portal's links that open a document (an application) rather than a step.
const DOC_LINK = /^view\b/i;

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

  const ctx: RenderCtx = { busy, drafts, setDraft: (ref, v) => setDrafts((d) => ({ ...d, [ref]: v })), commit, set, press };

  return (
    <section className="col" style={{ gap: 16 }} aria-label={SCREEN_LABEL[screen]}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="body-sm muted">Applications &gt; {SCREEN_LABEL[screen]} - on your account at filing.ecourts.gov.in</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => ({ kind: 'reopen' }))}>
          {busy ? 'Working on the portal…' : 'Refresh from portal'}
        </button>
      </div>

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

      {s ? (
        <div className="col" style={{ gap: 14, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', padding: 16 }} aria-busy={busy}>
          {s.tabs.length ? (
            <div role="tablist" className="row" style={{ gap: 0, borderBottom: '2px solid var(--bg-inverse)', flexWrap: 'wrap' }}>
              {s.tabs.map((t) => (
                <button key={t.ref} type="button" role="tab" aria-selected={t.active} disabled={busy}
                  onClick={() => onControl(t.ref, (r) => ({ kind: 'press', ref: r }))}
                  style={{
                    padding: '10px 18px', border: '1px solid var(--border-default)', borderBottom: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 15,
                    background: t.active ? 'var(--bg-inverse)' : 'var(--bg-surface-2)', color: t.active ? 'var(--text-inverse)' : 'var(--text-primary)',
                  }}>{t.text}</button>
              ))}
            </div>
          ) : null}
          <Items items={s.items} ctx={ctx} />
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
}

const labelCol: React.CSSProperties = { flex: '0 0 min(260px, 100%)', fontWeight: 700, textAlign: 'right', paddingTop: 6 };
const fieldRow: React.CSSProperties = { gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' };

/** The portal's items in its order; a run of radios with one name is one choice. */
function Items({ items, ctx }: { items: AppItem[]; ctx: RenderCtx }) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind === 'field' && it.control.type === 'radio') {
      const group: AppControl[] = [it.control];
      while (items[i + 1]?.kind === 'field' && (items[i + 1] as { control: AppControl }).control.type === 'radio'
        && (items[i + 1] as { control: AppControl }).control.name === it.control.name) {
        group.push((items[++i] as { control: AppControl }).control);
      }
      out.push(
        <div key={`r${i}`} role="radiogroup" className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          {group.map((c) => (
            <label key={c.ref} className="row" style={{ gap: 6, alignItems: 'center', cursor: c.disabled ? 'default' : 'pointer' }}>
              <input type="radio" name={`difai-${c.name}`} checked={!!c.checked} disabled={ctx.busy || c.disabled} onChange={() => ctx.set(c, { checked: true })} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>,
      );
      continue;
    }
    out.push(<Item key={i} it={it} ctx={ctx} />);
  }
  return <>{out}</>;
}

function Item({ it, ctx }: { it: AppItem; ctx: RenderCtx }) {
  switch (it.kind) {
    case 'heading':
      return <h3 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700 }}>{it.text}</h3>;
    case 'text':
      return it.label ? (
        <div className="row" style={fieldRow}>
          <span style={labelCol}>{it.label}</span>
          <span style={{ flex: '1 1 260px', paddingTop: 6, whiteSpace: 'pre-line' }}>{it.text}</span>
        </div>
      ) : <p style={{ margin: 0, whiteSpace: 'pre-line', fontWeight: /:$/.test(it.text) ? 700 : undefined }}>{it.text}</p>;
    case 'button':
      return <div><PortalButton c={it.control} ctx={ctx} /></div>;
    case 'field':
      return <Field c={it.control} ctx={ctx} />;
    case 'table':
      return <AppTable headers={it.headers} rows={it.rows} ctx={ctx} />;
  }
}

function PortalButton({ c, ctx, small }: { c: AppControl; ctx: RenderCtx; small?: boolean }) {
  if (c.tag === 'a') {
    // A link where the portal has one (View, a page number ...).
    return (
      <button type="button" disabled={ctx.busy || c.disabled} onClick={() => ctx.press(c)}
        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', color: 'inherit', cursor: 'pointer' }}>{c.label || 'Open'}</button>
    );
  }
  return (
    <button type="button" className={`btn btn-sm ${small ? 'btn-ghost' : 'btn-primary'}`} disabled={ctx.busy || c.disabled} onClick={() => ctx.press(c)}>
      {c.label || 'Go'}
    </button>
  );
}

const isDate = (c: AppControl) => /date/i.test(`${c.id} ${c.name}`);

/** A field as the portal lays it out: its label on the left, the field on the right. */
function Field({ c, ctx }: { c: AppControl; ctx: RenderCtx }) {
  const id = `pa-${c.ref}`;
  if (c.type === 'checkbox') {
    return (
      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={!!c.checked} disabled={ctx.busy || c.disabled} onChange={(e) => ctx.set(c, { checked: e.target.checked })} />
        <span>{c.label}</span>
        {c.error ? <span className="body-sm" role="alert" style={{ fontWeight: 700 }}>{c.error}</span> : null}
      </label>
    );
  }
  return (
    <div className="row" style={fieldRow}>
      <label htmlFor={id} style={labelCol}>{c.label}</label>
      <div className="col" style={{ flex: '1 1 320px', gap: 4, minWidth: 0 }}>
        <FieldInput id={id} c={c} ctx={ctx} />
        {c.error ? <span className="body-sm" role="alert" style={{ fontWeight: 700 }}>{c.error}</span> : null}
      </div>
    </div>
  );
}

function FieldInput({ id, c, ctx }: { id: string; c: AppControl; ctx: RenderCtx }) {
  const off = ctx.busy || c.disabled;
  if (c.tag === 'select') {
    return (
      <select id={id} className="input" value={c.value} disabled={off} onChange={(e) => ctx.set(c, { value: e.target.value })}>
        {(c.options ?? []).map((o, i) => <option key={`${o.value}-${i}`} value={o.value}>{o.text}</option>)}
      </select>
    );
  }
  if (c.type === 'file') return <span className="body-sm muted">Attach this file on the portal page itself.</span>;
  const value = ctx.drafts[c.ref] ?? c.value;
  const common = {
    id, value, disabled: off, readOnly: c.readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => ctx.setDraft(c.ref, e.target.value),
    onBlur: () => ctx.commit(c),
  };
  if (c.tag === 'textarea') return <textarea className="input" rows={4} {...common} style={{ width: '100%', resize: 'vertical' }} />;
  const otp = c.id === 'user_otp';
  return (
    <input className="input" type="text" {...common}
      placeholder={isDate(c) ? 'DD-MM-YYYY' : undefined}
      inputMode={otp ? 'numeric' : undefined} autoComplete={otp ? 'one-time-code' : 'off'}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{ maxWidth: otp || isDate(c) ? 220 : undefined }} />
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
          : <span key={c.ref} style={{ opacity: c.disabled ? 0.5 : 1 }}><PortalButton c={c} ctx={ctx} small /></span>
      ))}
    </div>
  );
}
