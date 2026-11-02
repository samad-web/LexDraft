/**
 * Preview (local only): DifAi's version of every logged-in eFiling screen,
 * drawn from REAL data a self-test captured on the live portal
 * (EFILING_PREVIEW_DIR = a difai-efiling-selftest/<time> folder with
 * full.json), screenshotted into EFILING_PREVIEW_OUT so each screen can be
 * compared with the portal's own screenshot of the same page. Skipped when
 * EFILING_PREVIEW_DIR is not set. Same setup as efiling-login-ui.e2e.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const PORT = Number(process.env['EFILING_PREVIEW_PORT'] ?? 4103);
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

// My Cases as the portal has it: the tile loads Portfolio_new/my_cases, whose
// own script fetches portfolio/getMyCasesData/ into the CNR_Numbers_ef globals
// and draws the case links; a case link loads portfolio/getCaseHistory/.
const NEXT = new Date(Date.now() + 330 * 60_000 + 7 * 86_400_000).toISOString().slice(0, 10);
const MY_CASES_DC = [
  { cino: 'TNCH0C0012342024', hc_dc: 'D', type_name: 'OS', case_no: '200100000572024', reg_no: '57', reg_year: '2024', fil_no: '', fil_year: '', pet_name: 'Ramesh Kumar', res_name: 'Suresh Babu', state_code: '10', state_name: 'Tamil Nadu', district_code: '2', district_name: 'Chennai', establishment_code: 'TNCH0C', establishment_name: 'City Civil Court, Chennai', desgname: '1-Principal Judge', date_next_list: NEXT, date_last_list: null, date_of_decision: null, registration_date: '2024-03-15', purpose_cd: '4', purpose_name: 'Hearing', ci_cri: 'civil', pde_no: '', under_obj: 'N', updated: true },
  { cino: 'TNCH0D0045672020', hc_dc: 'D', type_name: 'CC', case_no: '201200000122020', reg_no: '12', reg_year: '2020', fil_no: '', fil_year: '', pet_name: 'State', res_name: 'Murugan', state_code: '10', state_name: 'Tamil Nadu', district_code: '2', district_name: 'Chennai', establishment_code: 'TNCH0D', establishment_name: 'Metropolitan Magistrate Court, Egmore', desgname: '3-Metropolitan Magistrate', date_next_list: null, date_last_list: null, date_of_decision: '2026-09-15', registration_date: '2020-01-10', purpose_cd: '', purpose_name: '', ci_cri: 'criminal', pde_no: '', under_obj: 'N', updated: true },
];
const MY_CASES_PAGE = `<div id="datewiseDistrictwiseDiv"><button id="datewise">Date wise</button><button id="districtwise">District wise</button><span id="mycases_span_id"></span> [Last refreshed on 23-10-2026 20:06:41]</div>
<div id="ditrictsAccordion"></div><div id="hcAccordion"></div><div id="case_history_div" style="display:none"><div id="case_history"></div></div>
<script>
var CNR_Numbers_ef, CNR_Numbers_HC_ef; var allCNRRepresentative = [];
(function () {
  function post(u, b, cb) { var x = new XMLHttpRequest(); x.open('POST', '/pdedev/?p=' + u); x.onload = function () { cb(JSON.parse(x.responseText)); }; x.send(b); }
  post('portfolio/getMyCasesData/', 'configuration=D', function (o) {
    CNR_Numbers_ef = JSON.stringify(o.mycases_dc); CNR_Numbers_HC_ef = JSON.stringify(o.mycases_hc);
    document.getElementById('mycases_span_id').innerHTML = o.mycases_dc.length;
    document.getElementById('ditrictsAccordion').innerHTML = o.mycases_dc.map(function (c) { return '<a href="#" class="show_case_history_link" cino="' + c.cino + '" hcdc="D">' + c.type_name + '/' + c.reg_no + '/' + c.reg_year + '</a>'; }).join(' ');
  });
  if (!window.fxBound) window.fxBound = document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.show_case_history_link'); if (!a) return; e.preventDefault();
    post('portfolio/getCaseHistory/', 'cino1=' + a.getAttribute('cino'), function (o) { document.getElementById('case_history').innerHTML = o.option; document.getElementById('case_history_div').style.display = 'block'; });
  }) || true;
})();
</script>`;

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
<div class="tile">Draft Pleadings <span>1</span></div><div class="tile">My Cases <span>2</span></div>
<a href="#" id="efiling_activity">Draft Pleadings</a><a href="#" id="my_cases">My Cases</a><div id="db_screen"><div id="history_body"></div></div>
<a href="https://filing.ecourts.gov.in/pdedev/?p=login/logOut">Logout</a>
<script>document.getElementById('efiling_activity').addEventListener('click',function(e){e.preventDefault();var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=dashboard/fetchActivities');x.onload=function(){document.getElementById('history_body').innerHTML=JSON.parse(x.responseText).submitted_pde_list;};x.send('');});
document.getElementById('my_cases').addEventListener('click',function(e){e.preventDefault();var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=Portfolio_new/my_cases');x.onload=function(){var b=document.getElementById('history_body');b.innerHTML=x.responseText;Array.prototype.forEach.call(b.querySelectorAll('script'),function(o){var s=document.createElement('script');s.text=o.text;o.parentNode.replaceChild(s,o);});};x.send('header_view=N');});</script>
</body></html>` });
  }
  if (p === 'dashboard/fetchActivities') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ total_record: 1, submitted_pde_list: '<table><thead><tr><th>Sr.No.</th><th>e-Filing Number / Case Number</th></tr></thead><tbody><tr><td>1</td><td>O.S. - C202600019</td></tr></tbody></table>' }) });
  }
  if (p === 'Portfolio_new/my_cases') return route.fulfill({ contentType: 'text/html', body: MY_CASES_PAGE });
  if (p === 'portfolio/getMyCasesData/') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mycases_dc: MY_CASES_DC, mycases_hc: [] }) });
  if (p === 'portfolio/getRepresentingForCinos/') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ existing_cases: [] }) });
  if (p === 'portfolio/getCaseHistory/') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ option: '<h2>City Civil Court, Chennai</h2><h3>Case Details</h3><table><tr><td>Case Type</td><td>OS - Original Suit</td></tr><tr><td>Registration Number</td><td>57/2024</td></tr></table>' }) });
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
    const real = captured(url, route.request().method(), route.request().postData());
    if (real !== undefined) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(real) });
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


const DIR = process.env['EFILING_PREVIEW_DIR'] ?? '';
const OUT = process.env['EFILING_PREVIEW_OUT'] ?? '';
const FULL: Array<{ step: string; data: unknown }> = DIR ? JSON.parse(readFileSync(join(DIR, 'full.json'), 'utf8')) : [];
const stepData = (name: string) => FULL.find((x) => x.step === name || x.step.startsWith(name))?.data;

/** Which captured step answers this request (undefined: let the test API answer). */
function captured(url: URL, method: string, post: string | null): unknown {
  const m = /\/api\/efiling\/live\/session\/[^/]+\/(.*)$/.exec(url.pathname);
  if (!m || !FULL.length) return undefined;
  const p = m[1]!;
  const body = (() => { try { return JSON.parse(post ?? '{}'); } catch { return {}; } })() as Record<string, unknown>;
  let k: RegExpExecArray | null;
  if (p === 'counts') return stepData('dashboard counts + calendar + today');
  if (p === 'sync' && method === 'GET') return { summary: null, running: false };
  if (p === 'my-cases') return stepData('My Cases');
  if (p === 'my-cases/history') return stepData('My Cases: case details');
  if ((k = /^lists\/(\w+)\/open$/.exec(p))) return stepData(`${k[1]}: ${String(body['action'] ?? '')}`);
  if ((k = /^lists\/(\w+)$/.exec(p))) return stepData(`list ${k[1]}`);
  if ((k = /^case-filing\/lists\/(\w+)$/.exec(p))) return stepData(`Case Filing list: ${k[1]}`);
  if (/^case-filing\/wizard\/open$/.test(p)) return stepData(body['screen'] === 'clients' ? 'Case Filing: Manage Favourite Clients' : 'Case Filing: New Case Filing');
  if (p === 'pleadings') return stepData('Pleadings: Pleadings');
  if (p === 'templates') return stepData('Pleadings: Use Template');
  if (p === 'oath') return stepData('Pleadings: Video Recording');
  if (p === 'pleadings/drafts/draft') return stepData('Pleadings: Draft Pleadings');
  if (p === 'epay/form/open') return stepData('ePayments: Payment form');
  if (p === 'epay/transactions') return stepData('ePayments: transactions');
  if (p === 'epay/wallet') return stepData('ePayments: Court Fee Wallet');
  if (p === 'applications/screen') return stepData(url.searchParams.get('screen') === 'submitted' ? 'Applications: Submitted Applications' : 'Applications: IA Filing');
  if ((k = /^(?:vakalat|partners)\/(\w+)$/.exec(p)) && method === 'GET' && k[1] !== 'menu') return stepData(`Vakalat/Partners: ${k[1]}`);
  if ((k = /^portfolio\/(\w+)$/.exec(p)) && method === 'GET' && k[1] !== 'menu') return stepData(`Portfolio: ${k[1]}`);
  return undefined;
}

