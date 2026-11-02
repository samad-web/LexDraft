import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FilingStatus } from '@/hooks/useEfiling';

// =============================================================================
// eFiling portal -> DifAi (apps/api/src/services/efiling-portal-sync.service.ts):
// what the advocate has on filing.ecourts.gov.in, saved into their matters.
// The server runs it after the portal login and every 10 minutes while the
// dashboard is in use; "Sync now" runs it at once. Read-only on the portal.
// =============================================================================

export interface PortalSyncItem {
  efilingNo: string;
  title: string;
  establishment: string | null;
  caseNo: string | null;
  cnr: string | null;
  /** Where it is on the portal: "Completed Pleadings · Court verified". */
  portal: string;
  caseId: string | null;
  caseTitle: string | null;
  filingId: string | null;
  status: FilingStatus | null;
  lastChange: string | null;
  lastChangeAt: string | null;
  changes: string[];
  candidates?: Array<{ caseId: string; title: string; cnr: string | null }>;
}

export interface PortalSyncSummary {
  linked: number;
  updated: number;
  created: number;
  unlinked: PortalSyncItem[];
  items: PortalSyncItem[];
  errors: string[];
  at: string;
}

const key = (sessionId: string | null) => ['efiling', 'live', sessionId, 'sync'] as const;

/** The last sync of this advocate's portal (null before the first one finishes). */
export function usePortalSync(sessionId: string | null) {
  return useQuery({
    queryKey: key(sessionId),
    queryFn: () => api.get<{ summary: PortalSyncSummary | null; running: boolean }>(`/efiling/live/session/${sessionId}/sync`),
    enabled: !!sessionId,
    // While one runs (the login starts it) look again soon; otherwise now and then.
    refetchInterval: (q) => (q.state.data?.running || !q.state.data?.summary ? 5_000 : 60_000),
    retry: false,
  });
}

/** Everything a sync can change: filings (and the case pages showing them) and documents. */
function useAfterSync(sessionId: string | null) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: key(sessionId) });
    void qc.invalidateQueries({ queryKey: ['efiling', 'filings'] });
    void qc.invalidateQueries({ queryKey: ['efiling', 'filing'] });
    void qc.invalidateQueries({ queryKey: ['cases'] });
    void qc.invalidateQueries({ queryKey: ['documents'] });
  };
}

export function useRunPortalSync(sessionId: string | null) {
  const after = useAfterSync(sessionId);
  return useMutation({
    mutationFn: () => api.post<PortalSyncSummary>(`/efiling/live/session/${sessionId}/sync`, {}),
    onSettled: after,
  });
}

/** Connect a portal filing DifAi couldn't place: to a matter, or to a new matter made from the portal. */
export function useLinkPortalFiling(sessionId: string | null) {
  const after = useAfterSync(sessionId);
  return useMutation({
    mutationFn: (v: { portalEfilingNo: string } & ({ caseId: string } | { createCase: true })) =>
      api.post<PortalSyncItem>(`/efiling/live/session/${sessionId}/sync/link`, v),
    onSuccess: after,
  });
}

/** "Synced to DifAi 10:42 · 2 linked · 1 to link" for the advocate's name menu. */
export function syncMenuLabel(data: { summary: PortalSyncSummary | null; running: boolean } | undefined): string {
  if (data?.running) return 'Syncing to DifAi…';
  const s = data?.summary;
  if (!s) return 'Sync to DifAi';
  const at = new Date(s.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return [`Synced to DifAi ${at}`, `${s.linked} linked`, s.unlinked.length ? `${s.unlinked.length} to link` : null].filter(Boolean).join(' · ');
}
