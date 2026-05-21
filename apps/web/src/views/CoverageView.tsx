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
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import {
  useCoverageList,
  useClaimCoverage,
  useCancelCoverage,
  useCompleteCoverage,
  type CoverageRequest,
  type CoverageStatus,
} from '@/hooks/useCoverage';
import { RequestCoverageModal } from '@/components/RequestCoverageModal';

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
      onError: onError('claim coverage'),
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
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Hearing-coverage swap board</div>
          <h1 className="heading-xl">Coverage</h1>
        </div>
        <span className="spacer" />
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="plus" size={14} /> Request coverage
        </button>
      </div>

      <RequestCoverageModal open={modalOpen} onClose={() => setModalOpen(false)} />

      {isLoading && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 16,
          }}
        >
          {[0, 1, 2].map((c) => (
            <div key={c} className="card" style={{ background: 'var(--bg-surface-2)', padding: 16, minHeight: 360 }}>
              <Skeleton width={120} height={14} />
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Skeleton width="100%" height={80} radius="md" />
                <Skeleton width="100%" height={80} radius="md" />
              </div>
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
        <div
          className="kanban"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 16,
          }}
        >
          {COLUMNS.map((col) => {
            const cards = grouped[col.id];
            return (
              <div
                key={col.id}
                style={{
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                  minHeight: 420,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div className="row">
                  <div className="col" style={{ gap: 2 }}>
                    <span className="eyebrow">{col.label}</span>
                    <span className="body-xs muted">{col.sub}</span>
                  </div>
                  <span className="spacer" />
                  <span className="mono body-sm muted">{cards.length}</span>
                </div>
                <div className="col" style={{ gap: 10 }}>
                  {cards.length === 0 && (
                    <div className="body-sm muted" style={{ padding: 'var(--space-3)' }}>
                      Nothing here yet.
                    </div>
                  )}
                  {cards.map((r) => (
                    <div
                      key={r.id}
                      className="card card-hover"
                      onClick={() => setSelectedId(r.id)}
                      style={{
                        background: 'var(--bg-base)',
                        padding: 'var(--space-4)',
                        cursor: 'pointer',
                      }}
                    >
                      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                        <span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                        <span className="spacer" />
                        <span className="mono body-xs muted tabular">{formatDate(r.hearingDate)}</span>
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          lineHeight: 1.4,
                          marginBottom: 6,
                          color: 'var(--text-primary)',
                        }}
                      >
                        {r.caseLabel}
                      </div>
                      <div className="body-sm muted" style={{ marginBottom: 10 }}>
                        {r.court} · {r.hearingTime}
                      </div>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
                          {initials(r.requestedByName)}
                        </div>
                        <span className="body-xs muted">
                          {r.requestedByName ?? 'Unknown'}
                        </span>
                        {r.claimedByName && (
                          <>
                            <span className="body-xs muted">→</span>
                            <div className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
                              {initials(r.claimedByName)}
                            </div>
                            <span className="body-xs muted">{r.claimedByName}</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <>
          <div
            onClick={() => setSelectedId(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 60,
            }}
          />
          <div
            className="card"
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: 'min(480px, 100vw)',
              zIndex: 61,
              padding: 'var(--space-7)',
              overflowY: 'auto',
              background: 'var(--bg-elevated)',
              borderRadius: 0,
              borderLeft: '1px solid var(--border-default)',
            }}
          >
            <div className="row" style={{ marginBottom: 16 }}>
              <span className={`badge ${STATUS_BADGE[selected.status]}`}>{selected.status}</span>
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
            <h2 className="heading-lg" style={{ marginBottom: 6 }}>{selected.caseLabel}</h2>
            <div className="body-sm muted" style={{ marginBottom: 24 }}>
              {selected.court}
            </div>

            <div className="grid-2" style={{ gap: 16, marginBottom: 20 }}>
              <div>
                <div className="label">Date</div>
                <div className="mono body-md tabular">{formatDate(selected.hearingDate)}</div>
              </div>
              <div>
                <div className="label">Time</div>
                <div className="mono body-md tabular">{selected.hearingTime}</div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div className="label">Purpose</div>
                <div className="body-sm">{selected.purpose}</div>
              </div>
              <div>
                <div className="label">Requested by</div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                    {initials(selected.requestedByName)}
                  </div>
                  <span className="body-sm">{selected.requestedByName ?? 'Unknown'}</span>
                </div>
              </div>
              <div>
                <div className="label">Covered by</div>
                {selected.claimedByName ? (
                  <div className="row" style={{ gap: 8 }}>
                    <div className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                      {initials(selected.claimedByName)}
                    </div>
                    <span className="body-sm">{selected.claimedByName}</span>
                  </div>
                ) : (
                  <span className="body-sm muted">- Not yet claimed -</span>
                )}
              </div>
            </div>

            {selected.briefUrl && (
              <div style={{ marginBottom: 16 }}>
                <div className="label">Brief packet</div>
                <a
                  href={selected.briefUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="body-sm"
                  style={{ color: 'var(--accent)' }}
                >
                  {selected.briefUrl}
                </a>
              </div>
            )}
            {selected.briefNotes && (
              <div style={{ marginBottom: 24 }}>
                <div className="label">Notes for covering counsel</div>
                <p className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{selected.briefNotes}</p>
              </div>
            )}

            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
          </div>
        </>
      )}

      <style>{`
        @media (max-width: 1023px) { .kanban { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 640px)  { .kanban { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}
