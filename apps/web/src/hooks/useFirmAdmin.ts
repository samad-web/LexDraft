import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditLogEntry,
  FirmCreateUserRequest,
  FirmCreateUserResponse,
  FirmManagedUser,
  FirmUpdateUserRequest,
  MeFeaturesResponse,
  PracticeGroup,
  Role,
} from '@lexdraft/types';
import { api } from '@/lib/api';

/** Resolved feature set for the current session (spec §9, §5). */
export function useMeFeatures() {
  return useQuery({
    queryKey: ['me', 'features'],
    queryFn: () => api.get<MeFeaturesResponse>('/me/features'),
    staleTime: 5 * 60_000,
  });
}

/** Convenience: returns true when the current session has the named feature. */
export function useCan(feature: string): boolean {
  const q = useMeFeatures();
  return Boolean(q.data?.features?.includes(feature));
}

export function useFirmUsers() {
  return useQuery({
    queryKey: ['firm', 'users'],
    queryFn: () => api.get<{ items: FirmManagedUser[] }>('/firm/users'),
    select: (r) => r.items,
  });
}

export function useFirmRoles() {
  return useQuery({
    queryKey: ['firm', 'roles'],
    queryFn: () => api.get<{ items: Role[] }>('/firm/roles'),
    select: (r) => r.items,
  });
}

export function useFirmPracticeGroups() {
  return useQuery({
    queryKey: ['firm', 'practice-groups'],
    queryFn: () => api.get<{ items: PracticeGroup[] }>('/firm/practice-groups'),
    select: (r) => r.items,
  });
}

export function useFirmAudit() {
  return useQuery({
    queryKey: ['firm', 'audit'],
    queryFn: () => api.get<{ items: AuditLogEntry[] }>('/firm/audit'),
    select: (r) => r.items,
  });
}

export function useUpdateFirmUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: FirmUpdateUserRequest }) =>
      api.patch<FirmManagedUser>(`/firm/users/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm', 'users'] });
      qc.invalidateQueries({ queryKey: ['firm', 'audit'] });
    },
  });
}

export function useCreateFirmUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FirmCreateUserRequest) =>
      api.post<FirmCreateUserResponse>('/firm/users', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['firm', 'users'] });
      qc.invalidateQueries({ queryKey: ['firm', 'audit'] });
    },
  });
}
