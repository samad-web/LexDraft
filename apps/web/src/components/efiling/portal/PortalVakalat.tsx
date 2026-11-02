import { useEffect, useMemo, useState } from 'react';
import { PortalModal } from '../PortalKit';
import { PortalButton, PortalFormRow, PortalInput, PortalSearchCase, PortalSelect, PortalTabs, Star } from '../PortalForm';
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
//
// Laid out as the portal lays these pages out: its Help / Delete icons at
// the top right, the page title centred, "Fields marked with * ..." notes,
// label | field rows, the Search Case box, "Type of Case: ○ ○" rows, the
// DataTables parts (Show N entries, search row above the titles, "Showing a
// to b of n entries" with Previous · 1 · Next), tab strips over a bordered
// table, the Search Cases "Search by CNR | Advance Search" strip with its
// CNR [ ] Search line, and the Planner's month grid. Monochrome; no red.
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
        <div><PortalButton outline onClick={onReload}>Open {label} again</PortalButton></div>
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

const isTick = (c: LiveControl) => c.type === 'checkbox' || c.type === 'radio';

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

const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', color: 'inherit', cursor: 'pointer' };

// ---- what the portal page is made of, as blocks laid out like the portal's ---------------------

/** "No Record Present", "No record found", "No data available in table" ... */
const EMPTY = /^no (record|data|matching|entries)/i;
const TOOL = /^(help|delete)$/i;
const OUTLINE = /^(reset|clear|cancel|back|close|today)$/i;

type Block =
  | { k: 'tools'; clicks: LiveClick[] }
  | { k: 'title'; text: string }
  | { k: 'heading'; text: string }
  | { k: 'note'; text: string; band: boolean }
  | { k: 'text'; lines: string[]; clicks: LiveClick[] }
  | { k: 'fields'; controls: LiveControl[] }
  | { k: 'choices'; label: string; controls: LiveControl[] }
  | { k: 'searchCase'; label: string; choices: LiveControl[]; picker: LiveControl }
  | { k: 'buttons'; clicks: LiveClick[] }
  | { k: 'searchLine'; tabs: LiveClick[]; control: LiveControl; go: LiveClick }
  | { k: 'toolbar'; text: string; clicks: LiveClick[] }
  | { k: 'length'; control: LiveControl }
  | { k: 'table'; table: LiveTable; tabs?: LiveClick[] }
  | { k: 'calendar'; weeks: CalDay[][]; days: string[] }
  | { k: 'pager'; info: string; clicks: LiveClick[] };

const colsOf = (t: LiveTable) => Math.max(t.headers.length, ...t.rows.map((r) => ('cells' in r ? r.cells.length : 0)));

/**
 * The portal's page as read, made whole where it was read flat: a page laid
 * out inside one table cell (Revoke Partnership: title, column titles, "No
 * Record Present"), and a header-only grid followed by its body grid (a
 * calendar) as one table.
 */
function normalize(items: LiveItem[]): LiveItem[] {
  const out: LiveItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind === 'table') {
      const t = it.table;
      const r0 = t.rows[0];
      const only = !t.headers.length && t.rows.length === 1 && r0 && 'cells' in r0 && r0.cells.length === 1 ? r0.cells[0]! : null;
      if (only && !only.controls.length && !only.clicks.length) {
        const lines = only.text.split('\n').filter(Boolean);
        if (lines.length >= 3 && EMPTY.test(lines[lines.length - 1]!)) {
          out.push({ kind: 'heading', text: lines[0]! });
          out.push({ kind: 'table', table: { ...t, headers: lines.slice(1, -1), rows: [{ group: lines[lines.length - 1]! }] } });
          continue;
        }
      }
      const next = items[i + 1];
      if (t.headers.length && !t.rows.length && next?.kind === 'table' && !next.table.headers.length && colsOf(next.table) === t.headers.length) {
        out.push({ kind: 'table', table: { ...next.table, headers: t.headers, ...(t.filters ? { filters: t.filters } : {}) } });
        i++;
        continue;
      }
    }
    out.push(it);
  }
  return out;
}

const pagerOf = (clicks: LiveClick[]) => clicks.some((c) => /^previous$/i.test(c.text)) && clicks.some((c) => /^next$/i.test(c.text));

