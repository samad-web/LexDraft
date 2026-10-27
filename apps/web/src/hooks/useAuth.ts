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
      // their TOTP factor. Do NOT setSession yet - the caller (AuthView)
      // routes to the challenge sub-step using the returned `challengeId`.
      if (isMfaChallenge(r)) return;

      // Fully authenticated branch - swap the session, blow away the cache.
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

// ---- Google sign-in + WhatsApp-verified sign-up ----------------------------

export interface GoogleSignupRequired {
  signupRequired: true;
  /** Short-lived token for the sign-up steps below; not a session. */
  signupToken: string;
  profile: { email: string; name: string; picture?: string };
}
export type GoogleSignInResult = SignInResult | GoogleSignupRequired;

export function isGoogleSignupRequired(r: GoogleSignInResult): r is GoogleSignupRequired {
  return (r as GoogleSignupRequired).signupRequired === true;
}

/** Existing account: same handling as useSignIn (session or MFA challenge).
 *  New Google account: no session; the caller runs the WhatsApp step. */
export function useGoogleSignIn() {
  const setSession = useAuthStore((s) => s.setSession);
  const setForceMfaEnrollment = useUIStore((s) => s.setForceMfaEnrollment);
  const qc = useQueryClient();
  return useMutation<GoogleSignInResult, Error, { credential: string }>({
    mutationFn: (body) => api.post<GoogleSignInResult>('/auth/google', body),
    onSuccess: (r) => {
      if (isGoogleSignupRequired(r) || isMfaChallenge(r)) return;
      qc.clear();
      setSession(r.user, r.token);
      setForceMfaEnrollment(!!r.mustEnrollMfa);
    },
  });
}

export function useSendSignupOtp() {
  return useMutation({
    mutationFn: (body: { signupToken: string; phone: string }) =>
      api.post<{ challengeId: string; expiresAt: string; resendAfterSeconds: number; phone: string }>(
        '/auth/signup/otp/send', body,
      ),
  });
}

export function useVerifySignupOtp() {
  return useMutation({
    mutationFn: (body: { signupToken: string; challengeId: string; code: string }) =>
      api.post<{ signupToken: string; phone: string }>('/auth/signup/otp/verify', body),
  });
}

export interface GoogleSignUpRequest extends Omit<SignUpRequest, 'email' | 'name'> {
  /** Must be the token returned by useVerifySignupOtp. */
  signupToken: string;
  name?: string;
}

export function useGoogleSignUp() {
  const setSession = useAuthStore((s) => s.setSession);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GoogleSignUpRequest) => api.post<AuthResponse>('/auth/google/sign-up', body),
    onSuccess: (r) => {
      qc.clear();
      setSession(r.user, r.token);
    },
  });
}

export type FirmEnquirySize = '9-25' | '26-50' | '51-100' | '100+';

export interface FirmEnquiryRequest {
  name: string;
  email: string;
  phone?: string;
  firmName: string;
  firmSize: FirmEnquirySize;
  primaryCourt?: string;
  practiceAreas?: string;
  message?: string;
}

/**
 * Firm-tier sign-up bypasses self-serve account creation. The user fills a
 * contact form and a partner reaches out. The endpoint is public and rate-
 * limited by the same signUpLimiter that protects /auth/sign-up.
 */
export function useFirmEnquiry() {
  return useMutation({
    mutationFn: (body: FirmEnquiryRequest) =>
      api.post<{ ok: true; id: string }>('/auth/firm-enquiry', body),
  });
}

export type DemoType = 'contact' | 'schedule';
export interface DemoRequestBody {
  name: string;
  email: string;
  firmName?: string;
  phone?: string;
  preferredTime?: string;
  message?: string;
  demoType: DemoType;
}

/** Public demo-request capture from the landing funnel. Shares the
 *  signUpLimiter on the server so the same IP cannot flood the table. */
export function useDemoRequest() {
  return useMutation({
    mutationFn: (body: DemoRequestBody) =>
      api.post<{ ok: true; id: string }>('/auth/demo-request', body),
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
