import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { Modal } from './Modal';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Style the confirm button as a destructive action (outlined red). */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/** Wrap the app once. Provides `useConfirm()` to descendants. Renders via the
 *  shared <Modal>, so spacing/typography/borders match every other dialog. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button on open so Enter resolves true.
  useEffect(() => {
    if (pending) {
      const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [pending]);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const handleClose = (value: boolean) => {
    if (!pending) return;
    pending.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => handleClose(false)}
        title={pending?.title ?? ''}
        description={pending?.message}
        width={440}
        footer={
          pending && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => handleClose(false)}
              >
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className="btn"
                style={
                  pending.danger
                    ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
                    : { background: 'var(--text-primary)', borderColor: 'var(--text-primary)', color: 'var(--bg-base)' }
                }
                onClick={() => handleClose(true)}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </>
          )
        }
      >
        {/* Modal already renders title + description; nothing more to add. */}
        <></>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

/** Returns `(options) => Promise<boolean>` — resolves true on confirm, false
 *  on cancel/escape/backdrop click. Throws if used outside ConfirmProvider. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
