import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The per-IP sign-up limiter (5/hour) is not under test here; every request
// below comes from 127.0.0.1, so let it pass through.
vi.mock('../../middleware/rateLimit', async (orig) => {
  const real = await orig<typeof import('../../middleware/rateLimit')>();
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...real, signUpLimiter: pass, signInLimiter: pass, otpSendLimiter: pass };
});
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { authRouter } from '../auth.routes';
import { errorHandler } from '../../middleware/error';
import { TERMS_VERSION } from '../../lib/legal';

// features/terms-consent.md AC1 + AC6.

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
};

const token = 'x'.repeat(40);
const emailComplete = { signupToken: token, challengeId: '00000000-0000-4000-8000-000000000000', code: '123456', password: 'longenough1' };
const googleSignUp = { signupToken: token, password: 'longenough1', role: 'solo' };

describe('sign-up requires the Terms + Privacy agreement', () => {
  it('AC1: email sign-up without acceptTerms → 400 with the reason', async () => {
    const r = await post('/auth/signup/email/complete', emailComplete);
    expect(r.status).toBe(400);
    expect(r.text).toContain('Agree to the Terms of Service and Privacy Policy');
  });

  it('AC1: Google sign-up without acceptTerms → 400', async () => {
    expect((await post('/auth/google/sign-up', googleSignUp)).status).toBe(400);
  });

  it('AC1: acceptTerms false is refused too', async () => {
    expect((await post('/auth/signup/email/complete', { ...emailComplete, acceptTerms: false })).status).toBe(400);
    expect((await post('/auth/google/sign-up', { ...googleSignUp, acceptTerms: false })).status).toBe(400);
  });

  it('AC1: password sign-up without acceptTerms never creates an account', async () => {
    const r = await post('/auth/sign-up', { email: 'nobody@example.com', password: 'longenough1', name: 'N', role: 'solo' });
    expect([400, 403]).toContain(r.status);
  });

  it('control: with acceptTerms true the schema passes and the bad token is what fails', async () => {
    const r = await post('/auth/signup/email/complete', { ...emailComplete, acceptTerms: true });
    expect(r.status).toBe(401);
  });

  it('AC6: API TERMS_VERSION equals web LEGAL_VERSION', () => {
    const web = readFileSync(resolve(__dirname, '../../../../web/src/lib/legal.ts'), 'utf8');
    expect(web).toContain(`export const LEGAL_VERSION = '${TERMS_VERSION}';`);
  });
});
