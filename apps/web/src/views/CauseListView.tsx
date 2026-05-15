import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useUIStore } from '@/store/ui';
import { useCalendarDay } from '@/hooks/useCalendar';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

type CauseStatus = 'today' | 'upcoming' | 'past';

interface CauseRow {
  id: string;
  serial: number;
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

const TODAY_LABEL = new Date().toLocaleDateString(undefined, {
  weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
});

export function CauseListView() {
  const [filter, setFilter] = useState<CauseStatus | 'all'>('all');
  const showToast = useUIStore((s) => s.showToast);
  const today = TODAY_LABEL; // string used in eyebrow
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data: hearings = [], isLoading, isError } = useCalendarDay(todayIso);
  const qc = useQueryClient();

  const ROWS: CauseRow[] = useMemo(() =>
    hearings.map((h, i) => ({
      id: h.id ?? `h${i}`,
      serial: i + 1,
      time: h.time,
      caseName: h.case,
      courtRoom: h.court,
      purpose: h.purpose,
      status: h.status,
    })),
  [hearings]);

  const filtered: CauseRow[] = useMemo(() => {
    if (filter === 'all') return ROWS;
    return ROWS.filter((r) => r.status === filter);
  }, [filter, ROWS]);

  const pager = usePagination(filtered);

  const stats = useMemo(() => ({
    total: ROWS.length,
    confirmed: ROWS.filter((r) => r.status === 'today').length,
    tentative: ROWS.filter((r) => r.status === 'upcoming').length,
  }), [ROWS]);
  void today;

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Daily roster · {TODAY_LABEL}</div>
          <h1 className="heading-xl">Cause list</h1>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={async () => {
            if (ROWS.length === 0) {
              showToast({ type: 'amber', text: 'No matters listed today' });
              return;
            }
            const rows = ROWS
              .map((r) =>
                `<tr>
                  <td class="num">${r.serial}</td>
                  <td>${escapeReportHtml(r.time)}</td>
                  <td>${escapeReportHtml(r.caseName)}</td>
                  <td>${escapeReportHtml(r.courtRoom)}</td>
                  <td>${escapeReportHtml(r.purpose)}</td>
                  <td>${escapeReportHtml(r.status.toUpperCase())}</td>
                </tr>`,
              )
              .join('');
            const html = `<table><thead><tr><th>№</th><th>Time</th><th>Matter</th><th>Court / Room</th><th>Purpose</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
            try {
              await exportPdf({
                title: `Cause List · ${TODAY_LABEL}`,
                bodyHtml: html,
                dated: todayIso,
                disclaimerHtml: null,
                orientation: 'landscape',
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'PDF export failed';
              showToast({ type: 'vermillion', text: msg });
            }
          }}
        >
          <Icon name="download" size={14} /> Download PDF
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            try {
              await qc.invalidateQueries({ queryKey: ['calendar', 'day', todayIso] });
              showToast({ type: 'sage', text: 'Roster refreshed' });
            } catch {
              showToast({ type: 'vermillion', text: 'Refresh failed - try again' });
            }
          }}
        >
          <Icon name="upload" size={14} /> Refresh roster
        </button>
      </div>

      <div className="stat-row">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Listed today</div>
          <div className="mono tabular" style={{ fontSize: 28, fontWeight: 600 }}>{stats.total}</div>
          <div className="body-xs muted">All matters</div>
        </div>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="dot dot-sage" />
            <span className="eyebrow">Today</span>
          </div>
          <div className="mono tabular" style={{ fontSize: 28, fontWeight: 600 }}>{stats.confirmed}</div>
          <div className="body-xs muted">In today’s cause list</div>
        </div>
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="dot dot-cobalt" />
            <span className="eyebrow">Upcoming</span>
          </div>
          <div className="mono tabular" style={{ fontSize: 28, fontWeight: 600 }}>{stats.tentative}</div>
          <div className="body-xs muted">Future hearings</div>
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
              <th style={{ width: 60, textAlign: 'right' }}>Sl.</th>
              <th style={{ width: 80 }}>Time</th>
              <th>Matter</th>
              <th>Court room</th>
              <th>Purpose</th>
              <th style={{ width: 130 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <span className="muted">Loading cause list<span className="blink" /></span>
                </td>
              </tr>
            )}
            {isError && !isLoading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--danger)' }}>
                  Couldn’t load cause list.
                </td>
              </tr>
            )}
            {!isLoading && !isError && pager.slice.map((r) => (
              <tr key={r.id}>
                <td className="mono tabular muted" style={{ textAlign: 'right' }}>{r.serial}</td>
                <td className="mono tabular" style={{ fontWeight: 500 }}>{r.time}</td>
                <td>
                  <em className="case-name" style={{ fontWeight: 500 }}>{r.caseName}</em>
                </td>
                <td>
                  <span className="body-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {r.courtRoom}
                  </span>
                </td>
                <td className="body-sm">{r.purpose}</td>
                <td>
                  <span className={`badge ${r.status === 'today' ? 'badge-sage' : r.status === 'past' ? 'badge-cream' : 'badge-cobalt'}`}>
                    {r.status === 'today' ? 'Today' : r.status === 'past' ? 'Past' : 'Upcoming'}
                  </span>
                </td>
              </tr>
            ))}
            {!isLoading && !isError && filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
                  <span className="body-sm muted">{ROWS.length === 0 ? 'No matters listed for today.' : 'No matters match this filter.'}</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
