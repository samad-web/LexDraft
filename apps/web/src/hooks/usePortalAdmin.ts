import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FirmEnablePortalResponse, FirmPortalThreadSummary, PortalMessage,
} from '@lexdraft/types';
import { api } from '@/lib/api';

/**
 * Firm-side portal-admin hooks.
 *
 * These wrap the `/api/portal-admin/*` endpoints (CLIENT_PORTAL.md §7.1) and
 * are imported by the Clients, Documents, Case-detail, and Portal Inbox
 * views. Mutations invalidate the right query keys so toggle changes appear
 * in the table immediately without a hard refresh.
 */

export function useEnableClientPortal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) =>
      api.post<FirmEnablePortalResponse>(`/portal-admin/clients/${clientId}/enable`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useDisableClientPortal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) =>
      api.post<{ ok: true; revokedSessions: number }>(`/portal-admin/clients/${clientId}/disable`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useResendClientPortalLink() {
  return useMutation({
    mutationFn: (clientId: string) =>
      api.post<FirmEnablePortalResponse>(`/portal-admin/clients/${clientId}/resend-link`),
  });
}

export function useUpdateDocumentPortalFlags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      sharedWithClient?: boolean;
      requiresAcknowledgement?: boolean;
    }) => {
      const { id, ...patch } = vars;
      return api.patch<{ id: string; sharedWithClient: boolean; requiresAcknowledgement: boolean }>(
        `/portal-admin/documents/${id}/flags`, patch,
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}

export function useUpdateMatterVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; visibleToClient: boolean }) =>
      api.patch<{ id: string; visibleToClient: boolean }>(
        `/portal-admin/cases/${vars.id}/visibility`,
        { visibleToClient: vars.visibleToClient },
      ),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['cases'] });
      queryClient.invalidateQueries({ queryKey: ['case', vars.id] });
    },
  });
}

// ---- Firm-side messages inbox ---------------------------------------------

export function useFirmPortalInbox() {
  return useQuery({
    queryKey: ['portal-admin', 'inbox'],
    queryFn: () => api.get<{ items: FirmPortalThreadSummary[] }>('/portal-admin/messages'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useFirmPortalThread(args: { clientId: string | null; matterId: string | null }) {
  return useQuery({
    queryKey: ['portal-admin', 'thread', args.clientId, args.matterId ?? 'general'],
    queryFn: () => api.get<{ items: PortalMessage[] }>('/portal-admin/messages/thread', {
      clientId: args.clientId!,
      ...(args.matterId ? { matterId: args.matterId } : {}),
    }),
    enabled: !!args.clientId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useSendFirmPortalMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { clientId: string; matterId: string | null; body: string }) =>
      api.post<PortalMessage>('/portal-admin/messages', vars),
    onSuccess: (_msg, vars) => {
      queryClient.invalidateQueries({ queryKey: ['portal-admin', 'inbox'] });
      queryClient.invalidateQueries({
        queryKey: ['portal-admin', 'thread', vars.clientId, vars.matterId ?? 'general'],
      });
    },
  });
}

export function useMarkFirmPortalThreadRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { clientId: string; matterId: string | null }) => {
      const params = new URLSearchParams({ clientId: vars.clientId });
      if (vars.matterId) params.set('matterId', vars.matterId);
      return api.post<{ ok: true; marked: number }>(`/portal-admin/messages/read?${params.toString()}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal-admin', 'inbox'] }),
  });
}
