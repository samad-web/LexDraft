import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarHearing, CalendarMonth, CalendarWeek } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useCalendarWeek(start?: string) {
  return useQuery({
    queryKey: ['calendar', 'week', start ?? 'current'],
    queryFn: () => api.get<CalendarWeek>('/hearings/week', start ? { start } : undefined),
  });
}

export function useCalendarMonth(year: number, month: number, enabled = true) {
  return useQuery({
    queryKey: ['calendar', 'month', year, month],
    queryFn: () => api.get<CalendarMonth>('/hearings/month', { year, month }),
    enabled,
  });
}

/** Hearings between two days (YYYY-MM-DD, inclusive) - the Cause List. */
export function useHearingsRange(from: string, to: string) {
  return useQuery({
    queryKey: ['calendar', 'range', from, to],
    queryFn: () => api.get<{ items: CalendarHearing[] }>('/hearings/range', { from, to }),
    select: (r) => r.items,
  });
}

/** "Sync from eCourts": refresh the firm's matters (hearings, next dates,
 *  orders) in the background. */
export function useSyncFirmFromEcourts() {
  return useMutation({
    mutationFn: () => api.post<{ queued: number; total: number; closed?: number }>('/ecourts/sync/firm'),
  });
}

export function useCalendarDay(iso: string | undefined) {
  return useQuery({
    queryKey: ['calendar', 'day', iso],
    queryFn: () => api.get<{ items: CalendarHearing[] }>(`/hearings/day/${iso}`),
    enabled: !!iso,
    select: (r) => r.items,
  });
}

export interface CreateHearingInput {
  case: string;
  time: string;
  court: string;
  purpose: string;
  status: 'today' | 'upcoming' | 'past';
  date?: string;
  judge?: string;
  /** Pins the hearing to this exact case row instead of letting the server
   *  fall back to a title-match lookup (which picks the newest case among
   *  same-titled matters — see hearings.service.ts ensureCaseId). */
  caseId?: string;
}

export function useCreateHearing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateHearingInput) => api.post<CalendarHearing>('/hearings', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['hearings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export interface UpdateHearingInput extends CreateHearingInput {
  id: string;
}

export function useUpdateHearing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateHearingInput) =>
      api.patch<CalendarHearing>(`/hearings/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['hearings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteHearing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/hearings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['hearings'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
