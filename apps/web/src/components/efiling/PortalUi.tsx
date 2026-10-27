import { useMemo, useState, type ReactNode } from 'react';

// =============================================================================
// eFiling 3.0 portal (filing.ecourts.gov.in) building blocks, in DifAI's
// monochrome design system. Advocates know the portal's screens, so every
// eFiling screen follows its exact shape (official user manual, eFiling 3.0):
//
//   [★ Initial Inputs][👤 Litigant] ...            plain tabs, no numbers
//   ┌ court · E-Filing Number · Relief · Case Type ┐  summary banner
//   *Note: Case detail tab is compulsary            note line
//              Case Details                         centred tab title
//   ▌Dispute Arising Out Of                         section bar
//   * Label [control]      Label [control]          two pairs per row
//          [Save] [Prev] [Next]                     centred button row
//
// The portal's cyan bars become inverse bars (black in light mode, white in
// dark mode) - structure from the portal, colour from DifAI.
// =============================================================================

/** Centred tab / page title ("Litigant", "Case Details", "Vakalat"). */
export function PortalTitle({ children }: { children: ReactNode }) {
  return <h2 className="heading-md" style={{ textAlign: 'center', margin: '4px 0 2px' }}>{children}</h2>;
}

/** The portal's small note under the tabs ("*Note: ... compulsary"). */
export function PortalNote({ children }: { children: ReactNode }) {
  return <p className="body-sm" style={{ color: 'var(--danger)', margin: 0 }}>{children}</p>;
}

