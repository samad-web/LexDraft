import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, ErrorState, EmptyState } from '@lexdraft/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/store/ui';
import { useHearingsRange, useSyncFirmFromEcourts } from '@/hooks/useCalendar';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { PageHeader } from '@/components/PageHeader';

// Cause List - every matter's hearings, from two sources that both feed the
// hearings table: the eCourts sync (09:00 / 19:00, on linking a CNR, and
// "Sync from eCourts" here) and the next hearing date typed on a matter.
// Today / Upcoming / Past come from the hearing's date, not a stored status.

type CauseStatus = 'today' | 'upcoming' | 'past';

interface CauseRow {
  id: string;
  /** Parent matter - the row opens it. */
  caseId?: string;
  serial: number;
  date: string;
  time: string;
  caseName: string;
  courtRoom: string;
  purpose: string;
  status: CauseStatus;
}

const FILTERS: ReadonlyArray<{ id: CauseStatus | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
];

const PAST_DAYS = 30;
const AHEAD_DAYS = 60;

/** YYYY-MM-DD in the advocate's local time (not UTC - before 05:30 IST the
 *  UTC date is still yesterday). */
function localIso(d: Date): string {
  return new Intl.DateTimeFormat('en-CA').format(d);
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localIso(d);
}

const dmy = (iso: string) => (iso ? iso.split('-').reverse().join('-') : '—');

