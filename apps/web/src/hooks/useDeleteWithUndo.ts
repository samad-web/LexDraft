import { useRef } from 'react';
import { useUIStore } from '@/store/ui';

/**
 * Deferred-delete pattern: the UI removes the item immediately (caller does
 * the optimistic update via setQueryData), a toast appears with an Undo
 * action, and the real API call doesn't fire until the toast expires.
 *
 * Undo: cancel the pending API call and call the caller's restore() to
 * put the item back. No network round-trip.
 *
 * Confirm path (no undo): after `windowMs`, fire the delete mutation. If
 * it errors, the caller's restore() is invoked so the cache rolls back.
 *
 * Keep this for routine reversible deletes (a lead, a task, a clause).
 * Use useConfirm for genuinely destructive actions (deleting a user,
 * dropping a client with active matters).
 */

export interface DeleteWithUndoOptions {
  /** Toast copy. Should name the thing deleted, e.g. 'Deleted "Acme Pvt"'. */
  toastText: string;
  /** Snapshot the cache before removing — invoked synchronously. */
  optimisticRemove: () => void;
  /** Put the item back in the cache exactly where it was. */
  restore: () => void;
  /** Fire the real DELETE call. Errors here trigger restore() + an error toast. */
  commit: () => Promise<unknown>;
  /** Optional toast on confirm-error. Default: "Couldn't delete". */
  errorText?: string;
  /** Override the undo window. Default 5000 ms. */
  windowMs?: number;
}

export function useDeleteWithUndo() {
  const showToast = useUIStore((s) => s.showToast);
  const hideToast = useUIStore((s) => s.hideToast);
  const pending = useRef<number | null>(null);

  return function deleteWithUndo(opts: DeleteWithUndoOptions): void {
    const windowMs = opts.windowMs ?? 5000;

    // Wipe any in-flight deletion before starting a new one. We don't
    // want two pending timers if the user smashes delete on three rows.
    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    }

    opts.optimisticRemove();

    let undone = false;

    const timer = window.setTimeout(() => {
      pending.current = null;
      if (undone) return;
      opts.commit().catch(() => {
        opts.restore();
        showToast({
          type: 'vermillion',
          text: opts.errorText ?? "Couldn't delete",
        });
      });
    }, windowMs);
    pending.current = timer;

    showToast({
      type: 'sage',
      text: opts.toastText,
      durationMs: windowMs,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          window.clearTimeout(timer);
          pending.current = null;
          opts.restore();
          hideToast();
        },
      },
    });
  };
}
