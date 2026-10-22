import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, EmptyState, ErrorState } from '@lexdraft/ui';
import { useCases, useDeleteCase, useRestoreCase, type CaseListItem } from '@/hooks/useCases';
import { linkStatusDisplay } from '@/components/ecourts/linkStatus';
import { useUIStore } from '@/store/ui';
import { FAB } from '@/components/FAB';
import { useSavedFilter } from '@/hooks/useSavedFilter';
import type { Case } from '@lexdraft/types';
import { NewCaseModal } from '@/components/NewCaseModal';
import { RecentlyDeletedCasesModal } from '@/components/RecentlyDeletedCasesModal';
import { Gate } from '@/components/Gate';
import { Pagination } from '@/components/Pagination';
import { CopyButton } from '@/components/CopyButton';
import { usePagination } from '@/hooks/usePagination';
import { PageHeader, PageSearch } from '@/components/PageHeader';

interface CasesListViewProps {
  onOpen: (c: Case) => void;
}

type FilterId = 'all' | 'civil' | 'criminal' | 'commercial' | 'property';
const FILTER_IDS: ReadonlyArray<FilterId> = ['all', 'civil', 'criminal', 'commercial', 'property'];

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
  const [filter, setFilter] = useSavedFilter<FilterId>('cases.filter', 'all', (raw) =>
    typeof raw === 'string' && (FILTER_IDS as ReadonlyArray<string>).includes(raw) ? (raw as FilterId) : null,
  );
  const [q, setQ] = useState<string>('');
  // Debounce the search query 400ms after the user stops typing, matching the
  // pattern used by NewCaseModal's conflict-check — avoids firing a new
  // GET /cases?q=... on every keystroke.
  const [qDebounced, setQDebounced] = useState<string>('');
  useEffect(() => {
    const handle = window.setTimeout(() => setQDebounced(q), 400);
    return () => window.clearTimeout(handle);
  }, [q]);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // Retain-a-lead handoff: LeadsView navigates here with ?newMatter=1&client=…
  // &title=…&type=… so the New-matter modal opens pre-filled from the lead.
  const [searchParams, setSearchParams] = useSearchParams();
  const [matterPrefill, setMatterPrefill] = useState<
    { client?: string; title?: string; type?: string } | undefined
  >(undefined);
  useEffect(() => {
    if (searchParams.get('newMatter') !== '1') return;
    setMatterPrefill({
      client: searchParams.get('client') ?? undefined,
      title: searchParams.get('title') ?? undefined,
      type: searchParams.get('type') ?? undefined,
    });
    setIntakeOpen(true);
    // Clear the params so a refresh / back doesn't re-trigger the modal.
    const next = new URLSearchParams(searchParams);
    ['newMatter', 'client', 'title', 'type'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const activeFilter: FilterOption = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;

  // "Connect matters →" (eCourts status strip) lands here with
  // ?ecourts=attention: only live matters not yet working with eCourts, and
  // opening one jumps straight to its eCourts connection card.
  const navigate = useNavigate();
  const ecourtsAttention = searchParams.get('ecourts') === 'attention';
  const clearEcourtsFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('ecourts');
    setSearchParams(next, { replace: true });
  };
  const openCase = (c: Case) => {
    if (ecourtsAttention) navigate(`/app/cases/${c.id}?focus=ecourts&from=ecourts`);
    else onOpen(c);
  };

  const deleteCase = useDeleteCase();
  const restoreCase = useRestoreCase();
  const showToast = useUIStore((s) => s.showToast);

  // Delete is a SOFT delete — the matter is recoverable for 30 days (see the
  // Recently-deleted view). We fire it immediately and offer an inline Undo that
  // restores it, plus the longer 30-day safety net on the server.
  const handleDeleteCase = (c: Case) => {
    deleteCase.mutate(c.id, {
      onSuccess: () => {
        showToast({
          type: 'sage',
          text: `Deleted "${c.title}". Recoverable for 30 days.`,
          action: {
            label: 'Undo',
            onClick: () => {
              restoreCase.mutate(c.id, {
                onSuccess: () => showToast({ type: 'sage', text: `Restored "${c.title}"` }),
                onError: () => showToast({ type: 'vermillion', text: 'Could not restore' }),
              });
            },
          },
        });
      },
      onError: () => showToast({ type: 'vermillion', text: "Couldn't delete the matter" }),
    });
  };

  const queryParams = useMemo(
    () => ({
      q: qDebounced.trim() || undefined,
      type: activeFilter.type,
      ecourts: ecourtsAttention ? ('attention' as const) : undefined,
    }),
    [qDebounced, activeFilter.type, ecourtsAttention],
  );

  const { data, isLoading, isError, error } = useCases(queryParams);
  const cases: CaseListItem[] = data ?? [];
  const pager = usePagination(cases);

  return (
    <div className="col stagger" style={{ gap: 20 }}>
      <PageHeader
        title="Cases"
        description="Every matter you handle, with court, stage, client and next date."
        meta={`${cases.length} ${cases.length === 1 ? 'matter' : 'matters'}`}
        actions={<>
        <button
          type="button"
          className="btn"
          onClick={() => setTrashOpen(true)}
          title="Matters deleted in the last 30 days"
        >
          <Icon name="trash" size={14} /> Recently deleted
        </button>
        <Gate feature="matter.create">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIntakeOpen(true)}
          >
            <Icon name="plus" size={14} /> New case
          </button>
        </Gate>
        </>}
      >
        <PageSearch
          value={q}
          onChange={setQ}
          placeholder="Search by title or CNR…"
          label="Search cases"
        />
      </PageHeader>

      {ecourtsAttention ? (
        <div className="card row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: 'var(--warning)' }} role="status">
          <span className="dot dot-amber" style={{ flexShrink: 0 }} />
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div className="heading-sm">Matters to connect to eCourts</div>
            <p className="body-sm muted">
              {cases.length === 0 && !isLoading
                ? 'Every live matter is connected to eCourts.'
                : 'These matters have no CNR, are waiting for eCourts, or their CNR wasn\'t found. Open one to connect it; you\'ll come back here for the next.'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/app/ecourts')}>Back to eCourts</button>
          <button type="button" className="btn btn-sm" onClick={clearEcourtsFilter}>Show all matters</button>
        </div>
      ) : null}

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
        <ErrorState
          icon="cases"
          title="Couldn't load cases"
          description={error instanceof Error ? error.message : 'Check your connection and try again.'}
        />
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
                <th>eCourts</th>
                <th aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {cases.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      variant="inline"
                      title={ecourtsAttention ? 'All matters connected' : q || filter !== 'all' ? 'No matters match' : 'No matters yet'}
                      description={
                        ecourtsAttention
                          ? 'Every live matter is connected to eCourts and refreshes at 9 AM and 7 PM.'
                          : q || filter !== 'all'
                          ? 'Try a different search term or filter.'
                          : 'Open a new matter to start tracking hearings, parties, and documents.'
                      }
                    />
                  </td>
                </tr>
              )}
              {pager.slice.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => openCase(c)}
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
                  <td style={{ color: 'var(--text-secondary)' }}>
                    <CopyButton value={c.cnr} />
                  </td>
                  <td className="muted">{c.court}</td>
                  <td><span className="badge badge-cobalt">{String(c.stage).toUpperCase()}</span></td>
                  <td>{c.client}</td>
                  <td className="mono tabular">{c.next}</td>
                  <td>
                    {(() => {
                      const d = linkStatusDisplay(c.ecourtsLinkStatus);
                      return <span className={`badge ${d.badge}`}>{d.label.toUpperCase()}</span>;
                    })()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    <Gate feature="matter.create">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm case-row-delete"
                        aria-label={`Delete ${c.title}`}
                        title="Delete matter (recoverable for 30 days)"
                        onClick={() => handleDeleteCase(c)}
                        style={{ color: 'var(--danger)' }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </Gate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            pageSize={pager.pageSize}
            onChange={pager.setPage}
          />
        </div>
      )}

      <NewCaseModal
        open={intakeOpen}
        onClose={() => { setIntakeOpen(false); setMatterPrefill(undefined); }}
        defaultType={activeFilter.type}
        prefill={matterPrefill}
      />
      <RecentlyDeletedCasesModal open={trashOpen} onClose={() => setTrashOpen(false)} />
      <Gate feature="matter.create">
        <FAB ariaLabel="New case" onClick={() => setIntakeOpen(true)}>
          <Icon name="plus" size={22} />
        </FAB>
      </Gate>
    </div>
  );
}
