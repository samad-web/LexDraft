import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SearchResults } from '@lexdraft/types';
import { api } from '@/lib/api';

/** Firm-wide Ctrl+K search, debounced so typing doesn't fire a request per key. */
export function useQuickSearch(q: string, delayMs = 200) {
  const [debounced, setDebounced] = useState(q.trim());
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), delayMs);
    return () => window.clearTimeout(t);
  }, [q, delayMs]);

  return useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResults>('/search', { q: debounced }),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
