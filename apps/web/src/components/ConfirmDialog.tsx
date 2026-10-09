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
  /** When set, renders a text input in the dialog body (replaces window.prompt).
   *  The resolved value carries the trimmed input text; cancel still resolves "". */
  inputLabel?: string;
  inputPlaceholder?: string;
  inputDefaultValue?: string;
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
/** Like ConfirmFn, but for dialogs with `inputLabel` set - resolves the typed
 *  (trimmed) value alongside whether the user confirmed. */
type ConfirmWithInputFn = (options: ConfirmOptions) => Promise<{ confirmed: boolean; value: string }>;
type AlertFn   = (options: AlertOptions) => Promise<void>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);
const ConfirmWithInputCtx = createContext<ConfirmWithInputFn | null>(null);
const AlertCtx   = createContext<AlertFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: { confirmed: boolean; value: string }) => void;
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
  const [inputValue, setInputValue] = useState('');
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const alertBtnRef   = useRef<HTMLButtonElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);

  // Focus the primary button on open so Enter resolves the dialog. When the
  // dialog has a text input, focus that instead so typing can start at once.
  useEffect(() => {
    if (pendingConfirm) {
      setInputValue(pendingConfirm.inputDefaultValue ?? '');
      const t = window.setTimeout(() => {
        (pendingConfirm.inputLabel ? inputRef.current : confirmBtnRef.current)?.focus();
      }, 50);
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

  const confirmWithInput = useCallback<ConfirmWithInputFn>((options) => {
    return new Promise((resolve) => {
      setPendingConfirm({ ...options, resolve });
    });
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return confirmWithInput(options).then((r) => r.confirmed);
  }, [confirmWithInput]);

  const alertFn = useCallback<AlertFn>((options) => {
    return new Promise<void>((resolve) => {
      setPendingAlert({ ...options, resolve });
    });
  }, []);

  const closeConfirm = (confirmed: boolean) => {
    if (!pendingConfirm) return;
    pendingConfirm.resolve({ confirmed, value: inputValue.trim() });
    setPendingConfirm(null);
  };

  const closeAlert = () => {
    if (!pendingAlert) return;
    pendingAlert.resolve();
    setPendingAlert(null);
  };

  const alertBtnClass = (() => {
    if (!pendingAlert) return 'btn';
    if (pendingAlert.tone === 'danger')  return 'btn btn-danger';
    if (pendingAlert.tone === 'success') return 'btn btn-success';
    return 'btn btn-primary';
  })();

  return (
    <ConfirmCtx.Provider value={confirm}>
      <ConfirmWithInputCtx.Provider value={confirmWithInput}>
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
                    className={pendingConfirm.danger ? 'btn btn-danger' : 'btn btn-primary'}
                    onClick={() => closeConfirm(true)}
                  >
                    {pendingConfirm.confirmLabel ?? 'Confirm'}
                  </button>
                </>
              )
            }
          >
            {pendingConfirm?.inputLabel ? (
              <label className="col" style={{ gap: 6, fontSize: 13 }}>
                <span className="body-sm muted">{pendingConfirm.inputLabel}</span>
                <input
                  ref={inputRef}
                  type="text"
                  className="input"
                  value={inputValue}
                  placeholder={pendingConfirm.inputPlaceholder}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') closeConfirm(true); }}
                />
              </label>
            ) : (
              // Modal already renders title + description; nothing more to add.
              <></>
            )}
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
                  className={alertBtnClass}
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
      </ConfirmWithInputCtx.Provider>
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

/** Like `useConfirm`, but for dialogs built with `inputLabel` set — resolves
 *  `{ confirmed, value }` so the caller gets the typed text alongside whether
 *  the user confirmed. Replaces `window.prompt()`. Throws if used outside
 *  ConfirmProvider. */
export function useConfirmWithInput(): ConfirmWithInputFn {
  const ctx = useContext(ConfirmWithInputCtx);
  if (!ctx) throw new Error('useConfirmWithInput must be used inside ConfirmProvider');
  return ctx;
}