/** Full-width section bar with an optional right-aligned note. */
export function PortalSection({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return (
    <section className="col" style={{ gap: 14 }} aria-label={title}>
      <div
        className="row"
        style={{
          justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '7px 12px', borderRadius: 6, background: 'var(--bg-inverse)', color: 'var(--text-inverse)',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
        {note ? <span style={{ fontSize: 12, fontStyle: 'italic', opacity: 0.85 }}>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** Two label/control pairs per row (one on phones). */
export function PortalGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '12px 28px' }}>
      {children}
    </div>
  );
}

/**
 * One portal field: bold label (red "*" before it when required) and its
 * control. The caption is a single span so tests and screen readers find the
 * control by its label text.
 */
export function PField({ label, required, children, wide, hint }: {
  label: string;
  required?: boolean;
  children: ReactNode;
  wide?: boolean;
  hint?: ReactNode;
}) {
  return (
    <label className="col" style={{ gap: 5, gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
      <span className="body-sm" style={{ fontWeight: 600 }}>
        {required ? <span aria-hidden style={{ color: 'var(--danger)', marginRight: 3 }}>*</span> : null}
        {label}
      </span>
      {children}
      {hint ? <span className="body-sm muted" style={{ fontSize: 12 }}>{hint}</span> : null}
    </label>
  );
}

/** A radio group laid out inline, portal style: (o) Civil (o) Criminal. */
export function PRadios<T extends string>({ label, required, name, value, options, onChange, disabled }: {
  label: string;
  required?: boolean;
  name: string;
  value: T | null | undefined;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="col" style={{ gap: 5 }} role="radiogroup" aria-label={label}>
      <span className="body-sm" style={{ fontWeight: 600 }}>
        {required ? <span aria-hidden style={{ color: 'var(--danger)', marginRight: 3 }}>*</span> : null}
        {label}
      </span>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', minHeight: 36, alignItems: 'center' }}>
        {options.map((o) => (
          <label key={o.value} className="row body-sm" style={{ gap: 6, alignItems: 'center', cursor: disabled ? 'default' : 'pointer' }}>
            <input type="radio" name={name} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/** A checkbox with its caption to the right (Organisation Details, ...). */
export function PCheck({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="row body-sm" style={{ gap: 8, alignItems: 'center', fontWeight: 600, minHeight: 36, cursor: disabled ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Centred row of pill buttons (Submit / Reset, Update / Next, Save / Prev / Next). */
export function PortalButtons({ children }: { children: ReactNode }) {
  return <div className="row" style={{ gap: 10, justifyContent: 'center', flexWrap: 'wrap', paddingTop: 4 }}>{children}</div>;
}

/** Pill button: primary (portal blue Submit/Save/Update) or secondary (grey Reset/Prev/Next). */
export function PButton({ children, primary, danger, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn-sm ${primary ? 'btn-primary' : ''} ${rest.className ?? ''}`}
      style={{ borderRadius: 999, minWidth: 96, ...(danger ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : null), ...rest.style }}
    >
      {children}
    </button>
  );
}

/** The local-language block: rule, centred caps language heading, fields. */
export function LocalLanguageBlock({ language, children }: { language: string | null | undefined; children: ReactNode }) {
  return (
    <div className="col" style={{ gap: 12, borderTop: '1px solid var(--border-default)', paddingTop: 12 }}>
      <span style={{ textAlign: 'center', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {language || 'Local language'}
      </span>
      {children}
    </div>
  );
}

/**
 * The summary banner shown on every wizard tab once Initial Inputs is saved:
 * court, then "E-Filing Number: … - Relief Sought: … - Case Type: …", then the
 * cause title.
 */
export function SummaryBanner({ court, efilingNo, relief, caseType, causeTitle }: {
  court: string | null | undefined;
  efilingNo: string | null | undefined;
  relief: string | null | undefined;
  caseType: string | null | undefined;
  causeTitle: string | null | undefined;
}) {
  const bits: Array<[string, string | null | undefined]> = [['E-Filing Number', efilingNo || 'not issued yet'], ['Relief Sought', relief], ['Case Type', caseType]];
  return (
    <div
      role="note"
      aria-label="Case summary"
      className="col"
      style={{ alignItems: 'center', textAlign: 'center', gap: 3, padding: '10px 14px', borderRadius: 8, background: 'var(--bg-surface-2, var(--bg-subtle))', border: '1px solid var(--border-default)' }}
    >
      <span style={{ fontWeight: 700 }}>{court || 'Court not chosen yet'}</span>
      <span className="body-sm">
        {bits.filter(([, v]) => v).map(([k, v], i) => (
          <span key={k}>{i > 0 ? ' - ' : ''}<strong>{k}:</strong> {v}</span>
        ))}
      </span>
      {causeTitle ? <span className="body-sm" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{causeTitle}</span> : null}
    </div>
  );
}

// ---- tabs ---------------------------------------------------------------------

export type TabState = 'current' | 'available' | 'disabled';

/** The portal's plain tab strip: icon + label, no numbers, no arrows. */
export function PortalTabs<T extends string>({ tabs, value, onChange, label = 'Steps' }: {
  tabs: ReadonlyArray<{ id: T; label: string; icon?: string; disabled?: boolean; done?: boolean }>;
  value: T;
  onChange: (t: T) => void;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="row" style={{ gap: 0, flexWrap: 'wrap', borderBottom: '1px solid var(--border-default)' }}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            disabled={t.disabled}
            onClick={() => onChange(t.id)}
            style={{
              padding: '8px 14px', border: '1px solid', borderBottom: 'none', borderRadius: '6px 6px 0 0', marginBottom: -1,
              borderColor: on ? 'var(--border-default)' : 'transparent', font: 'inherit', fontSize: 14,
              background: on ? 'var(--bg-inverse)' : 'transparent',
              color: on ? 'var(--text-inverse)' : t.disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
              fontWeight: on ? 700 : t.done ? 600 : 500,
              cursor: t.disabled ? 'not-allowed' : 'pointer', opacity: t.disabled ? 0.55 : 1,
            }}
          >
            {t.icon ? <span aria-hidden style={{ marginRight: 6 }}>{t.icon}</span> : null}
            {t.label}
            {t.done && !on ? <span aria-hidden style={{ marginLeft: 6 }}>✓</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ---- tables -----------------------------------------------------------------------

export interface PortalColumn<R> {
  key: string;
  header: string;
  cell: (row: R, index: number) => ReactNode;
  /** Text used by the Search box. */
  text?: (row: R) => string;
  width?: number | string;
}

/**
 * The portal's DataTable: "Show [n] entries", Search, numbered rows, optional
 * group rows (establishment / case number), "Showing a to b of n entries",
 * Previous / Next.
 */
export function PortalTable<R>({ rows, columns, groupBy, pageSizes = [10, 25, 50, 100], defaultPageSize = 10, empty = 'No data available in table', label }: {
  rows: R[];
  columns: ReadonlyArray<PortalColumn<R>>;
  groupBy?: (row: R) => string;
  pageSizes?: number[];
  defaultPageSize?: number;
  empty?: string;
  label?: string;
}) {
  const [size, setSize] = useState(defaultPageSize);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => columns.some((c) => (c.text?.(r) ?? '').toLowerCase().includes(s)));
  }, [rows, columns, q]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const at = Math.min(page, pages - 1);
  const shown = filtered.slice(at * size, at * size + size);
  let lastGroup: string | null = null;

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="row body-sm" style={{ gap: 6, alignItems: 'center' }}>
          Show
          <select className="input" style={{ width: 76, height: 32 }} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
            {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          entries
        </label>
        <label className="row body-sm" style={{ gap: 6, alignItems: 'center' }}>
          Search:
          <input className="input" style={{ width: 200, height: 32 }} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label={`Search ${label ?? 'table'}`} />
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl" aria-label={label}>
          <thead>
            <tr>{columns.map((c) => <th key={c.key} style={{ width: c.width }}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ textAlign: 'center' }} className="muted">{empty}</td></tr>
            ) : shown.flatMap((r, i) => {
              const out: ReactNode[] = [];
              const g = groupBy?.(r) ?? null;
              if (g !== null && g !== lastGroup) {
                lastGroup = g;
                out.push(
                  <tr key={`g-${g}-${i}`}>
                    <td colSpan={columns.length} style={{ textAlign: 'center', fontWeight: 700, background: 'var(--bg-surface-2, var(--bg-subtle))' }}>{g}</td>
                  </tr>,
                );
              }
              out.push(<tr key={i}>{columns.map((c) => <td key={c.key}>{c.cell(r, at * size + i)}</td>)}</tr>);
              return out;
            })}
          </tbody>
        </table>
      </div>
      <div className="row body-sm muted" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>
          {filtered.length === 0 ? 'Showing 0 to 0 of 0 entries' : `Showing ${at * size + 1} to ${Math.min(filtered.length, at * size + size)} of ${filtered.length} entries`}
        </span>
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={at === 0} onClick={() => setPage(at - 1)}>Previous</button>
          <span className="btn btn-sm" aria-current="page" style={{ pointerEvents: 'none' }}>{at + 1}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>Next</button>
        </span>
      </div>
    </div>
  );
}

/** Cause title as the portal prints it: petitioner / Vs / respondent. */
export function CauseTitle({ petitioner, respondent }: { petitioner: string | null | undefined; respondent: string | null | undefined }) {
  return (
    <span className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 0 }}>
      <span>{petitioner || '—'}</span>
      <strong>Vs</strong>
      <span>{respondent || '—'}</span>
    </span>
  );
}

/** "🖥 eFiled Case" badge next to an eFiling number. */
export function EfiledBadge() {
  return <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>eFiled Case</span>;
}

/** Success box the portal pops up after a save ("New case added", ...). */
export function SuccessNote({ lines, onClose }: { lines: string[]; onClose?: () => void }) {
  if (lines.length === 0) return null;
  return (
    <div role="status" className="row" style={{ gap: 12, alignItems: 'center', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--success, var(--border-default))', background: 'var(--bg-surface-2, var(--bg-subtle))' }}>
      <span aria-hidden className="dot dot-sage" />
      <span className="col body-sm" style={{ gap: 2, flex: 1 }}>{lines.map((l) => <span key={l}>{l}</span>)}</span>
      {onClose ? <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Dismiss">×</button> : null}
    </div>
  );
}
