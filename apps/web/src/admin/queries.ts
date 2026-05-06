import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi } from './api';
import type {
  AdminCreateFirmRequest,
  AdminCreateTemplateRequest,
  AdminUpdateBrandingRequest,
  AdminUpdateFirmRequest,
  AdminUpdateFlagsRequest,
  AdminUpdatePlanRequest,
  AdminUpdateTemplateRequest,
  AdminUpdateUserRequest,
  AuditLogQuery,
  TemplateScope,
  UserStatus,
} from '@lexdraft/types';

export const adminKeys = {
  stats: ['admin', 'stats'] as const,
  firms: ['admin', 'firms'] as const,
  firm: (id: string) => ['admin', 'firm', id] as const,
  users: (q: object) => ['admin', 'users', q] as const,
  audit: (q: object) => ['admin', 'audit', q] as const,
  templates: (scope?: TemplateScope, firmId?: string) => ['admin', 'templates', scope, firmId] as const,
};

// ---- queries ---------------------------------------------------------------

export const usePlatformStats = () =>
  useQuery({ queryKey: adminKeys.stats, queryFn: adminApi.stats });

export const useFirms = () =>
  useQuery({ queryKey: adminKeys.firms, queryFn: adminApi.listFirms });

export const useFirm = (id: string | undefined) =>
  useQuery({ queryKey: adminKeys.firm(id ?? ''), queryFn: () => adminApi.getFirm(id!), enabled: !!id });

export const useAdminUsers = (filter: { firmId?: string; status?: UserStatus; q?: string } = {}) =>
  useQuery({ queryKey: adminKeys.users(filter), queryFn: () => adminApi.listUsers(filter) });

export const useAuditLog = (query: AuditLogQuery = {}) =>
  useQuery({ queryKey: adminKeys.audit(query), queryFn: () => adminApi.auditLog(query) });

export const useTemplates = (scope?: TemplateScope, firmId?: string) =>
  useQuery({ queryKey: adminKeys.templates(scope, firmId), queryFn: () => adminApi.listTemplates(scope, firmId) });

// ---- mutations -------------------------------------------------------------

export function useCreateFirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminCreateFirmRequest) => adminApi.createFirm(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.firms }); qc.invalidateQueries({ queryKey: adminKeys.stats }); },
  });
}

export function useUpdateFirm(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AdminUpdateFirmRequest) => adminApi.updateFirm(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.firms }); qc.invalidateQueries({ queryKey: adminKeys.firm(id) }); },
  });
}

export function useDeleteFirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteFirm(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.firms }); qc.invalidateQueries({ queryKey: adminKeys.stats }); },
  });
}

export function useUpdatePlan(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AdminUpdatePlanRequest) => adminApi.updatePlan(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.firm(id) }); qc.invalidateQueries({ queryKey: adminKeys.firms }); qc.invalidateQueries({ queryKey: adminKeys.stats }); },
  });
}

export function useUpdateFlags(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AdminUpdateFlagsRequest) => adminApi.updateFlags(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.firm(id) }); },
  });
}

export function useUpdateBranding(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AdminUpdateBrandingRequest) => adminApi.updateBranding(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: adminKeys.firm(id) }); },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AdminUpdateUserRequest }) => adminApi.updateUser(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'users'] }); qc.invalidateQueries({ queryKey: ['admin', 'firm'] }); },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'users'] }); qc.invalidateQueries({ queryKey: adminKeys.stats }); },
  });
}

export function useResetPassword() {
  return useMutation({ mutationFn: (id: string) => adminApi.resetUserPassword(id) });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminCreateTemplateRequest) => adminApi.createTemplate(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'templates'] }); },
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AdminUpdateTemplateRequest }) => adminApi.updateTemplate(id, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'templates'] }); },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'templates'] }); },
  });
}
