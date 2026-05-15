import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from '@lexdraft/types';
import axios from 'axios';
import { api, apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import type {
  MfaEnrollConfirmResponse,
  MfaEnrollStartResponse,
  MfaStatus,
  MfaVerifyResponse,
} from '@/lib/auth-types';

/**
 * MFA query/mutation hooks.
 *
 * Three flavours of MFA-related call:
 *  - status:    `useMfaStatus()` (cached query)
 *  - enrolment: `useMfaEnrollStart` / `useMfaEnrollConfirm` (authed)
 *  - challenge: `useMfaVerifyChallenge` (UNAUTHED - runs between password POST
 *               and session creation; we hand-roll the request rather than
 *               going through the api wrapper so we can prove there's no
 *               bearer attached)
 *
 * On success of every "issue new token" call we route the token back into
 * `setSession` so the axios interceptor picks it up on the next request.
 */

const MFA_STATUS_KEY = ['mfa', 'status'] as const;

export function useMfaStatus() {
  return useQuery({
    queryKey: MFA_STATUS_KEY,
    queryFn: () => api.get<MfaStatus>('/me/mfa/status'),
    // Status is sticky for the lifetime of a session - re-fetching after
    // every refocus is wasteful and would flicker the security panel.
    staleTime: 60_000,
  });
}

export function useMfaEnrollStart() {
  return useMutation({
    mutationFn: () => api.post<MfaEnrollStartResponse>('/me/mfa/enroll/start'),
  });
}

export function useMfaEnrollConfirm() {
  const qc = useQueryClient();
  const setForceMfaEnrollment = useUIStore((s) => s.setForceMfaEnrollment);
  return useMutation({
    mutationFn: (input: { challengeId: string; code: string }) =>
      api.post<MfaEnrollConfirmResponse>('/me/mfa/enroll/confirm', input),
    onSuccess: () => {
      // Refresh the security panel and let the banner unmount.
      qc.invalidateQueries({ queryKey: MFA_STATUS_KEY });
      setForceMfaEnrollment(false);
    },
  });
}

/** Verify a TOTP for the CURRENT logged-in user. Used post-enrolment or for
 *  step-up scenarios. The server returns a fresh token carrying mfaVerifiedAt;
 *  we slot it into the existing session without touching the user object. */
export function useMfaVerify() {
  const setSession = useAuthStore((s) => s.setSession);
  return useMutation({
    mutationFn: (input: { code: string }) =>
      api.post<MfaVerifyResponse>('/me/mfa/verify', input),
    onSuccess: (r) => {
      const currentUser = useAuthStore.getState().user;
      if (currentUser) setSession(currentUser, r.token);
    },
  });
}

/**
 * Exchange the sign-in challengeId + a code for a real session.
 *
 * The server allows this with no Authorization header (the challengeId is
 * itself the proof-of-password). The api wrapper would attach whatever stale
 * token is in the store, so we go around it and use the underlying axios
 * client directly with the auth header explicitly stripped - important when
 * the prior tab is signed in as someone else.
 *
 * The verify-challenge response only carries `{ token }`, so once we have it
 * we make a second authenticated request to `/me` to materialise the User
 * before flipping the session.
 */
export function useMfaVerifyChallenge() {
  const setSession = useAuthStore((s) => s.setSession);
  const setForceMfaEnrollment = useUIStore((s) => s.setForceMfaEnrollment);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { challengeId: string; code: string }) => {
      // Make the verify call without any cached bearer. Using axios directly
      // (NOT the api wrapper) avoids the interceptor that auto-attaches the
      // store token; we pass an explicit header override for clarity.
      const baseURL = apiClient.defaults.baseURL ?? '';
      const verifyResp = await axios.post<MfaVerifyResponse>(
        `${baseURL}/api/me/mfa/verify-challenge`,
        input,
        { headers: { Authorization: '' } },
      );
      const token = verifyResp.data.token;

      // /api/me requires auth; pass the freshly-minted token explicitly
      // because the store hasn't been updated yet (and the interceptor
      // would otherwise send the previous user's stale bearer, if any).
      const meResp = await axios.get<User>(`${baseURL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { user: meResp.data, token };
    },
    onSuccess: ({ user, token }) => {
      qc.clear();
      setSession(user, token);
      // Verified-in users start with a clean banner state; the server's
      // /me/mfa/status response is the source of truth from here.
      setForceMfaEnrollment(false);
    },
  });
}

export function useMfaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>('/me/mfa'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MFA_STATUS_KEY });
    },
  });
}
