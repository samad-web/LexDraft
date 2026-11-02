import { useEffect, useMemo, useState } from 'react';
import { PortalModal } from '../PortalKit';
import {
  CHANGES_ACCOUNT, portalError, useVakalatScreen, useVakalatStep,
  type FillEntry, type LiveCell, type LiveClick, type LiveControl, type LiveFile, type LiveItem, type LiveMessage,
  type LiveScreen, type LiveStep, type LiveStepResult, type LiveTable, type VakalatView,
} from '@/hooks/efiling/vakalat';

// =============================================================================
// The portal's Vakalat menu (Assign Partners to Case, Accept Offer, Print
// Vakalat) and My Partners (Add Partners, Accept Partnership, Revoke
// Partnership, Accept Revocation, My Partners Report), live.
//
// DifAi draws exactly what the advocate's own portal page shows - its
// headings, text, fields (with the portal's labels, choices and required
// marks), buttons and tables, in the portal's order - and every change goes
// back to that page: picking a choice or ticking a box runs the portal's own
// handler there (cascades, partners list, Send OTP enabling ...), a button
// is pressed there. OTPs are typed by the advocate. A button that changes
// the account (Submit, Add, Accept, Revoke, Remove ...) and any question the
// portal itself asks (its confirm()) are confirmed in DifAi first.
// Monochrome; no red.
// =============================================================================

/** The Vakalat menu, in the portal's order. */
export const VAKALAT_ITEMS: ReadonlyArray<{ id: VakalatView; label: string }> = [
  { id: 'vakalat', label: 'Assign Partners to Case' },
  { id: 'accept_offer', label: 'Accept Offer' },
  { id: 'print_vakalat', label: 'Print Vakalat' },
];

/** The My Partners menu, in the portal's order. */
export const PARTNERS_ITEMS: ReadonlyArray<{ id: VakalatView; label: string }> = [
  { id: 'add_partner', label: 'Add Partners' },
  { id: 'accept_partnership', label: 'Accept Partnership' },
  { id: 'revoke_partnership', label: 'Revoke Partnership' },
  { id: 'accept_revocation', label: 'Accept Revocation' },
  { id: 'partners_report', label: 'My Partners Report' },
];

export function PortalVakalat({ sessionId, view }: { sessionId: string; view: VakalatView }) {
  const screen = useVakalatScreen(sessionId, view);
  const step = useVakalatStep(sessionId, view);
  const label = [...VAKALAT_ITEMS, ...PARTNERS_ITEMS].find((i) => i.id === view)?.label ?? '';
  return (
    <LiveScreenPanel
      label={label}
      screen={screen.data}
      loading={screen.isLoading}
      error={screen.error ? portalError(screen.error) : null}
      onReload={() => void screen.refetch()}
      onStep={(s) => step.mutateAsync(s)}
      busy={step.isPending || screen.isFetching}
    />
  );
}

// ---- the live screen, shared with the Portfolio screens ---------------------------------------

/** A live portal screen with its loading / error states. */
export function LiveScreenPanel({ label, screen, loading, error, onReload, onStep, busy }: {
  label: string;
  screen: LiveScreen | undefined;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onStep: (step: LiveStep) => Promise<LiveStepResult>;
  busy: boolean;
}) {
  if (loading) return <p className="body-sm muted">Opening {label} on filing.ecourts.gov.in…</p>;
  if (error && !screen) {
    return (
      <div className="col" style={{ gap: 8 }}>
        <p className="body-sm">{error}</p>
        <div><button type="button" className="btn btn-ghost btn-sm" onClick={onReload}>Open {label} again</button></div>
      </div>
    );
  }
  if (!screen) return null;
  return <LiveScreenView screen={screen} onStep={onStep} busy={busy} onReload={onReload} />;
}

type Value = string | string[] | boolean;

const valueOf = (c: LiveControl): Value => (c.type === 'checkbox' || c.type === 'radio' ? !!c.checked
  : c.type === 'select-multiple' ? (c.options ?? []).filter((o) => o.selected).map((o) => o.value) : c.value);

const fillOf = (c: LiveControl, v: Value): FillEntry => (typeof v === 'boolean' ? { key: c.key, checked: v } : { key: c.key, value: v });

