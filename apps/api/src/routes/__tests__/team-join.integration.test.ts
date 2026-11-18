/**
 * Team join, Teams-style (build-docs/features/team-join.md): join with email +
 * password, and an existing DifAi user joining a firm. Real Postgres + HTTP;
 * WhatsApp and the email MX check are stubbed.
 */
import { vi } from 'vitest';

const otp = vi.hoisted(() => ({ last: new Map<string, string>() }));
vi.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendOtp: async (phone: string, code: string) => { otp.last.set(phone, code); },
    sendTemplate: async () => undefined,
  },
}));
vi.mock('../../services/jobs.service', () => ({
  jobs: { enqueue: async () => 'job', register: () => undefined, start: async () => undefined },
}));
vi.mock('../../lib/email-check', async (orig) => ({ ...(await orig<object>()), assertDeliverableEmail: async () => undefined }));

import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { invitationsRouter } from '../invitations.routes';
import { authRouter } from '../auth.routes';
import { errorHandler } from '../../middleware/error';
import { authService } from '../../services/auth.service';
import { invitationsService } from '../../services/invitations.service';

const sql = () => getIntegrationSql();
let server: Server;
let base = '';
beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use('/invitations', invitationsRouter);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
};

let n = 0;
const uniq = () => `${Date.now()}-${++n}`;
const phoneFor = () => `+9197${String(Date.now() + n).slice(-8)}`;

/** A paid Chambers firm (3 advocate seats) with its Managing Partner. */
async function paidFirm() {
  const firm = await seedFirm(`Chambers ${uniq()}`, 'Practice');
  await sql()`update firms set plan_status = 'active', selected_plan = 'chambers', seats = 3, renews_at = now() + interval '20 days' where id = ${firm.id}::uuid`;
  const owner = await seedUser(firm.id, { role: 'Managing Partner', systemRole: 'Firm Admin' });
  await sql()`update users set onboarded_at = now() where firm_id = ${firm.id}::uuid`;
  return { firm, owner };
}
async function invite(firmId: string, owner: { id: string; email: string }, email: string, role = 'Associate') {
  const inv = await invitationsService.create({ email, role } as never, { id: owner.id, name: 'Owner', email: owner.email }, firmId);
  return inv.token;
}
const userRow = async (email: string) =>
  (await sql()<{ id: string; firm_id: string; role: string; google_sub: string | null; phone: string | null }[]>`
    select id, firm_id, role, google_sub, phone from users where lower(email) = ${email.toLowerCase()}`)[0];

