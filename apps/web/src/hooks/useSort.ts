import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K | null;
  direction: SortDirection;
}

export interface UseSortResult<T, K extends string> {
  state: SortState<K>;
  /** Toggle sort: same key flips direction, new key starts asc. */
  toggle: (key: K) => void;
  /** Returns 'asc' | 'desc' | undefined for the given key — bind to data-sort. */
  ariaSort: (key: K) => SortDirection | undefined;
  /** Items sorted client-side per the current state. */
  sorted: T[];
}

/**
 * Client-side column sort for in-memory tables. The selector returns a
 * comparable value per row (string | number | Date); strings collate
 * via localeCompare, numbers/dates compare numerically. Stable: a row's
 * relative order to peers with the same key is preserved.
 *
 * Caller is responsible for picking sensible defaults — null means
 * "respect insertion order".
 */
export function useSort<T, K extends string>(
  items: readonly T[],
  selectors: Record<K, (row: T) => string | number | Date | null | undefined>,
  initial?: SortState<K>,
): UseSortResult<T, K> {
  const [state, setState] = useState<SortState<K>>(initial ?? { key: null, direction: 'asc' });

  const toggle = (key: K) => {
    setState((prev) => {
      if (prev.key !== key) return { key, direction: 'asc' };
      if (prev.direction === 'asc') return { key, direction: 'desc' };
      // Third click clears the sort and falls back to insertion order.
      return { key: null, direction: 'asc' };
    });
  };

  const ariaSort = (key: K): SortDirection | undefined => (state.key === key ? state.direction : undefined);

  const sorted = useMemo(() => {
    if (!state.key) return [...items];
    const get = selectors[state.key];
    const arr = items.map((row, i) => ({ row, i, val: get(row) }));
    const mul = state.direction === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = a.val;
      const bv = b.val;
      // null/undefined sort to the end regardless of direction.
      if (av == null && bv == null) return a.i - b.i;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return mul * av.localeCompare(bv);
      if (av instanceof Date && bv instanceof Date) return mul * (av.getTime() - bv.getTime());
      const an = Number(av);
      const bn = Number(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return mul * (an - bn);
      return mul * String(av).localeCompare(String(bv));
    });
    return arr.map((x) => x.row);
  }, [items, state.key, state.direction, selectors]);

  return { state, toggle, ariaSort, sorted };
}