const SCREENS = [
  'dashboard', 'my_cases',
  'add_partner', 'accept_partnership', 'revoke_partnership', 'accept_revocation', 'partners_report',
  'new_case', 'fav_clients', 'draft_cases', 'filed_cases',
  'vakalat', 'accept_offer', 'print_vakalat',
  'templates', 'pleadings', 'oath',
  'payments', 'wallet',
  'applications', 'submitted_ias',
  'search_cases', 'planner',
];

describe.skipIf(!DIR)('DifAi eFiling screens from real portal data (preview)', () => {
  it('logs in (stand-in portal) and shows each screen', async () => {
    await page.goto(`${WEB}/app/efiling`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'eFiling Services · Sign In' }).waitFor({ timeout: 30_000 });
    await page.locator('select').filter({ hasText: 'Select state' }).selectOption({ label: 'Tamil Nadu' });
    await page.locator('label', { hasText: 'Bar Code / Email / Mobile / Unique Code' }).locator('input').fill('advocate@example.com');
    await page.locator('label', { hasText: 'Password' }).locator('input').fill('Secret@123');
    await page.getByRole('button', { name: /Log in to eFiling/ }).click();
    await page.getByAltText('eFiling captcha').waitFor({ timeout: 60_000 });
    await page.getByPlaceholder('Captcha code').fill(fx.lastCode);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('navigation', { name: 'eFiling menu' }).waitFor({ timeout: 60_000 });
    for (const m of SCREENS) {
      await page.goto(`${WEB}/app/efiling${m === 'dashboard' ? '' : `?m=${m}`}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('navigation', { name: 'eFiling menu' }).waitFor({ timeout: 30_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2500);
      await page.screenshot({ path: join(OUT, `${m}.png`), fullPage: true });
    }
    // The dashboard's windows, as the portal opens them.
    await page.goto(`${WEB}/app/efiling`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Completed Pleadings: / }).click();
    await page.getByRole('dialog', { name: 'Completed Pleadings' }).waitFor();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, 'window-completed_pleadings.png') });
    for (const action of ['View Documents', 'View Status']) {
      await page.getByRole('button', { name: action }).first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: join(OUT, `window-${action.replace(/ /g, '_')}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    expect(true).toBe(true);
  }, 600_000);
});
