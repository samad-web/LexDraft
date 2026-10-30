import { useMemo, useState } from 'react';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { useLimitations, type LimitationRow as LimitationRowType } from '@/hooks/useLimitations';
import { NewLimitationModal } from '@/components/NewLimitationModal';
import { LimitationCalculator } from '@/components/LimitationCalculator';
import { Gate } from '@/components/Gate';
import { PageHeader } from '@/components/PageHeader';
import { downloadCsv } from '@/lib/export-doc';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

type LimitationRow = LimitationRowType;

type UrgencyId = 'critical' | 'warning' | 'safe';

interface Urgency {
  id: UrgencyId;
  label: string;
  badgeClass: 'badge-vermillion' | 'badge-amber' | 'badge-cobalt';
}

function urgencyOf(days: number): Urgency {
  if (days <= 7) {
    return { id: 'critical', label: 'Critical', badgeClass: 'badge-vermillion' };
  }
  if (days <= 30) {
    return { id: 'warning', label: 'Warning', badgeClass: 'badge-amber' };
  }
  return { id: 'safe', label: 'Upcoming', badgeClass: 'badge-cobalt' };
}

const FILTERS: ReadonlyArray<{ id: UrgencyId | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'critical', label: 'Critical (≤7d)' },
  { id: 'warning', label: 'Warning (≤30d)' },
  { id: 'safe', label: 'Upcoming (>30d)' },
];