/** Read the screen into the portal's page parts, in its order. */
function blocksOf(screen: LiveScreen): Block[] {
  const items = normalize(screen.items);
  const clickAt = (j: number) => { const x = items[j]; return x?.kind === 'click' ? x.click : null; };
  const controlAt = (j: number) => { const x = items[j]; return x?.kind === 'control' ? x.control : null; };
  const out: Block[] = [];
  const tools: LiveClick[] = [];
  let content = false;
  let titled = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const next = items[i + 1];
    if (it.kind === 'click' && TOOL.test(it.click.text) && !content) { tools.push(it.click); continue; }
    if (it.kind === 'heading') {
      // A month title with today / prev / next, then its grid (the Planner).
      let j = i + 1;
      const bar: LiveClick[] = [];
      for (let c = clickAt(j); c; c = clickAt(++j)) bar.push(c);
      if (bar.length && items[j]?.kind === 'table') { out.push({ k: 'toolbar', text: it.text, clicks: bar }); i = j - 1; content = true; continue; }
      if (!titled && !content) { out.push({ k: 'title', text: it.text }); titled = true; continue; }
      out.push({ k: 'heading', text: it.text });
      content = true;
      continue;
    }
    content = true;
    if (it.kind === 'text') {
      const line = it.lines[0] ?? '';
      if (it.lines.length === 1 && /^fields marked with \*/i.test(line)) { out.push({ k: 'note', text: line, band: /mandatory/i.test(line) }); continue; }
      // "Showing a to b of n entries" and Previous · 1 · Next under a list.
      if (it.lines.length === 1 && /^showing \d/i.test(line)) {
        if (next?.kind === 'text' && pagerOf(next.clicks)) { out.push({ k: 'pager', info: line, clicks: next.clicks }); i++; continue; }
        out.push({ k: 'pager', info: line, clicks: [] });
        continue;
      }
      if (pagerOf(it.clicks) && it.lines.length === 1) { out.push({ k: 'pager', info: '', clicks: it.clicks }); continue; }
      // Links that are a tab strip over the table under them (My Partners Report).
      if (it.lines.length >= 2 && next?.kind === 'table' && it.clicks.length === it.lines.length && it.lines.every((l, n) => it.clicks[n]?.text === l)) {
        out.push({ k: 'table', table: next.table, tabs: it.clicks });
        i++;
        continue;
      }
      // "Type of Case:" (or "Search Case") and its choices.
      if (it.lines.length === 1 && next?.kind === 'control' && isTick(next.control) && next.control.type === 'radio') {
        const ticks: LiveControl[] = [];
        let j = i + 1;
        for (let c = controlAt(j); c && isTick(c); c = controlAt(++j)) ticks.push(c);
        const after = items[j];
        if (/search\s*case/i.test(line) && after?.kind === 'control' && after.control.tag === 'select') {
          out.push({ k: 'searchCase', label: line.replace(/\s*:$/, ''), choices: ticks, picker: after.control });
          i = j;
          continue;
        }
        out.push({ k: 'choices', label: line, controls: ticks });
        i = j - 1;
        continue;
      }
      out.push({ k: 'text', lines: it.lines, clicks: it.clicks });
      continue;
    }
    if (it.kind === 'control') {
      const c = it.control;
      if (c.tag === 'select' && /_length$/.test(c.name)) { out.push({ k: 'length', control: c }); continue; }
      const prev = out[out.length - 1];
      if (isTick(c)) {
        if (prev?.k === 'choices' && !prev.label) prev.controls.push(c);
        else out.push({ k: 'choices', label: '', controls: [c] });
        continue;
      }
      if (prev?.k === 'fields') prev.controls.push(c);
      else out.push({ k: 'fields', controls: [c] });
      continue;
    }
    if (it.kind === 'click') {
      const run: LiveClick[] = [];
      let j = i;
      for (let c = clickAt(j); c; c = clickAt(++j)) run.push(c);
      // "Search by CNR | Advance Search" then "CNR [ ] Search" on one line (Search Cases).
      const f = items[j];
      const go = items[j + 1];
      if (run.length >= 2 && f?.kind === 'control' && !isTick(f.control) && go?.kind === 'click' && items[j + 2]?.kind !== 'click') {
        out.push({ k: 'searchLine', tabs: run, control: f.control, go: go.click });
        i = j + 1;
        continue;
      }
      out.push({ k: 'buttons', clicks: run });
      i = j - 1;
      continue;
    }
    const cal = calendarOf(it.table);
    out.push(cal ? { k: 'calendar', ...cal } : { k: 'table', table: it.table });
  }
  return tools.length ? [{ k: 'tools', clicks: tools }, ...out] : out;
}

