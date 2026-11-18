import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Rate limiters are not under test.
vi.mock('../../middleware/rateLimit', async (orig) => {
  const real = await orig<typeof import('../../middleware/rateLimit')>();
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...real, tokenLookupLimiter: pass };
});

import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { invitationsRouter } from '../invitations.routes';
import { coCounselRouter } from '../co-counsel.routes';
import { errorHandler } from '../../middleware/error';

// Owner 2026-11-18: signing up with Google also needs a verified WhatsApp
// number AND a strong password — on every path that creates an account.
let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/invitations', invitationsRouter);
  app.use('/co-counsel', coCounselRouter);
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
const token = 'a'.repeat(32);
const routes = [`/invitations/by-token/${token}/accept`, `/co-counsel/accept/by-token/${token}`];
const base0 = { name: 'New Member', signupToken: 'x'.repeat(40) };

describe('Google sign-up through a team invite or co-counsel link needs a strong password', () => {
  it.each(routes)('%s: no password → 400', async (path) => {
    const r = await post(path, base0);
    expect(r.status).toBe(400);
    expect(r.text).toContain('password');
  });

  it.each(routes)('%s: weak password → 400 with the rule', async (path) => {
    const r = await post(path, { ...base0, password: 'longenough1' });
    expect(r.status).toBe(400);
    expect(r.text).toContain('uppercase letter, a lowercase letter, a number and a symbol');
  });

  it.each(routes)('%s: strong password passes validation; the unverified token is what fails', async (path) => {
    const r = await post(path, { ...base0, password: 'Longenough1!' });
    expect(r.status).not.toBe(400);
  });
});
