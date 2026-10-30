import { useEffect, useMemo, useState } from 'react';
import { Icon, EmptyState, ErrorState } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import type { DiaryEntry, DiaryKind } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useDiary, useDiaryEntry, useDeleteDiaryEntry } from '@/hooks/useDiary';
import { NewDiaryEntryModal } from '@/components/NewDiaryEntryModal';
import { RequestCoverageModal } from '@/components/RequestCoverageModal';
import { DiaryAssistantBar } from '@/components/DiaryAssistantBar';
import { DiaryBriefing } from '@/components/DiaryBriefing';
import { JudgmentInsightPanel } from '@/components/JudgmentInsightPanel';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { useConfirm } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';

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

function offsetLabel(n: number): string {
  if (n === 0) return 'on the hearing day';
  if (n === 1) return '1 day before';
  if (n === 7) return '1 week before';
  return `${n} days before`;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "13 Nov 2026" - readable date for reminders and next dates. */
function niceDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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
  // Assistant: briefing range + lazy-load flag (so opening the Diary doesn't
  // spend AI quota), and the judgment entry currently being analysed.
  const [briefRange, setBriefRange] = useState<'today' | 'week'>('today');
  const [briefLoaded, setBriefLoaded] = useState(false);
  const [insightEntry, setInsightEntry] = useState<{ id: string; fileName: string } | null>(null);
  // Entry being edited in the NewDiaryEntryModal (reused in edit mode). Kept
  // separate from `modalOpen` so the "New entry" FAB/button path is untouched.
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const showToast = useUIStore((s) => s.showToast);
  const confirm = useConfirm();
  const deleteEntry = useDeleteDiaryEntry();
  const { data: entries = [], isLoading, isError } = useDiary();

  const handleDelete = async (e: DiaryEntry) => {
    const ok = await confirm({
      title: 'Delete diary entry?',
      message: `This will permanently remove the "${e.caseLabel}" entry${e.attachmentFileName ? ', including its attached PDF' : ''}. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEntry.mutateAsync(e.id);
      showToast({ type: 'sage', text: 'Diary entry deleted' });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message
        ?? 'Could not delete diary entry';
      showToast({ type: 'vermillion', text: msg });
    }
  };

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

  // In-app reminders: entries that asked to be reminded N days before their
  // next hearing, whose hearing hasn't passed. "Due" once the remind date has
  // arrived. (No email/SMS — surfaced here only.)
  const reminders = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return entries
      .filter((e) => e.nextHearingDate && e.reminderOffsetDays != null)
      .map((e) => ({
        entry: e,
        remindOn: addDaysIso(e.nextHearingDate as string, -(e.reminderOffsetDays as number)),
      }))
      .filter((r) => (r.entry.nextHearingDate as string) >= today)
      .map((r) => ({ ...r, due: r.remindOn <= today }))
      .sort((a, b) => a.remindOn.localeCompare(b.remindOn));
  }, [entries]);

  return (
    <div className="col stagger ct ct-diary" style={{ gap: 24 }}>
      <PageHeader
        title="Court Diary"
        description="Hearings, judgments and filings by date, with next-date reminders."
        actions={<>
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
        </>}
      />
      <NewDiaryEntryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultKind={filter === 'judgment' ? 'judgment' : 'hearing'}
      />
      <NewDiaryEntryModal
        open={editingEntry !== null}
        onClose={() => setEditingEntry(null)}
        entry={editingEntry}
      />
      <FAB ariaLabel="Add diary entry" onClick={() => setModalOpen(true)}>
        <Icon name="plus" size={22} />
      </FAB>
      <RequestCoverageModal
        open={coverageDefaults !== null}
        onClose={() => setCoverageDefaults(null)}
        defaults={coverageDefaults ?? undefined}
      />
      <JudgmentInsightPanel
        open={insightEntry !== null}
        onClose={() => setInsightEntry(null)}
        entryId={insightEntry?.id ?? ''}
        fileName={insightEntry?.fileName ?? ''}
      />

      <DiaryAssistantBar onBriefing={(r) => { setBriefRange(r); setBriefLoaded(true); }} />
      <DiaryBriefing
        range={briefRange}
        onRangeChange={setBriefRange}
        loaded={briefLoaded}
        onLoad={() => setBriefLoaded(true)}
      />

      {reminders.length > 0 && (
        <section className="col" style={{ gap: 12 }}>
          <div className="ct-section-head">
            <h2 className="ct-section-title">Reminders</h2>
            <span className="ct-rule" />
            <span className="ct-section-count">
              {reminders.length} upcoming{reminders.some((r) => r.due) ? ` · ${reminders.filter((r) => r.due).length} due` : ''}
            </span>
          </div>
          <div className="ct-card">
            {reminders.map(({ entry, remindOn, due }) => (
              <div key={entry.id} className="ct-remind">
                <span className="ct-icon-tile"><Icon name="bell" size={15} /></span>
                <div className="col" style={{ gap: 4, minWidth: 0 }}>
                  <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="ct-title">{entry.caseLabel}</span>
                    {due && <span className="ct-pill is-ink">Due</span>}
                  </div>
                  <div className="ct-meta">
                    Remind {offsetLabel(entry.reminderOffsetDays as number)}<span className="ct-meta-dot" />Next hearing {niceDate(entry.nextHearingDate as string)}
                  </div>
                </div>
                <div className="ct-remind-on" title="Reminder date">
                  <b>{niceDate(remindOn)}</b>
                  Remind on
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
            {!isLoading && !isError && <span className="ct-chip-count">{f.id === 'all' ? entries.length : entries.filter((e) => e.kind === f.id).length}</span>}
          </button>
        ))}
      </div>

      <div className="col" style={{ gap: 28 }}>
        {pager.slice.map((g) => (
          <section key={g.date} className="col" style={{ gap: 12 }}>
            <div className="ct-section-head">
              <h2 className="ct-section-title">{formatHeading(g.date)}</h2>
              <span className="ct-rule" />
              <span className="ct-section-count">{g.entries.length} item{g.entries.length === 1 ? '' : 's'}</span>
            </div>
            <div className="ct-card">
              {g.entries.map((e) => {
                const meta = KIND_META[e.kind];
                return (
                  <div key={e.id} className="ct-erow">
                    <div className={`ct-erow-time${e.time ? '' : ' is-empty'}`}>{e.time || 'No time'}</div>
                    <span className="ct-icon-tile" aria-hidden><Icon name={meta.icon} size={15} /></span>
                    <div className="ct-erow-body">
                      <div className="ct-erow-head">
                        <span className="ct-title">{e.caseLabel}</span>
                        <span className={`ct-pill${e.kind === 'judgment' ? ' is-strong' : ''}`}>{meta.label}</span>
                      </div>
                      {e.detail && <div className="ct-erow-detail">{e.detail}</div>}
                      <div className="ct-meta">
                        {e.cnr && <span className="ct-code">{e.cnr}</span>}
                        {e.cnr && e.forum && <span className="ct-meta-dot" />}
                        {e.forum}
                        {e.bench && <><span className="ct-meta-dot" />{e.bench}</>}
                        {e.nextHearingDate && <><span className="ct-meta-dot" />Next date {niceDate(e.nextHearingDate)}</>}
                      </div>
                    </div>
                    <div className="ct-erow-actions">
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
                      {e.kind === 'judgment' && e.attachmentFileName && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setInsightEntry({ id: e.id, fileName: e.attachmentFileName! })}
                            title="AI summary, holding & follow-ups"
                          >
                            <Icon name="research" size={12} /> Analyze
                          </button>
                          <JudgmentAttachmentButton entryId={e.id} fileName={e.attachmentFileName} />
                        </>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditingEntry(e)}
                        title="Edit this diary entry"
                        aria-label="Edit diary entry"
                      >
                        <Icon name="edit" size={13} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDelete(e)}
                        title="Delete this diary entry"
                        aria-label="Delete diary entry"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {isLoading && (
          <div className="ct-card ct-loading-row" aria-busy="true" aria-label="Loading diary">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="row" style={{ gap: 16 }}>
                <span className="ct-skel" style={{ width: 44, height: 14 }} />
                <span className="ct-skel" style={{ width: 34, height: 34 }} />
                <div className="col" style={{ gap: 8, flex: 1 }}>
                  <span className="ct-skel" style={{ width: '40%', height: 14 }} />
                  <span className="ct-skel" style={{ width: '70%', height: 12 }} />
                </div>
              </div>
            ))}
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

/**
 * One-shot fetch + download for the judgment PDF attached to a diary row.
 * Lazy because the list endpoint omits the base64 body — we only ask for it
 * when the user actually clicks. Falls back to opening in a new tab if the
 * blob URL can't be created (very old browsers).
 */
function JudgmentAttachmentButton({ entryId, fileName }: { entryId: string; fileName: string }) {
  const [requested, setRequested] = useState(false);
  const entryQ = useDiaryEntry(requested ? entryId : null);
  const showToast = useUIStore((s) => s.showToast);

  // When the lazy fetch resolves, trigger the download once. Must live in an
  // effect, not the render body - triggering a real download/DOM mutation
  // during render isn't safe (React may re-invoke the render function, e.g.
  // under StrictMode's dev double-invoke, firing the download twice).
  useEffect(() => {
    if (!requested || !entryQ.data?.attachmentBase64 || !entryQ.data?.attachmentMime) return;
    try {
      const byteString = atob(entryQ.data.attachmentBase64);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i += 1) bytes[i] = byteString.charCodeAt(i);
      const blob = new Blob([bytes], { type: entryQ.data.attachmentMime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = entryQ.data.attachmentFileName ?? fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      showToast({ type: 'vermillion', text: 'Could not open the attached PDF' });
    } finally {
      setRequested(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fileName/showToast are stable identity enough here; re-running on entryQ.data is the only trigger that matters.
  }, [entryQ.data, requested]);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => setRequested(true)}
      disabled={entryQ.isFetching}
      title="Download the attached judgment PDF"
    >
      <Icon name="download" size={12} />{' '}
      {entryQ.isFetching ? 'Loading…' : 'View PDF'}
    </button>
  );
}
