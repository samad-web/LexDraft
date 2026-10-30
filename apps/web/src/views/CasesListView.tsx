import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, EmptyState, ErrorState, Select } from '@lexdraft/ui';
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
import { usePagination } from '@/hooks/usePagination';
import { PageHeader, PageSearch } from '@/components/PageHeader';

// =============================================================================
// Cases - every matter, grouped by when it is next in court. Summary tiles on
// top double as quick filters ("Next 7 days", "No next date", ...). One layout
// for every screen: a wide row on desktop, a compact two-line card on tablets
// and phones (styles: .cs-* in globals.css, monochrome per the dashboard rules).
// =============================================================================

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

/** Quick filters driven by the summary tiles. */
type QuickId = 'all' | 'week' | 'nodate' | 'ecourts';
type SortId = 'date' | 'title';

/** Where a matter sits relative to today - also the list's section order. */
type GroupId = 'today' | 'week' | 'later' | 'passed' | 'none' | 'closed';
const GROUPS: ReadonlyArray<{ id: GroupId; label: string }> = [
  { id: 'today',  label: 'Today' },
  { id: 'week',   label: 'Next 7 days' },
  { id: 'later',  label: 'Later' },
  { id: 'passed', label: 'Date passed · post the next date' },
  { id: 'none',   label: 'No date posted' },
  { id: 'closed', label: 'Closed & archived' },
];
const GROUP_ORDER: Record<GroupId, number> = { today: 0, week: 1, later: 2, passed: 3, none: 4, closed: 5 };

const CNR_RE = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from today to an ISO date (negative = in the past); null if none. */
function daysUntil(iso: string | null | undefined, today: string): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((b - a) / 864e5);
}

function isOpen(c: Case): boolean {
  return c.status !== 'Closed' && c.status !== 'Archived';
}

function groupOf(c: Case, today: string): GroupId {
  if (!isOpen(c)) return 'closed';
  const n = daysUntil(c.next, today);
  if (n === null) return 'none';
  if (n < 0) return 'passed';
  if (n === 0) return 'today';
  if (n <= 7) return 'week';
  return 'later';
}

