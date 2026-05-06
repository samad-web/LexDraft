import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Expense } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useExpenses() {
  return useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.get<{ items: Expense[] }>('/expenses'),
    select: (r) => r.items,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Expense, 'id'>) => api.post<Expense>('/expenses', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
}
