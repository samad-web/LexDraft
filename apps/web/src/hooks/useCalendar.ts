import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarHearing, CalendarWeek } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useCalendarWeek(start?: string) {
  return useQuery({
    queryKey: ['calendar', 'week', start ?? 'current'],
    queryFn: () => api.get<CalendarWeek>('/hearings/week', start ? { start } : undefined),
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
