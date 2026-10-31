/**
 * eFiling portal login + dashboard flow, against fixture pages that behave
 * like filing.ecourts.gov.in's own (reverse-engineered from its public
 * login1.js, components.js and dashboard.js - docs/efiling-portal-reverse-
 * engineering.md):
 *   - the login page loads THREE Securimage captchas (login, forgot-password,
 *     duplicate-login) and only the code of the image served LAST is valid
 *   - a failed login clears #user_name / #user_password, reloads the captcha
 *     and shows the message in #msg-danger4
 *   - a valid login while the account is open elsewhere answers "User already
 *     login ... CLICK HERE", which opens #frm_duplicate_login (own captcha)
 *   - the dashboard's tiles (#draft_cases, #efiling_activity, #objections ...)
 *     POST ?p=<controller/method> with a __csrf_magic token that rotates on
 *     every request and put their list in #history_body
 * The real service code drives them (no live portal, no account, no DB).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Route } from 'playwright';
import * as live from '../src/services/efiling-live.service';

const USER = 'portal-flow-user';
const PASSWORD = 'Secret@123';
const ORIGIN = 'https://filing.ecourts.gov.in';

// ---- fixture state ------------------------------------------------------------------

const fx = {
  counter: 0,
  lastCode: '',
  codeBySrc: new Map<string, string>(),
  loginAttempts: [] as Array<{ user: string; password: string; captcha: string }>,
  openElsewhere: true,
  csrf: 'tok0',
  csrfSeen: [] as string[],
  loggedOut: false,
};

const svg = (code: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="12" y="34" font-size="26" font-family="monospace">${code}</text></svg>`;

const loginPage = `<!doctype html><html><body>
<form id="frm_login">
  <select id="selState"><option value="">Select</option><option value="4">Kerala</option><option value="10">Tamil Nadu</option></select>
  <input type="radio" name="rdoUser" id="user_advocate" value="1"><input type="radio" name="rdoUser" id="user_person" value="2">
  <input id="user_name"><input type="password" id="user_password"><input type="hidden" id="gennum" value="n1">
  <div id="div_captcha_mobile"><img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a1" width="150" height="50">
  <a href="#" title="Refresh Image" onclick="document.getElementById('captcha_image').src='/pdedev/securimage/securimage_show.php?'+Math.random();return false;">r</a></div>
  <input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="doLogin()">Login</button>
  <div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div>
</form>
<div id="regForPassModal"><img id="captcha_image2" src="/pdedev/securimage/securimage_show.php?b2" width="150" height="50"></div>
<div id="alert_invalid_pin" style="display:none"><form id="frm_duplicate_login">
  <input type="password" id="user_pwd"><img id="captcha_image1" src="/pdedev/securimage/securimage_show.php?c3" width="150" height="50">
  <input id="fcaptcha_code_mobile1"><button type="button" id="re_verify_button" onclick="doDuplicate()">Logout and Login</button>
  <div class="alert-danger5" style="display:none"><span id="msg-danger5"></span></div>
</form></div>
<script>
  function post(url, body, cb) {
    var x = new XMLHttpRequest(); x.open('POST', '/pdedev/?p=' + url);
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.onload = function () { cb(JSON.parse(x.responseText)); }; x.send(body);
  }
  // Like the portal's open_logout_form(): reload the pop-up captcha, call
  // duplicate_logout_data, and in its callback reload the hidden one too.
  function showDuplicate() {
    document.getElementById('captcha_image1').src = '/pdedev/securimage/securimage_show.php?' + Math.random();
    post('login/duplicate_logout_data/', '', function () {
      document.getElementById('alert_invalid_pin').style.display = 'block';
      setTimeout(function () { document.getElementById('captcha_image2').src = '/pdedev/securimage/securimage_show.php?' + Math.random(); }, 300);
    });
    return false;
  }
  function doLogin() {
    post('login/verify_login/', 'user_name=' + encodeURIComponent(document.getElementById('user_name').value)
      + '&user_password=' + encodeURIComponent(document.getElementById('user_password').value)
      + '&fcaptcha_code=' + encodeURIComponent(document.getElementById('fcaptcha_code_mobile').value), function (obj) {
      if (obj.status === true && obj.redirect_path) { window.location.href = obj.redirect_path; return; }
      document.querySelector('.alert-danger4').style.display = 'block';
      document.getElementById('msg-danger4').innerHTML = obj.errorMsg;
      if (obj.duplicate_login == 0) { document.getElementById('user_name').value = ''; document.getElementById('user_password').value = ''; }
      document.getElementById('captcha_image').src = '/pdedev/securimage/securimage_show.php?' + Math.random();
      document.getElementById('fcaptcha_code_mobile').value = '';
    });
  }
  function doDuplicate() {
    post('login/verify_duplicate_login/', 'user_password=' + encodeURIComponent(document.getElementById('user_pwd').value)
      + '&fcaptcha_code=' + encodeURIComponent(document.getElementById('fcaptcha_code_mobile1').value), function (obj) {
      if (obj.status === true && obj.redirect_path) { window.location.href = obj.redirect_path; return; }
      document.querySelector('.alert-danger5').style.display = 'block';
      document.getElementById('msg-danger5').innerHTML = obj.errorMsg;
    });
  }
</script></body></html>`;

const TILES: Record<string, { route: string; field: string; html: string }> = {
  draft_cases: { route: 'advocate_case_registration/getUnRegisteredPDE', field: 'pde_list', html: '<table><thead><tr><th>Sr. No.</th><th>E-Filing Number</th><th>Litigant Name</th></tr></thead><tbody><tr><td>1</td><td>59/2026</td><td>Ramesh Kumar</td></tr></tbody></table>' },
  filed_cases: { route: 'advocate_case_registration/getSubmittedPDE', field: 'submitted_pde_list', html: '<table><thead><tr><th>Sr.No.</th><th>E-Filing No</th></tr></thead><tbody></tbody></table>' },
  efiling_activity: { route: 'dashboard/fetchActivities', field: 'submitted_pde_list', html: '<table><thead><tr><th>Sr.No.</th><th>e-Filing Number / Case Number</th><th>ePayments</th></tr></thead><tbody><tr><td>1</td><td>O.S. - C202600019</td><td><select><option>Select GRN</option><option>KL26GRN00012345 - 4320.00</option></select></td></tr></tbody></table>' },
  completed_pleading: { route: 'dashboard/fetchCompletedActivities', field: 'submitted_pde_list', html: '<table><tbody></tbody></table>' },
  draft_ia: { route: 'dashboard/fetchDraftIA', field: 'submitted_pde_list', html: '<table><tbody></tbody></table>' },
  completed_ia: { route: 'dashboard/fetchCompletedIA', field: 'submitted_pde_list', html: '<table><tbody></tbody></table>' },
  my_cases: { route: 'Portfolio_new/my_cases', field: 'html', html: '<table><thead><tr><th>Sr No</th><th>Cases</th><th>Party Name</th></tr></thead><tbody><tr><td>1</td><td>OS/57/2024</td><td>Ramesh Kumar Vs Suresh Babu</td></tr></tbody></table>' },
  objections: { route: 'dashboard/fetchObjections', field: 'table', html: '<table id="tblFavClient"><thead><tr><th>Sr.No.</th><th>Reason</th><th>Date</th></tr></thead><tbody><tr><td colspan="3">C202600004 - Maintenance Application</td></tr><tr><td>1</td><td>Court fee deficit of Rs. 120.</td><td>21-10-2026</td></tr></tbody></table>' },
};

const dashboardPage = () => `<!doctype html><html><body>
<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="${fx.csrf}">
<h3>Dashboard</h3>
<!-- The real dashboard's tiles: pairs inside shared panels, label, icon, number. -->
<div class="row panel"><div class="col tile"><span>Draft Pleadings</span><i class="fa"></i><span>1</span></div><div class="col tile"><span>Completed Pleadings</span><i class="fa"></i><span>2</span></div></div>
<div class="row panel"><div class="col tile"><span>Draft IAs</span><span>0</span></div><div class="col tile"><span>Completed IAs</span><span>3</span></div></div>
<div class="row panel"><div class="col tile"><span>Objections</span><span>1</span></div><div class="col tile"><span>My Cases</span><span>1</span></div></div>
${Object.keys(TILES).map((id) => `<a href="#" id="${id}">${id}</a>`).join(' ')}
<a href="${ORIGIN}/pdedev/?p=login/logOut">Logout</a>
<div id="db_screen"><div id="history_body"></div></div>
<script>
  var TILES = ${JSON.stringify(Object.fromEntries(Object.entries(TILES).map(([k, v]) => [k, { route: v.route, field: v.field }])))};
  Object.keys(TILES).forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      e.preventDefault();
      var x = new XMLHttpRequest(); x.open('POST', document.getElementById('base_url').value + '/?p=' + TILES[id].route);
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      x.onload = function () {
        var obj = JSON.parse(x.responseText);
        document.getElementById('__csrf_magic').value = obj.nsteptoken;
        document.getElementById('history_body').innerHTML = obj[TILES[id].field];
      };
      x.send('ajax_req=true&__csrf_magic=' + encodeURIComponent(document.getElementById('__csrf_magic').value));
    });
  });
</script></body></html>`;

const form = (body: string | null) => new URLSearchParams(body ?? '');

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('/securimage/securimage_show.php')) {
    fx.counter += 1;
    const code = `K${fx.counter}x${fx.counter % 7}`;
    fx.lastCode = code;
    fx.codeBySrc.set(url.search.slice(1), code);
    return route.fulfill({ contentType: 'image/svg+xml', body: svg(code) });
  }
  if (req.method() === 'GET' && p === 'login/logOut') {
    fx.loggedOut = true;
    return route.fulfill({ contentType: 'text/html', body: '<html><body>Logged out</body></html>' });
  }
  if (req.method() === 'GET' && p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: dashboardPage() });
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: loginPage });

  const f = form(req.postData());
  if (p === 'login/verify_login/') {
    fx.loginAttempts.push({ user: f.get('user_name') ?? '', password: f.get('user_password') ?? '', captcha: f.get('fcaptcha_code') ?? '' });
    const ok = f.get('fcaptcha_code') === fx.lastCode && f.get('user_name') === 'adv@example.com' && f.get('user_password') === PASSWORD;
    if (!ok) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: false, errorMsg: 'Login Failed<br>Invalid captcha', duplicate_login: 0, gennum: 'n2', captcha: '' }) });
    if (fx.openElsewhere) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: false, duplicate_login: 1, errorMsg: 'User already login. <a href="#" onclick="return showDuplicate()">CLICK HERE</a> to logout from other places', captcha: '' }) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }) });
  }
  if (p === 'login/duplicate_logout_data/') {
    await new Promise((r) => setTimeout(r, 400));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, state_name: 'Kerala', user_type: 'Advocate', username: 'adv@example.com' }) });
  }
  if (p === 'login/verify_duplicate_login/') {
    const ok = f.get('fcaptcha_code') === fx.lastCode && f.get('user_password') === PASSWORD;
    if (!ok) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: false, errorMsg: 'Invalid captcha', duplicate_login: 0, captcha: '' }) });
    fx.openElsewhere = false;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }) });
  }
  const tile = Object.values(TILES).find((t) => t.route === p);
  if (tile) {
    // The rotating token: anything but the latest one is refused.
    const sent = f.get('__csrf_magic') ?? '';
    fx.csrfSeen.push(sent);
    if (sent !== fx.csrf) return route.fulfill({ status: 403, body: `Invalid token#####${fx.csrf}` });
    fx.csrf = `tok${fx.csrfSeen.length}`;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsteptoken: fx.csrf, [tile.field]: tile.html, total_record: 1 }) });
  }
  return route.fulfill({ status: 404, body: 'not in fixture' });
}

let sessionId = '';

beforeAll(() => {
  live.__testing.setContextHook(async (context: BrowserContext) => {
    await context.route(`${ORIGIN}/**`, serve);
  });
});

afterAll(async () => {
  live.__testing.setContextHook(null);
  if (sessionId) await live.endEfilingSession(sessionId, USER).catch(() => {});
});

describe('eFiling portal login (fixture portal)', () => {
  it('shows the login captcha the portal will actually check (three images, last served wins)', async () => {
    ({ sessionId } = await live.startEfilingSession(USER, '4', 'advocate'));
    const first = await live.submitEfilingCredentials(sessionId, USER, 'adv@example.com', PASSWORD);
    expect(first.captchaImageBase64.length).toBeGreaterThan(500);
    const page = live.__testing.pageOf(sessionId)!;
    const src = (await page.getAttribute('#captcha_image', 'src'))!.split('?')[1]!;
    // Before the fix the visible login image was not the last one served.
    expect(fx.codeBySrc.get(src)).toBe(fx.lastCode);
  });

  it('a wrong captcha comes back with a fresh image and the login refilled', async () => {
    const before = fx.lastCode;
    const r = await live.submitEfilingLoginCaptcha(sessionId, USER, 'WRONG1');
    expect(r).toMatchObject({ retry: true });
    expect('retry' in r && r.reason).toMatch(/Invalid captcha/);
    expect(fx.lastCode).not.toBe(before);
    const page = live.__testing.pageOf(sessionId)!;
    // The fixture (like the portal) emptied these; DifAi put them back.
    expect(await page.inputValue('#user_name')).toBe('adv@example.com');
    expect(await page.inputValue('#user_password')).toBe(PASSWORD);
    const src = (await page.getAttribute('#captcha_image', 'src'))!.split('?')[1]!;
    expect(fx.codeBySrc.get(src)).toBe(fx.lastCode);
  });

  it('the right captcha while the account is open elsewhere -> "log out other session" with its own fresh captcha -> logged in', async () => {
    const r = await live.submitEfilingLoginCaptcha(sessionId, USER, fx.lastCode);
    expect(r).toMatchObject({ duplicateLogin: true });
    expect('reason' in r && r.reason).toMatch(/already login/i);
    const page = live.__testing.pageOf(sessionId)!;
    const src = (await page.getAttribute('#captcha_image1', 'src'))!.split('?')[1]!;
    expect(fx.codeBySrc.get(src)).toBe(fx.lastCode);
    // Empty password from the client: DifAi uses the one from the login step.
    const done = await live.confirmDuplicateEfilingLogin(sessionId, USER, '', fx.lastCode);
    expect(done).toEqual({ status: 'authenticated' });
    expect(live.efilingSessionStatus(sessionId, USER).authenticated).toBe(true);
  });
});

describe('eFiling portal dashboard (fixture portal)', () => {
  it('reads every dashboard list by clicking the portal\'s own tiles, keeping its token chain', async () => {
    const lists = await live.readPortalLists(sessionId, USER);
    expect(lists.map((l) => l.key)).toEqual(['draft_cases', 'filed_cases', 'draft_pleadings', 'completed_pleadings', 'draft_ias', 'completed_ias', 'objections', 'my_cases']);
    expect(lists.find((l) => l.key === 'my_cases')).toMatchObject({ total: 1, rows: [{ cells: ['1', 'OS/57/2024', 'Ramesh Kumar Vs Suresh Babu'] }] });
    expect(lists.every((l) => l.error === null)).toBe(true);
    expect(lists.find((l) => l.key === 'draft_cases')).toMatchObject({ total: 1, rows: [{ cells: ['1', '59/2026', 'Ramesh Kumar'] }] });
    expect(lists.find((l) => l.key === 'draft_pleadings')!.rows).toEqual([{ cells: ['1', 'O.S. - C202600019', 'KL26GRN00012345 - 4320.00'] }]);
    expect(lists.find((l) => l.key === 'objections')).toMatchObject({
      total: 1,
      rows: [{ group: 'C202600004 - Maintenance Application' }, { cells: ['1', 'Court fee deficit of Rs. 120.', '21-10-2026'] }],
    });
    // Eight tile requests, each carrying the token the previous one issued.
    expect(fx.csrfSeen).toEqual(['tok0', 'tok1', 'tok2', 'tok3', 'tok4', 'tok5', 'tok6', 'tok7']);
  });

  it('reads the numbers off the portal\'s own tiles at once (pairs in shared panels), then one list per tile', async () => {
    const counts = await live.readPortalCounts(sessionId, USER);
    expect(counts).toEqual({ draft_pleadings: 1, completed_pleadings: 2, draft_ias: 0, completed_ias: 3, objections: 1, my_cases: 1 });
    const one = await live.readPortalList(sessionId, USER, 'objections');
    expect(one).toMatchObject({ key: 'objections', total: 1, rows: [{ group: 'C202600004 - Maintenance Application' }, { cells: ['1', 'Court fee deficit of Rs. 120.', '21-10-2026'] }] });
  });

  it('runs one portal step at a time: a second request meanwhile is told to wait', async () => {
    const results = await Promise.allSettled([live.readPortalLists(sessionId, USER), live.readPortalLists(sessionId, USER)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason?.message)).toMatch(/Still working on your last eFiling step/);
  });

  it('"Log out of eFiling" also logs out on the portal (one session per account)', async () => {
    await live.endEfilingSession(sessionId, USER);
    expect(fx.loggedOut).toBe(true);
    sessionId = '';
  });
});
