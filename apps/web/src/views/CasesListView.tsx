import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useCases } from '@/hooks/useCases';
import type { Case } from '@lexdraft/types';
import { NewCaseModal } from '@/components/NewCaseModal';

interface CasesListViewProps {
  onOpen: (c: Case) => void;
}

type FilterId = 'all' | 'civil' | 'criminal' | 'commercial' | 'property';

interface FilterOption {
  id: FilterId;
  label: string;
  type?: string;
}

const FILTERS: ReadonlyArray<FilterOption> = [
  { id: 'all',        label: 'All' },
  { id: 'civil',      label: 'Civil',      type: 'Civil' },
  { id: 'criminal',   label: 'Criminal',   type: 'Criminal' },
  { id: 'commercial', label: 'Commercial', type: 'Commercial' },
  { id: 'property',   label: 'Property',   type: 'Property' },
];

export function CasesListView({ onOpen }: CasesListViewProps) {
  const [filter, setFilter] = useState<FilterId>('all');
  const [q, setQ] = useState<string>('');
  const [intakeOpen, setIntakeOpen] = useState(false);

  const activeFilter: FilterOption = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;

  const queryParams = useMemo(
    () => ({
      q: q.trim() || undefined,
      type: activeFilter.type,
    }),
    [q, activeFilter.type],
  );

  const { data, isLoading, isError, error } = useCases(queryParams);
  const cases: Case[] = data ?? [];

  return (
    <div className="col stagger" style={{ gap: 20 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Case management</div>
          <h1 className="heading-xl">Cases</h1>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginTop: 4 }}>
            {cases.length} {cases.length === 1 ? 'MATTER' : 'MATTERS'}
          </div>
        </div>
        <span className="spacer" />
        <div style={{ position: 'relative' }}>
          <input
            type="search"
            className="input"
            style={{ paddingLeft: 36, width: 280 }}
            placeholder="Search by title or CNR…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search cases"
          />
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-tertiary)',
              display: 'inline-flex',
            }}
          >
            <Icon name="search" size={14} />
          </span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIntakeOpen(true)}
        >
          <Icon name="plus" size={14} /> New case
        </button>
      </div>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`chip ${filter === f.id ? 'active' : ''}`}
            aria-pressed={filter === f.id}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="card">
          <span className="muted">Loading cases…</span>
        </div>
      )}
      {isError && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="heading-sm" style={{ marginBottom: 6 }}>Couldn’t load cases</div>
          <p className="body-sm muted">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      )}

      {!isLoading && !isError && (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>CNR</th>
                <th>Court</th>
                <th>Stage</th>
                <th>Client</th>
                <th>Next date</th>
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="col" style={{ padding: '28px 8px', alignItems: 'center', gap: 6 }}>
                      <div className="heading-sm">No matters found</div>
                      <p className="body-sm muted">Try a different search term or filter.</p>
                    </div>
                  </td>
                </tr>
              )}
              {cases.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => onOpen(c)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <div style={{ fontWeight: 500 }}>
                      <em className="case-name">{c.title}</em>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {c.type}
                    </div>
                  </td>
                  <td className="mono tabular" style={{ color: 'var(--text-secondary)' }}>{c.cnr}</td>
                  <td className="muted">{c.court}</td>
                  <td><span className="badge badge-cobalt">{String(c.stage).toUpperCase()}</span></td>
                  <td>{c.client}</td>
                  <td className="mono tabular">{c.next}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewCaseModal
        open={intakeOpen}
        onClose={() => setIntakeOpen(false)}
        defaultType={activeFilter.type}
      />
    </div>
  );
}
