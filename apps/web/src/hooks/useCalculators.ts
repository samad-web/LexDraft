import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * TanStack Query wrappers for the /api/calculators endpoints.
 *
 * The response shapes are mirrored inline here rather than imported from
 * `@lexdraft/types` — the calculator DTOs are intentionally local to the api
 * package for now (see apps/api/src/types/calculators.types.ts), and the
 * orchestrator will lift them into the shared types package once contracts
 * stabilise. Keeping the duplication explicit here is cheaper than a
 * cross-package wire change.
 */

export type VakalatnamaCourtType = 'District Court' | 'High Court' | 'Supreme Court';

export interface CalculatorStateRef {
  stateCode: string;
  stateName: string;
  courtTypes: VakalatnamaCourtType[];
  instruments: string[];
}

export interface CourtFeeResult {
  fee: number;
  breakdown: string[];
  notes: string;
}

export interface StampDutyResult {
  duty: number;
  breakdown: string[];
  notes: string;
}

export interface VakalatnamaResult {
  text: string;
}

export interface VakalatnamaInput {
  stateCode: string;
  courtType: VakalatnamaCourtType;
  party: string;
  parent: string;
  age: number;
  address: string;
  advocate: string;
  barNo: string;
  court: string;
  city: string;
  respondent?: string;
}

export const calculatorKeys = {
  states: () => ['calculators', 'states'] as const,
  courtFee: (state: string | undefined, value: number | undefined) =>
    ['calculators', 'court-fee', state ?? '', value ?? 0] as const,
  stampDuty: (state: string | undefined, instrument: string | undefined, value: number | undefined) =>
    ['calculators', 'stamp-duty', state ?? '', instrument ?? '', value ?? 0] as const,
};

export function useCalculatorStates() {
  return useQuery({
    queryKey: calculatorKeys.states(),
    queryFn: () => api.get<{ items: CalculatorStateRef[] }>('/calculators/states'),
    select: (r) => r.items,
    // The catalogue is static-shaped and changes at deploy time; cache it
    // for the session so flipping between tabs doesn't refetch.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Court-fee lookup. Skips the network call entirely when either input is
 * missing/invalid so the form can render an empty result panel without
 * showing a spurious error.
 */
export function useCourtFee(params: { state?: string; value?: number }) {
  const enabled = Boolean(params.state) && Number.isFinite(params.value) && (params.value ?? -1) >= 0;
  return useQuery({
    queryKey: calculatorKeys.courtFee(params.state, params.value),
    queryFn: () =>
      api.get<CourtFeeResult>('/calculators/court-fee', {
        state: params.state,
        value: params.value,
      }),
    enabled,
  });
}

export function useStampDuty(params: { state?: string; instrument?: string; value?: number }) {
  const enabled =
    Boolean(params.state) &&
    Boolean(params.instrument) &&
    Number.isFinite(params.value) &&
    (params.value ?? -1) >= 0;
  return useQuery({
    queryKey: calculatorKeys.stampDuty(params.state, params.instrument, params.value),
    queryFn: () =>
      api.get<StampDutyResult>('/calculators/stamp-duty', {
        state: params.state,
        instrument: params.instrument,
        value: params.value,
      }),
    enabled,
  });
}

/** Vakalatnama is a POST because the body is too large for a query string and
 *  some address fields legitimately contain `&` / `?`. No caching — every
 *  generation is bespoke. */
export function useGenerateVakalatnama() {
  return useMutation({
    mutationFn: (input: VakalatnamaInput) =>
      api.post<VakalatnamaResult>('/calculators/vakalatnama', input),
  });
}
