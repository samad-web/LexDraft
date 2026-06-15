import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query and returns whether it currently matches,
 * staying accurate as the viewport changes. Mirrors useReducedMotion's
 * lifecycle, including the deprecated Safari addListener fallback.
 *
 * Use this when a layout decision has to happen at the React level — e.g.
 * rendering a different *component* per breakpoint — which a CSS-only
 * `@media` rule can't express.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Resync on mount in case the query changed between render and effect.
    setMatches(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [query]);

  return matches;
}
