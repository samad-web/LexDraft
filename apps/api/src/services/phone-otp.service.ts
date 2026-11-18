/**
 * WhatsApp OTP challenges for sign-up phone verification. Same shape as the
 * e-sign email OTP (esign.service): 6 digits, SHA-256 at rest, 10 minute
 * TTL, 5 attempts. A sign-up code is bound to the Google account that asked
 * for it; a password-reset code (forgot-password-whatsapp.md) to the account.
 */
import { createHash, randomInt } from 'node:crypto';
import { db } from '../db/client';
import { BadRequestError, TooManyRequestsError, UnauthorizedError } from '../lib/errors';
import { whatsappService } from './whatsapp.service';

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_AFTER_SECONDS = 30;
const MAX_SENDS_PER_HOUR = 5;

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/** Normalise to E.164. A bare 10-digit Indian mobile gets +91. */
export function normalizePhone(raw: string): string {
  const compact = raw.replace(/[\s\-().]/g, '');
  let e164 = compact;
  if (/^[6-9]\d{9}$/.test(compact)) e164 = `+91${compact}`;
  else if (/^0[6-9]\d{9}$/.test(compact)) e164 = `+91${compact.slice(1)}`;
  else if (/^91[6-9]\d{9}$/.test(compact)) e164 = `+${compact}`;
  // DifAi accepts Indian mobile numbers only (+91, 10 digits starting 6-9).
  if (/^\+(?!91)/.test(e164)) {
    throw new BadRequestError('Only Indian (+91) mobile numbers are supported. Enter your 10-digit WhatsApp number.');
  }
  if (!/^\+91[6-9]\d{9}$/.test(e164)) {
    throw new BadRequestError('Enter a valid 10-digit Indian WhatsApp number, e.g. +91 98765 43210.');
  }
  return e164;
}

type Challenge = {
  id: string; phone: string; purpose: string; google_sub: string | null; user_id: string | null;
  code_hash: string; attempts: number; expires_at: Date; verified_at: Date | null;
};

/** Checks the code (one use, TTL, attempts) for a challenge `owns` accepts. */
async function consume(challengeId: string, code: string, owns: (c: Challenge) => boolean): Promise<Challenge> {
  const sql = db();
  if (!sql) throw new Error('DATABASE_URL not configured');
  const [c] = await sql<Challenge[]>`
    select id, phone, purpose, google_sub, user_id, code_hash, attempts, expires_at, verified_at
    from phone_otp_challenges where id = ${challengeId}::uuid
  `;
  if (!c || !owns(c) || c.verified_at) {
    throw new UnauthorizedError('That code is no longer valid. Request a new one.');
  }
  if (new Date(c.expires_at) < new Date() || c.attempts >= OTP_MAX_ATTEMPTS) {
    throw new UnauthorizedError('That code has expired. Request a new one.');
  }
  await sql`update phone_otp_challenges set attempts = attempts + 1 where id = ${c.id}::uuid`;
  if (hashOtp(code) !== c.code_hash) {
    const left = OTP_MAX_ATTEMPTS - c.attempts - 1;
    throw new UnauthorizedError(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Request a new one.');
  }
  await sql`update phone_otp_challenges set verified_at = now() where id = ${c.id}::uuid`;
  return c;
}

export const phoneOtpService = {
  /** googleSub = sign-up code; userId = password-reset code for that account. */
  async start(input: { phone: string; ip: string | null } & ({ googleSub: string; userId?: never } | { userId: string; googleSub?: never })): Promise<{
    challengeId: string;
    expiresAt: string;
    resendAfterSeconds: number;
  }> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');

    const [recent] = await sql<{ sent_last_hour: number; last_sent: Date | null }[]>`
      select count(*)::int as sent_last_hour, max(created_at) as last_sent
      from phone_otp_challenges
      where phone = ${input.phone} and created_at > now() - interval '1 hour'
    `;
    if (recent && recent.last_sent && Date.now() - new Date(recent.last_sent).getTime() < RESEND_AFTER_SECONDS * 1000) {
      throw new TooManyRequestsError(`Wait ${RESEND_AFTER_SECONDS} seconds before requesting another code.`);
    }
    if (recent && recent.sent_last_hour >= MAX_SENDS_PER_HOUR) {
      throw new TooManyRequestsError('Too many codes sent to this number. Try again in an hour.');
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
    // Send first: if the provider rejects the number we don't burn the
    // caller's hourly budget on a code that never arrived.
    await whatsappService.sendOtp(input.phone, code);
    const [row] = await sql<{ id: string }[]>`
      insert into phone_otp_challenges (phone, purpose, google_sub, user_id, code_hash, expires_at, ip_address)
      values (${input.phone}, ${input.userId ? 'password_reset' : 'signup'}, ${input.googleSub ?? null},
              ${input.userId ?? null}, ${hashOtp(code)}, ${expiresAt}, ${input.ip})
      returning id
    `;
    return { challengeId: row!.id, expiresAt: expiresAt.toISOString(), resendAfterSeconds: RESEND_AFTER_SECONDS };
  },

  /** Sign-up: returns the verified phone number, or throws. */
  async verify(input: { challengeId: string; code: string; googleSub: string }): Promise<string> {
    const c = await consume(input.challengeId, input.code, (c) => c.purpose === 'signup' && c.google_sub === input.googleSub);
    return c.phone;
  },

  /** Password reset: returns the account the code was sent for, or throws. */
  async verifyReset(input: { challengeId: string; code: string }): Promise<string> {
    const c = await consume(input.challengeId, input.code, (c) => c.purpose === 'password_reset' && !!c.user_id);
    return c.user_id!;
  },
};
