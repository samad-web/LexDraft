import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useLiveScreen, useLiveStep } from './vakalat';

// =============================================================================
// Portfolio menu except My Cases (useEfiling.ts has that): Search Cases and
// Planner are live screens of the advocate's portal page; Export / Import /
// Delete my cases are the portal's own requests
// (apps/api/src/services/efiling-portal-portfolio.service.ts).
// =============================================================================

export type PortfolioScreenView = 'search_cases' | 'planner';
export type CourtType = 'D' | 'H';

const path = (sessionId: string | null, view: PortfolioScreenView) => (sessionId ? `/efiling/live/session/${sessionId}/portfolio/${view}` : null);

export function usePortfolioScreen(sessionId: string | null, view: PortfolioScreenView) {
  return useLiveScreen(['portfolio', view], sessionId, path(sessionId, view));
}

export function usePortfolioStep(sessionId: string | null, view: PortfolioScreenView) {
  return useLiveStep(['portfolio', view], sessionId, path(sessionId, view));
}

export interface ExportResult { court: CourtType; fileName: string; content: string; count: number; message: string | null }
export interface ImportResult { inFile: number; added: number; messages: string[] }

/** Export Cases: the myCases.txt / hcMyCases.txt the portal's Download link holds. */
export function useExportMyCases(sessionId: string | null) {
  return useMutation({
    mutationFn: (court: CourtType) => api.post<ExportResult>(`/efiling/live/session/${sessionId}/portfolio/export`, { court }),
  });
}

/** Import Cases from a myCases.txt / hcMyCases.txt (adds them to My Cases on the portal). */
export function useImportMyCases(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { court: CourtType; fileName: string; content: string }) =>
      api.post<ImportResult>(`/efiling/live/session/${sessionId}/portfolio/import`, { ...v, confirmed: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId, 'my-cases'] }); },
  });
}

/** "Do you want to delete my cases ?" -> Delete. */
export function useDeleteMyCases(sessionId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string | null }>(`/efiling/live/session/${sessionId}/portfolio/delete`, { confirmed: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['efiling', 'live', sessionId, 'my-cases'] }); },
  });
}
