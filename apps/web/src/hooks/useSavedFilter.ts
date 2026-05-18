import { useEffect, useState } from 'react';

const STORAGE_PREFIX = 'lexdraft.filter.';

/**
 * useState-shaped hook that mirrors its value into localStorage so a
 * user's per-view filter survives a refresh. Keyed by a stable string
 * (`'cases.filter'`, `'invoices.filter'`, etc.) — pick something
 * descriptive enough that two views don't collide.
 *
 * Reads happen once on mount; writes happen on every change. The
 * `validate` callback is the only protection against a stored value
 * that no longer satisfies the type (e.g. you removed a filter id).
 * Return `null` from it to fall back to the initial.
 */
export function useSavedFilter<T>(
  key: string,
  initial: T,
  validate: (raw: unknown) => T | null,
): [T, (next: T) => void] {
  const fullKey = STORAGE_PREFIX + key;

  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(fullKey);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as unknown;
      const ok = validate(parsed);
      return ok ?? initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(value));
    } catch {
      // Quota or private-mode failure — silently swallow. Filter state
      // is convenience, not correctness; losing it is acceptable.
    }
  }, [fullKey, value]);

  return [value, setValue];
}
