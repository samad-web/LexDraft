/**
 * Member invitations - presets, the "Other" custom role, resend, accept, and
 * the invited member's permissions - through the real API (and the real
 * invite dialog), against the LIVE database inside ONE rolled-back transaction.
 *
 *   pnpm --filter @lexdraft/api exec vitest run --config e2e/vitest.e2e.config.ts invitations
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import { chromium, type Browser, type Page } from 'playwright';
import type { Server } from 'node:http';

const h = vi.hoisted(() => ({
  tx: null as unknown,
  jobs: [] as Array<{ name: string; data: Record<string, unknown> }>,
}));

vi.mock('../src/db/client', () => ({ db: () => h.tx, closeDb: async () => {} }));
vi.mock('../src/services/jobs.service', () => ({
  jobs: {
    register: () => {},
    start: async () => {},
    enqueue: async (name: string, data: Record<string, unknown>) => { h.jobs.push({ name, data }); return null; },
  },
  ensureScheduledSyncRan: async () => {},
}));

class Rollback extends Error {}
const PORT = 4101;
const WEB = 'http://localhost:5173';
const TABLES = ['invitations', 'roles', 'users', 'firms'];

let raw: ReturnType<typeof postgres>;
let releaseTx: () => void;
let txDone: Promise<void>;
let server: Server;
let browser: Browser | undefined;
let page: Page | undefined;
let adminToken: string;
let firmId: string;
const before: Record<string, number> = {};
const tag = Date.now().toString(36);
const sql = () => h.tx as ReturnType<typeof postgres>;

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, token = adminToken) {
  const r = await fetch(`http://localhost:${PORT}/api${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as T };
}

/** Features the resolver grants a user (what the sidebar and route gates use). */
async function featuresOf(token: string): Promise<string[]> {
  const r = await call<{ features: string[] }>('GET', '/me/features', undefined, token);
  return r.body.features ?? [];
}

/** What a role id grants on the Firm plan, straight from the tables. */
async function expectedFor(systemRole: string): Promise<string[]> {
  const rows = await sql()<Array<{ feature_key: string }>>`
    select rf.feature_key from role_features rf
    join roles r on r.id = rf.role_id and r.firm_id is null and r.is_system and r.name = ${systemRole}
    join plan_features pf on pf.feature_key = rf.feature_key and pf.plan_tier = 'Firm' and pf.enabled
    where rf.enabled`;
  return rows.map((r) => r.feature_key);
}

async function accept(token: string, name: string) {
  return call<{ token: string; user: { role: string } }>('POST', `/invitations/by-token/${token}/accept`, { name, password: 'Passw0rd!long' }, '');
}

beforeAll(async () => {
  raw = postgres(process.env['DATABASE_URL']!, { ssl: 'require', max: 1, prepare: false, onnotice: () => {} });
  for (const t of TABLES) before[t] = (await raw.unsafe(`select count(*)::int as n from ${t}`))[0]!.n as number;

  let ready!: () => void;
  const isReady = new Promise<void>((r) => { ready = r; });
  const release = new Promise<void>((r) => { releaseTx = r; });
  txDone = raw.begin(async (tx) => {
    h.tx = new Proxy(tx, {
      get: (target, prop) => (prop === 'begin' ? (fn: (s: unknown) => unknown) => target.savepoint(fn as never) : (target as never)[prop]),
      apply: (target, thisArg, args) => Reflect.apply(target as never, thisArg, args),
    });
    ready();
    await release;
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; }) as Promise<void>;
  await isReady;

  const [f] = await sql()`
    insert into firms (name, plan_tier, plan_status, seats)
    values (${'E2E Invite Firm ' + tag}, 'Firm', 'active', 50) returning id`;
  firmId = f!.id;
  const [admin] = await sql()`
    insert into users (firm_id, name, email, role, role_id, password_hash, status)
    values (${firmId}, 'E2E Admin', ${`e2e-admin-${tag}@test.invalid`}, 'Managing Partner',
            (select id from roles where firm_id is null and is_system and name = 'Firm Admin'), 'x', 'active')
    returning id, email`;
  adminToken = jwt.sign({ sub: admin!.id, email: admin!.email, role: 'Managing Partner', isSuperadmin: false }, process.env['JWT_SECRET']!, { expiresIn: '30m' });

  const { createApp } = await import('../src/app');
  server = createApp().listen(PORT);
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  releaseTx?.();
  await txDone;
  const leftover: string[] = [];
  for (const t of TABLES) {
    const n = (await raw.unsafe(`select count(*)::int as n from ${t}`))[0]!.n as number;
    if (n !== before[t]) leftover.push(`${t}: before ${before[t]}, after ${n}`);
  }
  await raw.end();
  expect(leftover, 'rolled back - nothing left behind').toEqual([]);
});

