import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, SignInRequest, SignUpRequest } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { isMfaChallenge, type SignInResult } from '@/lib/auth-types';

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
  const setForceMfaEnrollment = useUIStore((s) => s.setForceMfaEnrollment);
  const qc = useQueryClient();
  return useMutation<SignInResult, Error, SignInRequest>({
    mutationFn: (body) => api.post<SignInResult>('/auth/sign-in', body),
    onSuccess: (r) => {
      // MFA-challenge branch: the server has accepted the password but is
      // withholding the session token until the user proves possession of
      // their TOTP factor. Do NOT setSession yet — the caller (AuthView)
      // routes to the challenge sub-step using the returned `challengeId`.
      if (isMfaChallenge(r)) return;

      // Fully authenticated branch — swap the session, blow away the cache.
      qc.clear();
      setSession(r.user, r.token);

      // Role mandates MFA but the user has no factor on file. Flip the UI
      // flag so the MfaPromptBanner stays mounted and the user is nudged
      // into enrolment on first action.
      if (r.mustEnrollMfa) {
        setForceMfaEnrollment(true);
      } else {
        // Belt-and-braces: clear any stale flag from a prior session.
        setForceMfaEnrollment(false);
      }
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
  const setForceMfaEnrollment = useUIStore((s) => s.setForceMfaEnrollment);
  const qc = useQueryClient();
  return () => {
    void api.post('/auth/sign-out').catch(() => undefined);
    qc.clear();
    clear();
    // The mfa-must-enrol nag is a property of the session, not the device.
    setForceMfaEnrollment(false);
  };
}
