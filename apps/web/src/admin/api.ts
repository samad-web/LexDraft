import { api } from '@/lib/api';
import type {
  AdminCreateFirmRequest,
  AdminCreateTemplateRequest,
  AdminUpdateBrandingRequest,
  AdminUpdateFirmRequest,
  AdminUpdateFlagsRequest,
  AdminUpdatePlanRequest,
  AdminUpdateTemplateRequest,
  AdminUpdateUserRequest,
  AdminUserSummary,
  AuditLogEntry,
  AuditLogQuery,
  DocumentTemplate,
  FeatureFlag,
  FirmBranding,
  FirmDetail,
  FirmPlan,
  FirmSummary,
  ImpersonationGrant,
  PlatformStats,
  TemplateScope,
  UserStatus,
} from '@lexdraft/types';

export const adminApi = {
  // ---- platform stats ---------------------------------------------------
  stats: () => api.get<PlatformStats>('/admin/stats'),

  // ---- firms ------------------------------------------------------------
  listFirms: () => api.get<{ items: FirmSummary[] }>('/admin/firms').then((r) => r.items),
  getFirm:   (id: string) => api.get<FirmDetail>(`/admin/firms/${id}`),
  createFirm: (input: AdminCreateFirmRequest) => api.post<FirmSummary>('/admin/firms', input),
  updateFirm: (id: string, patch: AdminUpdateFirmRequest) => api.patch<FirmSummary>(`/admin/firms/${id}`, patch),
  deleteFirm: (id: string) => api.delete<void>(`/admin/firms/${id}`),

  // ---- plan / flags / branding -----------------------------------------
  updatePlan:     (id: string, patch: AdminUpdatePlanRequest) => api.patch<FirmPlan>(`/admin/firms/${id}/plan`, patch),
  updateFlags:    (id: string, patch: AdminUpdateFlagsRequest) =>
    api.patch<{ items: FeatureFlag[] }>(`/admin/firms/${id}/flags`, patch).then((r) => r.items),
  updateBranding: (id: string, patch: AdminUpdateBrandingRequest) => api.patch<FirmBranding>(`/admin/firms/${id}/branding`, patch),

  // ---- users (cross-firm) ----------------------------------------------
  listUsers: (filter: { firmId?: string; status?: UserStatus; q?: string } = {}) =>
    api.get<{ items: AdminUserSummary[] }>('/admin/users', filter as Record<string, unknown>).then((r) => r.items),
  updateUser: (id: string, patch: AdminUpdateUserRequest) => api.patch<AdminUserSummary>(`/admin/users/${id}`, patch),
  deleteUser: (id: string) => api.delete<void>(`/admin/users/${id}`),
  resetUserPassword: (id: string) => api.post<{ tempPassword: string }>(`/admin/users/${id}/reset-password`),

  // ---- impersonation ---------------------------------------------------
  impersonate: (userId: string) => api.post<ImpersonationGrant>(`/admin/impersonate/${userId}`),
  endImpersonation: (targetUserId: string | null) =>
    api.post<void>('/admin/impersonate/end', { targetUserId }),

  // ---- audit log -------------------------------------------------------
  auditLog: (query: AuditLogQuery = {}) =>
    api.get<{ items: AuditLogEntry[] }>('/admin/audit-log', query as Record<string, unknown>).then((r) => r.items),

  // ---- templates -------------------------------------------------------
  listTemplates: (scope?: TemplateScope, firmId?: string) =>
    api.get<{ items: DocumentTemplate[] }>('/admin/templates', { scope, firmId }).then((r) => r.items),
  getTemplate: (id: string) => api.get<DocumentTemplate>(`/admin/templates/${id}`),
  createTemplate: (input: AdminCreateTemplateRequest) => api.post<DocumentTemplate>('/admin/templates', input),
  updateTemplate: (id: string, patch: AdminUpdateTemplateRequest) => api.patch<DocumentTemplate>(`/admin/templates/${id}`, patch),
  deleteTemplate: (id: string) => api.delete<void>(`/admin/templates/${id}`),
};
