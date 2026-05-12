import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, SignInRequest, SignUpRequest } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Auth mutations always wipe the React Query cache before swapping the session.
 *
 * Without this, queries keyed by stable strings (e.g. `['dashboard']`) keep
 * returning the previous user's data after sign-in. The dashboard greeting
 * reads from `/dashboard`, so without this clear a fresh sign-in as user B
 * shows "Good morning, A." until the first refetch lands.
 */
export function useSignIn() {
  const setSession = useAuthStore((s) => s.setSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SignInRequest) => api.post<AuthResponse>('/auth/sign-in', body),
    onSuccess: (r) => {
      qc.clear();
      setSession(r.user, r.token);
    },
  });
}

export function useSignUp() {
  const setSession = useAuthStore((s) => s.setSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SignUpRequest) => api.post<AuthResponse>('/auth/sign-up', body),
    onSuccess: (r) => {
      qc.clear();
      setSession(r.user, r.token);
    },
  });
}

export function useSignOut() {
  const clear = useAuthStore((s) => s.clear);
  const qc = useQueryClient();
  return () => {
    void api.post('/auth/sign-out').catch(() => undefined);
    qc.clear();
    clear();
  };
}