describe('join with email + password (no Google)', () => {
  it('AC1: invite -> WhatsApp code -> strong password -> member of the firm with the invite role', async () => {
    const { firm, owner } = await paidFirm();
    const email = `asha-${uniq()}@firm-no-google.test`;
    const token = await invite(firm.id, owner, email, 'Senior Associate');
    const phone = phoneFor();
    const start = await call('POST', `/invitations/by-token/${token}/email/start`, { name: 'Asha Rao', phone: phone.slice(3) });
    expect(start.status).toBe(200);
    const res = await call('POST', `/invitations/by-token/${token}/email/accept`, {
      signupToken: start.body.signupToken, challengeId: start.body.challengeId, code: otp.last.get(phone), password: 'Strong#Pass9',
    });
    expect(res.status).toBe(201);
    const u = await userRow(email);
    expect(u).toMatchObject({ firm_id: firm.id, role: 'Senior Associate', google_sub: null, phone });
    const [inv] = await sql()<{ status: string }[]>`select status from invitations where token = ${token}`;
    expect(inv!.status).toBe('accepted');
    // the new member signs in with the password
    expect((await call('POST', '/auth/sign-in', { email, password: 'Strong#Pass9' })).status).toBe(200);
  });

  it('AC2: wrong code, weak password, or an email that already has an account are refused', async () => {
    const { firm, owner } = await paidFirm();
    const email = `ravi-${uniq()}@firm-no-google.test`;
    const token = await invite(firm.id, owner, email);
    const phone = phoneFor();
    const start = await call('POST', `/invitations/by-token/${token}/email/start`, { name: 'Ravi', phone: phone.slice(3) });
    const code = otp.last.get(phone)!;
    const wrong = code === '000000' ? '111111' : '000000';
    expect((await call('POST', `/invitations/by-token/${token}/email/accept`, { signupToken: start.body.signupToken, challengeId: start.body.challengeId, code: wrong, password: 'Strong#Pass9' })).status).toBe(401);
    expect((await call('POST', `/invitations/by-token/${token}/email/accept`, { signupToken: start.body.signupToken, challengeId: start.body.challengeId, code, password: 'weakpass' })).status).toBe(400);
    expect(await userRow(email)).toBeUndefined();

    // existing account -> email path refused at start (they use "sign in and join")
    const other = await seedUser((await seedFirm(`Solo ${uniq()}`, 'Solo')).id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    const t2 = await invite(firm.id, owner, other.email);
    expect((await call('POST', `/invitations/by-token/${t2}/email/start`, { name: 'X', phone: phoneFor().slice(3) })).status).toBe(409);
  });
});

describe('existing DifAi user joins a firm', () => {
  it('AC3: account moves to the firm with the invite role; old workspace rows stay; new session works', async () => {
    const { firm, owner } = await paidFirm();
    const solo = await seedFirm(`Solo ${uniq()}`, 'Solo');
    const me = await seedUser(solo.id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    const [matter] = await sql()<{ id: string }[]>`insert into cases (firm_id, cnr, title, court, stage, client, status, type) values (${solo.id}::uuid, 'CNR-TEAMJOIN-1', 'My own matter', 'Madras HC', 'Filing', 'Client', 'Active', 'Civil') returning id`;
    const token = await invite(firm.id, owner, me.email);
    const session = await authService.sessionFor(me.id);

    const res = await call('POST', `/invitations/by-token/${token}/join`, undefined, session.token);
    expect(res.status).toBe(200);
    expect((res.body.user as { role: string }).role).toBe('Associate');
    expect(await userRow(me.email)).toMatchObject({ firm_id: firm.id, role: 'Associate' });
    const [still] = await sql()<{ firm_id: string }[]>`select firm_id from cases where id = ${matter!.id}::uuid`;
    expect(still!.firm_id).toBe(solo.id); // old matter not moved into the firm
    const me2 = await call('GET', '/auth/me', undefined, res.body.token as string);
    expect(me2.status).toBe(200);
    // the link is used up
    expect((await call('POST', `/invitations/by-token/${token}/join`, undefined, res.body.token as string)).status).toBe(409);
  });

  it('AC4: refused for another email, a superadmin, an expired invite, a full firm, or a sole admin leaving a team', async () => {
    const { firm, owner } = await paidFirm();
    // room for the several pending invites below (pending invites hold seats)
    await sql()`update firms set seats = 8 where id = ${firm.id}::uuid`;
    const solo = await seedFirm(`Solo ${uniq()}`, 'Solo');
    const me = await seedUser(solo.id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    const someoneElse = await seedUser(solo.id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    const join = async (token: string, userId: string) =>
      call('POST', `/invitations/by-token/${token}/join`, undefined, (await authService.sessionFor(userId)).token);

    // signed in as a different email
    const t1 = await invite(firm.id, owner, me.email);
    expect((await join(t1, someoneElse.id)).status).toBe(403);

    // superadmin
    const admin = await seedUser(solo.id, { isSuperadmin: true });
    const t2 = await invite(firm.id, owner, admin.email);
    expect((await join(t2, admin.id)).status).toBe(403);

    // expired
    await sql()`update invitations set expires_at = now() - interval '1 day' where token = ${t1}`;
    expect((await join(t1, me.id)).status).toBe(410);

    // sole Firm Admin of a team that still has members
    const { firm: teamB, owner: ownerB } = await paidFirm();
    await seedUser(teamB.id, { role: 'Associate', systemRole: 'Associate' });
    const t3 = await invite(firm.id, owner, ownerB.email);
    const r3 = await join(t3, ownerB.id);
    expect(r3.status).toBe(409);
    expect(String(r3.body.error ?? r3.body.message)).toMatch(/only admin/);

    // firm full: 3 seats, owner + 2 more invites accepted leaves none
    const { firm: full, owner: ownerF } = await paidFirm();
    await seedUser(full.id, { role: 'Associate', systemRole: 'Associate' });
    const t4 = await invite(full.id, ownerF, me.email);
    await seedUser(full.id, { role: 'Associate', systemRole: 'Associate' });
    expect((await join(t4, me.id)).status).toBe(402);
    expect((await userRow(me.email))!.firm_id).toBe(solo.id);
  });
});
