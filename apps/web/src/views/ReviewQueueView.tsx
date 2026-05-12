import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useMyReviews, type ContractReviewSummary, type ReviewDecision } from '@/hooks/useReview';

/**
 * "My Reviews" — the reviewer queue.
 *
 * Lists every review where the current user is the assignee, bucketed by
 * decision state (Pending → Changes requested → Approved). Each row links
 * back to the main /app/review page with the review pre-selected via the
 * `?id=` query param, which ContractReviewView already honours.
 *
 * The endpoint is sorted server-side; we re-group on the client because
 * the buckets and counts are part of the UI and it's cheap.
 */
export function ReviewQueueView() {
  const { data, isLoading } = useMyReviews();
  const items = data?.items ?? [];

  const buckets = useMemo(() => groupByDecision(items), [items]);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 className="heading-xl" style={{ marginBottom: 4 }}>
            My Reviews
          </h1>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            CONTRACT REVIEWS ASSIGNED TO YOU
          </div>
        </div>
        <Link className="btn" to="/app/review">
          <Icon name="plus" size={14} /> New review
        </Link>
      </div>

      {isLoading && (
        <div className="card" style={{ padding: 24, color: 'var(--text-tertiary)' }}>
          Loading your queue…
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <div className="heading-md" style={{ marginBottom: 8 }}>
            Nothing assigned to you yet
          </div>
          <p className="body-md muted" style={{ marginBottom: 16 }}>
            When a colleague assigns you a contract review, it'll show up here. You can also pick
            up unassigned reviews from the main Review page.
          </p>
          <Link className="btn btn-primary" to="/app/review">
            Open Review
          </Link>
        </div>
      )}

      {!isLoading && items.length > 0 && (
        <>
          <Bucket
            label="Awaiting your decision"
            token="warning"
            items={buckets.pending}
            empty="Nothing awaiting decision."
          />
          <Bucket
            label="Changes requested"
            token="danger"
            items={buckets.changesRequested}
            empty="No pending change requests."
          />
          <Bucket
            label="Approved"
            token="success"
            items={buckets.approved}
            empty="Nothing approved yet."
          />
        </>
      )}
    </div>
  );
}

interface BucketsByDecision {
  pending: ContractReviewSummary[];
  changesRequested: ContractReviewSummary[];
  approved: ContractReviewSummary[];
}

function groupByDecision(items: ContractReviewSummary[]): BucketsByDecision {
  const out: BucketsByDecision = { pending: [], changesRequested: [], approved: [] };
  for (const r of items) {
    if (r.decision === 'approved') out.approved.push(r);
    else if (r.decision === 'changes_requested') out.changesRequested.push(r);
    else out.pending.push(r); // null and 'pending' both treated as "needs decision"
  }
  return out;
}

type StatusToken = 'success' | 'warning' | 'danger' | 'info';
const BADGE_BY_TOKEN: Record<StatusToken, string> = {
  success: 'badge-sage',
  warning: 'badge-amber',
  danger: 'badge-vermillion',
  info: 'badge-cobalt',
};

function Bucket({
  label,
  token,
  items,
  empty,
}: {
  label: string;
  token: StatusToken;
  items: ContractReviewSummary[];
  empty: string;
}) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <div className="heading-md">{label}</div>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div
          className="card"
          style={{ padding: 14, color: 'var(--text-tertiary)', fontSize: 13 }}
        >
          {empty}
        </div>
      ) : (
        items.map((r) => <QueueRow key={r.id} item={r} token={token} />)
      )}
    </div>
  );
}

function QueueRow({ item, token }: { item: ContractReviewSummary; token: StatusToken }) {
  const created = new Date(item.createdAt);
  const decided = item.decidedAt ? new Date(item.decidedAt) : null;
  return (
    <Link
      to={`/app/review?id=${encodeURIComponent(item.id)}`}
      className="card"
      style={{
        padding: 14,
        borderLeft: `3px solid var(--${token})`,
        display: 'grid',
        gridTemplateColumns: '1fr auto auto auto',
        gap: 12,
        alignItems: 'center',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>{item.title}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {item.perspective.toUpperCase()} · {created.toLocaleString()}
          {decided && ` · decided ${decided.toLocaleString()}`}
        </div>
      </div>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        {item.status === 'completed' ? `${item.riskScore ?? '—'}/100` : item.status.toUpperCase()}
      </span>
      <span className={`badge ${BADGE_BY_TOKEN[token]}`}>{decisionLabel(item.decision)}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
        {item.commentCount > 0 ? `${item.commentCount} 💬` : ''}
      </span>
    </Link>
  );
}

function decisionLabel(d: ReviewDecision | null): string {
  if (d === 'approved') return 'APPROVED';
  if (d === 'changes_requested') return 'CHANGES';
  if (d === 'pending') return 'IN REVIEW';
  return 'NEEDS DECISION';
}
