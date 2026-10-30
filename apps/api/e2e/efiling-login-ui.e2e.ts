/**
 * eFiling starts with the portal login and, once logged in, goes straight to
 * the eFiling screen that was asked for - through the real web app (5173)
 * and the real API, with the portal itself a fixture (no account needed).
 * DB: one rolled-back transaction, as in efiling.e2e.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import type { Server } from 'node:http';

const h = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock('../src/db/client', () => ({ db: () => h.tx, closeDb: async () => {} }));
vi.mock('../src/services/jobs.service', () => ({
  jobs: { register: () => {}, start: async () => {}, enqueue: async () => null },
  ensureScheduledSyncRan: async () => {},
}));

class Rollback extends Error {}
const PORT = 4102;
const WEB = 'http://localhost:5173';
const ORIGIN = 'https://filing.ecourts.gov.in';
const fx = { lastCode: '', n: 0 };

const loginPage = `<!doctype html><html><body><form id="frm_login">
<select id="selState"><option value="">Select</option><option value="4">Kerala</option><option value="10">Tamil Nadu</option></select>
<input type="radio" id="user_advocate" name="rdoUser"><input id="user_name"><input type="password" id="user_password">
<img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a" width="150" height="50">
<input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="go()">Login</button>
<div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div></form>
<script>function go(){var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=login/verify_login/');x.onload=function(){var o=JSON.parse(x.responseText);if(o.redirect_path){location.href=o.redirect_path;return;}document.querySelector('.alert-danger4').style.display='block';document.getElementById('msg-danger4').innerHTML=o.errorMsg;};x.send('fcaptcha_code='+document.getElementById('fcaptcha_code_mobile').value);}</script>
</body></html>`;

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('securimage_show.php')) {
    fx.lastCode = `Q${++fx.n}z`;
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="10" y="32" font-size="24">${fx.lastCode}</text></svg>` });
  }
  if (req.method() === 'GET' && p === 'dashboard') {
    return route.fulfill({ contentType: 'text/html', body: `<html><body><h3>Dashboard</h3>
<div class="tile">Draft Pleadings <span>1</span></div>
<a href="#" id="efiling_activity">Draft Pleadings</a><div id="db_screen"><div id="history_body"></div></div>
<a href="https://filing.ecourts.gov.in/pdedev/?p=login/logOut">Logout</a>
<script>document.getElementById('efiling_activity').addEventListener('click',function(e){e.preventDefault();var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=dashboard/fetchActivities');x.onload=function(){document.getElementById('history_body').innerHTML=JSON.parse(x.responseText).submitted_pde_list;};x.send('');});</script>
</body></html>` });
  }
  if (p === 'dashboard/fetchActivities') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_record: 1, submitted_pde_list: '<table><thead><tr><th>Sr.No.</th><th>e-Filing Number / Case Number</th></tr></thead><tbody><tr><td>1</td><td>O.S. - C202600019</td></tr></tbody></table>' }) });
  }
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: loginPage });
  if (p === 'login/verify_login/') {
    const ok = new URLSearchParams(req.postData() ?? '').get('fcaptcha_code') === fx.lastCode;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok ? { status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` } : { status: false, errorMsg: 'Login Failed<br>Invalid captcha', duplicate_login: 0 }) });
  }
  return route.fulfill({ contentType: 'application/json', body: '{}' });
}

let raw: ReturnType<typeof postgres>;
let releaseTx: () => void;
let txDone: Promise<void>;
let server: Server;
let browser: Browser;
let page: Page;
let token: string;
let live: typeof import('../src/services/efiling-live.service');

beforeAll(async () => {
  raw = postgres(process.env['DATABASE_URL']!, { ssl: 'require', max: 1, prepare: false, onnotice: () => {} });
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
  const sql = h.tx as ReturnType<typeof postgres>;
  const [u] = await sql`select id, email, role, is_superadmin from users where name ilike 'riyaz%' and firm_id is not null limit 1`;
  token = jwt.sign({ sub: u!.id, email: u!.email, role: u!.role, isSuperadmin: !!u!.is_superadmin }, process.env['JWT_SECRET']!, { expiresIn: '30m' });

  live = await import('../src/services/efiling-live.service');
  live.__testing.setContextHook(async (context: BrowserContext) => { await context.route(`${ORIGIN}/**`, serve); });
  const { createApp } = await import('../src/app');
  server = createApp().listen(PORT);

  browser = await chromium.launch({ headless: true });
  const me = await (await fetch(`http://localhost:${PORT}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } })).json();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([t, usr]) => {
    localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: usr, token: t, actAs: null, previousSession: null }, version: 0 }));
  }, [token, (me as { user?: unknown }).user ?? me] as const);
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/stream')) return route.abort();
    try { await route.fulfill({ response: await route.fetch({ url: `http://localhost:${PORT}${url.pathname}${url.search}` }) }); } catch { await route.abort().catch(() => {}); }
  });
});

afterEach(async (ctx) => {
  if (ctx.task.result?.state === 'fail' && page && process.env['E2E_SHOTS']) {
    await page.screenshot({ path: `${process.env['E2E_SHOTS']}/FAIL-login-ui-${ctx.task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`, fullPage: true }).catch(() => {});
  }
});

afterAll(async () => {
  live?.__testing.setContextHook(null);
  await browser?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  releaseTx?.();
  await txDone;
  await raw.end();
});

describe('eFiling login, then straight to the eFiling features', () => {
  it('a requested eFiling screen asks for the portal login first, then opens that screen', async () => {
    await page.goto(`${WEB}/app/efiling?m=filings`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'eFiling Services · Sign In' }).waitFor({ timeout: 30_000 });
    const states = page.locator('select').filter({ hasText: 'Select state' });
    await states.selectOption({ label: 'Kerala' });
    await page.locator('label', { hasText: 'Bar Code / Email / Mobile / Unique Code' }).locator('input').fill('adv@example.com');
    await page.locator('label', { hasText: 'Password' }).locator('input').fill('Secret@123');
    await page.getByRole('button', { name: /Log in to eFiling/ }).click();
    await page.getByAltText('eFiling captcha').waitFor({ timeout: 60_000 });
    await page.getByPlaceholder('Captcha code').fill(fx.lastCode);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();

    // Straight into eFiling - the screen that was asked for, connected.
    await page.getByText('Connected to filing.ecourts.gov.in as').waitFor({ timeout: 60_000 });
    await page.getByRole('navigation', { name: 'eFiling menu' }).waitFor();
    expect(new URL(page.url()).searchParams.get('m')).toBe('filings');
    expect(await page.getByRole('heading', { name: 'eFiling Services · Sign In' }).count()).toBe(0);
  });

  it("the eFiling Dashboard is then the portal's own: its tiles, its numbers, its list", async () => {
    await page.goto(`${WEB}/app/efiling`, { waitUntil: 'domcontentloaded' });
    await page.getByText('From your account on filing.ecourts.gov.in').waitFor({ timeout: 60_000 });
    for (const t of ['Draft Pleadings', 'Completed Pleadings', 'Draft IAs', 'Completed IAs', 'Objections', 'My Cases']) {
      await page.locator('button.card', { hasText: t }).first().waitFor();
    }
    await page.getByRole('cell', { name: 'O.S. - C202600019' }).waitFor({ timeout: 60_000 });
    expect((await page.locator('button.card', { hasText: 'Draft Pleadings' }).first().innerText()).split('\n')[1]).toBe('1');
    if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/efiling-portal-dashboard.png`, fullPage: true });
  });

  it('after "Log out of eFiling" the next login remembers state and username (never the password)', async () => {
    await page.getByRole('button', { name: 'Log out of eFiling' }).click();
    await page.getByRole('heading', { name: 'eFiling Services · Sign In' }).waitFor({ timeout: 30_000 });
    expect(await page.locator('select').filter({ hasText: 'Select state' }).inputValue()).not.toBe('');
    expect(await page.locator('label', { hasText: 'Bar Code / Email / Mobile / Unique Code' }).locator('input').inputValue()).toBe('adv@example.com');
    expect(await page.locator('label', { hasText: 'Password' }).locator('input').inputValue()).toBe('');
  });
});