describe('preset roles', () => {
  for (const [preset, systemRole] of [
    ['Associate', 'Associate'],
    ['Senior Associate', 'Senior Associate'],
    ['Junior Associate', 'Associate'],
    ['Of Counsel', 'Senior Associate'],
    ['Paralegal', 'Paralegal'],
    ['Managing Partner', 'Firm Admin'],
  ] as const) {
    it(`${preset}: invite, accept, and get ${systemRole} access`, async () => {
      const email = `e2e-${preset.replace(/\W/g, '').toLowerCase()}-${tag}@test.invalid`;
      const inv = await call<{ token: string; role: string; emailSent: boolean }>('POST', '/invitations', { email, role: preset });
      expect(inv.status).toBe(201);
      expect(inv.body.role).toBe(preset);
      expect(inv.body.emailSent).toBe(false); // no SMTP in this environment

      const pub = await call<{ role: string }>('GET', `/invitations/by-token/${inv.body.token}`, undefined, '');
      expect(pub.body.role).toBe(preset);

      const acc = await accept(inv.body.token, `E2E ${preset}`);
      expect(acc.status).toBe(201);
      expect(acc.body.user.role).toBe(preset);
      const [u] = await sql()`select r.name from users u join roles r on r.id = u.role_id where lower(u.email) = ${email}`;
      expect(u?.name, 'role_id set (was null before the fix)').toBe(systemRole);
      const got = await featuresOf(acc.body.token);
      for (const f of await expectedFor(systemRole)) expect(got).toContain(f);
      expect(got).toContain('matter.view');
    });
  }
});

