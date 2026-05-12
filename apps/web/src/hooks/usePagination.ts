import { useEffect, useMemo, useState } from 'react';

export interface PaginationResult<T> {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  /** The slice of `items` for the current page. */
  slice: T[];
  setPage: (n: number) => void;
  /** True when there's nothing to paginate (len <= pageSize). */
  isSinglePage: boolean;
}

/**
 * Client-side pagination over an in-memory list. Pure function of the input
 * array — when callers re-filter the dataset (e.g. typing in a search box)
 * we snap the cursor back to page 1 so the table doesn't go blank.
 *
 * The default page size of 10 matches the application-wide convention. Pass
 * a different size when a view legitimately needs more density.
 */
export function usePagination<T>(items: readonly T[], pageSize = 10): PaginationResult<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [page, setPageRaw] = useState(1);

  // If the dataset shrinks (e.g. a filter removes rows) and the current
  // page no longer exists, slide the cursor down. Without this you get
  // empty tables until the user manually clicks Page 1.
  useEffect(() => {
    if (page > totalPages) setPageRaw(totalPages);
  }, [page, totalPages]);

  const slice = useMemo(() => {
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, totalPages, pageSize]);

  function setPage(n: number): void {
    setPageRaw(Math.min(Math.max(1, n), totalPages));
  }

  return {
    page: Math.min(Math.max(1, page), totalPages),
    totalPages,
    pageSize,
    total,
    slice: slice as T[],
    setPage,
    isSinglePage: total <= pageSize,
  };
}
