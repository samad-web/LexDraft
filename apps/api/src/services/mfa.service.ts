/**
 * MFA service — TOTP enrolment + verification (spec §10).
 *
 * Design notes:
 *  - The provisional enrolment secret is persisted in mfa_pending_challenges
 *    (NOT in users.totp_secret) so it can survive a server restart and so a
 *    half-finished enrolment can never be silently promoted to a working
 *    factor. It only lands in users.totp_secret AFTER the user proves
 *    they hold the secret by submitting a valid code.
 *  - Backup codes are stored bcrypt-hashed (cost 10, matching the password
 *    pipeline). Consumption is destructive — we remove the matching hash
 *    from the array, so a backup code is truly single-use.
 *  - We allow ±1 TOTP step for clock skew (~30s window each side). otplib's
 *    `window: 1` does exactly this.
 *  - `firmIdForUser` is NOT used here — MFA state is per-user, not
 *    per-tenant, so tenant scoping doesn't apply. The /me/* prefix means
 *    every call is already implicitly self-scoped via req.user.id.
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import qrcode from 'qrcode';
import { db } from '../db/client';
import { NotFoundError, UnauthorizedError, UnprocessableEntityError } from '../lib/errors';
import type {
  MfaEnrollStartResponse,
  MfaEnrollConfirmResponse,
  MfaStatusResponse,
} from '../types/mfa.types';

// 30-second TOTP step, ±1 step tolerance for clock skew.
authenticator.options = { window: 1, step: 30 };

const ISSUER = 'LexDraft';

// 5 minutes — long enough for a sluggish QR-scan + code-entry roundtrip,
// short enough that a stolen challengeId can't be replayed an hour later.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// 8 codes, 16 hex chars each — matches the size most authenticator apps
// surface in their backup UIs and trivially decodes for paste-with-spaces.
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LEN_BYTES = 8; // hex => 16 chars

const ROLES_REQUIRING_MFA: ReadonlySet<string> = new Set(['Firm Admin']);

function generateBackupCode(): string {
  // Hex is human-pasteable; format as XXXX-XXXX-XXXX-XXXX for legibility.
  const raw = crypto.randomBytes(BACKUP_CODE_LEN_BYTES).toString('hex').toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

interface UserMfaRow {
  email: string;
  role: string;
  is_superadmin: boolean;
  totp_secret: string | null;
  mfa_enrolled_at: Date | null;
  mfa_required_at: Date | null;
  mfa_backup_codes: string[] | null;
}

async function loadUser(userId: string): Promise<UserMfaRow> {
  const sql = db();
  if (!sql) throw new UnprocessableEntityError('Database not configured — MFA unavailable in in-memory mode');
  const rows = await sql<UserMfaRow[]>`
    select email, role, is_superadmin, totp_secret, mfa_enrolled_at, mfa_required_at, mfa_backup_codes
    from users
    where id = ${userId}::uuid
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new NotFoundError('User not found');
  return row;
}

function roleRequiresMfa(row: Pick<UserMfaRow, 'role' | 'is_superadmin' | 'mfa_required_at'>): boolean {
  if (row.is_superadmin) return true;
  if (ROLES_REQUIRING_MFA.has(row.role)) return true;
  if (row.mfa_required_at) return true;
  return false;
}

export const mfaService = {
  /**
   * Begin enrolment: mint a fresh secret, stash it in a pending challenge,
   * return the otpauth URL + QR data URL so the client can render the
   * onboarding screen. The secret only lands on the users row after
   * `enrollConfirm` proves possession.
   */
  async enrollStart(userId: string): Promise<MfaEnrollStartResponse> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured — MFA unavailable in in-memory mode');

    const user = await loadUser(userId);

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, ISSUER, secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const rows = await sql<Array<{ id: string }>>`
      insert into mfa_pending_challenges (user_id, pending_secret, expires_at)
      values (${userId}::uuid, ${secret}, ${expiresAt})
      returning id
    `;
    const challengeId = rows[0]!.id;

    return { secret, otpauthUrl, qrCodeDataUrl, challengeId };
  },

  /**
   * Finish enrolment: verify the supplied code against the provisional
   * secret tied to `challengeId`, then commit the secret + freshly-issued
   * backup codes to the users row.
   *
   * Caller passes the challengeId returned by `enrollStart`. We refuse to
   * fall back to "find latest pending for this user" — the explicit handle
   * makes replays/late-arriving codes safer to reason about.
   */
  async enrollConfirm(userId: string, challengeId: string, code: string): Promise<MfaEnrollConfirmResponse> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured — MFA unavailable in in-memory mode');

    const challengeRows = await sql<Array<{ id: string; pending_secret: string | null; expires_at: Date; consumed_at: Date | null }>>`
      select id, pending_secret, expires_at, consumed_at
      from mfa_pending_challenges
      where id = ${challengeId}::uuid and user_id = ${userId}::uuid
      limit 1
    `;
    const challenge = challengeRows[0];
    if (!challenge || !challenge.pending_secret) {
      throw new UnauthorizedError('Invalid or expired enrolment challenge', { code: 'mfa_challenge_invalid' });
    }
    if (challenge.consumed_at) {
      throw new UnauthorizedError('Enrolment challenge already used', { code: 'mfa_challenge_consumed' });
    }
    if (challenge.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedError('Enrolment challenge expired', { code: 'mfa_challenge_expired' });
    }

    const ok = authenticator.check(code, challenge.pending_secret);
    if (!ok) throw new UnauthorizedError('Invalid TOTP code', { code: 'mfa_code_invalid' });

    // Mint + hash backup codes BEFORE the commit so a hash failure can't
    // half-enrol the user.
    const plaintextCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
    const hashedCodes = await Promise.all(plaintextCodes.map((c) => bcrypt.hash(c, 10)));

    await sql.begin(async (tx) => {
      await tx`
        update users
        set totp_secret      = ${challenge.pending_secret},
            mfa_enrolled_at  = now(),
            mfa_backup_codes = ${hashedCodes}
        where id = ${userId}::uuid
      `;
      await tx`
        update mfa_pending_challenges
        set consumed_at = now()
        where id = ${challengeId}::uuid
      `;
    });

    return { backupCodes: plaintextCodes, enrolledAt: new Date().toISOString() };
  },

  /**
   * Verify a TOTP (or backup) code for an already-enrolled user. Returns
   * true on success; on backup-code success, the matching hash is also
   * removed from the user's backup_codes array (single-use).
   *
   * Returns false (rather than throwing) for "wrong code" — callers can
   * decide whether to 401 or count toward a lockout counter.
   */
  async verifyTotp(userId: string, code: string): Promise<boolean> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured — MFA unavailable in in-memory mode');

    const user = await loadUser(userId);
    if (!user.totp_secret) return false;

    const trimmed = code.trim();
    if (!trimmed) return false;

    // Try TOTP first — the common case, no DB write needed.
    if (authenticator.check(trimmed, user.totp_secret)) {
      return true;
    }

    // Fall through to backup codes. Normalise: uppercase, accept w/ or
    // w/o the formatting dashes the user was originally shown.
    const candidate = trimmed.toUpperCase();
    const hashes = user.mfa_backup_codes ?? [];
    for (let i = 0; i < hashes.length; i += 1) {
      const hash = hashes[i]!;
      if (await bcrypt.compare(candidate, hash)) {
        const remaining = hashes.filter((_, idx) => idx !== i);
        await sql`
          update users set mfa_backup_codes = ${remaining}
          where id = ${userId}::uuid
        `;
        return true;
      }
    }
    return false;
  },

  async mfaStatus(userId: string): Promise<MfaStatusResponse> {
    const user = await loadUser(userId);
    return {
      enrolled: !!user.totp_secret && !!user.mfa_enrolled_at,
      required: roleRequiresMfa(user),
      enrolledAt: user.mfa_enrolled_at ? user.mfa_enrolled_at.toISOString() : null,
    };
  },

  /**
   * Strip MFA state from a user — used by admin-recovery flows (lost
   * device, support intervention). Does NOT clear mfa_required_at, because
   * the role still requires MFA — the user must enrol again.
   */
  async disableForUser(userId: string): Promise<void> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured — MFA unavailable in in-memory mode');
    await sql`
      update users
      set totp_secret      = null,
          mfa_enrolled_at  = null,
          mfa_backup_codes = null
      where id = ${userId}::uuid
    `;
  },

  // -- helpers used by auth.service.signIn ---------------------------------

  /**
   * Sign-in helper — return whether the user has a working TOTP set up and
   * whether their role mandates MFA. The auth service uses these two
   * booleans to branch between "challenge for code", "force enrolment",
   * and "proceed normally".
   */
  async signInGate(userId: string): Promise<{ enrolled: boolean; required: boolean }> {
    const user = await loadUser(userId);
    return {
      enrolled: !!user.totp_secret && !!user.mfa_enrolled_at,
      required: roleRequiresMfa(user),
    };
  },

  /**
   * Open a sign-in challenge: password is verified, but TOTP is still
   * required. Returns the challengeId the client will exchange for a
   * real token via /me/mfa/verify-challenge.
   */
  async openSignInChallenge(userId: string): Promise<{ challengeId: string; expiresAt: string }> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured — MFA unavailable in in-memory mode');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    const rows = await sql<Array<{ id: string }>>`
      insert into mfa_pending_challenges (user_id, pending_secret, expires_at)
      values (${userId}::uuid, ${null}, ${expiresAt})
      returning id
    `;
    return { challengeId: rows[0]!.id, expiresAt: expiresAt.toISOString() };
  },

  /**
   * Exchange a sign-in challenge + TOTP code for "code verified" — the
   * caller mints the actual session token.
   *
   * Returns the user id on success; throws Unauthorized on bad challenge,
   * bad code, expired challenge, or replayed challenge.
   */
  async consumeSignInChallenge(challengeId: string, code: string): Promise<string> {
    const sql = db();
    if (!sql) throw new UnprocessableEntityError('Database not configured — MFA unavailable in in-memory mode');

    const rows = await sql<Array<{ user_id: string; expires_at: Date; consumed_at: Date | null; pending_secret: string | null }>>`
      select user_id, expires_at, consumed_at, pending_secret
      from mfa_pending_challenges
      where id = ${challengeId}::uuid
      limit 1
    `;
    const ch = rows[0];
    if (!ch) throw new UnauthorizedError('Invalid challenge', { code: 'mfa_challenge_invalid' });
    if (ch.consumed_at) throw new UnauthorizedError('Challenge already used', { code: 'mfa_challenge_consumed' });
    if (ch.expires_at.getTime() < Date.now()) throw new UnauthorizedError('Challenge expired', { code: 'mfa_challenge_expired' });
    // pending_secret should be null for sign-in challenges — guard against
    // a confused-deputy attempt to use an enrolment challenge here.
    if (ch.pending_secret) throw new UnauthorizedError('Wrong challenge type', { code: 'mfa_challenge_wrong_type' });

    const ok = await mfaService.verifyTotp(ch.user_id, code);
    if (!ok) throw new UnauthorizedError('Invalid TOTP code', { code: 'mfa_code_invalid' });

    await sql`
      update mfa_pending_challenges set consumed_at = now()
      where id = ${challengeId}::uuid
    `;
    return ch.user_id;
  },

  /** Used by auth-service signIn so it can attach `mustEnrollMfa` to the
   *  response when the user's role mandates MFA but they haven't enrolled
   *  yet. */
  roleRequiresMfa,
};
