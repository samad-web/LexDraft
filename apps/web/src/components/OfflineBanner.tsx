import { useEffect, useState } from 'react';
import { Icon } from '@lexdraft/ui';

/**
 * Sticky banner that surfaces when the browser reports an offline state.
 * Uses the `online`/`offline` window events. Note that `navigator.onLine`
 * is a soft signal — it can be true while the API is unreachable, and
 * false in some VPN edge cases. Treat the banner as a hint, not a
 * guarantee. Real failures still bubble through API error states.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener('online', onUp);
    window.addEventListener('offline', onDown);
    return () => {
      window.removeEventListener('online', onUp);
      window.removeEventListener('offline', onDown);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        background: 'var(--warning)',
        color: '#0A0A0A',
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
      }}
    >
      <Icon name="globe" size={14} />
      <span>You&rsquo;re offline. Some actions may not save until your connection returns.</span>
    </div>
  );
}
