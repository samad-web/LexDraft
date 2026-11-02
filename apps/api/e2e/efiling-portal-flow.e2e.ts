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
  /** The portal ended the session (same account logged in elsewhere). */
  signedOut: false,
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
  // As the real portal returns it (columns, buttons and links as on screen).
  completed_pleading: { route: 'dashboard/fetchCompletedActivities', field: 'submitted_pde_list', html: '<table class="search"><tr><td>Search By (eFiling Number/CNR Number/Party Name)</td><td><input></td><td><button>Search</button></td><td><button>Clear</button></td></tr></table><table id="example1" class="table"><thead><tr><th>Sr.No.</th><th>e-Filing Number / Case Number</th><th>Establishment</th><th>Cause Title</th><th>Upload Pleadings (Mandatory)</th><th>Oath Recording</th><th>ePayments</th><th>Application Submitted</th><th>Last Updated on</th><th>Status</th></tr></thead><tbody><tr><td>1</td><td><b>STC/4377/2026</b><br>(TNCH0C0121292026)<br>STC - ATN20250009438C202600002<br><span class="badge">Court Verified eFile Case</span><br><a href="#" onclick="return false">Acknowledgement</a></td><td>The Metropolitan Magistrates Courts, Saidapet, Chennai</td><td><a href="#">Ambeth Arivukarasan Proprietor Thoorigai Prints</a><br>Vs<br><a href="#">R Venkatesh Bhat Proprietor Ms Venki Publications</a></td><td><button class="btn" id="btn-pop7" onclick="fxDocs(7)">View Documents</button><div class="popup" id="dv_challan7" style="display:none"><table id="example_pl7"><thead><tr><th>Sr. No.</th><th>File Name</th><th>Uploaded On</th><th>Final Submitted On</th><th>Status</th><th>CIS Status</th></tr></thead><tbody><tr><td>0</td><td>stale</td><td></td><td></td><td></td><td></td></tr></tbody></table></div></td><td>---</td><td>TNCT2716H2608P694 - 6600.00</td><td></td><td>27-08-2026 15:09:56</td><td><button class="btn" onclick="fxStatus()">View Status</button></td></tr></tbody></table>' },
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
<!-- jQuery UI datepicker as the portal draws it, with case-count badges. -->
<div class="calendar-box"><h4>Calendar</h4><div class="datepicker"><div class="ui-datepicker-header"><select class="ui-datepicker-month"><option value="9" selected>Oct</option></select><select class="ui-datepicker-year"><option value="2026" selected>2026</option></select></div>
<table class="ui-datepicker-calendar"><tbody>
<tr><td class="ui-datepicker-other-month"><span class="ui-state-default">28</span><span class="badge">9</span></td><td><a class="ui-state-default" href="#">1</a></td><td><a class="ui-state-default" href="#">5<span class="badge">5</span></a></td></tr>
<tr><td><a class="ui-state-default" href="#">22</a></td><td><a class="ui-state-default" href="#">23</a><span class="badge">1</span></td></tr>
</tbody></table></div></div>
<div class="today-box"><div class="box-title"><h4>Cases Listed Today - 31-10-2026</h4></div><div class="activeCasestbl">No Cases</div></div>
<div id="db_screen"><div id="history_body"></div></div>
<div class="modal" id="mod_status" style="display:none"><div class="modal-content">
  <button class="close">×</button>
  <div><b>STC/4377/2026</b></div><div><b>METROPOLITAN MAGISTRATE COURTS, SAIDAPET, CHENNAI</b></div>
  <div><b>Ambeth Arivukarasan Proprietor Thoorigai Prints Vs R Venkatesh Bhat Proprietor Ms Venki Publications</b></div>
  <ul class="nav nav-tabs"><li><a href="#st_doc" data-toggle="tab" onclick="fxTab('st_doc')">Document</a></li><li><a href="#st_app" data-toggle="tab" onclick="fxTab('st_app')">Application</a></li><li><a href="#st_fee" data-toggle="tab" onclick="fxTab('st_fee')">Court Fee</a></li><li><a href="#st_oath" data-toggle="tab" onclick="fxTab('st_oath')">Oath</a></li></ul>
  <div class="tab-content"><div id="st_doc" class="tab-pane"></div><div id="st_app" class="tab-pane" style="display:none"></div><div id="st_fee" class="tab-pane" style="display:none"></div><div id="st_oath" class="tab-pane" style="display:none"></div></div>
