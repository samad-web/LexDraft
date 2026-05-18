import { useMemo, useState } from 'react';
import { Icon, EmptyState, ErrorState } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import type { DiaryEntry, DiaryKind } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useDiary } from '@/hooks/useDiary';
import { NewDiaryEntryModal } from '@/components/NewDiaryEntryModal';
import { RequestCoverageModal } from '@/components/RequestCoverageModal';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

/** Defaults handed to the coverage modal when a Diary hearing row asks for cover.
 *  Kept narrow so we don't import the modal's full prop type here. */
interface CoverageDefaults {
  caseLabel?: string;
  court?: string;
  hearingDate?: string;
  hearingTime?: string;
  purpose?: string;
}

interface KindMeta {
  label: string;
  badgeClass: 'badge-cobalt' | 'badge-sage' | 'badge-amber';
  icon: 'calendar' | 'flag' | 'file';
}

const KIND_META: Record<DiaryKind, KindMeta> = {
  hearing: { label: 'Hearing', badgeClass: 'badge-cobalt', icon: 'calendar' },
  judgment: { label: 'Judgment', badgeClass: 'badge-sage', icon: 'flag' },
  filing: { label: 'Filing', badgeClass: 'badge-amber', icon: 'file' },
};

const FILTERS: ReadonlyArray<{ id: DiaryKind | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'hearing', label: 'Hearings' },
  { id: 'judgment', label: 'Judgments' },
  { id: 'filing', label: 'Filings' },
];

interface DateGroup {
  date: string;
  entries: DiaryEntry[];
}

function formatHeading(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const d = new Date(iso + 'T00:00:00');
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const day = d.getDate().toString().padStart(2, '0');
  const base = `${wd} ${day} ${mo}`;
  if (iso === today) return `Today · ${base}`;
  if (iso === tomorrow) return `Tomorrow · ${base}`;
  return base;
}

export function DiaryView() {
  const [filter, setFilter] = useState<DiaryKind | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  // Coverage modal: opens with hearing-row defaults so the user only fills in
  // the brief packet (URL + notes). `null` = closed.
  const [coverageDefaults, setCoverageDefaults] = useState<CoverageDefaults | null>(null);
  const showToast = useUIStore((s) => s.showToast);
  const { data: entries = [], isLoading, isError } = useDiary();

  const groups: DateGroup[] = useMemo(() => {
    const filtered = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);
    const sorted = [...filtered].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time.localeCompare(b.time);
    });
    const map = new Map<string, DiaryEntry[]>();
    for (const e of sorted) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return Array.from(map.entries()).map(([date, entries]) => ({ date, entries }));
  }, [entries, filter]);

  const pager = usePagination(groups);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Court diary</div>
          <h1 className="heading-xl">Diary</h1>
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const visible = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);
            if (visible.length === 0) {
              showToast({ type: 'amber', text: 'Nothing to print under the current filter' });
              return;
            }
            const rows = [...visible]
              .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))
              .map((e) =>
                `<tr>
                  <td>${escapeReportHtml(e.date)}</td>
                  <td>${escapeReportHtml(e.time || '')}</td>
                  <td>${escapeReportHtml(e.kind.toUpperCase())}</td>
                  <td>${escapeReportHtml(e.caseLabel)}</td>
                  <td>${escapeReportHtml(e.forum || '')}</td>
                  <td>${escapeReportHtml(e.detail || '')}</td>
                </tr>`,
              )
              .join('');
            const html = `<table><thead><tr><th>Date</th><th>Time</th><th>Kind</th><th>Matter</th><th>Forum</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>`;
            try {
              await exportPdf({
                title: 'Court Diary',
                bodyHtml: html,
                dated: new Date().toISOString().slice(0, 10),
                disclaimerHtml: null,
                orientation: 'landscape',
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Print failed';
              showToast({ type: 'vermillion', text: msg });
            }
          }}
        >
          <Icon name="download" size={14} /> Print
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="plus" size={14} /> New entry
        </button>
      </div>
      <NewDiaryEntryModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <FAB ariaLabel="Add diary entry" onClick={() => setModalOpen(true)}>
        <Icon name="plus" size={22} />
      </FAB>
      <RequestCoverageModal
        open={coverageDefaults !== null}
        onClose={() => setCoverageDefaults(null)}
        defaults={coverageDefaults ?? undefined}
      />

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

      <div className="col" style={{ gap: 28 }}>
        {pager.slice.map((g) => (
          <section key={g.date} className="col" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 12 }}>
              <div className="heading-md">{formatHeading(g.date)}</div>
              <span className="hairline" style={{ flex: 1 }} />
              <span className="mono body-xs muted tabular">{g.entries.length} item{g.entries.length === 1 ? '' : 's'}</span>
            </div>
            <div className="card" style={{ padding: 0 }}>
              {g.entries.map((e, idx) => {
                const meta = KIND_META[e.kind];
                return (
                  <div
                    key={e.id}
                    className="row"
                    style={{
                      alignItems: 'flex-start',
                      gap: 16,
                      padding: 'var(--space-4) var(--space-6)',
                      borderBottom:
                        idx === g.entries.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      className="mono tabular"
                      style={{
                        width: 56,
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        paddingTop: 2,
                      }}
                    >
                      {e.time}
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--bg-surface-2)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-full)',
                        color: 'var(--text-secondary)',
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={meta.icon} size={14} />
                    </div>
                    <div className="col" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                        <em className="case-name" style={{ fontWeight: 500 }}>{e.caseLabel}</em>
                        <span className={`badge ${meta.badgeClass}`}>{meta.label}</span>
                      </div>
                      <div className="body-sm" style={{ color: 'var(--text-primary)' }}>
                        {e.detail}
                      </div>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="mono body-xs muted tabular">{e.cnr}</span>
                        <span className="body-xs muted">·</span>
                        <span className="body-xs muted">{e.forum}</span>
                      </div>
                    </div>
                    {e.kind === 'hearing' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setCoverageDefaults({
                            caseLabel: e.caseLabel,
                            court: e.forum,
                            hearingDate: e.date,
                            hearingTime: e.time,
                            purpose: e.detail,
                          })
                        }
                        title="Post this hearing to the coverage board"
                      >
                        <Icon name="members" size={12} /> Request coverage
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {isLoading && (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-9)' }}>
            <p className="body-md muted">Loading diary<span className="blink" /></p>
          </div>
        )}
        {isError && !isLoading && (
          <ErrorState
            icon="diary"
            title="Couldn't load diary"
            description="Check your connection and try again."
          />
        )}
        {!isLoading && !isError && groups.length === 0 && (
          <EmptyState
            icon="diary"
            title={entries.length === 0 ? 'No diary entries yet' : 'No diary entries match'}
            description={
              entries.length === 0
                ? 'Log hearings, calls, and visits to keep an audited record of your day.'
                : 'Try a different filter or date range.'
            }
          />
        )}
        {!isLoading && !isError && groups.length > 0 && (
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
