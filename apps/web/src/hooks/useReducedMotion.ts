import { useEffect, useState } from 'react';

/**
 * Returns true when the user has the OS-level "reduce motion" setting on.
 * Subscribes to the media query so it stays accurate if the user toggles
 * it while the app is open (rare, but free to support).
 *
 * Components using inline-style transitions should multiply their
 * duration by `prefersReduced ? 0 : 1`, or skip transitions entirely.
 * Components driven by CSS classes can rely on the `@media (prefers-
 * reduced-motion: reduce)` blocks in globals.css instead.
 */
export function useReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setPrefers(e.matches);
    // Older Safari only supports the deprecated addListener API.
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return prefers;
}
