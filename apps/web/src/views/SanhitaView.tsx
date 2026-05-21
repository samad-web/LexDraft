import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

type OldAct = 'IPC' | 'CrPC' | 'IEA';
type NewAct = 'BNS' | 'BNSS' | 'BSA';

interface SanhitaMapping {
  fromAct: OldAct;
  fromSection: string;
  fromTitle: string;
  toAct: NewAct;
  toSection: string;
  toTitle: string;
  substantiveChange: string;
  notes: string;
}

const ACT_OPTIONS: ReadonlyArray<{ id: 'all' | OldAct; label: string }> = [
  { id: 'all', label: 'All Acts' },
  { id: 'IPC', label: 'IPC → BNS' },
  { id: 'CrPC', label: 'CrPC → BNSS' },
  { id: 'IEA', label: 'IEA → BSA' },
];

function useSanhita() {
  return useQuery({
    queryKey: ['sanhita', 'mappings'],
    queryFn: () => api.get<{ items: SanhitaMapping[] }>('/sanhita'),
    select: (r) => r.items,
    staleTime: 60 * 60 * 1000,
  });
}

export function SanhitaView() {
  const { data: rows = [], isLoading, isError } = useSanhita();
  const [filter, setFilter] = useState<'all' | OldAct>('all');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.fromAct !== filter) return false;
      if (!term) return true;
      return (
        r.fromSection.toLowerCase().includes(term)
        || r.toSection.toLowerCase().includes(term)
        || r.fromTitle.toLowerCase().includes(term)
        || r.toTitle.toLowerCase().includes(term)
      );
    });
  }, [rows, filter, q]);

  const pagination = usePagination(filtered);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Statute translator</div>
        <h1 className="heading-xl">Sanhita translator</h1>
        <p className="body-sm muted" style={{ maxWidth: 720, marginTop: 8 }}>
          Cross-reference the colonial-era IPC, CrPC and Indian Evidence Act to their 2023 successors -
          Bharatiya Nyaya Sanhita (BNS), Bharatiya Nagarik Suraksha Sanhita (BNSS) and Bharatiya Sakshya
          Adhiniyam (BSA). Coverage is curated, not exhaustive. Always verify against the bare Act before
          relying on a mapping in court.
        </p>
      </div>

      <div
        className="card"
        style={{
          padding: '10px 14px',
          background: 'rgba(180, 83, 9, 0.06)',
          borderLeft: '3px solid var(--warning)',
        }}
      >
        <span className="body-sm">
          <strong>Plausibility-grade data.</strong> These mappings are research-stand-in entries
          assembled from public commentary on the new Sanhitas. Several entries carry an
          <em> &ldquo;UNVERIFIED&rdquo;</em> marker - counsel review is required before relying on any
          mapping for filings, advice or jurisprudence.
        </span>
      </div>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {ACT_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`chip${filter === o.id ? ' active' : ''}`}
              onClick={() => setFilter(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <input
          type="text"
          className="input"
          placeholder="Search by section number or title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 280 }}
        />
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Horizontal scroller — long "Old title" / "New title" entries push
            the table wider than narrow viewports. Scrolling lives inside the
            card so the page itself never grows a horizontal scrollbar. */}
        <div style={{ overflowX: 'auto' }}>
        <table
          className="tbl"
          style={{ tableLayout: 'fixed', minWidth: 880, wordBreak: 'break-word' }}
        >
          <thead>
            <tr>
              <th style={{ width: 140 }}>From</th>
              <th>Old title</th>
              <th style={{ width: 140 }}>To</th>
              <th>New title</th>
              <th style={{ width: 220 }}>Mind the gap</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <span className="muted">Loading mappings<span className="blink" /></span>
                </td>
              </tr>
            )}
            {isError && !isLoading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--danger)' }}>
                  Couldn’t load mappings.
                </td>
              </tr>
            )}
            {!isLoading && !isError && pagination.slice.map((r, i) => {
              const unverified = /unverified/i.test(r.substantiveChange);
              const renumbered = /renumbered only/i.test(r.substantiveChange);
              const omitted = !r.toSection;
              return (
                <tr key={`${r.fromAct}-${r.fromSection}-${i}`}>
                  <td className="mono tabular">
                    <span className="body-xs muted">{r.fromAct}</span>{' '}
                    <strong>§{r.fromSection}</strong>
                  </td>
                  <td className="body-sm">{r.fromTitle}</td>
                  <td className="mono tabular">
                    {omitted ? (
                      <span className="badge badge-vermillion">Omitted</span>
                    ) : (
                      <>
                        <span className="body-xs muted">{r.toAct}</span>{' '}
                        <strong>§{r.toSection}</strong>
                      </>
                    )}
                  </td>
                  <td className="body-sm">{r.toTitle}</td>
                  <td className="body-xs">
                    {unverified && (
                      <span className="badge badge-amber" style={{ marginRight: 6 }}>Unverified</span>
                    )}
                    {renumbered ? (
                      <span className="muted">Renumbered only</span>
                    ) : (
                      <span>{r.substantiveChange}</span>
                    )}
                    {r.notes && (
                      <div className="muted" style={{ marginTop: 4 }}>{r.notes}</div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!isLoading && !isError && filtered.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <span className="body-sm muted">No mappings match this filter.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        {!isLoading && !isError && filtered.length > 0 && (
          <div style={{ padding: '0 14px' }}>
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.pageSize}
              onChange={pagination.setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