function whenLabel(n: number | null): string {
  if (n === null) return 'No date';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

export function CasesListView({ onOpen }: CasesListViewProps) {
  const [filter, setFilter] = useSavedFilter<FilterId>('cases.filter', 'all', (raw) =>
    typeof raw === 'string' && (FILTER_IDS as ReadonlyArray<string>).includes(raw) ? (raw as FilterId) : null,
  );
  const [quick, setQuick] = useState<QuickId>('all');
  const [sort, setSort] = useSavedFilter<SortId>('cases.sort', 'date', (raw) =>
    raw === 'date' || raw === 'title' ? raw : null,
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
  const today = todayIso();

  // Summary numbers for the tiles, from the type/search-filtered list.
  const stats = useMemo(() => {
    const all: CaseListItem[] = data ?? [];
    const open = all.filter(isOpen);
    const week = open.filter((c) => { const n = daysUntil(c.next, today); return n !== null && n >= 0 && n <= 7; });
    const todayCount = week.filter((c) => daysUntil(c.next, today) === 0).length;
    const noDate = open.filter((c) => { const n = daysUntil(c.next, today); return n === null || n < 0; });
    const offEcourts = open.filter((c) => (c.ecourtsLinkStatus ?? 'unlinked') !== 'linked');
    return { all, open, week, todayCount, noDate, offEcourts };
  }, [data, today]);

  const visible = useMemo(() => {
    const base =
      quick === 'week' ? stats.week
      : quick === 'nodate' ? stats.noDate
      : quick === 'ecourts' ? stats.offEcourts
      : stats.all;
    const list = [...base];
    if (sort === 'title') {
      list.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      list.sort((a, b) => {
        const ga = GROUP_ORDER[groupOf(a, today)];
        const gb = GROUP_ORDER[groupOf(b, today)];
        if (ga !== gb) return ga - gb;
        // Date passed: oldest first is least useful - most recent first.
        const dir = groupOf(a, today) === 'passed' ? -1 : 1;
        if ((a.next || '') !== (b.next || '')) return (a.next || '') < (b.next || '') ? -dir : dir;
        return a.title.localeCompare(b.title);
      });
    }
    return list;
  }, [stats, quick, sort, today]);

  const pager = usePagination(visible);

  // Section the current page by date group (only when sorting by date).
  const sections = useMemo(() => {
    if (sort === 'title') return [{ id: 'all' as const, label: '', items: pager.slice }];
    return GROUPS
      .map((g) => ({ id: g.id, label: g.label, items: pager.slice.filter((c) => groupOf(c, today) === g.id) }))
      .filter((s) => s.items.length > 0);
  }, [pager.slice, sort, today]);

  const anyNarrowing = !!q || filter !== 'all' || quick !== 'all';

  const tiles: ReadonlyArray<{ id: QuickId; icon: 'cases' | 'calendar' | 'limitation' | 'ecourts'; label: string; value: number; note: string }> = [
    {
      id: 'all', icon: 'cases', label: 'Active matters', value: stats.open.length,
      note: `${stats.all.length} in total${stats.all.length - stats.open.length > 0 ? ` · ${stats.all.length - stats.open.length} closed` : ''}`,
    },
    {
      id: 'week', icon: 'calendar', label: 'Next 7 days', value: stats.week.length,
      note: stats.todayCount > 0 ? `${stats.todayCount} in court today` : stats.week.length > 0 ? 'None today' : 'A clear week ahead',
    },
    {
      id: 'nodate', icon: 'limitation', label: 'No next date', value: stats.noDate.length,
      note: stats.noDate.length > 0 ? 'Post the next hearing date' : 'Every matter has a date',
    },
    {
      id: 'ecourts', icon: 'ecourts', label: 'Not on eCourts', value: stats.offEcourts.length,
      note: stats.offEcourts.length > 0 ? 'Add the CNR to auto-sync' : 'All synced at 9 AM & 7 PM',
    },
  ];

  return (
    <div className="col stagger cs">
      <PageHeader
        title="Cases"
        description="Every matter you handle, sorted by when it is next in court."
        meta={`${stats.all.length} ${stats.all.length === 1 ? 'matter' : 'matters'}`}
        actions={<>
        <button
          type="button"
          className="btn"
          onClick={() => setTrashOpen(true)}
          title="Matters deleted in the last 30 days"
          aria-label="Recently deleted"
        >
          <Icon name="trash" size={14} /> <span className="cs-hide-sm">Recently deleted</span>
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
      />

      {ecourtsAttention ? (
        <div className="cs-banner" role="status">
          <span className="cs-banner-icon"><Icon name="ecourts" size={16} /></span>
          <div className="cs-banner-text">
            <div className="cs-banner-title">Matters to connect to eCourts</div>
            <p>
              {stats.all.length === 0 && !isLoading
                ? 'Every live matter is connected to eCourts.'
                : 'These matters have no CNR, are waiting for eCourts, or their CNR wasn\'t found. Open one to connect it; you\'ll come back here for the next.'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/app/ecourts')}>Back to eCourts</button>
          <button type="button" className="btn btn-sm" onClick={clearEcourtsFilter}>Show all matters</button>
        </div>
      ) : (
        <div className="cs-stats" role="group" aria-label="Quick filters">
          {tiles.map((t) => {
            const on = quick === t.id && t.id !== 'all';
            return (
              <button
                key={t.id}
                type="button"
                className={`cs-stat${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => setQuick(quick === t.id ? 'all' : t.id)}
              >
                <span className="cs-stat-label">
                  <span className="cs-stat-icon"><Icon name={t.icon} size={15} /></span>
                  <span className="cs-stat-text">{t.label}</span>
                </span>
                <span className="cs-stat-value">{isLoading ? '…' : t.value}</span>
                <span className="cs-stat-note">{isLoading ? ' ' : t.note}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="cs-toolbar">
        <PageSearch
          value={q}
          onChange={setQ}
          placeholder="Search title, CNR or client…"
          label="Search cases"
        />
        <div className="cs-chips" role="group" aria-label="Matter type">
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
        <div className="cs-sort">
          <Select
            value={sort}
            onChange={(v) => setSort(v as SortId)}
            options={[
              { value: 'date', label: 'By next date' },
              { value: 'title', label: 'Title A–Z' },
            ]}
          />
        </div>
      </div>

      {quick !== 'all' && (
        <div className="cs-filter-note">
          Showing <strong>{tiles.find((t) => t.id === quick)?.label.toLowerCase()}</strong> · {visible.length} {visible.length === 1 ? 'matter' : 'matters'}
          <button type="button" className="adv-link" onClick={() => setQuick('all')}>Show all</button>
        </div>
      )}

      {isLoading && (
        <div className="cs-list-card">
          {[0, 1, 2].map((i) => <div key={i} className="cs-skel" />)}
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
        <div className="cs-list-card">
          {visible.length === 0 ? (
            <EmptyState
              variant="inline"
              title={ecourtsAttention ? 'All matters connected' : anyNarrowing ? 'No matters match' : 'No matters yet'}
              description={
                ecourtsAttention
                  ? 'Every live matter is connected to eCourts and refreshes at 9 AM and 7 PM.'
                  : anyNarrowing
                  ? 'Try a different search term or filter.'
                  : 'Open a new matter to start tracking hearings, parties, and documents.'
              }
            />
          ) : (
            <>
              <div className="cs-head" aria-hidden="true">
                <span>Matter</span>
                <span>Stage</span>
                <span>eCourts</span>
                <span>Next date</span>
                <span />
              </div>
              {sections.map((s) => (
                <section key={s.id} className="cs-section" aria-label={s.label || 'Matters'}>
                  {s.label && (
                    <div className="cs-section-head">
                      <span>{s.label}</span>
                      <span className="cs-section-count">{s.items.length}</span>
                    </div>
                  )}
                  <ul className="cs-rows">
                    {s.items.map((c) => (
                      <CaseRow
                        key={c.id}
                        c={c}
                        today={today}
                        onOpen={() => openCase(c)}
                        onDelete={() => handleDeleteCase(c)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
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

function CaseRow({ c, today, onOpen, onDelete }: { c: CaseListItem; today: string; onOpen: () => void; onDelete: () => void }) {
  const n = daysUntil(c.next, today);
  const hasDate = n !== null;
  const realCnr = CNR_RE.test((c.cnr ?? '').trim());
  const link = linkStatusDisplay(c.ecourtsLinkStatus);
  const open = isOpen(c);
  const sub = [c.client || 'No client', c.court || 'Court level not set'].join(' · ');
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
  };

  return (
    <li>
      <div className={`cs-row${open ? '' : ' is-closed'}`} role="link" tabIndex={0} onClick={onOpen} onKeyDown={onKey}>
        <span className={`adv-dateblock cs-dateblock${n === 0 && open ? ' is-today' : ''}`} aria-hidden="true">
          {hasDate ? (
            <>
              <span className="adv-dateblock-m">{MONTHS[+c.next.slice(5, 7) - 1]}</span>
              <span className="adv-dateblock-d">{+c.next.slice(8, 10)}</span>
            </>
          ) : (
            <span className="adv-dateblock-d">–</span>
          )}
        </span>

        <span className="cs-row-main">
          <span className="cs-row-title"><em className="case-name">{c.title}</em></span>
          <span className="cs-row-sub">{sub}</span>
          <span className="cs-row-tags">
            <span className="cs-tag">{c.type}</span>
            {realCnr && <span className="cs-tag mono">{c.cnr.toUpperCase()}</span>}
            {!open && <span className="cs-tag">{c.status}</span>}
          </span>
          {/* Tablet / phone: stage, eCourts and date fold into one line here. */}
          <span className="cs-row-meta">
            <span className="adv-pill">{String(c.stage)}</span>
            <span className={`badge ${link.badge}`}>{link.label}</span>
            <span className="cs-when-inline">{whenLabel(n)}</span>
          </span>
        </span>

        <span className="cs-col cs-col-stage"><span className="adv-pill">{String(c.stage)}</span></span>
        <span className="cs-col cs-col-ecourts"><span className={`badge ${link.badge}`}>{link.label}</span></span>
        <span className="cs-col cs-col-when">
          <span className="cs-when">{whenLabel(n)}</span>
          {hasDate && <span className="cs-when-date mono">{c.next}</span>}
        </span>

        <span className="cs-row-end">
          <Gate feature="matter.create">
            <button
              type="button"
              className="btn btn-ghost btn-sm cs-row-delete"
              aria-label={`Delete ${c.title}`}
              title="Delete matter (recoverable for 30 days)"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Icon name="trash" size={14} />
            </button>
          </Gate>
          <Icon name="chevron" size={16} className="adv-chev" />
        </span>
      </div>
    </li>
  );
}
