/**
 * Case page x eCourts - a linked matter opens on its eCourts status (Overview
 * snapshot) and carries the full eCourts record on its own tab; an unlinked
 * one offers to connect. Real UI + real API against the LIVE database inside
 * ONE rolled-back transaction (same harness as efiling.e2e.ts); eCourts is
 * stubbed with a fixed record.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import { chromium, type Browser, type Page } from 'playwright';
import type { Server } from 'node:http';

const h = vi.hoisted(() => ({ tx: null as unknown }));
const CNR = 'KLAL170000572026';

vi.mock('../src/db/client', () => ({ db: () => h.tx, closeDb: async () => {} }));
vi.mock('../src/services/jobs.service', () => ({
  jobs: { register: () => {}, start: async () => {}, enqueue: async () => null },
  ensureScheduledSyncRan: async () => {},
}));
vi.mock('../src/services/ecourts.service', async (orig) => {
  const real = await orig<typeof import('../src/services/ecourts.service')>();
  const order = (date: string, details: string) => ({
    order_id: '1', order_date1f: date, order_details: details, filename: '', caseno: 'OS/57/2026', cCode: 17, appFlag: '', state_cd: 4, dist_cd: 6, court_code: 17, bilingual_flag: '0',
  });
  const hearing = (date: string, purpose: string) => ({
    cino: CNR, case_number: 'OS/57/2026', purpose, judge_name: 'Munsiff', todays_date: date, todays_date1: date, nextdate: '', businessStatus: '', court_code: 17, court_no: '1', dist_code: 6, state_code: 4, showbusiness: 'N',
  });
  return {
    ...real,
    lookupByCnr: async (cino: string) => (cino.toUpperCase() !== CNR ? null : {
      cino: CNR, case_no: '200570000572026', filing_no: '100/2026', date_of_filing: '2026-01-10', dt_regis: '2026-01-12',
      date_first_list: '2026-02-01', date_next_list: '2026-11-05', reg_no: 57, reg_year: 2026, fil_no: 100, fil_year: 2026,
      type_name: 'O.S.', pet_name: 'E2E Ramesh Kumar', pet_adv: 'Adv. Anil', res_name: 'Suresh Babu', res_adv: 'Adv. Meera',
      fir_no: '', fir_year: 0, police_st_code: 0, purpose_name: 'Evidence', court_name: 'Munsiff Court, Chengannur',
      est_code: 'KLAL17', state_code: 4, state_name: 'Kerala', district_code: 6, district_name: 'Alappuzha', desgname: '1-Munsiff',
      desgcode: 1, jcode: 1, court_code: 17, version: '1',
      historyOfCaseHearing: [hearing('01-09-2026', 'Appearance'), hearing('01-10-2026', 'Written Statement')],
      interimOrder: [order('01-09-2026', 'Notice issued'), order('01-10-2026', 'Interim injunction granted')],
      finalOrder: [],
    }),
  };
});

class Rollback extends Error {}
const pollFor = <T>(fn: () => Promise<T> | T) => expect.poll(fn, { timeout: 20_000, interval: 250 });
const PORT = 4101;
const WEB = 'http://localhost:5173';

let raw: ReturnType<typeof postgres>;
let releaseTx: () => void;
let txDone: Promise<void>;
let server: Server;
let browser: Browser;
let page: Page;
let token: string;
let linkedId: string;
let unlinkedId: string;

async function api<T = Record<string, unknown>>(method: string, path: string): Promise<{ status: number; body: T }> {
  const r = await fetch(`http://localhost:${PORT}/api${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as T };
}

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
  const [u] = await sql`select id, email, role, is_superadmin, firm_id from users where name ilike 'riyaz%' and firm_id is not null limit 1`;
  token = jwt.sign({ sub: u!.id, email: u!.email, role: u!.role, isSuperadmin: !!u!.is_superadmin }, process.env['JWT_SECRET']!, { expiresIn: '30m' });
  const [a] = await sql`
    insert into cases (firm_id, cnr, title, court, stage, client, type, ecourts_link_status, ecourts_court_tier, created_by_user_id)
    values (${u!.firm_id}, ${CNR}, 'E2E Ramesh Kumar v. Suresh Babu', 'Munsiff Court, Chengannur', 'Filing', 'Ramesh Kumar', 'Civil', 'linked', 'DC', ${u!.id})
    returning id`;
  linkedId = a!.id;
  const [b] = await sql`
    insert into cases (firm_id, cnr, title, court, stage, client, type, created_by_user_id)
    values (${u!.firm_id}, ${'TEMP-E2E-' + Date.now()}, 'E2E parking issue', 'High Court of Madras', 'Filing', 'Ramesh', 'Civil', ${u!.id})
    returning id`;
  unlinkedId = b!.id;

  const { createApp } = await import('../src/app');
  server = createApp().listen(PORT);
  browser = await chromium.launch({ headless: true });
  const me = await api<{ user?: unknown }>('GET', '/auth/me');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([t, usr]) => {
    localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: usr, token: t, actAs: null, previousSession: null }, version: 0 }));
  }, [token, me.body.user ?? me.body] as const);
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/stream')) return route.abort();
    try {
      const res = await route.fetch({ url: `http://localhost:${PORT}${url.pathname}${url.search}` });
      await route.fulfill({ response: res });
    } catch {
      await route.abort().catch(() => {});
    }
  });
});

afterEach(async (ctx) => {
  if (ctx.task.result?.state === 'fail' && page) {
    const name = ctx.task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
    await page.screenshot({ path: `${process.env['E2E_SHOTS'] ?? '.e2e-shots'}/FAIL-${name}.png`, fullPage: true }).catch(() => {});
  }
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  releaseTx?.();
  await txDone;
  const [left] = await raw`select count(*)::int as n from cases where cnr = ${CNR} or cnr like 'TEMP-E2E-%'`;
  await raw.end();
  console.log('ROLLBACK CHECK:', left!.n === 0 ? 'clean - nothing left in the database' : `LEFTOVER cases=${left!.n}`);
  expect(left!.n).toBe(0);
});

describe('Case page x eCourts', () => {
  it('a linked matter opens on its eCourts status: next date, stage, judge, latest order', async () => {
    await page.goto(`${WEB}/app/cases/${linkedId}`, { waitUntil: 'domcontentloaded' });
    const snap = page.locator('#ecourts-snapshot');
    await snap.getByText('05-11-2026').waitFor({ timeout: 30_000 });
    await snap.getByText('PENDING').first().waitFor();
    await snap.getByText('Evidence').first().waitFor();
    await snap.getByText('1-Munsiff').first().waitFor();
    await snap.getByText('O.S./57/2026').first().waitFor();
    await snap.getByText('01-10-2026 · Interim injunction granted').first().waitFor();
    await snap.getByText('01-10-2026 · Written Statement').first().waitFor();
    if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/case-ecourts-overview.png`, fullPage: true });
  });

  it('"Full eCourts record" opens the eCourts tab with the app\'s Case History sections', async () => {
    await page.getByRole('button', { name: 'Full eCourts record →' }).click();
    await pollFor(() => page.getByRole('tab', { name: 'eCourts' }).getAttribute('aria-selected')).toBe('true');
    expect(new URL(page.url()).searchParams.get('tab')).toBe('ecourts');
    await page.getByRole('heading', { name: 'Case History' }).waitFor({ timeout: 30_000 });
    for (const section of ['Case Details', 'Case Status', 'History of Case Hearing']) {
      await page.getByRole('button', { name: new RegExp(section) }).first().first().waitFor();
    }
    // It already is the matter: no "Add Case" / "In My Cases".
    expect(await page.getByRole('button', { name: /Add Case|In My Cases/ }).count()).toBe(0);
    if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/case-ecourts-tab.png`, fullPage: true });
  });

  it('an unlinked (TEMP-) matter has no eCourts tab and offers to connect', async () => {
    await page.goto(`${WEB}/app/cases/${unlinkedId}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Not connected to eCourts').waitFor({ timeout: 30_000 });
    expect(await page.getByRole('tab', { name: 'eCourts' }).count()).toBe(0);
    await page.getByRole('button', { name: 'Connect to eCourts' }).click();
    await pollFor(() => page.locator('#ecourts-connection').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; })).toBe(true);
  });
});
