/**
 * Land Records (eservices.tn.gov.in) - every service, every route, the UI,
 * and how long each step takes. Runs against the LIVE site and the LIVE
 * database inside ONE transaction that is rolled back.
 *
 *   - db() is a transaction-bound handle; afterAll rolls it back and checks
 *     tn_land_applications / documents / title_report_searches are unchanged
 *   - file storage is in memory; the job queue only records
 *   - the Land Records site is NOT stubbed: every service opens the real site
 *     and walks its real lists up to the gate. No OTP is ever requested (it
 *     would text a real phone) and no captcha is solved - a deliberately
 *     wrong captcha checks the "try the new one" path.
 *   - filing a result uses a sample result loaded into a live session
 *     (a real one needs an OTP).
 * The browser runs the real web app (localhost:5173), /api re-routed here.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import { chromium, type Browser, type Page } from 'playwright';
import type { Server } from 'node:http';

const h = vi.hoisted(() => ({
  tx: null as unknown,
  files: new Map<string, { body: Buffer; contentType: string }>(),
}));

vi.mock('../src/db/client', () => ({ db: () => h.tx, closeDb: async () => {} }));
vi.mock('../src/services/jobs.service', () => ({
  jobs: { register: () => {}, start: async () => {}, enqueue: async () => null },
  ensureScheduledSyncRan: async () => {},
}));
vi.mock('../src/services/storage.service', () => ({
  storage: () => ({
    putObject: async ({ key, body, contentType }: { key: string; body: Buffer; contentType: string }) => { h.files.set(key, { body, contentType }); },
    getObject: async (key: string) => h.files.get(key) ?? null,
    delete: async (key: string) => { h.files.delete(key); },
    presignUpload: async () => { throw new Error('not used'); },
    presignDownload: async ({ key }: { key: string }) => ({ url: `memory://${key}`, expiresAt: new Date().toISOString() }),
  }),
  verifyLocalUploadUrl: () => false,
}));

class Rollback extends Error {}
const PORT = 4101;
const WEB = 'http://localhost:5173';
const TABLES = ['tn_land_applications', 'documents', 'title_report_searches'];

let raw: ReturnType<typeof postgres>;
let releaseTx: () => void;
let txDone: Promise<void>;
let server: Server;
let browser: Browser;
let page: Page;
let token: string;
let otherToken: string;
let firmId: string;
let caseId: string;
let caseTitle: string;
let titleReportId: string | null = null;
const before: Record<string, number> = {};
const timings: Array<[string, number]> = [];

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown, tok = token): Promise<{ status: number; body: T; ms: number }> {
  const t0 = Date.now();
  const r = await fetch(`http://localhost:${PORT}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: unknown = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: r.status, body: parsed as T, ms: Date.now() - t0 };
}
const time = (label: string, ms: number) => { timings.push([label, ms]); };

type Opt = { value: string; label: string };
type Start = { sessionId: string; gate: string; form: string; districts: Opt[]; captchaImage?: string };
type Sel = { next: string | null; options: Opt[]; askLandType?: boolean; message?: string };

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

  const sql = h.tx as ReturnType<typeof postgres>;
  const [u] = await sql`select id, email, role, is_superadmin, firm_id from users where name ilike 'riyaz%' and firm_id is not null limit 1`;
  firmId = u!.firm_id;
  token = jwt.sign({ sub: u!.id, email: u!.email, role: u!.role, isSuperadmin: !!u!.is_superadmin }, process.env['JWT_SECRET']!, { expiresIn: '60m' });
  const [o] = await sql`select id, email, role, is_superadmin from users where id <> ${u!.id} and firm_id is not null limit 1`;
  otherToken = jwt.sign({ sub: o!.id, email: o!.email, role: o!.role, isSuperadmin: !!o!.is_superadmin }, process.env['JWT_SECRET']!, { expiresIn: '60m' });
  const [c] = await sql`
    insert into cases (firm_id, cnr, title, court, stage, client, type, created_by_user_id)
    values (${firmId}, ${'TEMP-E2E-' + Date.now()}, 'E2E Land v. Records', 'Principal District Court, Chengalpattu', 'Filing', 'E2E', 'Civil', ${u!.id})
    returning id, title`;
  caseId = c!.id; caseTitle = c!.title;
  const [tr] = await sql`select id from title_reports where firm_id = ${firmId} and status <> 'withdrawn' limit 1`;
  titleReportId = tr?.id ?? null;

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
  page.on('response', async (r) => {
    if (!r.url().includes('/api/land-records') || r.status() < 400) return;
    console.log(`API ${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()} ${(await r.text().catch(() => '')).slice(0, 200)}`);
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/stream')) return route.abort();
    try {
      const res = await route.fetch({ url: `http://localhost:${PORT}${url.pathname}${url.search}`, timeout: 90_000 });
      await route.fulfill({ response: res });
    } catch {
      await route.abort().catch(() => {});
    }
  });
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
  const [cases] = await raw`select count(*)::int as n from cases where cnr like 'TEMP-E2E-%'`;
  await raw.end();
  console.log('\nTIMINGS (ms)\n' + timings.map(([l, ms]) => `  ${String(ms).padStart(6)}  ${l}`).join('\n'));
  console.log('ROLLBACK CHECK:', leftover.length === 0 && cases!.n === 0 ? 'clean - nothing left in the database' : `LEFTOVER ${leftover.join('; ')} cases=${cases!.n}`);
  expect(leftover).toEqual([]);
  expect(cases!.n).toBe(0);
});

// ---------------------------------------------------------------------------

describe('Land Records API against the live site', () => {
  it('prepare answers at once', async () => {
    const r = await api('POST', '/land-records/prepare');
    expect(r.status).toBe(202);
    expect(r.ms).toBeLessThan(500);
    time('POST /prepare', r.ms);
    // Give the ready page a moment, like an advocate reading the menu.
    await new Promise((res) => setTimeout(res, 4000));
  });

  for (const service of ['patta', 'a-register', 'fmb'] as const) {
    it(`${service}: district > taluk > village > survey > sub divisions, OTP gate`, async () => {
      const s = await api<Start>('POST', '/land-records/sessions', { service });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      time(`${service}: open`, s.ms);
      expect(s.body.gate).toBe('otp');
      expect(s.body.form).toBe('rural');
      expect(s.body.districts.length).toBeGreaterThan(30);
      const id = s.body.sessionId;
      const d = s.body.districts.find((x) => /chengalpattu/i.test(x.label))!;
      const t = await api<Sel>('POST', `/land-records/sessions/${id}/select`, { field: 'district', value: d.value });
      time(`${service}: taluks`, t.ms);
      expect(t.body.next).toBe('taluk');
      expect(t.body.options.length).toBeGreaterThan(3);
      const taluk = t.body.options.find((x) => /^chengalpattu$/i.test(x.label)) ?? t.body.options[0]!;
      const v = await api<Sel>('POST', `/land-records/sessions/${id}/select`, { field: 'taluk', value: taluk.value });
      time(`${service}: villages`, v.ms);
      expect(v.body.next).toBe('village');
      expect(v.body.options.length).toBeGreaterThan(10);
      const village = v.body.options[0]!;
      const vv = await api<Sel>('POST', `/land-records/sessions/${id}/select`, { field: 'village', value: village.value });
      expect(vv.status).toBe(200);
      const sd = await api<Sel>('POST', `/land-records/sessions/${id}/subdivisions`, { surveyNo: '1', ...(v.body.askLandType ? { landType: 'R' } : {}) });
      time(`${service}: sub divisions`, sd.ms);
      expect(sd.status, JSON.stringify(sd.body)).toBe(200);
      expect(sd.body.options.length, sd.body.message ?? '').toBeGreaterThan(0);
      // Gate guards (no OTP is requested).
      expect((await api('POST', `/land-records/sessions/${id}/otp`, { mobile: '12345', fields: {} })).status).toBe(400);
      expect((await api('POST', `/land-records/sessions/${id}/otp/verify`, { otp: '123456' })).status).toBe(400);
      expect((await api('POST', `/land-records/sessions/${id}/captcha`, { captcha: '1', fields: {} })).status).toBe(400);
      // Another advocate cannot touch this session.
      expect((await api('POST', `/land-records/sessions/${id}/select`, { field: 'village', value: village.value }, otherToken)).status).toBe(404);
      expect((await api('GET', `/land-records/sessions/${id}/pdf`)).status).toBe(404);
      expect((await api('DELETE', `/land-records/sessions/${id}`)).status).toBe(204);
      expect((await api('POST', `/land-records/sessions/${id}/select`, { field: 'village', value: village.value })).status).toBe(404);
    });
  }

  for (const service of ['tslr-extract', 'tslr-sketch'] as const) {
    it(`${service}: district > taluk > town > ward > block > survey > sub division`, async () => {
      const s = await api<Start>('POST', '/land-records/sessions', { service });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      time(`${service}: open`, s.ms);
      expect(s.body.form).toBe('urban');
      const id = s.body.sessionId;
      let field = 'district';
      let value = (s.body.districts.find((x) => /chennai/i.test(x.label)) ?? s.body.districts[0]!).value;
      const chain: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await api<Sel>('POST', `/land-records/sessions/${id}/select`, { field, value });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        time(`${service}: ${field} -> ${r.body.next}`, r.ms);
        chain.push(`${field}:${r.body.options.length}`);
        if (!r.body.next) break;
        expect(r.body.options.length, `${r.body.next} list empty after ${field}=${value} (${r.body.message ?? ''})`).toBeGreaterThan(0);
        field = r.body.next;
        value = r.body.options[0]!.value;
      }
      expect(field, chain.join(' ')).toBe('subdiv');
      await api('DELETE', `/land-records/sessions/${id}`);
    });
  }

  it('verify-patta and order-copy open with their single field (OTP gate)', async () => {
    for (const service of ['verify-patta', 'order-copy'] as const) {
      const s = await api<Start>('POST', '/land-records/sessions', { service });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      time(`${service}: open`, s.ms);
      expect(s.body.gate).toBe('otp');
      expect(s.body.districts).toEqual([]);
      // Bad Application Id is refused before anything reaches the site.
      if (service === 'order-copy') {
        expect((await api('POST', `/land-records/sessions/${s.body.sessionId}/otp`, { mobile: '9876543210', fields: { applicationId: '12/34' } })).status).toBe(400);
      }
      await api('DELETE', `/land-records/sessions/${s.body.sessionId}`);
    }
  });

  it('poramboke: lists + captcha; a wrong captcha returns a fresh one', async () => {
    const s = await api<Start>('POST', '/land-records/sessions', { service: 'poramboke' });
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    time('poramboke: open', s.ms);
    expect(s.body.gate).toBe('captcha');
    expect(s.body.captchaImage).toMatch(/^data:image\//);
    const id = s.body.sessionId;
    const t = await api<Sel>('POST', `/land-records/sessions/${id}/select`, { field: 'district', value: s.body.districts.find((x) => /chengalpattu/i.test(x.label))!.value });
    const v = await api<Sel>('POST', `/land-records/sessions/${id}/select`, { field: 'taluk', value: t.body.options[0]!.value });
    await api<Sel>('POST', `/land-records/sessions/${id}/select`, { field: 'village', value: v.body.options[0]!.value });
    const fresh = await api<{ captchaImage: string }>('POST', `/land-records/sessions/${id}/captcha/refresh`);
    time('poramboke: new captcha', fresh.ms);
    expect(fresh.body.captchaImage).toMatch(/^data:image\//);
    const wrong = await api<{ status: string; reason?: string; captchaImage?: string; error?: string }>('POST', `/land-records/sessions/${id}/captcha`, { captcha: '99999', fields: { surveyNo: '1', subdivNo: '-' } });
    time('poramboke: wrong captcha round trip', wrong.ms);
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(200);
    expect(wrong.body.status).toBe('retry');
    expect(wrong.body.captchaImage).toMatch(/^data:image\//);
    // Second try on the site's posted-back form: the district / taluk / village
    // picks must be re-applied, so the site answers about the captcha again.
    const again = await api<{ status: string; error?: string }>('POST', `/land-records/sessions/${id}/captcha`, { captcha: '99998', fields: { surveyNo: '1', subdivNo: '-' } });
    time('poramboke: second wrong captcha (picks re-applied)', again.ms);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.status).toBe('retry');
    await api('DELETE', `/land-records/sessions/${id}`);
  });

  for (const service of ['app-status', 'fline'] as const) {
    it(`${service}: captcha; a wrong captcha returns a fresh one`, async () => {
      const s = await api<Start>('POST', '/land-records/sessions', { service });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      time(`${service}: open`, s.ms);
      expect(s.body.captchaImage).toMatch(/^data:image\//);
      const wrong = await api<{ status: string; reason?: string; captchaImage?: string; error?: string }>('POST', `/land-records/sessions/${s.body.sessionId}/captcha`, { captcha: '99999', fields: { applicationId: '2026/0412/05/001234' } });
      time(`${service}: wrong captcha round trip`, wrong.ms);
      expect(wrong.status, JSON.stringify(wrong.body)).toBe(200);
      expect(wrong.body.status, JSON.stringify(wrong.body).slice(0, 300)).toBe('retry');
      await api('DELETE', `/land-records/sessions/${s.body.sessionId}`);
    });
  }

  it('files a result into the matter documents and a title report search', async () => {
    const { __testing } = await import('../src/services/tn-land-records.service');
    const s = await api<Start>('POST', '/land-records/sessions', { service: 'patta' });
    expect(s.status).toBe(200);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    __testing.setSessionResult(s.body.sessionId, {
      title: 'Chitta', fields: [{ label: 'Patta Number', value: '1234' }, { label: 'Owner', value: 'K. Ramesh' }], sections: [], text: '', hasPdf: true,
    }, pdf, { District: 'Chengalpattu', Taluk: 'Chengalpattu', Village: 'Alapakkam', 'Survey Number': '1/1A1' });
    const dl = await fetch(`http://localhost:${PORT}/api/land-records/sessions/${s.body.sessionId}/pdf`, { headers: { authorization: `Bearer ${token}` } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toContain('application/pdf');
    expect(dl.headers.get('content-disposition')).toMatch(/S\.No\._1_1A1/);
    const saved = await api<{ documentId: string; titleReportSearchId: string | null; name: string }>('POST', `/land-records/sessions/${s.body.sessionId}/save`, { caseId, ...(titleReportId ? { titleReportId } : {}) });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.name).toBe('View Patta / Chitta / FMB - S.No. 1/1A1 - Alapakkam, Chengalpattu, Chengalpattu');
    const sql = h.tx as ReturnType<typeof postgres>;
    const [doc] = await sql`select case_label, type, file_mime, storage_key from documents where id = ${saved.body.documentId}::uuid`;
    expect(doc).toMatchObject({ case_label: caseTitle, type: 'Land Record', file_mime: 'application/pdf' });
    expect(h.files.get(doc!.storage_key)?.body.subarray(0, 5).toString()).toBe('%PDF-');
    if (titleReportId) {
      const [srch] = await sql`select search_type, attachment_ref, search_query from title_report_searches where id = ${saved.body.titleReportSearchId}::uuid`;
      expect(srch).toMatchObject({ search_type: 'revenue', attachment_ref: `document:${saved.body.documentId}` });
    } else {
      console.log('NOTE: no title report in this firm - title-report filing not exercised');
    }
    // Matter of another firm / missing -> refused.
    expect((await api('POST', `/land-records/sessions/${s.body.sessionId}/save`, { caseId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);
    expect((await api('POST', `/land-records/sessions/${s.body.sessionId}/save`, {})).status).toBe(400);
    await api('DELETE', `/land-records/sessions/${s.body.sessionId}`);
  });

  it('followed applications: add, list, record status, close, reopen, remove', async () => {
    const add = await api<{ id: string; applicationId: string; caseTitle: string }>('POST', '/land-records/applications', { applicationId: '2026/0412/05/001234', kind: 'patta_transfer', caseId, note: 'e2e' });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.caseTitle).toBe(caseTitle);
    expect((await api('POST', '/land-records/applications', { applicationId: 'bad' })).status).toBe(400);
    // Re-adding the same Id updates instead of duplicating.
    expect((await api('POST', '/land-records/applications', { applicationId: '2026/0412/05/001234', kind: 'patta_transfer' })).status).toBe(201);
    const list = await api<{ items: Array<{ id: string; lastStatus: string | null }> }>('GET', '/land-records/applications');
    expect(list.body.items.filter((a) => a.id === add.body.id)).toHaveLength(1);
    const { recordStatus } = await import('../src/services/tn-land-tracker.service');
    expect(await recordStatus(firmId, '2026/0412/05/001234', { title: '', fields: [{ label: 'Application Status', value: 'Pending with VAO' }], sections: [], text: '', hasPdf: false })).toBe(true);
    const after = await api<{ items: Array<{ id: string; lastStatus: string | null; lastCheckedAt: string | null }> }>('GET', `/land-records/applications?caseId=${caseId}`);
    expect(after.body.items[0]).toMatchObject({ lastStatus: 'Application Status: Pending with VAO' });
    expect(after.body.items[0]!.lastCheckedAt).toBeTruthy();
    expect((await api('PATCH', `/land-records/applications/${add.body.id}`, { closed: true })).status).toBe(204);
    expect((await api('PATCH', `/land-records/applications/${add.body.id}`, { closed: false })).status).toBe(204);
    expect((await api('DELETE', `/land-records/applications/${add.body.id}`)).status).toBe(204);
  });
});

describe('Land Records UI', () => {
  const tiles = [
    ['Patta / Chitta / FMB', 'District'], ['A-Register extract', 'District'], ['FMB sketch', 'District'],
    ['Verify Patta / Chitta', 'Reference Number to Verify Chitta Extract :'], ['Government or private land', 'District'],
    ['TSLR extract', 'District'], ['TSLR sketch', 'District'],
    ['Application status', 'Application Id'], ['Patta order copy', 'Application Id'], ['F-Line sketch / statement', 'Application Id'],
  ] as const;

  it('every tile opens its form at once and the site answers', async () => {
    await page.goto(`${WEB}/app/land-records`, { waitUntil: 'domcontentloaded' });
    await page.locator('.lr-tile').first().waitFor();
    expect(await page.locator('.lr-tile').count()).toBe(10);
    expect(await page.locator('.lr-gate, .lr-tile-cta').count()).toBe(0);
    for (const [title, firstLabel] of tiles) {
      await page.locator('.lr-tile', { hasText: title }).click();
      const t0 = Date.now();
      await page.getByText(firstLabel, { exact: false }).first().waitFor({ timeout: 2000 });
      time(`UI ${title}: form visible`, Date.now() - t0);
      // Ready = district list filled, or captcha shown, or Get OTP / field enabled.
      await page.waitForFunction(() => {
        const sel = document.querySelector('select');
        if (sel && sel.options.length > 1) return true;
        if (document.querySelector('img[alt="Captcha from Land Records"]')) return true;
        const inp = document.querySelector('input[placeholder^="eg:-"], input[maxlength="40"]');
        return Boolean(inp && !document.body.innerText.includes('Loading'));
      }, undefined, { timeout: 60_000 });
      time(`UI ${title}: site ready`, Date.now() - t0);
      expect(await page.getByRole('alert').count(), await page.getByRole('alert').allInnerTexts().then((x) => x.join(' | '))).toBe(0);
      await page.getByRole('button', { name: /All services/ }).click();
      await page.locator('.lr-tile').first().waitFor();
    }
  });

  it('patta form: pick lists, survey, sub division, then Get OTP is enabled (not clicked)', async () => {
    await page.locator('.lr-tile', { hasText: 'Patta / Chitta / FMB' }).click();
    const sel = (label: string) => page.locator('label', { has: page.locator('span', { hasText: new RegExp(`^${label}\\*?$`) }) }).locator('select');
    await page.waitForFunction(() => (document.querySelector('select')?.options.length ?? 0) > 1, undefined, { timeout: 60_000 });
    await sel('District').selectOption({ label: 'Chengalpattu' });
    await page.waitForFunction(() => (document.querySelectorAll('select')[1]?.options.length ?? 0) > 1, undefined, { timeout: 30_000 });
    await sel('Taluk').selectOption({ index: 1 });
    await page.waitForFunction(() => (document.querySelectorAll('select')[2]?.options.length ?? 0) > 1, undefined, { timeout: 30_000 });
    await sel('Village').selectOption({ index: 1 });
    if (await page.getByLabel('Rural').count()) await page.getByLabel('Rural').check();
    const survey = page.getByRole('textbox', { name: 'Survey Number' });
    await survey.fill('1');
    await survey.press('Enter');
    await page.waitForFunction(() => {
      const s = [...document.querySelectorAll('select')].pop();
      return (s?.options.length ?? 0) > 1;
    }, undefined, { timeout: 30_000 });
    await survey.blur();
    await page.waitForTimeout(800);
    const subdiv = page.locator('select').last();
    await subdiv.selectOption({ index: 1 });
    await page.waitForTimeout(800);
    // The pick must survive the survey box's blur (regression: it used to reload and clear).
    expect(await subdiv.inputValue()).not.toBe('');
    await page.getByLabel('Mobile No(10 digit)').fill('9876543210');
    await expect.poll(() => page.getByRole('button', { name: 'Get OTP' }).isEnabled(), { timeout: 5000 }).toBe(true);
    await page.getByRole('button', { name: /All services/ }).click();
  });

  it('application status: wrong captcha shows the message and a new captcha', async () => {
    await page.locator('.lr-tile', { hasText: 'Application status' }).click();
    await page.locator('img[alt="Captcha from Land Records"]').waitFor({ timeout: 60_000 });
    const first = await page.locator('img[alt="Captcha from Land Records"]').getAttribute('src');
    await page.getByPlaceholder('eg:-0000/0000/00/000000').fill('2026/0412/05/001234');
    await page.getByLabel('Authentication value').fill('99999');
    await page.getByRole('button', { name: 'Get Status' }).click();
    await page.getByRole('alert').waitFor({ timeout: 60_000 });
    const msg = await page.getByRole('alert').innerText();
    expect(msg).toMatch(/incorrect|authentication|captcha/i);
    expect(await page.locator('img[alt="Captcha from Land Records"]').getAttribute('src')).not.toBe(first);
    await page.getByRole('button', { name: /All services/ }).click();
  });

  it('my applications: follow from the UI, then close', async () => {
    await page.goto(`${WEB}/app/land-records?tab=applications`, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('eg:-0000/0000/00/000000').fill('2026/0412/05/009999');
    await page.getByRole('button', { name: 'Follow' }).click();
    await page.getByText('Following 2026/0412/05/009999.').waitFor();
    const row = page.locator('tr', { hasText: '2026/0412/05/009999' });
    await row.waitFor();
    await row.getByRole('button', { name: 'Close' }).click();
    await page.getByText(/Closed \(1\)|Closed \(\d+\)/).waitFor();
  });
});
