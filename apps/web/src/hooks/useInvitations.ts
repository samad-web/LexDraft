import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptInvitationRequest,
  AuthResponse,
  CreateInvitationRequest,
  Invitation,
  InvitationPublic,
} from '@lexdraft/types';
import { api } from '@/lib/api';

export function useInvitations() {
  return useQuery({
    queryKey: ['invitations'],
    queryFn: () => api.get<{ items: Invitation[] }>('/invitations'),
    select: (r) => r.items,
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInvitationRequest) => api.post<Invitation>('/invitations', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

export function useCancelInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

export function useResendInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Invitation>(`/invitations/${id}/resend`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations'] }),
  });
}

/** Public — used on the /invite/:token page to fetch the invitation summary. */
export function useInvitationByToken(token: string | undefined) {
  return useQuery({
    queryKey: ['invitations', 'by-token', token],
    queryFn: () => api.get<InvitationPublic>(`/invitations/by-token/${token}`),
    enabled: !!token,
    retry: false,
  });
}

/** Public — accept the invitation, creates the account, returns a session. */
export function useAcceptInvitation() {
  return useMutation({
    mutationFn: ({ token, body }: { token: string; body: AcceptInvitationRequest }) =>
      api.post<AuthResponse>(`/invitations/by-token/${token}/accept`, body),
  });
}
