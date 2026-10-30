import { Icon, EmptyState } from '@lexdraft/ui';
import { useDeletedCases, useRestoreCase } from '@/hooks/useCases';
import { useUIStore } from '@/store/ui';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

const RETENTION_DAYS = 30;

/** Days left before a soft-deleted matter is permanently purged. */
function daysLeft(deletedAtIso: string): number {
  const deleted = new Date(deletedAtIso).getTime();
  const elapsedDays = (Date.now() - deleted) / 86_400_000;
  return Math.max(0, Math.ceil(RETENTION_DAYS - elapsedDays));
}

/**
 * Recently-deleted matters: everything soft-deleted within the 30-day window,
 * each restorable. After 30 days a matter is permanently purged (server-side)
 * and no longer appears here.
 */
export function RecentlyDeletedCasesModal({ open, onClose }: Props) {
  const { data: deleted = [], isLoading } = useDeletedCases();
  const restore = useRestoreCase();
  const showToast = useUIStore((s) => s.showToast);

  const onRestore = (id: string, title: string) => {
    restore.mutate(id, {
      onSuccess: () => showToast({ type: 'sage', text: `Restored "${title}"` }),
      onError: () => showToast({ type: 'vermillion', text: 'Could not restore' }),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Trash"
      title="Recently deleted matters"
      description="Deleted matters are recoverable for 30 days, then permanently removed."
      footer={<button type="button" className="btn" onClick={onClose}>Done</button>}
    >
      {isLoading && <p className="cs-muted" style={{ padding: 16 }}>Loading…</p>}
      {!isLoading && deleted.length === 0 && (
        <EmptyState
          variant="inline"
          title="Nothing in the trash"
          description="Matters you delete appear here for 30 days so you can restore them."
        />
      )}
      <div className="cs-trash">
        {deleted.map((c) => {
          const left = daysLeft(c.deletedAt);
          return (
            <div key={c.id} className="cs-trash-row">
              <div className="cs-trash-main">
                <div className="cs-trash-title">{c.title}</div>
                <div className="cs-trash-meta">
                  <span className="cs-code">{c.cnr}</span> · {c.court || 'court not set'} · {c.client}
                </div>
              </div>
              <span className="cs-trash-left" title="Days until permanent deletion">
                <span className="cs-figure" style={left <= 5 ? { textDecoration: 'underline', textUnderlineOffset: 3 } : undefined}>{left}</span>
                <small>{left === 1 ? 'day left' : 'days left'}</small>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={restore.isPending}
                onClick={() => onRestore(c.id, c.title)}
              >
                <Icon name="check" size={12} /> Restore
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