describe('"Other" custom role', () => {
  it('rejects Other without a name or access level', async () => {
    expect((await call('POST', '/invitations', { email: `e2e-x-${tag}@test.invalid`, role: 'Other' })).status).toBe(400);
    expect((await call('POST', '/invitations', { email: `e2e-x-${tag}@test.invalid`, role: 'Other', customRoleName: 'Clerk' })).status).toBe(400);
    expect((await call('POST', '/invitations', { email: `e2e-x-${tag}@test.invalid`, role: 'Other', customRoleName: 'Clerk', accessLevel: 'Firm Admin' })).status).toBe(400);
  });

  it('creates a named firm role that inherits the chosen access', async () => {
    const email = `e2e-office-${tag}@test.invalid`;
    const inv = await call<{ token: string; role: string }>('POST', '/invitations', {
      email, role: 'Other', customRoleName: '  Office   Manager ', accessLevel: 'Paralegal',
    });
    expect(inv.status).toBe(201);
    expect(inv.body.role).toBe('Office Manager');
    const roles = await sql()`select name, is_system, (select name from roles b where b.id = r.base_role_id) as base from roles r where firm_id = ${firmId}`;
    expect(roles).toEqual([{ name: 'Office Manager', is_system: false, base: 'Paralegal' }]);

    const acc = await accept(inv.body.token, 'E2E Office Manager');
    expect(acc.status).toBe(201);
    expect(acc.body.user.role).toBe('Office Manager');
    const got = await featuresOf(acc.body.token);
    const want = await expectedFor('Paralegal');
    for (const f of want) expect(got).toContain(f);
    // Not more than a Paralegal: nothing Partner-only leaks in.
    const partnerOnly = (await expectedFor('Partner')).filter((f) => !want.includes(f));
    for (const f of partnerOnly) expect(got).not.toContain(f);
  });

  it('reuses the firm role for a second invite with the same name (any case)', async () => {
    const inv = await call<{ role: string }>('POST', '/invitations', {
      email: `e2e-office2-${tag}@test.invalid`, role: 'Other', customRoleName: 'office manager', accessLevel: 'Intern',
    });
    expect(inv.status).toBe(201);
    const roles = await sql()`select name from roles where firm_id = ${firmId}`;
    expect(roles.length).toBe(1);
  });

  it('a preset name typed into Other becomes that preset', async () => {
    const inv = await call<{ role: string }>('POST', '/invitations', {
      email: `e2e-assoc2-${tag}@test.invalid`, role: 'Other', customRoleName: 'Associate', accessLevel: 'Intern',
    });
    expect(inv.status).toBe(201);
    expect(inv.body.role).toBe('Associate');
  });

  it('refuses a built-in role name that is not a preset (e.g. Firm Admin)', async () => {
    const r = await call<{ error: string }>('POST', '/invitations', {
      email: `e2e-fa-${tag}@test.invalid`, role: 'Other', customRoleName: 'Intern', accessLevel: 'Partner',
    });
    expect(r.status).toBe(400);
  });
});

describe('resend + email', () => {
  it('resend keeps the shared link working and extends the expiry', async () => {
    const inv = await call<{ id: string; token: string; expiresAt: string }>('POST', '/invitations', { email: `e2e-resend-${tag}@test.invalid`, role: 'Associate' });
    await sql()`update invitations set expires_at = now() + interval '1 day' where id = ${inv.body.id}`;
    const r = await call<{ token: string; expiresAt: string; emailSent: boolean }>('POST', `/invitations/${inv.body.id}/resend`);
    expect(r.status).toBe(200);
    expect(r.body.token).toBe(inv.body.token);
    expect(new Date(r.body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await call('GET', `/invitations/by-token/${inv.body.token}`, undefined, '')).status).toBe(200);
  });

  it('cancel works and kills the link', async () => {
    const inv = await call<{ id: string; token: string }>('POST', '/invitations', { email: `e2e-cancel-${tag}@test.invalid`, role: 'Associate' });
    expect((await call('DELETE', `/invitations/${inv.body.id}`)).status).toBe(204);
    expect((await call('GET', `/invitations/by-token/${inv.body.token}`, undefined, '')).status).toBe(409);
  });

  it('emails the link when SMTP is configured', async () => {
    const { env } = await import('../src/env');
    const prev = env.hasSmtp;
    (env as { hasSmtp: boolean }).hasSmtp = true;
    h.jobs.length = 0;
    try {
      const email = `e2e-mail-${tag}@test.invalid`;
      const inv = await call<{ token: string; emailSent: boolean }>('POST', '/invitations', { email, role: 'Paralegal', message: 'Welcome!' });
      expect(inv.body.emailSent).toBe(true);
      const mail = h.jobs.find((j) => j.name === 'email.send');
      expect(mail?.data['to']).toBe(email);
      expect(String(mail?.data['body'])).toContain(`/invite/${inv.body.token}`);
      expect(String(mail?.data['body'])).toContain('Welcome!');
      // Sent on the inviter's behalf: their name as sender, replies to them.
      expect(mail?.data['fromName']).toBe('E2E Admin (via LexDraft)');
      expect(mail?.data['replyTo']).toBe(`e2e-admin-${tag}@test.invalid`);
    } finally {
      (env as { hasSmtp: boolean }).hasSmtp = prev;
    }
  });
});

