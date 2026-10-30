/**
 * Coverage swap board - Practice / Firm tier feature.
 *
 * 3-column Trello-style layout (Open / Claimed / Completed) so the firm can
 * see, at a glance, who needs cover and who's already picked up someone
 * else's clash. Clicking a card opens a side panel with the full brief
 * packet and the relevant action (claim / cancel / complete).
 *
 * Authorisation is enforced server-side. We optimistically render whichever
 * actions COULD apply and let the API reject if the caller isn't entitled
 * (e.g. claiming your own request) - that surfaces a toast rather than
 * confusing pre-hide. Cancelled requests are intentionally not visible by
 * default; they re-appear if the caller filters by "All".
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import {
  useCoverageList,
  useClaimCoverage,
  useCancelCoverage,
  useCompleteCoverage,
  COVERAGE_KEY,
  type CoverageRequest,
  type CoverageStatus,
} from '@/hooks/useCoverage';
import { RequestCoverageModal } from '@/components/RequestCoverageModal';
import { PageHeader } from '@/components/PageHeader';

interface ColumnDef {
  id: CoverageStatus;
  label: string;
  sub: string;
}

const COLUMNS: ReadonlyArray<ColumnDef> = [
  { id: 'open',      label: 'Open',      sub: 'Awaiting a volunteer' },
  { id: 'claimed',   label: 'Claimed',   sub: 'Covering counsel locked in' },
  { id: 'completed', label: 'Completed', sub: 'Hearing covered' },
];

const STATUS_BADGE: Record<CoverageStatus, string> = {
  open:      'badge-amber',
  claimed:   'badge-cobalt',
  completed: 'badge-sage',
  cancelled: 'badge-vermillion',
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  open:      'Open',
  claimed:   'Claimed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${wd} ${String(d.getDate()).padStart(2, '0')} ${mo}`;
}

function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export function CoverageView() {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const me = useAuthStore((s) => s.user);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: requests = [], isLoading, isError } = useCoverageList();
  const claim = useClaimCoverage();
  const cancel = useCancelCoverage();
  const complete = useCompleteCoverage();

  // Group into the 3 board columns. Cancelled requests fall off the board.
  const grouped = useMemo(() => {
    const buckets: Record<CoverageStatus, CoverageRequest[]> = {
      open: [], claimed: [], completed: [], cancelled: [],
    };
    for (const r of requests) buckets[r.status].push(r);
    return buckets;
  }, [requests]);

  const selected = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const onError = (action: string) => (err: unknown) => {
    const msg =
      (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
      ?? (err as Error).message
      ?? `Couldn't ${action}`;
    showToast({ type: 'vermillion', text: msg });
  };

  const handleClaim = (id: string) => {
    claim.mutate(id, {
      onSuccess: () => showToast({ type: 'sage', text: 'You\'re covering this hearing' }),
      onError: (err: unknown) => {
        onError('claim coverage')(err);
        // Someone else likely claimed it first - the panel's `selected` data is
        // now stale, so re-sync with the server and close it rather than leaving
        // an actionable "Claim coverage" button pointed at a request that no
        // longer accepts that action.
        qc.invalidateQueries({ queryKey: COVERAGE_KEY });
        setSelectedId(null);
      },
    });
  };

  const handleCancel = (id: string) => {
    cancel.mutate(id, {
      onSuccess: () => {
        showToast({ type: 'cobalt', text: 'Coverage request cancelled' });
        setSelectedId(null);
      },
      onError: onError('cancel request'),
    });
  };

  const handleComplete = (id: string) => {
    complete.mutate(id, {
      onSuccess: () => showToast({ type: 'sage', text: 'Marked complete' }),
      onError: onError('mark complete'),
    });
  };

  const isMine = (r: CoverageRequest): boolean => !!me && r.requestedBy === me.id;
  const isClaimer = (r: CoverageRequest): boolean => !!me && r.claimedBy === me.id;

  return (
    <div className="col stagger ct ct-coverage" style={{ gap: 24 }}>
      <PageHeader
        title="Coverage Board"
        description="Ask a colleague to cover a hearing you can't attend, or pick one up."
        actions={
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setModalOpen(true)}
          >
            <Icon name="plus" size={14} /> Request coverage
          </button>
        }
      />

      <RequestCoverageModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {isLoading && (
        <div className="ct-board is-3" style={{ ['--ct-cols' as string]: 3 }} aria-busy="true">
          {[0, 1, 2].map((c) => (
            <div key={c} className="ct-col">
              <Skeleton width={120} height={14} />
              <Skeleton width="100%" height={110} radius="md" />
              <Skeleton width="100%" height={110} radius="md" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Couldn't load the coverage board"
          description="Check your connection and try again."
        />
      )}

      {!isLoading && !isError && requests.length === 0 && (
        <EmptyState
          icon="members"
          title="No coverage requests yet"
          description="When a colleague needs another advocate to cover a hearing, their request will appear here. Click 'Request coverage' to ask for one."
        />
      )}

      {!isLoading && !isError && requests.length > 0 && (
        <div className="ct-kpis">
          <div className="ct-kpi"><span className="ct-kpi-label">Needs cover</span><span className="ct-kpi-value">{grouped.open.length}</span><span className="ct-kpi-note">Open requests</span></div>
          <div className="ct-kpi"><span className="ct-kpi-label">Covered</span><span className="ct-kpi-value">{grouped.claimed.length}</span><span className="ct-kpi-note">Counsel locked in</span></div>
          <div className="ct-kpi"><span className="ct-kpi-label">Completed</span><span className="ct-kpi-value">{grouped.completed.length}</span><span className="ct-kpi-note">Hearings attended</span></div>
        </div>
      )}

      {!isLoading && !isError && requests.length > 0 && (
        <div className="ct-board is-3" style={{ ['--ct-cols' as string]: 3 }}>
          {COLUMNS.map((col) => {
            const cards = grouped[col.id];
            return (
              <div key={col.id} className="ct-col">
                <div className="ct-col-head">
                  <div style={{ minWidth: 0 }}>
                    <span className="ct-col-title">{col.label}</span>
                    <span className="ct-col-sub">{col.sub}</span>
                  </div>
                  <span className="ct-col-count">{cards.length}</span>
                </div>
                {cards.length === 0 && (
                  <div className="ct-col-empty">Nothing here yet.</div>
                )}
                {cards.map((r) => {
                  const dt = r.hearingDate ? new Date(r.hearingDate + 'T00:00:00') : null;
                  const valid = dt && !Number.isNaN(dt.getTime());
                  return (
                    <div
                      key={r.id}
                      className="ct-tcard"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(r.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(r.id); }}
                    >
                      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                        <span className="ct-date" aria-label={formatDate(r.hearingDate)}>
                          {valid ? (
                            <>
                              <span className="ct-date-wd">{dt!.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                              <span className="ct-date-d">{dt!.getDate()}</span>
                              <span className="ct-date-mo">{dt!.toLocaleDateString('en-IN', { month: 'short' })}</span>
                            </>
                          ) : <span className="ct-date-d">—</span>}
                        </span>
                        <div className="col" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                          <span className="ct-tcard-title">{r.caseLabel}</span>
                          <span className="ct-meta">{r.court}</span>
                          {r.purpose && <span className="ct-meta" style={{ color: 'var(--text-tertiary)' }}>{r.purpose}</span>}
                        </div>
                      </div>
                      <div className="ct-tcard-foot">
                        <div className="avatar" title={r.requestedByName ?? 'Unknown'}>{initials(r.requestedByName)}</div>
                        <span className="ct-tcard-due" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.requestedByName ?? 'Unknown'}
                        </span>
                        {r.claimedByName && (
                          <>
                            <Icon name="arrow" size={12} />
                            <div className="avatar" title={r.claimedByName}>{initials(r.claimedByName)}</div>
                            <span className="ct-tcard-due">{r.claimedByName}</span>
                          </>
                        )}
                        <span className="spacer" />
                        <span className={`ct-time${r.hearingTime ? '' : ' is-empty'}`}>{r.hearingTime || '--:--'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <>
          <div className="ct-scrim" onClick={() => setSelectedId(null)} />
          <aside className="ct-drawer" role="dialog" aria-modal="true" aria-label={selected.caseLabel}>
            <div className="ct-drawer-top">
              <span className={`ct-pill${selected.status === 'open' ? ' is-ink' : selected.status === 'claimed' ? ' is-strong' : selected.status === 'cancelled' ? ' is-quiet' : ''}`}>
                {STATUS_LABEL[selected.status]}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedId(null)}
                aria-label="Close"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div>
              <div className="ct-eyebrow">Coverage request</div>
              <h2 className="ct-drawer-title" style={{ marginTop: 8 }}>{selected.caseLabel}</h2>
              <p className="ct-drawer-sub">{selected.court}</p>
            </div>

            <div className="ct-facts">
              <div className="ct-fact">
                <span className="ct-eyebrow">Date</span>
                <span className="ct-fact-value">{formatDate(selected.hearingDate)}</span>
              </div>
              <div className="ct-fact">
                <span className="ct-eyebrow">Time</span>
                <span className="ct-fact-value">{selected.hearingTime || '—'}</span>
              </div>
              <div className="ct-fact is-wide">
                <span className="ct-eyebrow">Purpose</span>
                <span className="ct-fact-value">{selected.purpose || '—'}</span>
              </div>
              <div className="ct-fact">
                <span className="ct-eyebrow">Requested by</span>
                <span className="ct-fact-value">
                  <span className="avatar">{initials(selected.requestedByName)}</span>
                  {selected.requestedByName ?? 'Unknown'}
                </span>
              </div>
              <div className="ct-fact">
                <span className="ct-eyebrow">Covered by</span>
                {selected.claimedByName ? (
                  <span className="ct-fact-value">
                    <span className="avatar">{initials(selected.claimedByName)}</span>
                    {selected.claimedByName}
                  </span>
                ) : (
                  <span className="ct-fact-value" style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>Not yet claimed</span>
                )}
              </div>
            </div>

            {selected.briefUrl && (
              <div className="ct-drawer-block">
                <span className="ct-eyebrow">Brief packet</span>
                <a
                  href={selected.briefUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="body-sm"
                  style={{ color: 'var(--text-primary)', textDecoration: 'underline', textUnderlineOffset: 3, overflowWrap: 'anywhere' }}
                >
                  {selected.briefUrl}
                </a>
              </div>
            )}
            {selected.briefNotes && (
              <div className="ct-drawer-block">
                <span className="ct-eyebrow">Notes for covering counsel</span>
                <p className="body-sm" style={{ whiteSpace: 'pre-wrap', margin: 0, lineHeight: 1.6 }}>{selected.briefNotes}</p>
              </div>
            )}

            <div className="ct-drawer-actions">
              {selected.status === 'open' && !isMine(selected) && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={claim.isPending}
                  onClick={() => handleClaim(selected.id)}
                >
                  {claim.isPending ? 'Claiming…' : 'Claim coverage'}
                </button>
              )}
              {(selected.status === 'open' || selected.status === 'claimed') && isMine(selected) && (
                <button
                  type="button"
                  className="btn btn-oxblood"
                  disabled={cancel.isPending}
                  onClick={() => handleCancel(selected.id)}
                >
                  {cancel.isPending ? 'Cancelling…' : 'Cancel request'}
                </button>
              )}
              {selected.status === 'claimed' && isClaimer(selected) && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={complete.isPending}
                  onClick={() => handleComplete(selected.id)}
                >
                  {complete.isPending ? 'Marking…' : 'Mark complete'}
                </button>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
