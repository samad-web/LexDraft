import { useEffect } from 'react';
import { useUIStore } from '@/store/ui';

const DEFAULT_DURATION_MS = 4000;

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  const hideToast = useUIStore((s) => s.hideToast);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.durationMs ?? DEFAULT_DURATION_MS;
    const t = setTimeout(hideToast, ms);
    return () => clearTimeout(t);
  }, [toast, hideToast]);

  if (!toast) return null;
  return (
    <div className={`toast ${toast.type}`} role="status">
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.onClick();
            hideToast();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
