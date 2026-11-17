import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LandAccess } from '@lexdraft/types';
import { api } from '@/lib/api';

const KEY = ['land-records', 'access'] as const;

/** Who may use Land Records: TN advocates, superadmin switch (land-records-tn-gate). */
export function useLandAccess(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<LandAccess>('/land-records/access'), enabled, staleTime: 5 * 60_000 });
}

/** Save the advocate's state (asked once on the Land Records screen). */
export function useSaveLandState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (state: string) => api.put<LandAccess>('/land-records/state', { state }),
    onSuccess: (a) => qc.setQueryData(KEY, a),
  });
}