describe('backfill migration 0092', () => {
  it('fills role_id for members who joined without one, and nothing else', async () => {
    const [orphan] = await sql()`
      insert into users (firm_id, name, email, role, password_hash, status)
      values (${firmId}, 'E2E Orphan', ${`e2e-orphan-${tag}@test.invalid`}, 'Paralegal', 'x', 'active') returning id`;
    const [kept] = await sql()`
      insert into users (firm_id, name, email, role, role_id, password_hash, status)
      values (${firmId}, 'E2E Kept', ${`e2e-kept-${tag}@test.invalid`}, 'Paralegal',
              (select id from roles where firm_id is null and is_system and name = 'Intern'), 'x', 'active') returning id`;
    await sql().unsafe(readFileSync(resolve(__dirname, '..', 'migrations', '0092_invited_member_roles.sql'), 'utf8'));
    const rows = await sql()`select u.id, r.name from users u left join roles r on r.id = u.role_id where u.id in (${orphan!.id}, ${kept!.id})`;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.name]));
    expect(byId[orphan!.id]).toBe('Paralegal');
    expect(byId[kept!.id], 'an admin-set role is never overwritten').toBe('Intern');
  });
});

describe('invite dialog (browser)', () => {
  it('Other role + link shown when email is not set up', async () => {
    const reachable = await fetch(WEB).then((r) => r.ok).catch(() => false);
    if (!reachable) { console.log('web app not running on 5173 - skipping browser check'); return; }
    browser = await chromium.launch({ headless: true });
    const me = await call<{ user?: unknown }>('GET', '/auth/me');
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
    await ctx.addInitScript(([t, usr]) => {
      localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: usr, token: t, actAs: null, previousSession: null }, version: 0 }));
    }, [adminToken, me.body.user ?? me.body] as const);
    page = await ctx.newPage();
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/stream')) return route.abort();
      try {
        const res = await route.fetch({ url: `http://localhost:${PORT}${url.pathname}${url.search}` });
        await route.fulfill({ response: res });
      } catch { await route.abort().catch(() => {}); }
    });

    await page.goto(`${WEB}/app/members`);
    await page.getByRole('button', { name: /Invite member/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Work email').fill(`e2e-ui-${tag}@test.invalid`);
    await dialog.getByRole('button', { name: 'Other', exact: true }).click();
    await dialog.getByLabel('Role name').fill('Court Clerk');
    await dialog.getByLabel('Access level').selectOption('Legal Secretary');
    await expect.poll(() => dialog.getByText('with the same access as Legal Secretary').count()).toBe(1);
    if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/invite-other.png` });
    await dialog.getByRole('button', { name: 'Create invitation' }).click();

    await expect.poll(() => dialog.getByRole('heading', { name: 'Invitation ready' }).count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => dialog.getByText(/from your own email/).count()).toBe(1);
    // "Send from my email" composes in the inviter's own mail app.
    const mailto = await dialog.getByRole('link', { name: 'Send from my email' }).getAttribute('href');
    expect(mailto).toMatch(/^mailto:e2e-ui-/);
    expect(decodeURIComponent(mailto!)).toContain('/invite/');
    const gmail = await dialog.getByRole('link', { name: 'Open in Gmail' }).getAttribute('href');
    expect(gmail).toContain(`authuser=${encodeURIComponent(`e2e-admin-${tag}@test.invalid`)}`);
    const link = await dialog.getByLabel(/Invitation link/).inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/);
    expect(await dialog.getByRole('link', { name: 'Share on WhatsApp' }).getAttribute('href')).toContain(encodeURIComponent(link));
    if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/invite-ready.png` });

    const [row] = await sql()`select role from invitations where email = ${`e2e-ui-${tag}@test.invalid`}`;
    expect(row?.role).toBe('Court Clerk');
  });
});
