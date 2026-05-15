import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * TanStack Query wrappers for the internal error tracker. Mirrors the
 * shape of `apps/web/src/admin/queries.ts` - small, view-local file because
 * the orchestrator owns the central queries module and a self-contained
 * hooks file keeps this feature's diff minimal.
 */

// ---------- shared types (kept local - no shared @lexdraft/types entries) ---

export interface ErrorLogListItem {
  id: string;
  occurredAt: string;
  requestId: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  firmId: string | null;
  firmName: string | null;
  method: string;
  path: string;
  status: number;
  errorName: string;
  errorMessage: string;
  userAgent: string | null;
  ip: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface ErrorLogDetail extends ErrorLogListItem {
  errorStack: string | null;
  context: unknown;
}

export interface ErrorLogListResponse {
  items: ErrorLogListItem[];
  total: number;
}

export interface ErrorLogStats {
  totalCount: number;
  unresolvedCount: number;
  byStatus: Record<string, number>;
  byPath: Array<{ path: string; count: number }>;
  byErrorName: Array<{ name: string; count: number }>;
}

export interface ErrorLogQuery {
  since?: string;
  until?: string;
  status?: number;
  userId?: string;
  firmId?: string;
  /** 'true' / 'false' / 'all'. Maps to the API's `resolved` enum. */
  resolved?: 'true' | 'false' | 'all';
  limit?: number;
  offset?: number;
}

// ---------- query keys ------------------------------------------------------

export const errorLogKeys = {
  all:    ['admin', 'errors'] as const,
  list:   (q: ErrorLogQuery) => ['admin', 'errors', 'list', q] as const,
  detail: (id: string)       => ['admin', 'errors', 'detail', id] as const,
  stats:  (range: { since?: string; until?: string }) => ['admin', 'errors', 'stats', range] as const,
};

// ---------- API client ------------------------------------------------------

const errorLogApi = {
  list: (q: ErrorLogQuery) =>
    api.get<ErrorLogListResponse>('/admin/errors', q as Record<string, unknown>),
  get: (id: string) => api.get<ErrorLogDetail>(`/admin/errors/${id}`),
  stats: (range: { since?: string; until?: string }) =>
    api.get<ErrorLogStats>('/admin/errors/stats', range as Record<string, unknown>),
  resolve: (id: string, note?: string) =>
    api.post<void>(`/admin/errors/${id}/resolve`, { note }),
  unresolve: (id: string) =>
    api.post<void>(`/admin/errors/${id}/unresolve`),
};

// ---------- hooks -----------------------------------------------------------

export const useErrorLogList = (query: ErrorLogQuery = {}) =>
  useQuery({
    queryKey: errorLogKeys.list(query),
    queryFn: () => errorLogApi.list(query),
    // The error feed is live data - refetch on mount so an operator who
    // navigates away and back doesn't stare at a stale list, but don't
    // poll: there's no expectation of sub-minute latency here.
    refetchOnMount: 'always',
  });

export const useErrorLogDetail = (id: string | undefined) =>
  useQuery({
    queryKey: errorLogKeys.detail(id ?? ''),
    queryFn: () => errorLogApi.get(id!),
    enabled: !!id,
  });

export const useErrorLogStats = (range: { since?: string; until?: string } = {}) =>
  useQuery({
    queryKey: errorLogKeys.stats(range),
    queryFn: () => errorLogApi.stats(range),
  });

export function useResolveError() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => errorLogApi.resolve(id, note),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: errorLogKeys.all });
      qc.invalidateQueries({ queryKey: errorLogKeys.detail(vars.id) });
    },
  });
}

export function useUnresolveError() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => errorLogApi.unresolve(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: errorLogKeys.all });
      qc.invalidateQueries({ queryKey: errorLogKeys.detail(id) });
    },
  });
}
