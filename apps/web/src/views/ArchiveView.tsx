import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { ArchivedMatter, CaseOutcome } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useArchive } from '@/hooks/useArchive';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

type Outcome = CaseOutcome;
type FilterKey = 'all' | Outcome;

const OUTCOMES: Outcome[] = ['Won', 'Lost', 'Settled', 'Withdrawn'];

export function ArchiveView() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery]   = useState<string>('');
  const showToast = useUIStore((s) => s.showToast);
  const { data: archive = [], isLoading, isError } = useArchive();

  const filtered = useMemo<ArchivedMatter[]>(() => {
    const q = query.trim().toLowerCase();
    return archive.filter((m) => {
      const matchOutcome = filter === 'all' || m.outcome === filter;
      const matchQuery   = q === ''
        || m.title.toLowerCase().includes(q)
        || m.client.toLowerCase().includes(q)
        || m.cnr.toLowerCase().includes(q)
        || m.court.toLowerCase().includes(q);
      return matchOutcome && matchQuery;
    });
  }, [archive, filter, query]);

  const pager = usePagination(filtered);

  const counts = useMemo<Record<FilterKey, number>>(() => {
    const tally: Record<FilterKey, number> = { all: archive.length, Won: 0, Lost: 0, Settled: 0, Withdrawn: 0 };
    for (const m of archive) {
      tally[m.outcome] = (tally[m.outcome] ?? 0) + 1;
    }
    return tally;
  }, [archive]);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>§ - CLOSED MATTERS</div>
        <h1 className="heading-xl">Archive</h1>
        <p className="body-md muted" style={{ marginTop: 8, maxWidth: 640 }}>
          A complete register of disposed matters across the chambers. Read-only - original files are preserved with their final orders.
        </p>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <FilterChip label="All"        active={filter === 'all'} count={counts.all}        onClick={() => setFilter('all')} />
          {OUTCOMES.map((o) => (
            <FilterChip key={o} label={o} active={filter === o} count={counts[o]} onClick={() => setFilter(o)} />
          ))}
        </div>
        <span className="spacer" />
        <div className="row" style={{ gap: 8, alignItems: 'center', minWidth: 260 }}>
          <Icon name="search" size={14} />
          <input
            className="input"
            style={{ height: 36, fontSize: 13 }}
            placeholder="Search CNR, title, client or court"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search archive"
          />
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 160 }}>CNR</th>
              <th>Matter</th>
              <th>Client</th>
              <th>Court</th>
              <th style={{ width: 130 }}>Closed</th>
              <th style={{ width: 130 }}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 32 }}>
                  <span className="muted">Loading archive<span className="blink" /></span>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 32 }}>
                  <span style={{ color: 'var(--danger)' }}>Couldn’t load archive.</span>
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 32 }}>
                  <span className="muted">{archive.length === 0 ? 'No closed matters yet.' : 'No archived matters match these filters.'}</span>
                </td>
              </tr>
            ) : (
              pager.slice.map((m) => (
                <tr
                  key={m.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => showToast({ type: 'cobalt', text: `Opening archived matter "${m.title}"…` })}
                >
                  <td className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{m.cnr}</td>
                  <td><em className="case-name" style={{ fontSize: 15 }}>{m.title}</em></td>
                  <td>{m.client}</td>
                  <td className="muted">{m.court}</td>
                  <td className="mono tabular" style={{ fontSize: 12 }}>{m.closedDate}</td>
                  <td><OutcomeBadge outcome={m.outcome} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={pager.page}
        totalPages={pager.totalPages}
        total={pager.total}
        pageSize={pager.pageSize}
        onChange={pager.setPage}
      />

      <div className="row" style={{ gap: 8 }}>
        <span className="mono tabular" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
          {filtered.length} OF {archive.length} MATTERS MATCH FILTERS
        </span>
      </div>
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
      <span className="mono tabular" style={{ marginLeft: 8, opacity: 0.7, fontSize: 11 }}>{count}</span>
    </button>
  );
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  if (outcome === 'Won')        return <span className="badge badge-sage">WON</span>;
  if (outcome === 'Lost')       return <span className="badge badge-vermillion">LOST</span>;
  if (outcome === 'Settled')    return <span className="badge badge-cobalt">SETTLED</span>;
  return <span className="badge badge-amber">WITHDRAWN</span>;
}
