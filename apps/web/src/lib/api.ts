import axios, { AxiosError } from 'axios';
import { useAuthStore } from '@/store/auth';

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
  (err: AxiosError<{ error?: string; code?: string }>) => {
    const status = err.response?.status;
    if (status === 401) {
      useAuthStore.getState().clear();
    } else if (status === 402) {
      // Plan inactive - the server has refused to serve this request because
      // the firm's plan is cancelled / past due / past renews_at. Treat as
      // a forced logout: drop the token, surface a reason on the next URL
      // so the login page can show a "renew to continue" banner.
      const code = err.response?.data?.code ?? 'plan_inactive';
      useAuthStore.getState().clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth')) {
        const sep = window.location.pathname === '/auth' ? '?' : '?';
        window.location.assign(`/auth${sep}reason=${encodeURIComponent(code)}`);
      }
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
