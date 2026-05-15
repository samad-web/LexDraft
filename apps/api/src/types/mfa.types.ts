/**
 * MFA DTOs - kept LOCAL to the api package on purpose. The orchestrator will
 * promote/unify these into `@lexdraft/types` once the web client wires up,
 * so don't import from here in the web app; treat this as the API's
 * provisional contract.
 */

export interface MfaEnrollStartResponse {
  /** Base32 TOTP secret. Show in the manual-entry field beneath the QR. */
  secret: string;
  /** `otpauth://totp/...` URI - what the QR encodes. */
  otpauthUrl: string;
  /** PNG-encoded data URL of `otpauthUrl`, ready to drop into <img src>. */
  qrCodeDataUrl: string;
  /** Provisional challenge handle. The client passes this back to
   *  /enroll/confirm so the server can pair the verification with the
   *  right provisional secret. Expires in 5 minutes. */
  challengeId: string;
}

export interface MfaEnrollConfirmResponse {
  /** 8 single-use backup codes, plaintext. Shown to the user ONCE - the
   *  server only stores bcrypt hashes from this point on. */
  backupCodes: string[];
  enrolledAt: string;
}

export interface MfaStatusResponse {
  /** True when the user has a stored TOTP secret. */
  enrolled: boolean;
  /** True when the user's role (Firm Admin / superadmin) mandates MFA. */
  required: boolean;
  /** ISO timestamp the user finished enrolment, or null. */
  enrolledAt: string | null;
}

export interface MfaVerifyResponse {
  /** A fresh JWT carrying `mfaVerifiedAt`. Replaces the bearer the client
   *  currently holds. */
  token: string;
}

/** Server-side representation of a `mfa_pending_challenges` row. */
export interface MfaChallenge {
  id: string;
  userId: string;
  pendingSecret: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}
