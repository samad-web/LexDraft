import { useMutation } from '@tanstack/react-query';
import type { AuthResponse, SignInRequest, SignUpRequest } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

export function useSignIn() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (body: SignInRequest) => api.post<AuthResponse>('/auth/sign-in', body),
    onSuccess: (r) => setSession(r.user, r.token),
  });
}

export function useSignUp() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (body: SignUpRequest) => api.post<AuthResponse>('/auth/sign-up', body),
    onSuccess: (r) => setSession(r.user, r.token),
  });
}

export function useSignOut() {
  const clear = useAuthStore((s) => s.clear);
  return () => {
    void api.post('/auth/sign-out').catch(() => undefined);
    clear();
  };
}