export function CauseListView() {
  const showToast = useUIStore((s) => s.showToast);
  const navigate = useNavigate();
  const todayIso = localIso(new Date());
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const from = shiftDays(todayIso, -PAST_DAYS);
  const to = shiftDays(todayIso, AHEAD_DAYS);
  const { data: hearings = [], isLoading, isError, refetch } = useHearingsRange(from, to);
  const qc = useQueryClient();
  const sync = useSyncFirmFromEcourts();
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Stop polling when the page closes.
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

  const ROWS: CauseRow[] = useMemo(() => {
    const rows = hearings.map((h, i) => {
      const date = h.date ?? '';
      const status: CauseStatus = !date ? h.status : date === todayIso ? 'today' : date > todayIso ? 'upcoming' : 'past';
      return { id: h.id ?? `h${i}`, caseId: h.caseId, date, time: h.time, caseName: h.case, courtRoom: h.court, purpose: h.purpose, status };
    });
    // Today first, then upcoming (soonest first), then past (latest first).
    const rank = { today: 0, upcoming: 1, past: 2 } as const;
    rows.sort((a, b) =>
      rank[a.status] - rank[b.status]
      || (a.status === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date))
      || a.time.localeCompare(b.time));
    return rows.map((r, i) => ({ ...r, serial: i + 1 }));
  }, [hearings, todayIso]);

  const [filter, setFilter] = useState<CauseStatus | 'all'>('all');
  const filtered: CauseRow[] = useMemo(() => {
    const list = filter === 'all' ? ROWS : ROWS.filter((r) => r.status === filter);
    return list.map((r, i) => ({ ...r, serial: i + 1 }));
  }, [filter, ROWS]);

  const pager = usePagination(filtered);

  const stats = useMemo(() => ({
    today: ROWS.filter((r) => r.status === 'today').length,
    upcoming: ROWS.filter((r) => r.status === 'upcoming').length,
    past: ROWS.filter((r) => r.status === 'past').length,
  }), [ROWS]);

  const refreshHearings = () => qc.invalidateQueries({ queryKey: ['calendar'] });

  const syncFromEcourts = async () => {
    try {
      const r = await sync.mutateAsync();
      if (r.total === 0) {
        const closed = r.closed ?? 0;
        showToast({
          type: 'amber',
          text: closed > 0
            ? `Nothing to sync: your ${closed === 1 ? 'matter with a CNR is' : `${closed} matters with a CNR are`} closed or disposed in eCourts. Only open matters are refreshed - add a CNR to an open matter to sync it.`
            : 'None of your open matters has a CNR yet - add one to connect it to eCourts.',
        });
        await refreshHearings();
        return;
      }
      if (r.queued === 0) {
        showToast({ type: 'sage', text: 'All matters were synced from eCourts in the last 30 minutes.' });
        await refreshHearings();
        return;
      }
      showToast({ type: 'sage', text: `Syncing ${r.queued} matter${r.queued === 1 ? '' : 's'} from eCourts. Hearings update as they come in.` });
      // eCourts answers a few matters a minute; refresh while it works.
      setSyncing(true);
      if (pollRef.current) window.clearInterval(pollRef.current);
      let ticks = 0;
      const maxTicks = Math.min(40, Math.ceil(r.queued * 4 / 15) + 2);
      pollRef.current = window.setInterval(() => {
        ticks += 1;
        void refreshHearings();
        if (ticks >= maxTicks && pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
          setSyncing(false);
        }
      }, 15_000);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not start the eCourts sync - try again.';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const downloadPdf = async () => {
    if (filtered.length === 0) {
      showToast({ type: 'amber', text: 'No hearings to export for this view' });
      return;
    }
    const rows = filtered
      .map((r) =>
        `<tr>
          <td class="num">${r.serial}</td>
          <td>${escapeReportHtml(dmy(r.date))}</td>
          <td>${escapeReportHtml(r.time)}</td>
          <td>${escapeReportHtml(r.caseName)}</td>
          <td>${escapeReportHtml(r.courtRoom)}</td>
          <td>${escapeReportHtml(r.purpose)}</td>
        </tr>`,
      )
      .join('');
    const html = `<table><thead><tr><th>№</th><th>Date</th><th>Time</th><th>Matter</th><th>Court / Room</th><th>Purpose</th></tr></thead><tbody>${rows}</tbody></table>`;
    try {
      await exportPdf({
        title: `Cause List · ${filter === 'all' ? todayLabel : FILTERS.find((f) => f.id === filter)?.label}`,
        bodyHtml: html,
        dated: todayIso,
        disclaimerHtml: null,
        orientation: 'landscape',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF export failed';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const chipCount = (id: CauseStatus | 'all') => (id === 'all' ? ROWS.length : stats[id]);
  const openRow = (r: CauseRow) => { if (r.caseId) navigate(`/app/cases/${r.caseId}`); };

  return (
    <div className="col stagger ct ct-causelist" style={{ gap: 24 }}>
      <PageHeader
        title="Cause List"
        description="Hearings of every matter in Cases - from eCourts and from the next hearing date on each matter."
        meta={todayLabel}
        actions={<>
          <button type="button" className="btn" onClick={() => { void downloadPdf(); }}>
            <Icon name="download" size={14} /> Download PDF
          </button>
          <button type="button" className="btn btn-primary" disabled={sync.isPending} onClick={() => { void syncFromEcourts(); }}>
            <Icon name="upload" size={14} /> {sync.isPending ? 'Starting…' : syncing ? 'Syncing from eCourts…' : 'Sync from eCourts'}
          </button>
        </>}
      />

      <div className="ct-kpis">
        {([
          { id: 'today', label: 'Listed today', value: stats.today, note: 'In today’s cause list' },
          { id: 'upcoming', label: 'Upcoming', value: stats.upcoming, note: `Next ${AHEAD_DAYS} days` },
          { id: 'past', label: 'Past', value: stats.past, note: `Last ${PAST_DAYS} days` },
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
            {!isLoading && !isError && <span className="ct-chip-count">{chipCount(f.id)}</span>}
          </button>
        ))}
        <span className="ct-toolbar-note">{syncing ? 'Refreshing as eCourts answers…' : 'Click a hearing to open its matter'}</span>
      </div>

      <div className="ct-card ct-docket" role="table" aria-label="Cause list">
        <div className="ct-docket-head" role="row">
          <span className="ct-h-sl" role="columnheader">Sl.</span>
          <span className="ct-h-date" role="columnheader">Date</span>
          <span className="ct-h-time" role="columnheader">Time</span>
          <span className="ct-h-main" role="columnheader">Matter · Court room</span>
          <span className="ct-h-purpose" role="columnheader">Purpose</span>
          <span className="ct-h-status" role="columnheader">Status</span>
        </div>
        {isLoading && (
          <div className="ct-loading-row" aria-busy="true" aria-label="Loading cause list">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="row" style={{ gap: 16 }}>
                <span className="ct-skel" style={{ width: 52, height: 56 }} />
                <div className="col" style={{ gap: 8, flex: 1 }}>
                  <span className="ct-skel" style={{ width: '46%', height: 14 }} />
                  <span className="ct-skel" style={{ width: '30%', height: 12 }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {isError && !isLoading && (
          <div className="ct-empty-row">
            <ErrorState
              variant="inline"
              title="Couldn't load cause list"
              description="Check your connection and try again."
              onRetry={() => { void refetch(); }}
            />
          </div>
        )}
        {!isLoading && !isError && pager.slice.map((r) => {
          const d = r.date ? new Date(`${r.date}T00:00:00`) : null;
          return (
            <div
              key={r.id}
              role="row"
              className={`ct-drow is-${r.status}${r.caseId ? ' is-link' : ''}`}
              onClick={r.caseId ? () => openRow(r) : undefined}
              onKeyDown={r.caseId ? (e) => { if (e.key === 'Enter') openRow(r); } : undefined}
              tabIndex={r.caseId ? 0 : undefined}
              title={r.caseId ? `Open ${r.caseName}` : undefined}
            >
              <span className="ct-drow-sl" role="cell">{r.serial}</span>
              <span
                role="cell"
                className={`ct-date${r.status === 'today' ? ' is-today' : r.status === 'past' ? ' is-past' : ''}`}
                aria-label={dmy(r.date)}
              >
                {d ? (
                  <>
                    <span className="ct-date-wd">{d.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                    <span className="ct-date-d">{d.getDate()}</span>
                    <span className="ct-date-mo">{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
                  </>
                ) : <span className="ct-date-d">—</span>}
              </span>
              <span className="ct-drow-time" role="cell">
                <span className={`ct-time${r.time ? '' : ' is-empty'}`}>{r.time || '--:--'}</span>
              </span>
              <span className="ct-drow-main" role="cell">
                <span className="ct-title">{r.caseName}</span>
                <span className="ct-meta">{r.courtRoom || '—'}</span>
                {r.purpose && <span className="ct-meta ct-drow-purpose-inline">{r.purpose}</span>}
              </span>
              <span className="ct-drow-purpose" role="cell">{r.purpose || '—'}</span>
              <span className="ct-drow-status" role="cell">
                <span className={`ct-pill${r.status === 'today' ? ' is-ink' : r.status === 'past' ? ' is-quiet' : ''}`}>
                  {r.status === 'today' ? 'Today' : r.status === 'past' ? 'Past' : 'Upcoming'}
                </span>
              </span>
            </div>
          );
        })}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="ct-empty-row">
            <EmptyState
              variant="inline"
              icon="causelist"
              title={ROWS.length === 0 ? 'No hearings yet' : 'No hearings match this filter'}
              description={ROWS.length === 0
                ? 'Hearings appear here from eCourts (matters with a CNR) and from the next hearing date on a matter. Use “Sync from eCourts” to fetch them now.'
                : undefined}
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
