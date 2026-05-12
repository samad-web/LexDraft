import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Local mirror of the api's `CaseloadHealthSummary` shape. We don't import
 * from `@lexdraft/types` because the surface is still maturing — the
 * service-side types live in `apps/api/src/types/caseload-health.types.ts`
 * and will be promoted to the shared package once thresholds stabilise.
 */
export type CaseloadHealthBand = 'healthy' | 'stretched' | 'overloaded';

export interface CaseloadHealthSignal {
  key:
    | 'open_matters'
    | 'imminent_limitations'
    | 'unscheduled_hearings'
    | 'invoice_overdue'
    | 'tasks_overdue';
  severity: 'info' | 'warning' | 'critical';
  label: string;
  value: number;
  threshold: number;
  message: string;
}

export interface CaseloadHealthSummary {
  score: number;
  band: CaseloadHealthBand;
  signals: CaseloadHealthSignal[];
  recommendations: string[];
}

export function useCaseloadHealth() {
  return useQuery({
    queryKey: ['caseload-health'],
    queryFn: () => api.get<CaseloadHealthSummary>('/caseload-health'),
    // Health signals shift on minute-scale (overdue counts roll over at
    // midnight; manual mutations elsewhere may invalidate). 60s is a
    // sensible balance between freshness and request volume.
    staleTime: 60_000,
    // The widget is non-critical — never block the dashboard on a 403/500.
    retry: false,
  });
}
