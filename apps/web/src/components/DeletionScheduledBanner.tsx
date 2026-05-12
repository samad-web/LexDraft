/**
 * Top-of-shell banner that surfaces a pending DPDP deletion request, with a
 * one-click Cancel.
 *
 * Limitation — the backend has no `GET /api/me/dpdp/deletion-status` endpoint
 * yet. State is read from the React Query cache that the request/cancel
 * mutations write to. In practice this means: the banner only shows in the
 * same browser session that *initiated* the deletion. Reload (or a different
 * device) and the banner is gone until the backend exposes a status read.
 *
 * The orchestrator should mount this at the top of the authenticated app
 * shell so it sits above primary navigation but below any global header.
 */

import { Icon } from '@lexdraft/ui';
// Using 'flag' for the warning indicator — the IconName union does not
// include an alert/warning glyph and 'flag' is what CalculatorsView uses for
// its advisory banner.
import { useCancelDeletion, useDeletionStatus } from '@/hooks/useDpdp';
import { useUIStore } from '@/store/ui';

function formatPurgeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function DeletionScheduledBanner() {
  const { data: status } = useDeletionStatus();
  const cancel = useCancelDeletion();
  const showToast = useUIStore((s) => s.showToast);

  if (!status) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        background: 'var(--danger-bg)',
        borderBottom: '1px solid var(--danger)',
        color: 'var(--text-primary)',
        flexWrap: 'wrap',
      }}
    >
      <Icon name="flag" size={16} />
      <span className="body-sm" style={{ flex: 1, minWidth: 200 }}>
        Your account is scheduled for deletion on{' '}
        <strong>{formatPurgeDate(status.scheduledPurgeAt)}</strong>. You can cancel
        until then.
      </span>
      <button
        type="button"
        className="btn"
        disabled={cancel.isPending}
        onClick={async () => {
          try {
            await cancel.mutateAsync();
            showToast({ type: 'sage', text: 'Deletion cancelled.' });
          } catch (err) {
            showToast({
              type: 'vermillion',
              text:
                err instanceof Error
                  ? err.message
                  : 'Could not cancel deletion. Try again.',
            });
          }
        }}
        style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
      >
        {cancel.isPending ? 'Cancelling…' : 'Cancel deletion'}
      </button>
    </div>
  );
}
