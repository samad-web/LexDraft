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

export interface AlertOptions {
  title: string;
  message?: string;
  /** Label for the dismiss button. Defaults to "OK". */
  okLabel?: string;
  /** Visual tone for the dialog header — defaults to neutral. */
  tone?: 'neutral' | 'danger' | 'success';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
type AlertFn   = (options: AlertOptions) => Promise<void>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);
const AlertCtx   = createContext<AlertFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface PendingAlert extends AlertOptions {
  resolve: () => void;
}

/** Wrap the app once. Provides `useConfirm()` and `useAlert()` to descendants.
 *  Renders via the shared <Modal>, so spacing/typography/borders match every
 *  other dialog. Replaces every `window.confirm()` / `window.alert()` call in
 *  the app — the native browser dialogs are blocking and styled by the OS,
 *  which clashes with the rest of the UI. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingAlert,   setPendingAlert]   = useState<PendingAlert | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const alertBtnRef   = useRef<HTMLButtonElement>(null);

  // Focus the primary button on open so Enter resolves the dialog.
  useEffect(() => {
    if (pendingConfirm) {
      const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [pendingConfirm]);

  useEffect(() => {
    if (pendingAlert) {
      const t = window.setTimeout(() => alertBtnRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [pendingAlert]);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPendingConfirm({ ...options, resolve });
    });
  }, []);

  const alertFn = useCallback<AlertFn>((options) => {
    return new Promise<void>((resolve) => {
      setPendingAlert({ ...options, resolve });
    });
  }, []);

  const closeConfirm = (value: boolean) => {
    if (!pendingConfirm) return;
    pendingConfirm.resolve(value);
    setPendingConfirm(null);
  };

  const closeAlert = () => {
    if (!pendingAlert) return;
    pendingAlert.resolve();
    setPendingAlert(null);
  };

  const alertAccent = (() => {
    if (!pendingAlert) return undefined;
    if (pendingAlert.tone === 'danger')  return { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' };
    if (pendingAlert.tone === 'success') return { background: 'var(--success)', borderColor: 'var(--success)', color: '#fff' };
    return { background: 'var(--text-primary)', borderColor: 'var(--text-primary)', color: 'var(--bg-base)' };
  })();

  return (
    <ConfirmCtx.Provider value={confirm}>
      <AlertCtx.Provider value={alertFn}>
        {children}
        <Modal
          open={!!pendingConfirm}
          onClose={() => closeConfirm(false)}
          title={pendingConfirm?.title ?? ''}
          description={pendingConfirm?.message}
          width={440}
          footer={
            pendingConfirm && (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => closeConfirm(false)}
                >
                  {pendingConfirm.cancelLabel ?? 'Cancel'}
                </button>
                <button
                  ref={confirmBtnRef}
                  type="button"
                  className="btn"
                  style={
                    pendingConfirm.danger
                      ? { borderColor: 'var(--danger)', color: 'var(--danger)' }
                      : { background: 'var(--text-primary)', borderColor: 'var(--text-primary)', color: 'var(--bg-base)' }
                  }
                  onClick={() => closeConfirm(true)}
                >
                  {pendingConfirm.confirmLabel ?? 'Confirm'}
                </button>
              </>
            )
          }
        >
          {/* Modal already renders title + description; nothing more to add. */}
          <></>
        </Modal>

        <Modal
          open={!!pendingAlert}
          onClose={closeAlert}
          title={pendingAlert?.title ?? ''}
          description={pendingAlert?.message}
          width={440}
          footer={
            pendingAlert && (
              <button
                ref={alertBtnRef}
                type="button"
                className="btn"
                style={alertAccent}
                onClick={closeAlert}
              >
                {pendingAlert.okLabel ?? 'OK'}
              </button>
            )
          }
        >
          <></>
        </Modal>
      </AlertCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

/** Returns `(options) => Promise<boolean>` - resolves true on confirm, false
 *  on cancel/escape/backdrop click. Throws if used outside ConfirmProvider. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}

/** Returns `(options) => Promise<void>` — resolves when the user dismisses the
 *  alert. Throws if used outside ConfirmProvider. */
export function useAlert(): AlertFn {
  const ctx = useContext(AlertCtx);
  if (!ctx) throw new Error('useAlert must be used inside ConfirmProvider');
  return ctx;
}
