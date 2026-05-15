import type { User } from '@lexdraft/types';

/**
 * MFA-aware sign-in types.
 *
 * The backend sign-in endpoint now returns one of two shapes:
 *   1. `AuthResponseWithMfa` - the normal success payload, optionally carrying
 *      `mustEnrollMfa` when the user's role mandates enrolment but no factor
 *      has been registered yet. The session is fully authenticated.
 *   2. `MfaChallengeResponse` - the user has MFA enrolled, password is valid,
 *      but no session token has been issued. The client must exchange the
 *      `challengeId` (plus a TOTP code) at /me/mfa/verify-challenge to get a
 *      real token. NO bearer should be set in this branch.
 *
 * The `isMfaChallenge` type guard narrows the union - see useSignIn for how
 * the two branches are routed through the React tree.
 *
 * These types live in apps/web on purpose: per the API team note in
 * apps/api/src/types/mfa.types.ts, the @lexdraft/types package will absorb
 * them later - until then, this file is the web-side mirror.
 */

export interface AuthResponseWithMfa {
  user: User;
  token: string;
  /** True when the role requires MFA but the user has not yet enrolled.
   *  The UI shows a persistent banner + forces enrolment on first action. */
  mustEnrollMfa?: boolean;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeId: string;
  /** ISO timestamp - the challenge is dead after this. The UI shows a
   *  countdown so the user knows when to restart. */
  expiresAt: string;
}

export type SignInResult = AuthResponseWithMfa | MfaChallengeResponse;

export function isMfaChallenge(r: SignInResult): r is MfaChallengeResponse {
  return (r as MfaChallengeResponse).mfaRequired === true;
}

export interface MfaStatus {
  enrolled: boolean;
  required: boolean;
  /** ISO timestamp the user finished enrolment, or null. Present on the
   *  server response; tolerated as optional here so older builds don't
   *  break the type check. */
  enrolledAt?: string | null;
}

export interface MfaEnrollStartResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
  challengeId: string;
}

export interface MfaEnrollConfirmResponse {
  backupCodes: string[];
  /** Server returns the enrolment timestamp too - kept optional so the UI
   *  can read it without requiring it to be defined. */
  enrolledAt?: string;
}

export interface MfaVerifyResponse {
  token: string;
}