/** Every field on the screen, by key (table cells included). */
function allControls(items: LiveItem[]): Map<string, LiveControl> {
  const m = new Map<string, LiveControl>();
  const cells = (cs: LiveCell[] | undefined) => { for (const c of cs ?? []) for (const x of c.controls) m.set(x.key, x); };
  for (const it of items) {
    if (it.kind === 'control') m.set(it.control.key, it.control);
    if (it.kind === 'table') {
      cells(it.table.filters);
      for (const r of it.table.rows) if ('cells' in r) cells(r.cells);
    }
  }
  return m;
}

const pill = (primary: boolean): React.CSSProperties => ({
  borderRadius: 999, minWidth: 96, padding: '6px 16px', fontWeight: 600, cursor: 'pointer', font: 'inherit', fontSize: 14,
  border: '1px solid var(--text-primary)',
  background: primary ? 'var(--bg-inverse)' : 'var(--bg-surface)', color: primary ? 'var(--text-inverse)' : 'var(--text-primary)',
});

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', color: 'inherit', cursor: 'pointer' };

/**
 * The portal page as it is now. Choices and ticks go to the portal at once
 * (its handlers react there); typed text goes with the next button.
 */
export function LiveScreenView({ screen, onStep, busy, onReload }: {
  screen: LiveScreen;
  onStep: (step: LiveStep) => Promise<LiveStepResult>;
  busy: boolean;
  onReload?: () => void;
}) {
  const controls = useMemo(() => allControls(screen.items), [screen]);
  // Typed text not yet on the portal page.
  const [dirty, setDirty] = useState<Record<string, Value>>({});
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ question: string; step: LiveStep } | null>(null);
  const [file, setFile] = useState<{ url: string; name: string; type: string } | null>(null);
  useEffect(() => { setDirty({}); }, [screen]);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  const pending = (): FillEntry[] => Object.entries(dirty).flatMap(([k, v]) => {
    const c = controls.get(k);
    return c ? [fillOf(c, v)] : [];
  });

  const run = async (s: LiveStep) => {
    setError(null);
    try {
      const r = await onStep(s);
      // The portal asked its own question and DifAi answered Cancel: ask the advocate.
      const q = r.messages.find((m) => m.kind === 'confirm');
      if (q && !s.confirmed) {
        setAsk({ question: q.text, step: { ...s, confirmed: true } });
        setMessages(r.messages.filter((m) => m.kind !== 'confirm'));
        return;
      }
      setMessages(r.messages.filter((m) => m.kind !== 'confirm'));
      if (r.file) showFile(r.file);
    } catch (err) {
      setError(portalError(err));
    }
  };

  const showFile = (f: LiveFile) => {
    const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
    setFile({ url: URL.createObjectURL(new Blob([bytes], { type: f.contentType })), name: f.name, type: f.contentType });
  };

  /** A choice / tick: straight to the portal page, with any typed text before it. */
  const change = (c: LiveControl, v: Value) => {
    const rest = pending().filter((f) => f.key !== c.key);
    void run({ fill: [...rest, fillOf(c, v)] });
  };
  const type = (c: LiveControl, v: string) => setDirty((d) => ({ ...d, [c.key]: v }));

  const press = (b: LiveClick) => {
    const s: LiveStep = { fill: pending(), press: { text: b.text, nth: b.nth } };
    if (CHANGES_ACCOUNT.test(b.text)) setAsk({ question: `Press "${b.text}" on the eFiling portal? This changes your portal account.`, step: { ...s, confirmed: true } });
    else void run(s);
  };

  const hasDirty = Object.keys(dirty).length > 0;
  const field = (c: LiveControl, compact = false) => (
    <LiveField key={c.key} control={c} value={dirty[c.key] ?? valueOf(c)} busy={busy} compact={compact} onChange={change} onType={type} />
  );
  const button = (b: LiveClick) => (
    b.kind === 'link'
      ? <button key={`${b.text}#${b.nth}`} type="button" style={linkBtn} disabled={busy} onClick={() => press(b)}>{b.text}</button>
      : <button key={`${b.text}#${b.nth}`} type="button" style={{ ...pill(true), opacity: b.disabled && !hasDirty ? 0.45 : 1 }} disabled={busy || (b.disabled && !hasDirty)} onClick={() => press(b)}>{b.text}</button>
  );

  // Consecutive fields / buttons sit in one grid / row, as the portal lays them out.
  const blocks: React.ReactNode[] = [];
  let fields: LiveControl[] = [];
  let clicks: LiveClick[] = [];
  const flush = () => {
    if (fields.length) {
      const f = fields;
      blocks.push(<div key={`f${blocks.length}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '12px 28px' }}>{f.map((c) => field(c))}</div>);
    }
    if (clicks.length) {
      const b = clicks;
      blocks.push(<div key={`b${blocks.length}`} className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>{b.map(button)}</div>);
    }
    fields = [];
    clicks = [];
  };
  screen.items.forEach((it, i) => {
    if (it.kind === 'control') { if (clicks.length) flush(); fields.push(it.control); return; }
    if (it.kind === 'click') { clicks.push(it.click); return; }
    flush();
    if (it.kind === 'heading') {
      blocks.push(i === 0
        ? <h2 key={i} className="heading-md" style={{ textAlign: 'center', margin: '4px 0 2px' }}>{it.text}</h2>
        : <div key={i} style={{ padding: '7px 12px', borderRadius: 6, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, fontSize: 14 }}>{it.text}</div>);
    } else if (it.kind === 'text') {
      blocks.push(<TextLines key={i} lines={it.lines} clicks={it.clicks} onPress={press} busy={busy} />);
    } else {
      blocks.push(<LiveTableView key={i} table={it.table} field={(c) => field(c, true)} button={button} onPress={press} busy={busy} />);
    }
  });
  flush();

  return (
    <div className="col" style={{ gap: 14 }} aria-label={screen.label} aria-busy={busy}>
      {messages.length ? (
        <div role="status" className="col" style={{ gap: 4, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)' }}>
          {messages.map((m, i) => <span key={i} className="body-sm" style={{ fontWeight: m.kind === 'error' ? 700 : 500 }}>{m.text}</span>)}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="row body-sm" style={{ gap: 10, alignItems: 'center', fontWeight: 700 }}>
          {error}
          {onReload ? <button type="button" className="btn btn-ghost btn-sm" onClick={onReload}>Open again</button> : null}
        </div>
      ) : null}
      {blocks}
      {busy ? <p className="body-sm muted" style={{ margin: 0 }}>Working on filing.ecourts.gov.in…</p> : null}
      {ask ? (
        <PortalModal title="eFiling portal" level={2} onClose={() => setAsk(null)}>
          <div className="col" style={{ gap: 14 }}>
            <p className="body" style={{ margin: 0 }}>{ask.question}</p>
            <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
              <button type="button" style={pill(true)} onClick={() => { const s = ask.step; setAsk(null); void run(s); }}>OK</button>
              <button type="button" style={pill(false)} onClick={() => setAsk(null)}>Cancel</button>
            </div>
          </div>
        </PortalModal>
      ) : null}
      {file ? (
        <PortalModal title={file.name} level={2} onClose={() => setFile(null)}>
          <div className="col" style={{ gap: 10 }}>
            <a href={file.url} download={file.name} className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }}>Download</a>
            <iframe title={file.name} src={file.url} style={{ width: '100%', height: '75vh', border: '1px solid var(--border-default)', background: '#fff' }} />
          </div>
        </PortalModal>
      ) : null}
    </div>
  );
}

/** Text lines, with the portal's links clickable where they are. */
function TextLines({ lines, clicks, onPress, busy }: { lines: string[]; clicks: LiveClick[]; onPress: (b: LiveClick) => void; busy: boolean }) {
  const used = new Set<LiveClick>();
  return (
    <div className="col body-sm" style={{ gap: 2 }}>
      {lines.map((line, i) => {
        const b = clicks.find((c) => !used.has(c) && line.includes(c.text));
        if (!b) return <span key={i}>{line}</span>;
        used.add(b);
        const at = line.indexOf(b.text);
        return (
          <span key={i}>
            {line.slice(0, at)}
            <button type="button" style={linkBtn} disabled={busy} onClick={() => onPress(b)}>{b.text}</button>
            {line.slice(at + b.text.length)}
          </span>
        );
      })}
    </div>
  );
}

/** One field with the portal's label and required mark. */
function LiveField({ control: c, value, busy, compact, onChange, onType }: {
  control: LiveControl; value: Value; busy: boolean; compact: boolean;
  onChange: (c: LiveControl, v: Value) => void; onType: (c: LiveControl, v: string) => void;
}) {
  const off = busy || c.disabled || c.readOnly;
  const star = c.required ? <span aria-hidden style={{ marginRight: 3 }}>*</span> : null;
  if (c.type === 'checkbox' || c.type === 'radio') {
    return (
      <label className="row body-sm" style={{ gap: 8, alignItems: 'center', fontWeight: 600, minHeight: compact ? undefined : 36, cursor: off ? 'default' : 'pointer', justifyContent: compact ? 'center' : undefined }}>
        <input type={c.type} name={c.name || undefined} checked={value === true} disabled={off} aria-label={c.label || c.value}
          onChange={(e) => onChange(c, c.type === 'radio' ? true : e.target.checked)} />
        {compact ? null : <span>{star}{c.label}</span>}
      </label>
    );
  }
  let input: React.ReactNode;
  if (c.tag === 'select') {
    const multiple = c.type === 'select-multiple';
    input = (
      <select className="input" multiple={multiple} disabled={off} aria-label={c.label || undefined}
        value={multiple ? (value as string[]) : String(value)}
        onChange={(e) => onChange(c, multiple ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value)}
        style={multiple ? { minHeight: 90 } : undefined}>
        {(c.options ?? []).map((o, i) => <option key={`${o.value}-${i}`} value={o.value} disabled={o.disabled}>{o.text}</option>)}
      </select>
    );
  } else if (c.type === 'file') {
    input = <span className="body-sm muted">Choose this file on the portal itself.</span>;
  } else if (c.tag === 'textarea') {
    input = <textarea className="input" disabled={off} value={String(value)} placeholder={c.placeholder} maxLength={c.maxLength} aria-label={c.label || undefined} onChange={(e) => onType(c, e.target.value)} rows={3} />;
  } else {
    input = (
      <input className="input" type={/^(date|number|email|tel|password)$/.test(c.type) ? c.type : 'text'} disabled={off} value={String(value)}
        placeholder={c.placeholder} maxLength={c.maxLength} aria-label={c.label || undefined} autoComplete="off"
        onChange={(e) => onType(c, e.target.value)} />
    );
  }
  if (compact) return <span>{input}</span>;
  return (
    <label className="col" style={{ gap: 5, minWidth: 0 }}>
      <span className="body-sm" style={{ fontWeight: 600 }}>{star}{c.label}</span>
      {input}
    </label>
  );
}

/** A portal table: titles, its search row, rows with their links, buttons and ticks. */
function LiveTableView({ table, field, button, onPress, busy }: {
  table: LiveTable;
  field: (c: LiveControl) => React.ReactNode;
  button: (b: LiveClick) => React.ReactNode;
  onPress: (b: LiveClick) => void;
  busy: boolean;
}) {
  const cols = Math.max(table.headers.length, ...table.rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', whiteSpace: 'pre-line', fontSize: 14 };
  const cell = (c: LiveCell) => {
    // A cell's text, with its links where they are; buttons and fields after.
    const links = c.clicks.filter((b) => b.kind === 'link');
    const buttons = c.clicks.filter((b) => b.kind === 'button');
    const text = c.text.split('\n').filter((l) => !buttons.some((b) => b.text === l));
    return (
      <div className="col" style={{ gap: 4, alignItems: 'center' }}>
        {c.controls.map(field)}
        {text.length ? <TextLines lines={text} clicks={links} onPress={onPress} busy={busy} /> : null}
        {buttons.length ? <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>{buttons.map(button)}</div> : null}
      </div>
    );
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {table.headers.length || table.filters ? (
          <thead>
            {table.headers.length ? <tr>{table.headers.map((h, i) => <th key={i} style={{ ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700 }}>{h}</th>)}</tr> : null}
            {table.filters ? <tr>{table.filters.map((c, i) => <th key={i} style={{ ...td, background: 'var(--bg-surface-2)' }}>{cell(c)}</th>)}</tr> : null}
          </thead>
        ) : null}
        <tbody>
          {table.rows.length === 0 ? <tr><td colSpan={cols || 1} style={{ ...td, textAlign: 'center' }} className="muted">No data available in table</td></tr> : null}
          {table.rows.map((r, i) => ('group' in r ? (
            <tr key={i}><td colSpan={cols} style={{ ...td, textAlign: 'left', fontWeight: 700, background: 'var(--bg-surface-2)' }}>{r.group}</td></tr>
          ) : (
            <tr key={i} style={{ background: i % 2 ? undefined : 'var(--bg-surface-2)' }}>
              {r.cells.map((c, j) => <td key={j} style={td}>{cell(c)}</td>)}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}