</div></div>
<script>
  // Like the portal's fetchPleadingData: fill the row's hidden pop-up, then show it.
  function fxDocs(id) {
    setTimeout(function () {
      document.getElementById('example_pl' + id).innerHTML = '<thead><tr><th>Sr. No.</th><th>File Name</th><th>Uploaded On</th><th>Final Submitted On</th><th>Status</th><th>CIS Status</th></tr></thead><tbody>'
        + '<tr class="dtrg-group"><td colspan="6">Ambeth Arivukarasan Proprietor Thoorigai Prints</td></tr>'
        + '<tr><td>1</td><td>COMPLAINT (ATN20250009438D202600001)</td><td>27-08-2026 15:00:56</td><td>27-08-2026 15:09:56</td><td>Submitted</td><td>Approved</td></tr>'
        + '<tr><td>2</td><td>PROOF AFFIDAVIT (ATN20250009438D202600002)</td><td>27-08-2026 15:01:19</td><td>27-08-2026 15:09:56</td><td>Submitted</td><td>Approved</td></tr></tbody>';
      document.getElementById('dv_challan' + id).insertAdjacentHTML('afterbegin', '<div class="dataTables_length">Show <select><option>10</option><option>25</option><option>50</option><option>100</option></select> entries</div>');
      setTimeout(function () { document.getElementById('dv_challan' + id).style.display = 'block'; }, 400);
    }, 600);
  }
  var FX_TABS = {
    st_doc: '<table><thead><tr><th>Sr.No.</th><th>Document</th><th>Status</th><th>Return For Rejection</th><th>Submitted On</th><th>Approved On</th></tr></thead><tbody><tr><td>1</td><td>COMPLAINT (ATN20250009438D202600001)</td><td>Approved</td><td></td><td>27-08-2026 15:09:56</td><td>27-08-2026 00:00:00</td></tr><tr><td>2</td><td>VAKALAT (ATN20250009438D202600003)</td><td>Approved</td><td></td><td>27-08-2026 15:09:56</td><td>27-08-2026 00:00:00</td></tr></tbody></table>',
    st_app: '<p>No applications filed.</p>',
    st_fee: '<table><thead><tr><th>Sr.No.</th><th>GRN</th><th>Amount</th></tr></thead><tbody><tr><td>1</td><td>TNCT2716H2608P694</td><td>6600.00</td></tr></tbody></table>',
    st_oath: '<p>No oath recording.</p>'
  };
  // Each tab loads its own part, a moment after it is clicked.
  function fxTab(id) {
    ['st_doc', 'st_app', 'st_fee', 'st_oath'].forEach(function (t) { document.getElementById(t).style.display = t === id ? 'block' : 'none'; });
    var pane = document.getElementById(id); pane.innerHTML = '';
    setTimeout(function () { pane.innerHTML = FX_TABS[id]; }, 500);
    return false;
  }
  function fxStatus() {
    setTimeout(function () { document.getElementById('mod_status').style.display = 'block'; fxTab('st_doc'); }, 400);
  }
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
  if (req.method() === 'GET' && p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: fx.signedOut ? loginPage : dashboardPage() });
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
  // A dead session: the portal's ajax gets no list back.
  if (tile && fx.signedOut) return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
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
    const view = await live.readPortalCounts(sessionId, USER);
    expect(view.counts).toEqual({ draft_pleadings: 1, completed_pleadings: 2, draft_ias: 0, completed_ias: 3, objections: 1, my_cases: 1 });
    // The Calendar's badges (other-month days skipped) and "Cases Listed Today".
    expect(view.calendar).toEqual({ month: 10, year: 2026, days: { '5': 5, '23': 1 } });
    expect(view.today).toEqual({ title: 'Cases Listed Today - 31-10-2026', table: null, text: 'No Cases' });
    const one = await live.readPortalList(sessionId, USER, 'objections');
    expect(one).toMatchObject({ key: 'objections', total: 1, rows: [{ group: 'C202600004 - Maintenance Application' }, { cells: ['1', 'Court fee deficit of Rs. 120.', '21-10-2026'] }] });
  });

  it("Completed Pleadings comes back with the portal's own columns and row", async () => {
    const l = await live.readPortalList(sessionId, USER, 'completed_pleadings');
    expect(l.error).toBeNull();
    expect(l.headers).toEqual(['Sr.No.', 'e-Filing Number / Case Number', 'Establishment', 'Cause Title', 'Upload Pleadings (Mandatory)', 'Oath Recording', 'ePayments', 'Application Submitted', 'Last Updated on', 'Status']);
    const row = l.rows[0] as { cells: string[] };
    expect(row.cells[1]).toBe('STC/4377/2026\n(TNCH0C0121292026)\nSTC - ATN20250009438C202600002\nCourt Verified eFile Case\nAcknowledgement');
    expect(row.cells[3]).toBe('Ambeth Arivukarasan Proprietor Thoorigai Prints\nVs\nR Venkatesh Bhat Proprietor Ms Venki Publications');
    expect(row.cells[2]).toBe('The Metropolitan Magistrates Courts, Saidapet, Chennai');
    expect(row.cells[6]).toBe('TNCT2716H2608P694 - 6600.00');
    expect(row.cells[8]).toBe('27-08-2026 15:09:56');
  });

  it('the list is the portal\'s main table only: no search bar, no rows of the hidden pop-ups; each row carries its buttons', async () => {
    const l = await live.readPortalList(sessionId, USER, 'completed_pleadings');
    expect(l.rows).toHaveLength(1);
    const row = l.rows[0] as { cells: string[]; actions?: string[] };
    expect(row.cells).toHaveLength(10);
    expect(row.cells[4]).toBe('View Documents');
    expect(row.actions).toEqual(['Acknowledgement', 'View Documents', 'View Status']);
  });

  it('View Documents: the row\'s own pop-up, grouped by party, as on the portal', async () => {
    const row = ((await live.readPortalList(sessionId, USER, 'completed_pleadings')).rows[0] as { cells: string[] }).cells;
    const v = await live.openPortalRowAction(sessionId, USER, 'completed_pleadings', row.slice(0, 2), 'View Documents');
    expect(v.sections).toHaveLength(1);
    expect(v.sections[0]!.table).toEqual({
      headers: ['Sr. No.', 'File Name', 'Uploaded On', 'Final Submitted On', 'Status', 'CIS Status'],
      rows: [
        { group: 'Ambeth Arivukarasan Proprietor Thoorigai Prints' },
        { cells: ['1', 'COMPLAINT (ATN20250009438D202600001)', '27-08-2026 15:00:56', '27-08-2026 15:09:56', 'Submitted', 'Approved'] },
        { cells: ['2', 'PROOF AFFIDAVIT (ATN20250009438D202600002)', '27-08-2026 15:01:19', '27-08-2026 15:09:56', 'Submitted', 'Approved'] },
      ],
    });
  }, 60_000);

  it('View Status: the case heading and every tab (Document, Application, Court Fee, Oath), each read after it loads', async () => {
    const row = ((await live.readPortalList(sessionId, USER, 'completed_pleadings')).rows[0] as { cells: string[] }).cells;
    const v = await live.openPortalRowAction(sessionId, USER, 'completed_pleadings', row.slice(0, 2), 'View Status');
    expect(v.title).toEqual(['STC/4377/2026', 'METROPOLITAN MAGISTRATE COURTS, SAIDAPET, CHENNAI', 'Ambeth Arivukarasan Proprietor Thoorigai Prints Vs R Venkatesh Bhat Proprietor Ms Venki Publications']);
    expect(v.sections.map((x) => x.name)).toEqual(['Document', 'Application', 'Court Fee', 'Oath']);
    expect(v.sections[0]!.table?.rows).toEqual([
      { cells: ['1', 'COMPLAINT (ATN20250009438D202600001)', 'Approved', '', '27-08-2026 15:09:56', '27-08-2026 00:00:00'] },
      { cells: ['2', 'VAKALAT (ATN20250009438D202600003)', 'Approved', '', '27-08-2026 15:09:56', '27-08-2026 00:00:00'] },
    ]);
    expect(v.sections[1]).toMatchObject({ table: null, text: 'No applications filed.' });
    expect(v.sections[2]!.table?.rows).toEqual([{ cells: ['1', 'TNCT2716H2608P694', '6600.00'] }]);
    expect(v.sections[3]).toMatchObject({ table: null, text: 'No oath recording.' });
  }, 60_000);

  it('clicking tiles quickly: each read waits its turn instead of failing', async () => {
    const [a, b, c] = await Promise.all([
      live.readPortalCounts(sessionId, USER),
      live.readPortalList(sessionId, USER, 'completed_pleadings'),
      live.readPortalList(sessionId, USER, 'objections'),
    ]);
    expect(a.counts.completed_pleadings).toBe(2);
    expect(b.rows).toHaveLength(1);
    expect(c.total).toBe(1);
  });

  it('runs one portal step at a time: a second request meanwhile is told to wait', async () => {
    const results = await Promise.allSettled([live.readPortalLists(sessionId, USER), live.readPortalLists(sessionId, USER)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason?.message)).toMatch(/Still working on your last eFiling step/);
  });

  it('the portal signs the session out (account opened elsewhere): 410 "log in again", never 401, and the session shows logged out', async () => {
    fx.signedOut = true;
    try {
      const err = await live.readPortalList(sessionId, USER, 'draft_ias').then(() => null, (e: { status?: number; message?: string }) => e);
      expect(err?.status).toBe(410);
      expect(err?.message).toMatch(/signed this session out.*Log in again/);
      expect(live.efilingSessionStatus(sessionId, USER).authenticated).toBe(false);
      // Refresh says the same straight away.
      await expect(live.readPortalCounts(sessionId, USER)).rejects.toMatchObject({ status: 410 });
    } finally {
      fx.signedOut = false;
    }
    // Log in again, as the advocate would.
    await live.endEfilingSession(sessionId, USER);
    ({ sessionId } = await live.startEfilingSession(USER, '4', 'advocate'));
    await live.submitEfilingCredentials(sessionId, USER, 'adv@example.com', PASSWORD);
    expect(await live.submitEfilingLoginCaptcha(sessionId, USER, fx.lastCode)).toEqual({ status: 'authenticated' });
    fx.loggedOut = false;
  }, 90_000);

  it('"Log out of eFiling" also logs out on the portal (one session per account)', async () => {
    await live.endEfilingSession(sessionId, USER);
    expect(fx.loggedOut).toBe(true);
    sessionId = '';
  });
});
