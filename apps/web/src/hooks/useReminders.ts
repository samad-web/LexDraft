import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Reminders an advocate sets by hand (build-docs/features/reminders.md).

export interface Reminder {
  id: string;
  caseId: string | null;
  caseTitle: string | null;
  title: string;
  note: string;
  remindAt: string;
  sentAt: string | null;
}

export interface NewReminder {
  caseId?: string | null;
  title: string;
  note?: string;
  /** ISO instant. */
  remindAt: string;
}

/** A date (yyyy-mm-dd) and time (HH:mm) picked on this device, as an ISO
 *  instant, so the server never has to guess the advocate's time zone. */
export function toRemindAt(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function useReminders(caseId?: string) {
  return useQuery({
    queryKey: ['reminders', caseId ?? 'all'],
    queryFn: () => api.get<{ items: Reminder[] }>(`/reminders${caseId ? `?caseId=${caseId}` : ''}`).then((r) => r.items),
  });
}

export function useCreateReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewReminder) => api.post<Reminder>('/reminders', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}

export function useDeleteReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/reminders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
}
