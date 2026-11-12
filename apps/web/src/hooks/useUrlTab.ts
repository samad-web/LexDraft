import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The tab a URL value names, or the default when it names none we know. */
export function tabFromParam<T extends string>(raw: string | null, tabs: readonly T[], fallback: T): T {
  return raw !== null && (tabs as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * A page's active tab, kept in the URL (`?tab=`) as its own history entry, so
 * the Back button returns to the previous tab instead of leaving the page,
 * and refreshes and shared links land on the same tab. The default tab is
 * left out of the URL. Other query params are kept.
 */
export function useUrlTab<T extends string>(
  tabs: readonly T[],
  fallback: T,
  key = 'tab',
): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const tab = tabFromParam(params.get(key), tabs, fallback);

  const setTab = useCallback(
    (next: T) => {
      if (next === tab) return;
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (next === fallback) p.delete(key);
        else p.set(key, next);
        return p;
      });
    },
    [tab, fallback, key, setParams],
  );

  return [tab, setTab];
}
