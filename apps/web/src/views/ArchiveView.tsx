import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState } from '@lexdraft/ui';
import { PageHeader, PageSearch } from '@/components/PageHeader';
import type { ArchivedMatter, CaseOutcome } from '@lexdraft/types';
import { useArchive } from '@/hooks/useArchive';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

type Outcome = CaseOutcome;
type FilterKey = 'all' | Outcome;

const OUTCOMES: Outcome[] = ['Won', 'Lost', 'Settled', 'Withdrawn'];

export function ArchiveView() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery]   = useState<string>('');
  const navigate = useNavigate();
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
    <div className="col stagger fm-view fm-archive">
      <PageHeader
        title="Closed Matters"
        description="Read-only register of disposed matters, kept with their final orders."
        meta={isLoading || isError ? undefined : `${archive.length} matters`}
      />

      <div className="fm-toolbar">
        <div className="fm-chips" role="group" aria-label="Filter by outcome">
          <FilterChip label="All"        active={filter === 'all'} count={counts.all}        onClick={() => setFilter('all')} />
          {OUTCOMES.map((o) => (
            <FilterChip key={o} label={o} active={filter === o} count={counts[o]} onClick={() => setFilter(o)} />
          ))}
        </div>
        <span className="spacer" />
        <PageSearch
          value={query}
          onChange={setQuery}
          placeholder="Search CNR, title, client or court"
          label="Search archive"
        />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl fm-tbl">
          <thead>
            <tr>
              <th>Matter</th>
              <th style={{ width: 180 }}>CNR</th>
              <th>Client</th>
              <th>Court</th>
              <th style={{ width: 120 }}>Closed</th>
              <th style={{ width: 120 }}>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} data-span="all" style={{ textAlign: 'center', padding: 32 }}>
                  <span className="muted">Loading archive<span className="blink" /></span>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} data-span="all">
                  <ErrorState
                    variant="inline"
                    title="Couldn't load archive"
                    description="Check your connection and try again."
                  />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} data-span="all">
                  <EmptyState
                    variant="inline"
                    title={archive.length === 0 ? 'No closed matters yet' : 'No archived matters match'}
                    description={
                      archive.length === 0
                        ? 'Closed matters move here automatically once you mark them complete.'
                        : 'Try a different outcome filter or clear the search.'
                    }
                  />
                </td>
              </tr>
            ) : (
              pager.slice.map((m) => (
                <tr
                  key={m.id}
                  tabIndex={0}
                  onClick={() => navigate(`/app/cases/${m.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/app/cases/${m.id}`); }}
                >
                  <td><em className="case-name fm-matter">{m.title}</em></td>
                  <td><span className="fm-code">{m.cnr}</span></td>
                  <td>{m.client}</td>
                  <td className="muted">{m.court}</td>
                  <td><span className="fm-date">{formatClosed(m.closedDate)}</span></td>
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

      <div className="fm-reg-foot">
        {filtered.length} of {archive.length} matters match filters
      </div>
    </div>
  );
}

function formatClosed(iso: string): string {
  if (!iso) return '-';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`chip ${active ? 'active' : ''}`} onClick={onClick} aria-pressed={active}>
      {label}
      <span className="fm-count">{count}</span>
    </button>
  );
}

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  if (outcome === 'Won')        return <span className="fm-pill is-solid">Won</span>;
  if (outcome === 'Lost')       return <span className="fm-pill is-strong">Lost</span>;
  if (outcome === 'Settled')    return <span className="fm-pill">Settled</span>;
  return <span className="fm-pill is-dashed">Withdrawn</span>;
}
