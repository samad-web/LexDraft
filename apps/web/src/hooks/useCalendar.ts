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
