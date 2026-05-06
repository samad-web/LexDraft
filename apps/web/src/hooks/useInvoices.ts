import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Invoice } from '@lexdraft/types';
import { api } from '@/lib/api';

export function useInvoices() {
  return useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get<{ items: Invoice[] }>('/invoices'),
    select: (r) => r.items,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Invoice, 'id'>) => api.post<Invoice>('/invoices', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
  });
}
