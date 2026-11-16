/**
 * features/solo-munshi.md: a Sanad / Vakalat / Brief owner can invite, list
 * and remove their Munshi (within paid Munshi seats) and nothing else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { env } from '../../env';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { invitationsRouter } from '../invitations.routes';
import { firmRouter } from '../firm.routes';
import { requireAuth } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error';
import { invalidatePermissionsCache } from '../../services/permissions.service';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/invitations', invitationsRouter);
  app.use('/firm', requireAuth, firmRouter);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const sql = () => getIntegrationSql();
const tokenFor = (u: { id: string; email: string; role: string }) =>
  jwt.sign({ sub: u.id, email: u.email, role: u.role, isSuperadmin: false }, env.JWT_SECRET, { expiresIn: '5m' });
async function call(tok: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
const mail = (k: string) => `${k}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@munshi.integration.test`;

describe('Munshi seats on Sanad / Vakalat / Brief', () => {
  it('AC1-AC6: the solo owner manages Munshi only, within paid Munshi seats', async () => {
    const firm = await seedFirm(`Solo Munshi ${Date.now()}`, 'Solo');
    await sql()`update firms set plan_status = 'active', selected_plan = 'vakalat', seats = 1, munshi_seats = 1, renews_at = now() + interval '20 days' where id = ${firm.id}::uuid`;
    const owner = await seedUser(firm.id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    invalidatePermissionsCache();
    const tok = tokenFor(owner);

    // AC1: advocates cannot be invited on a solo plan.
    const adv = await call(tok, 'POST', '/invitations', { email: mail('adv'), role: 'Associate' });
    expect(adv.status).toBe(403);
    expect(adv.json.code).toBe('munshi_only');

    // AC2: a Munshi can, into the paid seat; a second one is refused.
    const ok = await call(tok, 'POST', '/invitations', { email: mail('m1'), role: 'Munshi' });
    expect(ok.status).toBe(201);
    const over = await call(tok, 'POST', '/invitations', { email: mail('m2'), role: 'Munshi' });
    expect(over.status).toBe(402);
    expect(over.json.code).toBe('seat_cap_exceeded');

    // AC3: list shows the Munshi invite; cancel works.
    const list = await call(tok, 'GET', '/invitations');
    expect(list.status).toBe(200);
    expect(list.json.items.map((i: { role: string }) => i.role)).toEqual(['Munshi']);
    expect((await call(tok, 'DELETE', `/invitations/${ok.json.id}`)).status).toBe(204);

    // AC4: an active Munshi is listed and can be removed; non-Munshi users cannot be touched here.
    const m = await seedUser(firm.id, { role: 'Munshi', systemRole: 'Munshi' });
    const members = await call(tok, 'GET', '/firm/munshi');
    expect(members.json.items.map((x: { id: string }) => x.id)).toEqual([m.id]);
    expect((await call(tok, 'PATCH', `/firm/munshi/${owner.id}`, { status: 'deactivated' })).status).toBe(404);
    expect((await call(tok, 'PATCH', `/firm/munshi/${m.id}`, { status: 'deactivated' })).status).toBe(200);
    expect((await call(tok, 'GET', '/firm/munshi')).json.items).toEqual([]);

    // AC5: the full member admin stays closed to the solo owner.
    expect((await call(tok, 'GET', '/firm/users')).status).toBe(403);

    // AC6: a Munshi cannot invite anyone.
    const mt = tokenFor(await seedUser(firm.id, { role: 'Munshi', systemRole: 'Munshi' }));
    expect((await call(mt, 'POST', '/invitations', { email: mail('x'), role: 'Munshi' })).status).toBe(403);
  });

  it('AC7: an Associates admin still invites advocates as before', async () => {
    const firm = await seedFirm(`Assoc Invite ${Date.now()}`, 'Practice');
    await sql()`update firms set plan_status = 'active', selected_plan = 'associates', seats = 2, munshi_seats = 0, renews_at = now() + interval '20 days' where id = ${firm.id}::uuid`;
    const admin = await seedUser(firm.id, { role: 'Managing Partner', systemRole: 'Firm Admin' });
    invalidatePermissionsCache();
    const r = await call(tokenFor(admin), 'POST', '/invitations', { email: mail('a'), role: 'Associate' });
    expect(r.status).toBe(201);
  });
});
