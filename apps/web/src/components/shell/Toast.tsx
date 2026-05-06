import { useEffect } from 'react';
import { useUIStore } from '@/store/ui';

export function Toast() {
  const toast = useUIStore((s) => s.toast);
  const hideToast = useUIStore((s) => s.hideToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(hideToast, 4000);
    return () => clearTimeout(t);
  }, [toast, hideToast]);

  if (!toast) return null;
  return <div className={`toast ${toast.type}`} role="status">{toast.text}</div>;
}
