import axios, { AxiosError } from 'axios';
import { usePortalAuthStore } from '@/store/portalAuth';

/**
 * Axios client for the read-only client portal. Uses the portal-specific
 * token store so it never collides with the advocate session.
 */
const portalClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  withCredentials: false,
});

portalClient.interceptors.request.use((config) => {
  const token = usePortalAuthStore.getState().token;
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

portalClient.interceptors.response.use(
  (r) => r,
  (err: AxiosError<{ error?: string }>) => {
    if (err.response?.status === 401) {
      usePortalAuthStore.getState().clear();
    }
    return Promise.reject(err);
  },
);

export const portalApi = {
  get: <T>(path: string, params?: Record<string, unknown>) =>
    portalClient.get<T>(`/api/portal${path}`, { params }).then((r) => r.data),
  post: <T>(path: string, body?: unknown) =>
    portalClient.post<T>(`/api/portal${path}`, body).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) =>
    portalClient.patch<T>(`/api/portal${path}`, body).then((r) => r.data),
};

export function portalErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string } | undefined;
    return data?.error || err.message || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