export function LimitationView() {
  const [filter, setFilter] = useState<UrgencyId | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const showToast = useUIStore((s) => s.showToast);
  const { data: rows = [], isLoading, isError } = useLimitations();

  const sorted = useMemo<LimitationRow[]>(() => {
    return [...rows].sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [rows]);

  const filtered: LimitationRow[] = useMemo(() => {
    if (filter === 'all') return sorted;
    return sorted.filter((r) => urgencyOf(r.daysRemaining).id === filter);
  }, [sorted, filter]);

  const pager = usePagination(filtered);

  const summary = useMemo(() => {
    return sorted.reduce(
      (acc, r) => {
        const u = urgencyOf(r.daysRemaining).id;
        acc[u] += 1;
        return acc;
      },
      { critical: 0, warning: 0, safe: 0 } as Record<UrgencyId, number>,
    );
  }, [sorted]);

  return (
    <div className="col stagger ct ct-limitation" style={{ gap: 24 }}>
      <PageHeader
        title="Limitation"
        description="Track limitation deadlines across matters, most urgent first."
        meta={isLoading || isError ? undefined : `${sorted.length} deadlines`}
        actions={<>
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (sorted.length === 0) {
              showToast({ type: 'amber', text: 'No limitations to export' });
              return;
            }
            downloadCsv(
              `limitations-${new Date().toISOString().slice(0, 10)}.csv`,
              ['Matter', 'CNR', 'Filing type', 'Basis statute', 'Basis section', 'Forum', 'Deadline', 'Days remaining', 'Urgency'],
              sorted.map((r) => [
                r.caseLabel,
                r.cnr,
                r.filingType,
                r.basisStatute ?? '',
                r.basisSection ?? '',
                r.forum,
                r.deadline,
                r.daysRemaining,
                urgencyOf(r.daysRemaining).label,
              ]),
            );
            showToast({ type: 'sage', text: `Exported ${sorted.length} limitations` });
          }}
        >
          <Icon name="download" size={14} /> Export
        </button>
        <Gate feature="matter.create">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
            <Icon name="plus" size={14} /> Add deadline
          </button>
        </Gate>
        </>}
      />
      <NewLimitationModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <LimitationCalculator />

      <div className="ct-kpis">
        {([
          { id: 'critical', label: 'Critical', value: summary.critical, note: 'Within 7 days' },
          { id: 'warning', label: 'Warning', value: summary.warning, note: '8-30 days out' },
          { id: 'safe', label: 'Upcoming', value: summary.safe, note: 'More than 30 days' },
        ] as const).map((k) => (
          <button
            key={k.id}
            type="button"
            className={`ct-kpi${filter === k.id ? ' is-active' : ''}`}
            aria-pressed={filter === k.id}
            onClick={() => setFilter(filter === k.id ? 'all' : k.id)}
          >
            <span className="ct-kpi-label">{k.label}</span>
            <span className="ct-kpi-value">{isLoading ? '–' : k.value}</span>
            <span className="ct-kpi-note">{k.note}</span>
          </button>
        ))}
      </div>

      <div className="ct-toolbar">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip ${filter === f.id ? 'active' : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {!isLoading && !isError && <span className="ct-chip-count">{f.id === 'all' ? sorted.length : summary[f.id]}</span>}
          </button>
        ))}
        {!isLoading && !isError && summary.critical > 0 && filter !== 'critical' && (
          <button type="button" className="adv-alert-btn" style={{ marginLeft: 'auto' }} onClick={() => setFilter('critical')}>
            {summary.critical} {summary.critical === 1 ? 'limitation' : 'limitations'} due within 7 days
          </button>
        )}
      </div>

      <div className="ct-card" style={{ overflow: 'hidden' }}>
        <div className="ct-lrow is-head" role="row">
          <span>Days left</span>
          <span>Matter</span>
          <span>Filing type · Basis</span>
          <span>Forum</span>
          <span>Deadline</span>
          <span>Owner</span>
        </div>
        {isLoading && (
          <div className="ct-loading-row" aria-busy="true" aria-label="Loading limitations">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={`sk-${i}`} className="row" style={{ gap: 16 }}>
                <Skeleton width={64} height={56} />
                <div className="col" style={{ gap: 8, flex: 1 }}>
                  <Skeleton width="40%" height={14} />
                  <Skeleton width="25%" height={12} />
                </div>
              </div>
            ))}
          </div>
        )}
        {isError && !isLoading && (
          <div className="ct-empty-row">
            <ErrorState
              variant="inline"
              title="Couldn't load limitations"
              description="Check your connection and try again."
            />
          </div>
        )}
        {!isLoading && !isError && pager.slice.map((r) => {
          const u = urgencyOf(r.daysRemaining);
          const overdue = r.daysRemaining < 0;
          return (
            <div key={r.id} className="ct-lrow">
              <span className={`ct-days is-${u.id}`} title={u.label}>
                <b>{overdue ? -r.daysRemaining : r.daysRemaining}</b>
                <span>{overdue ? 'over' : r.daysRemaining === 1 ? 'day' : 'days'}</span>
              </span>
              <span className="ct-lrow-main">
                <span className="ct-title">{r.caseLabel}</span>
                {r.cnr && <span className="ct-code">{r.cnr}</span>}
                <span className="ct-meta ct-lrow-forum-inline">{r.forum}</span>
              </span>
              <span className="ct-lrow-filing">
                <span>{r.filingType}</span>
                {r.basisStatute || r.basisSection ? (
                  <span className="ct-lrow-basis">
                    {r.basisStatute ?? '-'}{r.basisSection ? <><span className="ct-meta-dot" />{r.basisSection}</> : null}
                  </span>
                ) : null}
              </span>
              <span className="ct-lrow-forum">{r.forum}</span>
              <span className="ct-lrow-deadline">
                <b>{fmtDeadline(r.deadline)}</b>
                <span className={`ct-pill${u.id === 'critical' ? ' is-ink' : u.id === 'warning' ? ' is-strong' : ''}`}>{u.label}</span>
              </span>
              <span className="avatar" title={`Filed by ${r.filedBy}`}>{r.filedBy}</span>
            </div>
          );
        })}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="ct-empty-row">
            <EmptyState
              variant="inline"
              icon="limitation"
              title={rows.length === 0 ? 'No deadlines yet' : 'No deadlines match'}
              description={
                rows.length === 0
                  ? 'Add a deadline to start tracking statutory limitations across your matters.'
                  : 'Try a different filter or clear it to see all deadlines.'
              }
            />
          </div>
        )}
        {!isLoading && !isError && (
          <Pagination
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            pageSize={pager.pageSize}
            onChange={pager.setPage}
          />
        )}
      </div>
    </div>
  );
}

function fmtDeadline(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
