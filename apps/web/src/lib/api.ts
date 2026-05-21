import axios, { AxiosError } from 'axios';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';

interface CapErrorPayload {
  error?: string;
  code?: string;
  cap?: number;
  used?: number;
  resetsAt?: string;
  planTier?: string | null;
}

// In dev the Vite proxy forwards /api/* to VITE_API_URL (default
// http://localhost:4000) - so an empty baseURL is correct: requests go to the
// current origin and the proxy handles the hop. In prod, set VITE_API_URL to
// your API host (e.g. https://api.lexdraft.io) at build time.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: false,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (err: AxiosError<CapErrorPayload>) => {
    const status = err.response?.status;
    const code = err.response?.data?.code ?? '';
    const payload = err.response?.data;

    // Only these 402 codes mean "the subscription itself is dead" — emitted by
    // requireActivePlan.ts. Everything else (plan_not_supported,
    // cap_reached, etc.) is a feature-gate refusal from an active session
    // and must bubble up so the caller can render its own error UI.
    const INACTIVE_PLAN_CODES = new Set([
      'plan_cancelled',
      'plan_past_due',
      'plan_expired',
      'trial_expired',
    ]);

    if (status === 401) {
      useAuthStore.getState().clear();
    } else if (status === 402 && code === 'seat_cap_exceeded') {
      // Seat cap reached on an invite/accept. Surface an upgrade prompt
      // modal; do NOT log the user out. The current session is still valid.
      useUIStore.getState().showCapPrompt({
        kind: 'seat_cap',
        cap: payload?.cap ?? 0,
        used: payload?.used ?? 0,
        planTier: payload?.planTier ?? null,
      });
    } else if (status === 402 && INACTIVE_PLAN_CODES.has(code)) {
      // Plan inactive (cancelled / past due / past renews_at). Forced logout
      // with a reason on the next URL so the login page can show a banner.
      useAuthStore.getState().clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth')) {
        window.location.assign(`/auth?reason=${encodeURIComponent(code || 'plan_inactive')}`);
      }
    } else if (status === 429 && code === 'ai_quota_exceeded') {
      // Monthly AI cap hit. Surface upgrade-or-wait modal.
      useUIStore.getState().showCapPrompt({
        kind: 'ai_quota',
        cap: payload?.cap ?? 0,
        used: payload?.used ?? 0,
        ...(payload?.resetsAt ? { resetsAt: payload.resetsAt } : {}),
        planTier: payload?.planTier ?? null,
      });
    }
    return Promise.reject(err);
  },
);

// All endpoints are namespaced under /api on the backend.
export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) =>
    apiClient.get<T>(`/api${path}`, { params }).then((r) => r.data),
  post: <T>(path: string, body?: unknown) =>
    apiClient.post<T>(`/api${path}`, body).then((r) => r.data),
  put: <T>(path: string, body?: unknown) =>
    apiClient.put<T>(`/api${path}`, body).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) =>
    apiClient.patch<T>(`/api${path}`, body).then((r) => r.data),
  delete: <T>(path: string) => apiClient.delete<T>(`/api${path}`).then((r) => r.data),
};