// ---- the Planner's month ------------------------------------------------------------------------

interface CalDay { day: string; link?: LiveClick; events: Array<{ text: string; click?: LiveClick }>; out: boolean }
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A month grid (FullCalendar): its weeks of days, each day's number link and its case counts. */
function calendarOf(t: LiveTable): { weeks: CalDay[][]; days: string[] } | null {
  if (!/^sun(day)?mon(day)?tue(sday)?wed(nesday)?thu(rsday)?fri(day)?sat(urday)?$/i.test(t.headers.join('').replace(/\s+/g, ''))) return null;
  const days = t.headers.length === 7 ? t.headers : DAY_NAMES;
  const flat: CalDay[] = [];
  const rows = t.rows.filter((r): r is { cells: LiveCell[] } => 'cells' in r);
  if (rows.length === 1 && rows[0]!.cells.length === 1) {
    // Read as one cell: the day numbers in order, each case count after its day.
    const cell = rows[0]!.cells[0]!;
    const clicks = [...cell.clicks];
    let prev = 0;
    for (const line of cell.text.split('\n').filter(Boolean)) {
      const click = clicks[0]?.text === line ? clicks.shift() : undefined;
      const n = Number(line);
      if (/^\d{1,2}$/.test(line) && (!flat.length || n === prev + 1 || (n === 1 && prev >= 28))) {
        flat.push({ day: line, link: click, events: [], out: false });
        prev = n;
      } else if (flat.length) flat[flat.length - 1]!.events.push({ text: line, click });
    }
  } else {
    for (const r of rows) {
      for (const c of r.cells) {
        const [day = '', ...rest] = c.text.split('\n').filter(Boolean);
        const clicks = [...c.clicks];
        const link = clicks[0]?.text === day ? clicks.shift() : undefined;
        flat.push({ day, link, events: rest.map((text) => ({ text, click: clicks[0]?.text === text ? clicks.shift() : undefined })), out: false });
      }
    }
  }
  if (!flat.length || flat.length % 7) return null;
  const first = flat.findIndex((d) => d.day === '1');
  const second = flat.findIndex((d, i) => i > first && d.day === '1');
  flat.forEach((d, i) => { d.out = i < first || (second >= 0 && i >= second); });
  const weeks: CalDay[][] = [];
  for (let i = 0; i < flat.length; i += 7) weeks.push(flat.slice(i, i + 7));
  return { weeks, days };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Today's day number when the month shown is this month. */
function todayIn(title: string): string | null {
  const m = /([a-z]+)\s+(\d{4})/i.exec(title);
  if (!m) return null;
  const now = new Date();
  return MONTHS.indexOf(m[1]!.toLowerCase()) === now.getMonth() && Number(m[2]) === now.getFullYear() ? String(now.getDate()) : null;
}

// ---- the screen -------------------------------------------------------------------------------

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
  const blocks = useMemo(() => blocksOf(screen), [screen]);
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
  const off = (b: LiveClick) => busy || (b.disabled && !hasDirty);
  const input = (c: LiveControl, compact = false) => (
    <LiveField key={c.key} control={c} value={dirty[c.key] ?? valueOf(c)} busy={busy} compact={compact} onChange={change} onType={type} />
  );
  const button = (b: LiveClick) => (
    b.kind === 'link'
      ? <button key={`${b.text}#${b.nth}`} type="button" style={linkBtn} disabled={busy} onClick={() => press(b)}>{b.text}</button>
      : <PortalButton key={`${b.text}#${b.nth}`} outline={OUTLINE.test(b.text)} disabled={off(b)} onClick={() => press(b)}>{b.text}</PortalButton>
  );

  const toolRow = (b: { clicks: LiveClick[] }, style?: React.CSSProperties) => (
    <div className="row" style={{ justifyContent: 'flex-end', gap: 8, ...style }}>
      {b.clicks.map((c) => (
        <button key={`${c.text}#${c.nth}`} type="button" aria-label={c.text} title={c.text} disabled={off(c)} onClick={() => press(c)} style={roundTool}>
          {/^delete$/i.test(c.text) ? <TrashIcon /> : <span aria-hidden style={{ fontWeight: 800, fontSize: 16 }}>?</span>}
        </button>
      ))}
    </div>
  );
  // The Help / Delete icons share the title's line, at the right.
  const titleTools = blocks[0]?.k === 'tools' && blocks[1]?.k === 'title' ? blocks[0] : null;

  const draw = (b: Block, i: number): React.ReactNode => {
    switch (b.k) {
      case 'tools':
        return b === titleTools ? null : <div key={i}>{toolRow(b)}</div>;
      case 'title':
        return (
          <div key={i} style={{ position: 'relative', minHeight: titleTools ? 34 : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: titleTools ? '0 90px' : undefined }}>
            {titleTools && i === 1 ? toolRow(titleTools, { position: 'absolute', top: 0, right: 0 }) : null}
            <h2 style={{ margin: 0, textAlign: 'center', fontSize: 22, fontWeight: 700 }}>{b.text}</h2>
          </div>
        );
      case 'heading':
        return <h3 key={i} style={{ margin: '4px 0 0', fontSize: 17, fontWeight: 700 }}>{b.text}</h3>;
      case 'note':
        return b.band
          ? <div key={i} style={{ padding: '10px 12px', background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)', fontWeight: 700, fontSize: 14 }}>{b.text}</div>
          : <p key={i} style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{b.text}</p>;
      case 'text':
        return <TextLines key={i} lines={b.lines} clicks={b.clicks} onPress={press} busy={busy} />;
      case 'fields':
        return (
          <div key={i} style={formCol}>
            {b.controls.map((c) => (
              <PortalFormRow key={c.key} label={c.label} required={c.required} labelAlign="left">{input(c, true)}</PortalFormRow>
            ))}
          </div>
        );
      case 'choices': {
        const ticks = <div className="row" style={{ gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>{b.controls.map((c) => input(c))}</div>;
        return b.label
          ? <div key={i} style={formCol}><PortalFormRow label={b.label} labelAlign="left">{ticks}</PortalFormRow></div>
          : <div key={i} style={formCol}>{ticks}</div>;
      }
      case 'searchCase':
        return (
          <PortalSearchCase key={i} label={b.label} pickerLabel={b.picker.label || 'Search Keyword'} required={b.picker.required}
            choices={b.choices.map((c) => input(c))} picker={input(b.picker, true)} />
        );
      case 'buttons':
        return <div key={i} className="row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>{b.clicks.map(button)}</div>;
      case 'searchLine': {
        const on = b.tabs.find((t) => t.active) ?? b.tabs[0];
        return (
          <div key={i} className="row" style={{ gap: 32, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid var(--border-default)' }}>
            <span role="group" className="row" style={{ gap: 0, border: '1px solid var(--bg-inverse)', borderRadius: 4, overflow: 'hidden' }}>
              {b.tabs.map((t, n) => (
                <button key={`${t.text}#${t.nth}`} type="button" aria-pressed={t === on} disabled={off(t)} onClick={() => press(t)}
                  style={{ ...segment(t === on), borderLeft: n ? '1px solid var(--bg-inverse)' : 'none' }}>{t.text}</button>
              ))}
            </span>
            <span className="row" style={{ gap: 8, alignItems: 'center', margin: '0 auto' }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{b.control.label}{b.control.required ? <Star /> : null}</span>
              <span style={{ width: 200 }}>{input(b.control, true)}</span>
              <PortalButton disabled={off(b.go)} onClick={() => press(b.go)} icon={<SearchIcon />}>{b.go.text}</PortalButton>
            </span>
          </div>
        );
      }
      case 'toolbar':
        return (
          <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', width: '100%', maxWidth: 920, margin: '0 auto' }}>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{b.text}</h2>
            <span className="row" style={{ gap: 10, alignItems: 'center' }}>
              {b.clicks.filter((c) => !/^(prev|next)$/i.test(c.text)).map(button)}
              {b.clicks.some((c) => /^(prev|next)$/i.test(c.text)) ? (
                <span className="row" style={{ gap: 0, borderRadius: 4, overflow: 'hidden' }}>
                  {b.clicks.filter((c) => /^(prev|next)$/i.test(c.text)).map((c, n) => (
                    <button key={c.text} type="button" aria-label={c.text} title={c.text} disabled={off(c)} onClick={() => press(c)}
                      style={{ ...segment(true), padding: '6px 14px', fontSize: 16, borderLeft: n ? '1px solid var(--text-inverse)' : 'none' }}>{/^prev$/i.test(c.text) ? '‹' : '›'}</button>
                  ))}
                </span>
              ) : null}
            </span>
          </div>
        );
      case 'length':
        return (
          <label key={i} className="row" style={{ gap: 6, alignItems: 'center', fontSize: 14 }}>
            Show <span style={{ width: 90 }}>{input(b.control, true)}</span> entries
          </label>
        );
      case 'table':
        return <LiveTableView key={i} table={b.table} tabs={b.tabs} field={(c) => input(c, true)} button={button} onPress={press} busy={busy} />;
      case 'calendar':
        return <CalendarView key={i} weeks={b.weeks} days={b.days} today={todayIn(screen.title)} onPress={press} busy={busy} />;
      case 'pager': {
        const pages = b.clicks.filter((c) => /^\d+$/.test(c.text));
        const current = pages.find((c) => c.active) ?? (pages.length === 1 ? pages[0] : undefined);
        return (
          <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14 }}>
            <span>{b.info}</span>
            <span className="row" style={{ gap: 4, alignItems: 'center' }}>
              {b.clicks.map((c) => (
                <button key={`${c.text}#${c.nth}`} type="button" disabled={busy || c.disabled} onClick={() => press(c)} aria-current={c === current ? 'page' : undefined}
                  style={{
                    padding: '5px 12px', fontSize: 14, borderRadius: 3, cursor: c.disabled ? 'default' : 'pointer', color: 'var(--text-primary)', opacity: c.disabled ? 0.5 : 1,
                    background: c === current ? 'var(--bg-surface-2)' : 'transparent', border: /^\d+$/.test(c.text) ? '1px solid var(--border-default)' : '1px solid transparent',
                  }}>{c.text}</button>
              ))}
            </span>
          </div>
        );
      }
    }
  };

  return (
    <div className="col" style={{ gap: 14 }} aria-label={screen.label} aria-busy={busy}>
      {messages.length ? (
        <div role="status" className="col" style={{ gap: 4, padding: '10px 14px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'var(--bg-surface-2)' }}>
          {messages.map((m, i) => <span key={i} className="body-sm" style={{ fontWeight: m.kind === 'error' ? 700 : 500 }}>{m.text}</span>)}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="row body-sm" style={{ gap: 10, alignItems: 'center', fontWeight: 700 }}>
          {error}
          {onReload ? <PortalButton outline onClick={onReload}>Open again</PortalButton> : null}
        </div>
      ) : null}
      {blocks.map(draw)}
      {!screen.items.length ? (
        <div className="row body-sm" style={{ gap: 10, alignItems: 'center', justifyContent: 'center' }}>
          <span className="muted">The portal page showed nothing to read yet.</span>
          {onReload ? <PortalButton outline disabled={busy} onClick={onReload}>Open again</PortalButton> : null}
        </div>
      ) : null}
      {busy ? <p className="body-sm muted" style={{ margin: 0 }}>Working on filing.ecourts.gov.in…</p> : null}
      {ask ? (
        <PortalModal title="eFiling portal" level={2} onClose={() => setAsk(null)}>
          <div className="col" style={{ gap: 14 }}>
            <p className="body" style={{ margin: 0 }}>{ask.question}</p>
            <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
              <PortalButton onClick={() => { const s = ask.step; setAsk(null); void run(s); }}>OK</PortalButton>
              <PortalButton outline onClick={() => setAsk(null)}>Cancel</PortalButton>
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

/** The portal's form column: label | field rows, centred under the title. */
const formCol: React.CSSProperties = { display: 'grid', rowGap: 12, width: '100%', maxWidth: 620, margin: '0 auto' };

const roundTool: React.CSSProperties = {
  width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'var(--bg-inverse)', color: 'var(--text-inverse)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
};

const segment = (on: boolean): React.CSSProperties => ({
  padding: '7px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none',
  background: on ? 'var(--bg-inverse)' : 'var(--bg-surface-2)', color: on ? 'var(--text-inverse)' : 'var(--text-primary)',
});

function TrashIcon() {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" />
    </svg>
  );
}

/** Text lines, with the portal's links clickable where they are. */
function TextLines({ lines, clicks, onPress, busy }: { lines: string[]; clicks: LiveClick[]; onPress: (b: LiveClick) => void; busy: boolean }) {
  const used = new Set<LiveClick>();
  return (
    <div className="col" style={{ gap: 2, fontSize: 14 }}>
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

/** One field: a tick with its caption, or the bare control (its label is drawn by the row around it). */
function LiveField({ control: c, value, busy, compact, onChange, onType }: {
  control: LiveControl; value: Value; busy: boolean; compact: boolean;
  onChange: (c: LiveControl, v: Value) => void; onType: (c: LiveControl, v: string) => void;
}) {
  const off = busy || c.disabled || c.readOnly;
  if (isTick(c)) {
    return (
      <label className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 700, fontSize: 14, cursor: off ? 'default' : 'pointer', justifyContent: compact ? 'center' : undefined }}>
        <input type={c.type} name={c.name || undefined} checked={value === true} disabled={off} aria-label={c.label || c.value}
          onChange={(e) => onChange(c, c.type === 'radio' ? true : e.target.checked)} />
        {compact ? null : <span>{c.label}{c.required ? <Star /> : null}</span>}
      </label>
    );
  }
  if (c.tag === 'select') {
    const multiple = c.type === 'select-multiple';
    return (
      <PortalSelect multiple={multiple} disabled={off} aria-label={c.label || undefined}
        value={multiple ? (value as string[]) : String(value)}
        onChange={(e) => onChange(c, multiple ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value)}
        style={multiple ? { minHeight: 90, height: 'auto' } : undefined}>
        {(c.options ?? []).map((o, i) => <option key={`${o.value}-${i}`} value={o.value} disabled={o.disabled}>{o.text}</option>)}
      </PortalSelect>
    );
  }
  if (c.type === 'file') return <span className="body-sm muted">Choose this file on the portal itself.</span>;
  if (c.tag === 'textarea') {
    return (
      <textarea disabled={off} value={String(value)} placeholder={c.placeholder} maxLength={c.maxLength} aria-label={c.label || undefined} onChange={(e) => onType(c, e.target.value)} rows={3}
        style={{ width: '100%', padding: '6px 8px', fontSize: 14, border: '1px solid var(--text-primary)', borderRadius: 3, background: 'var(--bg-surface)', color: 'var(--text-primary)', font: 'inherit' }} />
    );
  }
  return (
    <PortalInput type={/^(date|number|email|tel|password)$/.test(c.type) ? c.type : 'text'} disabled={off} value={String(value)}
      placeholder={c.placeholder} maxLength={c.maxLength} aria-label={c.label || undefined} autoComplete="off"
      onChange={(e) => onType(c, e.target.value)} style={compact ? undefined : { maxWidth: 360 }} />
  );
}

/**
 * A portal table. A DataTables list (with its search row): the search row
 * above the titles, both dark. A plain list: bold titles in bordered cells.
 * "No Record Present" centred in a grey row; a list with no rows is just its
 * titles, as on the portal. Tabs over it (My Partners Report): the strip and
 * a bordered box round the table.
 */
function LiveTableView({ table, tabs, field, button, onPress, busy }: {
  table: LiveTable;
  tabs?: LiveClick[];
  field: (c: LiveControl) => React.ReactNode;
  button: (b: LiveClick) => React.ReactNode;
  onPress: (b: LiveClick) => void;
  busy: boolean;
}) {
  const cols = colsOf(table);
  const dark = !!table.filters;
  const td: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'left', whiteSpace: 'pre-line', fontSize: 14 };
  const th: React.CSSProperties = dark
    ? { ...td, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', fontWeight: 700, textAlign: 'center', verticalAlign: 'middle', borderColor: 'var(--text-inverse)' }
    : { ...td, fontWeight: 700, verticalAlign: 'middle' };
  const cell = (c: LiveCell) => {
    // A cell's text, with its links where they are; buttons and fields after.
    const links = c.clicks.filter((b) => b.kind === 'link');
    const buttons = c.clicks.filter((b) => b.kind === 'button');
    const text = c.text.split('\n').filter((l) => l && !buttons.some((b) => b.text === l));
    return (
      <div className="col" style={{ gap: 4 }}>
        {c.controls.map(field)}
        {text.length ? <TextLines lines={text} clicks={links} onPress={onPress} busy={busy} /> : null}
        {buttons.length ? <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{buttons.map(button)}</div> : null}
      </div>
    );
  };
  // The search row holds only its boxes and Search (the column names are the titles under it).
  const filter = (c: LiveCell) => (
    <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
      {c.controls.map(field)}
      {c.clicks.map((b) => <PortalButton key={`${b.text}#${b.nth}`} outline disabled={busy || b.disabled} onClick={() => onPress(b)}>{b.text}</PortalButton>)}
    </div>
  );
  const grid = (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {table.headers.length || table.filters ? (
          <thead>
            {table.filters ? <tr>{table.filters.map((c, i) => <th key={i} style={th}>{filter(c)}</th>)}</tr> : null}
            {table.headers.length ? <tr>{table.headers.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr> : null}
          </thead>
        ) : null}
        <tbody>
          {table.rows.map((r, i) => ('group' in r ? (
            <tr key={i}>
              <td colSpan={cols || 1} style={EMPTY.test(r.group) ? { ...td, textAlign: 'center', background: 'var(--bg-surface-2)' } : { ...td, fontWeight: 700, background: 'var(--bg-surface-2)' }}>{r.group}</td>
            </tr>
          ) : (
            <tr key={i}>{r.cells.map((c, j) => <td key={j} style={td}>{cell(c)}</td>)}</tr>
          )))}
        </tbody>
      </table>
    </div>
  );
  if (!tabs) return grid;
  const on = tabs.find((t) => t.active) ?? tabs[0]!;
  return (
    <div className="col" style={{ gap: 0 }}>
      <PortalTabs bold tabs={tabs.map((t) => ({ key: `${t.text}#${t.nth}`, label: t.text, disabled: busy }))} active={`${on.text}#${on.nth}`}
        onPick={(k) => { const t = tabs.find((x) => `${x.text}#${x.nth}` === k); if (t) onPress(t); }} />
      <div style={{ border: '1px solid var(--border-default)', borderTop: 'none', padding: '20px 4px' }}>{grid}</div>
    </div>
  );
}

/** The Planner's month: day names, weeks of days (number top right), each day's case count. */
function CalendarView({ weeks, days, today, onPress, busy }: {
  weeks: CalDay[][]; days: string[]; today: string | null; onPress: (b: LiveClick) => void; busy: boolean;
}) {
  const td: React.CSSProperties = { border: '1px solid var(--border-default)', verticalAlign: 'top', height: 96, padding: 4, width: `${100 / 7}%` };
  return (
    <div style={{ overflowX: 'auto', width: '100%', maxWidth: 920, margin: '0 auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>{days.map((d) => <th key={d} style={{ ...td, height: 'auto', padding: '6px 4px', textAlign: 'center', fontWeight: 700, fontSize: 14, textTransform: 'uppercase', textDecoration: 'underline' }}>{d}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={i}>
              {w.map((d, j) => (
                <td key={j} style={{ ...td, background: !d.out && d.day === today ? 'var(--bg-surface-2)' : undefined }}>
                  <div style={{ textAlign: 'right', opacity: d.out ? 0.4 : 1 }}>
                    {d.link
                      ? <button type="button" style={{ ...linkBtn, fontWeight: 400, fontSize: 14 }} disabled={busy} onClick={() => onPress(d.link!)}>{d.day}</button>
                      : <span style={{ fontSize: 14 }}>{d.day}</span>}
                  </div>
                  {d.events.map((e, n) => (
                    <button key={n} type="button" disabled={busy || !e.click} onClick={() => e.click && onPress(e.click)}
                      style={{ display: 'block', width: '100%', marginTop: 4, padding: '2px 6px', textAlign: 'left', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 3, background: 'var(--bg-inverse)', color: 'var(--text-inverse)', cursor: e.click ? 'pointer' : 'default' }}>
                      {e.text}
                    </button>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
