import { useEffect, useRef, useState } from 'react';
import type { PortalList } from '@/hooks/useEfiling';

// =============================================================================
// The eFiling portal's own look, shared by every portal screen in DifAi: its
// pop-up windows, its lists (Search By ... / Clear, Show N entries, First ·
// Prev · pages · Next · Last, "Showing a to b of n entries"), its tables with
// the row buttons and document links where the portal has them. Monochrome.
// =============================================================================

// The portal's row buttons DifAi can open and read (not file downloads).
export const ROW_ACTION = /^view\b/i;

// Open windows, newest last: Escape closes only the top one, as on the portal.
const modalStack: number[] = [];

/** A pop-up window like the portal's: title, close (×), content scrolling inside. */
export function PortalModal({ title, onClose, level = 1, children }: { title: string; onClose: () => void; level?: number; children: React.ReactNode }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Math.random();
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(id), 1);
    };
  }, []);
  return (
    <div role="dialog" aria-modal="true" aria-label={title || 'Portal window'} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000 + level * 10, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: level > 1 ? '40px 16px' : '24px 16px', overflowY: 'auto' }}>
      <div style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', width: level > 1 ? 'min(1240px, 100%)' : 'min(1720px, 100%)', boxShadow: '0 10px 40px rgba(0,0,0,0.35)' }}>
        <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: title ? '1px solid var(--border-default)' : 'none' }}>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 500 }}>{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ width: 42, height: 42, border: '2px solid var(--text-primary)', borderRadius: 8, background: 'transparent', color: 'inherit', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '14px 20px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

export type PortalRows = PortalList['rows'];

/**
 * A portal list as the portal shows it: "Search By (eFiling Number/CNR
 * Number/Party Name)" with Search / Clear and First · Prev · pages · Next ·
 * Last, "Show N entries", the table, "Showing a to b of n entries".
 */
export function PortalListView({ label, headers, rows, pageSize: initialSize, onAction, onLink, busy }: {
  label: string; headers: string[]; rows: PortalRows; pageSize: number;
  onAction?: (cells: string[], action: string) => void; onLink?: (cells: string[], link: string) => void; busy?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(initialSize);
  const [page, setPage] = useState(0);
  // Each data row with the group heading it sits under.
  const items: Array<{ group: string | null; row: { cells: string[]; actions?: string[] } }> = [];
  let group: string | null = null;
  for (const r of rows) {
    if ('group' in r) group = r.group;
    else items.push({ group, row: r });
  }
  const q = query.trim().toLowerCase();
  const found = q ? items.filter((it) => `${it.group ?? ''} ${it.row.cells.join(' ')}`.toLowerCase().includes(q)) : items;
  const pages = Math.max(1, Math.ceil(found.length / size));
  const p = Math.min(page, pages - 1);
  const shown = found.slice(p * size, p * size + size);
  const pageRows: PortalRows = [];
  let last: string | null | undefined;
  for (const it of shown) {
    if (it.group && it.group !== last) pageRows.push({ group: it.group });
    last = it.group;
    pageRows.push(it.row);
  }
  const search = () => { setQuery(draft); setPage(0); };
  const pager = (
    <span className="row" style={{ border: '1px solid var(--border-default)', borderRadius: 4, overflow: 'hidden' }}>
      {[['First', 0], ['Prev', p - 1]].map(([t, to]) => <button key={t} type="button" style={pagerBtn(false)} disabled={p === 0} onClick={() => setPage(to as number)}>{t}</button>)}
      {Array.from({ length: pages }, (_, i) => i).filter((i) => Math.abs(i - p) < 3).map((i) => (
        <button key={i} type="button" style={pagerBtn(i === p)} aria-current={i === p ? 'page' : undefined} onClick={() => setPage(i)}>{i + 1}</button>
      ))}
      {[['Next', p + 1], ['Last', pages - 1]].map(([t, to]) => <button key={t} type="button" style={pagerBtn(false)} disabled={p >= pages - 1} onClick={() => setPage(to as number)}>{t}</button>)}
    </span>
  );
  const bar = (
    <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <label className="body-sm" style={{ fontWeight: 700 }} htmlFor={`q-${label}`}>Search By (eFiling Number/CNR Number/Party Name)</label>
      <input id={`q-${label}`} className="input" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} style={{ width: 210 }} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={search}>Search</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(''); setQuery(''); setPage(0); }}>Clear</button>
      {pager}
    </div>
  );
  return (
    <div className="col" style={{ gap: 14 }}>
      {bar}
      <label className="body-sm" style={{ fontWeight: 700 }}>
        Show{' '}
        <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>{' '}entries
      </label>
      {found.length ? <PortalTable headers={headers} rows={pageRows} onAction={onAction} onLink={onLink} busy={busy} />
        : <p className="body-sm muted">{q ? 'No matching entries.' : `No ${label.toLowerCase()} on your portal account.`}</p>}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="body-sm">{found.length ? `Showing ${p * size + 1} to ${p * size + shown.length} of ${found.length} entries` : 'Showing 0 entries'}</span>
      </div>
      {found.length > size ? bar : null}
    </div>
  );
}

const pagerBtn = (on: boolean): React.CSSProperties => ({
  padding: '6px 14px', border: 'none', borderLeft: '1px solid var(--border-default)', cursor: 'pointer', fontWeight: 600,
  background: on ? 'var(--bg-inverse)' : 'var(--bg-surface-2)', color: on ? 'var(--text-inverse)' : 'inherit',
});

/** The portal's table look: dark header row, bordered cells, each cell's lines kept, its View buttons where the portal has them. */
export function PortalTable({ headers, rows, onAction, onLink, busy }: {
  headers: string[]; rows: PortalRows; onAction?: (cells: string[], action: string) => void; onLink?: (cells: string[], link: string) => void; busy?: boolean;
}) {
  const cols = Math.max(headers.length, ...rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  const td: React.CSSProperties = { padding: '10px 8px', borderRight: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)', verticalAlign: 'top', textAlign: 'center', whiteSpace: 'pre-line', fontSize: 14 };
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
            <tr key={i} style={{ background: i % 2 ? undefined : 'var(--bg-surface-2)' }}>
              {r.cells.map((c, j) => {
                const act = onAction && r.actions?.find((a) => ROW_ACTION.test(a) && a === c.trim());
                return (
                  <td key={j} style={td}>
                    {act ? (
                      <button type="button" disabled={busy} onClick={() => onAction!(r.cells, act)}
                        style={{ background: 'var(--bg-inverse)', color: 'var(--text-inverse)', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{act}</button>
                    ) : onLink ? <CellWithLinks text={c} links={(r.actions ?? []).filter((a) => !ROW_ACTION.test(a))} onLink={(a) => onLink(r.cells, a)} busy={busy} /> : c}
                  </td>
                );
              })}
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

/** A cell's lines, with the portal's document links (Acknowledgement, COMPLAINT ...) clickable where they are. */
export function CellWithLinks({ text, links, onLink, busy }: { text: string; links: string[]; onLink: (link: string) => void; busy?: boolean }) {
  if (!links.length) return <>{text}</>;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const link = links.find((a) => line === a || line.startsWith(`${a} `));
        return (
          <span key={i} style={{ display: 'block' }}>
            {link ? (
              <>
                <button type="button" disabled={busy} onClick={() => onLink(link)}
                  style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 700, textDecoration: 'underline', color: 'inherit', cursor: 'pointer' }}>{link}</button>
                {line.slice(link.length)}
              </>
            ) : line}
          </span>
        );
      })}
    </>
  );
}

