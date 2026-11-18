/**
 * Forgot password via WhatsApp code (build-docs/features/forgot-password-whatsapp.md),
 * real Postgres + real HTTP routes. WhatsApp sending is stubbed.
 */
import { vi } from 'vitest';

const otp = vi.hoisted(() => ({ sent: [] as Array<{ phone: string; code: string }> }));
vi.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendOtp: async (phone: string, code: string) => { otp.sent.push({ phone, code }); },
    sendTemplate: async () => undefined,
  },
}));
vi.mock('../../lib/email-check', async (orig) => ({ ...(await orig<object>()), assertDeliverableEmail: async () => undefined }));

import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { authRouter } from '../auth.routes';
import { errorHandler } from '../../middleware/error';
import { authService } from '../../services/auth.service';

const sql = () => getIntegrationSql();
let server: Server;
let base = '';

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => { otp.sent.length = 0; });

const post = async (path: string, body: unknown) => {
  const r = await fetch(`${base}/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
};

let n = 0;
/** An account with a verified WhatsApp number (each gets its own number). */
async function account(over: { superadmin?: boolean; phone?: boolean; status?: string } = {}) {
  n += 1;
  const email = `reset-${Date.now()}-${n}@integration.test`;
  const phone = `+9198765${String(10000 + n).slice(-5)}`;
  const auth = await authService.signUp({ email, password: 'Old-pass-123', name: 'Asha Rao', role: 'solo' });
  await sql()`update users set phone = ${over.phone === false ? null : phone},
    phone_verified_at = ${over.phone === false ? null : new Date()},
    is_superadmin = ${!!over.superadmin}, status = ${over.status ?? 'active'}
    where id = ${auth.user.id}::uuid`;
  return { id: auth.user.id, email, phone };
}
const hashOf = async (id: string) => (await sql()<{ password_hash: string }[]>`select password_hash from users where id = ${id}::uuid`)[0]!.password_hash;

describe('forgot password via WhatsApp', () => {
  it('AC1: known email with a verified phone gets a code on that phone, bound to the account', async () => {
    const a = await account();
    const r = await post('/password/forgot', { email: a.email.toUpperCase() });
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(['challengeId', 'resendAfterSeconds']);
    expect(otp.sent).toEqual([{ phone: a.phone, code: expect.stringMatching(/^\d{6}$/) }]);
    const [c] = await sql()<{ purpose: string; user_id: string }[]>`select purpose, user_id from phone_otp_challenges where id = ${r.body.challengeId as string}::uuid`;
    expect(c).toEqual({ purpose: 'password_reset', user_id: a.id });
  });

  it('AC2: unknown email, no phone, superadmin, suspended -> same reply shape, nothing sent', async () => {
    const noPhone = await account({ phone: false });
    const admin = await account({ superadmin: true });
    const suspended = await account({ status: 'suspended' });
    for (const email of ['nobody@integration.test', noPhone.email, admin.email, suspended.email]) {
      const r = await post('/password/forgot', { email });
      expect(r.status, email).toBe(200);
      expect(Object.keys(r.body).sort(), email).toEqual(['challengeId', 'resendAfterSeconds']);
    }
    expect(otp.sent).toEqual([]);
  });

  it('AC3: right code + strong password changes the password; old fails, new signs in', async () => {
    const a = await account();
    const { body } = await post('/password/forgot', { email: a.email });
    const r = await post('/password/reset', { challengeId: body.challengeId, code: otp.sent[0]!.code, password: 'New-pass-456!' });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect((await post('/sign-in', { email: a.email, password: 'Old-pass-123' })).status).toBe(401);
    expect((await post('/sign-in', { email: a.email, password: 'New-pass-456!' })).status).toBe(200);
  });

  it('AC4: wrong, reused, made-up, or sign-up codes are refused and the password stays', async () => {
    const a = await account();
    const before = await hashOf(a.id);
    const { body } = await post('/password/forgot', { email: a.email });
    const code = otp.sent[0]!.code;
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await post('/password/reset', { challengeId: body.challengeId, code: wrong, password: 'New-pass-456!' });
    expect(bad.status).toBe(401);
    expect(String(bad.body.message ?? bad.body.error)).toMatch(/attempts? left/);
    // made-up challenge id (what an unknown email gets back)
    const fake = await post('/password/forgot', { email: 'nobody2@integration.test' });
    expect((await post('/password/reset', { challengeId: fake.body.challengeId, code, password: 'New-pass-456!' })).status).toBe(401);
    // a sign-up code can't reset a password
    const [signup] = await sql()<{ id: string }[]>`
      insert into phone_otp_challenges (phone, purpose, google_sub, code_hash, expires_at)
      values (${a.phone}, 'signup', 'g-sub', 'x', now() + interval '10 minutes') returning id`;
    expect((await post('/password/reset', { challengeId: signup!.id, code, password: 'New-pass-456!' })).status).toBe(401);
    expect(await hashOf(a.id)).toBe(before);
    // right code works once, then never again
    expect((await post('/password/reset', { challengeId: body.challengeId, code, password: 'New-pass-456!' })).status).toBe(200);
    expect((await post('/password/reset', { challengeId: body.challengeId, code, password: 'Other-pass-789!' })).status).toBe(401);
  });

  it('AC5: weak password is refused and the password stays', async () => {
    const a = await account();
    const before = await hashOf(a.id);
    const { body } = await post('/password/forgot', { email: a.email });
    const r = await post('/password/reset', { challengeId: body.challengeId, code: otp.sent[0]!.code, password: 'weakpass' });
    expect(r.status).toBe(400);
    expect(await hashOf(a.id)).toBe(before);
  });
});
