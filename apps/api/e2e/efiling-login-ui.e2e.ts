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
    // The portal's own Sign In: the captcha is already there; one Login.
    await page.getByRole('heading', { name: 'Sign In', exact: true }).waitFor({ timeout: 30_000 });
    await page.getByAltText('eFiling captcha').waitFor({ timeout: 60_000 });
    if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/efiling-signin.png`, fullPage: true });
    await page.getByRole('combobox', { name: 'Select State' }).selectOption({ label: 'Kerala' });
    await page.getByRole('radio', { name: 'Advocate' }).check();
    await page.getByRole('textbox', { name: 'Username' }).fill('adv@example.com');
    await page.getByLabel('Password', { exact: true }).fill('Secret@123');
    await page.getByPlaceholder('Captcha code').fill(fx.lastCode);
    await page.getByRole('button', { name: 'Login', exact: true }).click();

    // Straight into eFiling - the screen that was asked for, connected.
    // The portal's own header: eFiling Services, its menus, the advocate's name.
    await page.getByRole('navigation', { name: 'eFiling menu' }).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'eFiling Services' }).waitFor();
    await page.getByText('adv@example.com').waitFor();
    await page.getByRole('combobox', { name: 'Select State or High Court' }).waitFor();
    expect(new URL(page.url()).searchParams.get('m')).toBe('filings');
    expect(await page.getByRole('heading', { name: 'Sign In', exact: true }).count()).toBe(0);
  });

  it("the eFiling Dashboard is then the portal's own: its tiles, its numbers, its list", async () => {
    await page.goto(`${WEB}/app/efiling`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('navigation', { name: 'eFiling menu' }).waitFor({ timeout: 60_000 });
    // The tiles, with the portal's numbers, then the Calendar and today's list.
    await page.getByRole('button', { name: 'Draft Pleadings: 1' }).waitFor({ timeout: 60_000 });
    for (const t of ['Completed Pleadings', 'Draft IAs', 'Completed IAs', 'Objections', 'My Cases']) {
      await page.getByRole('button', { name: new RegExp(`^${t}: `) }).waitFor();
    }
    await page.getByRole('heading', { name: 'Calendar' }).waitFor();
    await page.getByRole('heading', { name: /^Cases Listed Today - \d{2}-\d{2}-\d{4}$/ }).waitFor();
    // A tile opens its list in a window, as on the portal: search, paging, the table.
    await page.getByRole('button', { name: 'Draft Pleadings: 1' }).click();
    const win = page.getByRole('dialog', { name: 'Draft Pleadings' });
    await win.getByRole('cell', { name: 'O.S. - C202600019' }).waitFor({ timeout: 60_000 });
    await win.getByText('Showing 1 to 1 of 1 entries').waitFor();
    await win.getByLabel('Search By (eFiling Number/CNR Number/Party Name)').fill('nothing-like-this');
    await win.getByRole('button', { name: 'Search', exact: true }).click();
    await win.getByText('No matching entries.').waitFor();
    await win.getByRole('button', { name: 'Clear' }).click();
    await win.getByRole('cell', { name: 'O.S. - C202600019' }).waitFor();
    await page.keyboard.press('Escape');
    await win.waitFor({ state: 'detached' });
    if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/efiling-portal-dashboard.png`, fullPage: true });
  });

  it("My Cases opens the portal's widget: District wise / Date wise, Pending / Disposed / Both, panels that expand to the cases, and a case's history", async () => {
    await page.getByRole('button', { name: 'My Cases: 2' }).click();
    const win = page.getByRole('dialog', { name: 'My Cases' });
    await win.getByRole('heading', { name: 'District Court Cases' }).waitFor({ timeout: 60_000 });
    await win.getByText('[Last refreshed on 23-10-2026 20:06:41]').waitFor();
    expect(await win.getByRole('button', { name: 'District wise' }).getAttribute('aria-pressed')).toBe('true');
    expect(await win.getByRole('tab', { name: 'Both' }).getAttribute('aria-selected')).toBe('true');
    // District wise: one panel per district with its count; expanding it shows the establishments' tables.
    const panel = win.getByRole('button', { name: 'Chennai,Tamil Nadu (2)' });
    expect(await panel.getAttribute('aria-expanded')).toBe('false');
    await panel.click();
    await win.getByText('City Civil Court, Chennai(1)').waitFor();
    await win.getByText('Metropolitan Magistrate Court, Egmore(1)').waitFor();
    await win.getByRole('button', { name: 'OS/57/2024' }).waitFor();
    await win.getByRole('tab', { name: 'Pending' }).click();
    await win.getByRole('button', { name: 'Chennai,Tamil Nadu (1)' }).waitFor();
    expect(await win.getByRole('button', { name: 'CC/12/2020' }).count()).toBe(0);
    await win.getByRole('tab', { name: 'Disposed' }).click();
    await win.getByRole('button', { name: 'CC/12/2020' }).waitFor();
    // Date wise: the next date's panel under its month, disposed cases on their own.
    await win.getByRole('tab', { name: 'Both' }).click();
    await win.getByRole('button', { name: 'Date wise' }).click();
    await win.getByRole('button', { name: 'Disposed Cases (1)' }).waitFor();
    const next = NEXT.split('-').reverse().join('-');
    await win.getByRole('button', { name: `${next} (1)` }).click();
    await win.getByText('City Civil Court, Chennai(1), Chennai').waitFor();
    // A case number opens its history from the portal, on top.
    await win.getByRole('button', { name: 'OS/57/2024' }).click();
    const hist = page.getByRole('dialog', { name: 'OS/57/2024' });
    await hist.getByRole('heading', { name: 'Case Details' }).waitFor({ timeout: 60_000 });
    await hist.getByRole('cell', { name: 'OS - Original Suit' }).waitFor();
    if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/efiling-my-cases-history.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await hist.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await win.waitFor({ state: 'detached' });
  });

  it('after "Log out of eFiling" the next login remembers state and username (never the password)', async () => {
    await page.getByRole('button', { name: 'Log out of eFiling' }).click();
    await page.getByRole('heading', { name: 'Sign In', exact: true }).waitFor({ timeout: 30_000 });
    expect(await page.getByRole('combobox', { name: 'Select State' }).inputValue()).not.toBe('');
    expect(await page.getByRole('textbox', { name: 'Username' }).inputValue()).toBe('adv@example.com');
    expect(await page.getByLabel('Password', { exact: true }).inputValue()).toBe('');
  });
});
