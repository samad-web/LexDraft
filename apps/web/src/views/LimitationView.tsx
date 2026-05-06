import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import type { Limitation } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useLimitations } from '@/hooks/useLimitations';
import { NewLimitationModal } from '@/components/NewLimitationModal';

type LimitationRow = Limitation;

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
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const { data: rows = [], isLoading, isError } = useLimitations();

  const sorted = useMemo<LimitationRow[]>(() => {
    return [...rows].sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [rows]);

  const filtered: LimitationRow[] = useMemo(() => {
    if (filter === 'all') return sorted;
    return sorted.filter((r) => urgencyOf(r.daysRemaining).id === filter);
  }, [sorted, filter]);

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
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Statute of limitations</div>
          <h1 className="heading-xl">Limitation tracker</h1>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => showToast({ type: 'cobalt', text: 'Limitation register export queued' })}
        >
          <Icon name="download" size={14} /> Export
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="plus" size={14} /> Add deadline
        </button>
      </div>
      <NewLimitationModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <div className="stat-row">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="dot dot-vermillion" />
            <span className="eyebrow">Critical</span>
          </div>
          <div className="mono tabular" style={{ fontSize: 28, fontWeight: 600 }}>
            {summary.critical}
          </div>
          <div className="body-xs muted">Within 7 days</div>
        </div>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="dot dot-amber" />
            <span className="eyebrow">Warning</span>
          </div>
          <div className="mono tabular" style={{ fontSize: 28, fontWeight: 600 }}>
            {summary.warning}
          </div>
          <div className="body-xs muted">8–30 days out</div>
        </div>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="dot dot-cobalt" />
            <span className="eyebrow">Upcoming</span>
          </div>
          <div className="mono tabular" style={{ fontSize: 28, fontWeight: 600 }}>
            {summary.safe}
          </div>
          <div className="body-xs muted">More than 30 days</div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip ${filter === f.id ? 'active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Urgency</th>
              <th>Matter</th>
              <th>Filing type</th>
              <th>Forum</th>
              <th style={{ width: 130 }}>Deadline</th>
              <th style={{ width: 110, textAlign: 'right' }}>Days left</th>
              <th style={{ width: 80 }}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <span className="muted">Loading deadlines<span className="blink" /></span>
                </td>
              </tr>
            )}
            {isError && !isLoading && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--danger)' }}>
                  Couldn’t load limitations.
                </td>
              </tr>
            )}
            {!isLoading && !isError && filtered.map((r) => {
              const u = urgencyOf(r.daysRemaining);
              return (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/app/cases')}>
                  <td>
                    <span className={`badge ${u.badgeClass}`}>{u.label}</span>
                  </td>
                  <td>
                    <div className="col" style={{ gap: 2 }}>
                      <em className="case-name" style={{ fontWeight: 500 }}>{r.caseLabel}</em>
                      <span className="mono body-xs muted tabular">{r.cnr}</span>
                    </div>
                  </td>
                  <td className="body-sm">{r.filingType}</td>
                  <td className="body-sm muted">{r.forum}</td>
                  <td className="mono tabular" style={{ fontWeight: 500 }}>{r.deadline}</td>
                  <td
                    className="mono tabular"
                    style={{
                      textAlign: 'right',
                      fontWeight: 600,
                      color:
                        u.id === 'critical'
                          ? 'var(--danger)'
                          : u.id === 'warning'
                            ? 'var(--warning)'
                            : 'var(--text-primary)',
                    }}
                  >
                    {r.daysRemaining}d
                  </td>
                  <td>
                    <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                      {r.filedBy}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && filtered.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <span className="body-sm muted">{rows.length === 0 ? 'No deadlines yet.' : 'No deadlines match this filter.'}</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
