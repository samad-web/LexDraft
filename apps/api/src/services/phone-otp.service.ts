/**
 * WhatsApp OTP challenges for sign-up phone verification. Same shape as the
 * e-sign email OTP (esign.service): 6 digits, SHA-256 at rest, 10 minute
 * TTL, 5 attempts. Each challenge is bound to the Google account that asked
 * for it.
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
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) {
    throw new BadRequestError('Enter a valid WhatsApp number, e.g. +91 98765 43210.');
  }
  return e164;
}

export const phoneOtpService = {
  async start(input: { phone: string; googleSub: string; ip: string | null }): Promise<{
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
      insert into phone_otp_challenges (phone, purpose, google_sub, code_hash, expires_at, ip_address)
      values (${input.phone}, 'signup', ${input.googleSub}, ${hashOtp(code)}, ${expiresAt}, ${input.ip})
      returning id
    `;
    return { challengeId: row!.id, expiresAt: expiresAt.toISOString(), resendAfterSeconds: RESEND_AFTER_SECONDS };
  },

  /** Returns the verified phone number, or throws. */
  async verify(input: { challengeId: string; code: string; googleSub: string }): Promise<string> {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const [c] = await sql<{
      id: string; phone: string; google_sub: string | null; code_hash: string;
      attempts: number; expires_at: Date; verified_at: Date | null;
    }[]>`
      select id, phone, google_sub, code_hash, attempts, expires_at, verified_at
      from phone_otp_challenges where id = ${input.challengeId}::uuid
    `;
    if (!c || c.google_sub !== input.googleSub || c.verified_at) {
      throw new UnauthorizedError('That code is no longer valid. Request a new one.');
    }
    if (new Date(c.expires_at) < new Date() || c.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedError('That code has expired. Request a new one.');
    }
    await sql`update phone_otp_challenges set attempts = attempts + 1 where id = ${c.id}::uuid`;
    if (hashOtp(input.code) !== c.code_hash) {
      const left = OTP_MAX_ATTEMPTS - c.attempts - 1;
      throw new UnauthorizedError(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Incorrect code. Request a new one.');
    }
    await sql`update phone_otp_challenges set verified_at = now() where id = ${c.id}::uuid`;
    return c.phone;
  },
};
