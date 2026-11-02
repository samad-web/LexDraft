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
  pdfServed: [] as string[],
  /** Every POST route the stand-in portal received. */
  posts: [] as string[],
  mapped: [] as string[],
  /** My Cases keeps its cases in window globals (as the portal's my_cases.js does). */
  myCasesGlobals: true,
  /** The portal's newer My Cases: a group's case links are not on the page until it is opened. */
  lazyCaseLinks: false,
  /** The widget's own requests (portfolio/...), with what they sent. */
  portfolio: [] as Array<{ route: string; body: string }>,
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

// ---- My Cases: the portal's portfolio widget ------------------------------------
// Portfolio_new/my_cases is a page with its own script (js/portfolio/my_cases.js):
// it asks portfolio/getMyCasesData/ for { mycases_dc, mycases_hc }, keeps them in
// the globals CNR_Numbers_ef / CNR_Numbers_HC_ef, gets who the advocate represents
// (portfolio/getRepresentingForCinos/ -> allCNRRepresentative) and draws the
// district panels itself. A case link (.show_case_history_link) loads
// portfolio/getCaseHistory/ into #case_history; a hearing date there calls
// viewBusiness() -> portfolio/getViewBusiness/ -> #show_business.

const istIso = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);
const FUTURE = istIso(10);
const LATER = istIso(40);
const PAST = istIso(-20);
const dmyOf = (iso: string) => iso.split('-').reverse().join('-');

const MY_CASES = {
  dc: [
    { cino: 'TNCH0C0012342024', hc_dc: 'D', type_name: 'OS', case_no: '200100000572024', reg_no: '57', reg_year: '2024', fil_no: '80', fil_year: '2024', pet_name: 'Ramesh Kumar', res_name: 'Suresh Babu', state_code: '10', state_name: 'Tamil Nadu', district_code: '2', district_name: 'Chennai', establishment_code: 'TNCH0C', establishment_name: 'City Civil Court, Chennai', desgname: '1-Principal Judge', date_next_list: FUTURE, date_last_list: PAST, date_of_decision: null, registration_date: '2024-03-15', purpose_cd: '4', purpose_name: 'Hearing', ci_cri: 'civil', pde_no: '', under_obj: 'N', updated: true },
    { cino: 'TNCH0D0045672020', hc_dc: 'D', type_name: 'CC', case_no: '201200000122020', reg_no: '12', reg_year: '2020', fil_no: '30', fil_year: '2020', pet_name: 'State', res_name: 'Murugan', state_code: '10', state_name: 'Tamil Nadu', district_code: '2', district_name: 'Chennai', establishment_code: 'TNCH0D', establishment_name: 'Metropolitan Magistrate Court, Egmore', desgname: '3-Metropolitan Magistrate', date_next_list: null, date_last_list: '2026-09-15', date_of_decision: '2026-09-15', registration_date: '2020-01-10', purpose_cd: '', purpose_name: '', ci_cri: 'criminal', pde_no: '', under_obj: 'N', updated: true },
    { cino: 'TNCH0C0099992023', hc_dc: 'D', type_name: 'OS', case_no: '200100000902023', reg_no: '90', reg_year: '2023', fil_no: '91', fil_year: '2023', pet_name: 'Lakshmi', res_name: 'Kannan', state_code: '10', state_name: 'Tamil Nadu', district_code: '2', district_name: 'Chennai', establishment_code: 'TNCH0C', establishment_name: 'City Civil Court, Chennai', desgname: '2-Additional Judge', date_next_list: PAST, date_last_list: istIso(-50), date_of_decision: null, registration_date: '2023-06-01', purpose_cd: '2', purpose_name: 'Evidence', ci_cri: 'civil', pde_no: '', under_obj: 'N', updated: true },
    { cino: 'TNCB0A0000012026', hc_dc: 'D', type_name: 'OP', case_no: '', reg_no: '', reg_year: '', fil_no: '101', fil_year: '2026', pet_name: 'Priya', res_name: 'Arun', state_code: '10', state_name: 'Tamil Nadu', district_code: '5', district_name: 'Coimbatore', establishment_code: 'TNCB0A', establishment_name: 'Family Court, Coimbatore', desgname: '1-Judge', date_next_list: '5000-01-01', date_last_list: null, date_of_decision: null, registration_date: null, purpose_cd: '', purpose_name: '', ci_cri: 'civil', pde_no: 'ATN20250009438C202600007', under_obj: 'Y', updated: true },
  ],
  hc: [
    { cino: 'HCMA010012342025', hc_dc: 'H', type_name: 'WP', case_no: '201000012342025', reg_no: '1234', reg_year: '2025', fil_no: '5000', fil_year: '2025', pet_name: 'Ramesh Kumar', res_name: 'The District Collector', state_code: '10', state_name: 'Tamil Nadu', district_code: '1', district_name: 'Chennai', establishment_code: 'HCMA01', establishment_name: 'High Court of Madras', desgname: 'Court 5-Hon\'ble Justice', date_next_list: LATER, date_last_list: PAST, date_of_decision: null, registration_date: '2025-02-01', purpose_cd: '1', purpose_name: 'Admission', ci_cri: 'civil', pde_no: '', under_obj: 'N', updated: true },
  ],
};

const CASE_HISTORY = '<h2>City Civil Court, Chennai</h2><h3>Case Details</h3><table class="case_details_table"><tr><td>Case Type</td><td>OS - Original Suit</td></tr><tr><td>Registration Number</td><td>57/2024</td></tr><tr><td>CNR Number</td><td>TNCH0C0012342024</td></tr></table>'
  + `<h3>Case Status</h3><table><tr><td>First Hearing Date</td><td>20-03-2024</td></tr><tr><td>Next Hearing Date</td><td>${dmyOf(FUTURE)}</td></tr><tr><td>Case Stage</td><td>Hearing</td></tr></table>`
  + '<h3>Petitioner and Advocate</h3><div><span class="Petitioner_Advocate_table">1) Ramesh Kumar<br>Advocate- S. Advocate</span></div>'
  + '<h3>Case History</h3><table class="history_table"><thead><tr><th>Judge</th><th>Business on Date</th><th>Hearing Date</th><th>Purpose of hearing</th></tr></thead><tbody>'
  + `<tr><td>Principal Judge</td><td><a href="#" onclick="viewBusiness('TNCH0C','2','${FUTURE}','200100000572024','10','N','${dmyOf(PAST)}','1','D');return false;">${dmyOf(PAST)}</a></td><td>${dmyOf(FUTURE)}</td><td>Hearing</td></tr></tbody></table>`;

const MY_CASES_PAGE = `<div id="My_Cases_pannel">
<div id="datewiseDistrictwiseDiv"><button type="button" id="datewise">Date wise</button><button type="button" id="districtwise">District wise</button>
<span class="badge" id="mycases_span_id"></span> <span>[Last refreshed on 23-10-2026 20:06:41]</span>
<label>Search Keyword</label><select id="txt_case_search1"><option value="">Select</option></select></div>
<div id="pendingDisposedDiv"><button type="button" class="pendingDisposed" pendingDisposedValue="Pending">Pending</button><button type="button" class="pendingDisposed" pendingDisposedValue="Disposed">Disposed</button><button type="button" class="pendingDisposed" id="bothBtn" pendingDisposedValue="Both">Both</button></div>
<h5 id="districtcourtcasestxt" style="display:none">District Court Cases</h5><div id="ditrictsAccordion"></div>
<h5 id="highcourtcasestxt" style="display:none">High Court Cases</h5><div id="hcAccordion"></div>
<p id="nocasestxt" style="display:none">No cases added to My Cases</p>
<div id="case_history_div" style="display:none"><button type="button" onclick="fxHistoryBack()">Back</button><div id="case_history"></div></div>
<div id="show_business" style="display:none"></div>
</div>
<script>
FXTOP
(function () {
  FXLOCAL
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function draw(arr, hcdc) {
    var box = document.getElementById(hcdc === 'd' ? 'ditrictsAccordion' : 'hcAccordion');
    var byDist = {}; arr.forEach(function (c) { (byDist[c.district_code] = byDist[c.district_code] || []).push(c); });
    var html = '';
    Object.keys(byDist).forEach(function (k, i) {
      var l = byDist[k];
      html += '<div class="panel-group-main1 main_' + hcdc + '"><div class="card"><div class="card-header"><h4 class="panel-title"><a class="card-link collapsed panel-title-a panel-title-a-main" href="#abc_' + hcdc + i + '">' + l[0].district_name + ',' + l[0].state_name + '<span id="caseslength">  (' + l.length + ')</span></a></h4></div></div>';
      var byEst = {}; l.forEach(function (c) { (byEst[c.establishment_code] = byEst[c.establishment_code] || []).push(c); });
      html += '<div id="abc_' + hcdc + i + '" class="collapse"><div class="card-body">';
      Object.keys(byEst).forEach(function (e) {
        var cs = byEst[e];
        html += '<div class="card"><div class="card-header"><h4 class="panel-title"><a class="card-link collapsed panel-title-a" href="#">' + cs[0].establishment_name + '(<span id="estCasesLength">' + cs.length + '</span>)</a></h4></div>'
          + '<div class="collapse show"><div class="card-body context"><table class="table tbl-result"><thead><tr><th>Sr No</th><th>Case Number</th><th>Next/Disposal Date</th><th>Status</th><th>Cause Title</th><th>Representing</th><th>Registration Date</th></tr></thead><tbody>';
        cs.forEach(function (c, n) {
          var filing = !c.case_no;
          var no = c.type_name + '/' + (filing ? c.fil_no + '/' + c.fil_year : c.reg_no + '/' + c.reg_year);
          var d = c.date_of_decision || (c.date_next_list === '5000-01-01' ? null : c.date_next_list);
          var cal = d ? '<time class="date-as-calendar"><span class="month">' + MON[Number(d.slice(5, 7)) - 1] + '</span><span class="day">' + Number(d.slice(8)) + '</span><span class="year">' + d.slice(0, 4) + '</span></time>' : '<time class="date-as-calendar"><span class="day"><i>No Date</i></span></time>';
          html += '<tr class="trSelected"><td>' + (n + 1) + '</td><td><a href="#" class="' + (filing ? 'show_filing_case_history_link' : 'show_case_history_link') + '" cino="' + c.cino + '" hcdc="' + c.hc_dc + '" state_code="' + c.state_code + '" case_no="' + no + '">' + no + '</a>' + (filing ? '  (F)' : '') + '<br>' + c.desgname + '</td><td>' + cal + '</td><td><div class="' + (c.date_of_decision ? 'DCal' : 'PCal') + '">' + (c.date_of_decision ? 'Disposed' : 'Pending') + '</div></td><td><span>' + c.pet_name + ' <div class="font-weight-bold">Vs</div> ' + c.res_name + '</span></td><td></td><td>' + (c.registration_date || '') + '</td></tr>';
        });
        html += '</tbody></table></div></div></div>';
      });
      html += '</div></div></div>';
    });
    box.innerHTML = html;
    box.style.display = 'block';
  }
  fxPost('portfolio/getMyCasesData/', 'configuration=D', function (obj) {
    CNR_Numbers_ef = JSON.stringify(obj.mycases_dc);
    CNR_Numbers_HC_ef = JSON.stringify(obj.mycases_hc);
    document.getElementById('mycases_span_id').innerHTML = obj.mycases_dc.length + obj.mycases_hc.length;
    if (!obj.mycases_dc.length && !obj.mycases_hc.length) { document.getElementById('nocasestxt').style.display = 'block'; return; }
    if (obj.mycases_dc.length) { document.getElementById('districtcourtcasestxt').style.display = 'block'; draw(obj.mycases_dc, 'd'); }
    if (obj.mycases_hc.length) { document.getElementById('highcourtcasestxt').style.display = 'block'; draw(obj.mycases_hc, 'h'); }
    var cinos = obj.mycases_dc.concat(obj.mycases_hc).map(function (c) { return "'" + c.cino + "'"; }).join(',');
    fxPost('portfolio/getRepresentingForCinos/', 'cnr_numbers=' + encodeURIComponent(cinos), function (r) {
      allCNRRepresentative = r.existing_cases.reduce(function (acc, cur) { (acc[cur.cino] = acc[cur.cino] || []).push(cur); return acc; }, {});
    });
  });
  // Bound once per page, like $(document).on('click', '.show_case_history_link', ...).
  if (!window.fxMyCasesBound) window.fxMyCasesBound = document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.show_case_history_link, .show_filing_case_history_link');
    if (!a) return;
    e.preventDefault();
    var url = a.classList.contains('show_filing_case_history_link') ? 'portfolio/getFilingCaseHistory/' : 'portfolio/getCaseHistory/';
    fxPost(url, 'cino1=' + a.getAttribute('cino') + '&source=mycases&language_flag=marathi&bilingual_flag=0&selected_court=' + a.getAttribute('hcdc'), function (obj) {
      document.getElementById('case_history').innerHTML = obj.option;
      ['pendingDisposedDiv', 'datewiseDistrictwiseDiv', 'ditrictsAccordion', 'hcAccordion', 'districtcourtcasestxt', 'highcourtcasestxt'].forEach(function (id) { document.getElementById(id).style.display = 'none'; });
      document.getElementById('case_history_div').style.display = 'block';
    });
  }) || true;
})();
function viewBusiness(court_code, dist_code, nextdate1, case_number1, state_code, disposal_flag, businessDate, court_no, selected_court) {
  document.getElementById('case_history_div').style.display = 'none';
  fxPost('portfolio/getViewBusiness/', 'court_code=' + court_code + '&dist_code=' + dist_code + '&nextdate1=' + nextdate1 + '&case_number1=' + case_number1 + '&state_code=' + state_code + '&disposal_flag=' + disposal_flag + '&businessDate=' + businessDate + '&court_no=' + court_no + '&selected_court=' + selected_court, function (obj) {
    var b = document.getElementById('show_business'); b.innerHTML = obj.option; b.style.display = 'block';
  });
}
function fxHistoryBack() { document.getElementById('case_history_div').style.display = 'none'; }
</script>`;

// fx.myCasesGlobals = false: the cases live inside the widget's own scope,
// so DifAi has to read what the widget drew instead.
const myCasesPage = () => MY_CASES_PAGE
  .replace('FXTOP', fx.myCasesGlobals ? 'var CNR_Numbers_ef, CNR_Numbers_HC_ef; var allCNRRepresentative = [];' : '')
  .replace('FXLOCAL', fx.myCasesGlobals ? '' : 'var CNR_Numbers_ef, CNR_Numbers_HC_ef, allCNRRepresentative;')
  .replace("(filing ? 'show_filing_case_history_link' : 'show_case_history_link')", fx.lazyCaseLinks ? "'fx_group_closed'" : "(filing ? 'show_filing_case_history_link' : 'show_case_history_link')");

const TILES: Record<string, { route: string; field: string; html: string }> = {
  draft_cases: { route: 'advocate_case_registration/getUnRegisteredPDE', field: 'pde_list', html: '<table><thead><tr><th>Sr. No.</th><th>E-Filing Number</th><th>Litigant Name</th></tr></thead><tbody><tr><td>1</td><td>59/2026</td><td>Ramesh Kumar</td></tr></tbody></table>' },
  filed_cases: { route: 'advocate_case_registration/getSubmittedPDE', field: 'submitted_pde_list', html: '<table><thead><tr><th>Sr.No.</th><th>E-Filing No</th></tr></thead><tbody></tbody></table>' },
  efiling_activity: { route: 'dashboard/fetchActivities', field: 'submitted_pde_list', html: '<table><thead><tr><th>Sr.No.</th><th>e-Filing Number / Case Number</th><th>ePayments</th></tr></thead><tbody><tr><td>1</td><td>O.S. - C202600019</td><td><select><option>Select GRN</option><option>KL26GRN00012345 - 4320.00</option></select></td></tr></tbody></table>' },
  // As the real portal returns it (columns, buttons and links as on screen).
  completed_pleading: { route: 'dashboard/fetchCompletedActivities', field: 'submitted_pde_list', html: '<table class="search"><tr><td>Search By (eFiling Number/CNR Number/Party Name)</td><td><input></td><td><button>Search</button></td><td><button>Clear</button></td></tr></table><table id="example1" class="table"><thead><tr><th>Sr.No.</th><th>e-Filing Number / Case Number</th><th>Establishment</th><th>Cause Title</th><th>Upload Pleadings (Mandatory)</th><th>Oath Recording</th><th>ePayments</th><th>Application Submitted</th><th>Last Updated on</th><th>Status</th></tr></thead><tbody><tr><td>1</td><td><b>STC/4377/2026</b><br>(TNCH0C0121292026)<br>STC - ATN20250009438C202600002<br><span class="badge">Court Verified eFile Case</span><br><a href="#" onclick="return fxAck()">Acknowledgement</a></td><td>The Metropolitan Magistrates Courts, Saidapet, Chennai</td><td><a href="#">Ambeth Arivukarasan Proprietor Thoorigai Prints</a><br>Vs<br><a href="#">R Venkatesh Bhat Proprietor Ms Venki Publications</a></td><td><button class="btn" id="btn-pop7" onclick="fxDocs(7)">View Documents</button><div class="popup" id="pop7" style="display:none"><div id="dv_challan7"><table id="example_pl7"><thead><tr><th>Sr. No.</th><th>File Name</th><th>Uploaded On</th><th>Final Submitted On</th><th>Status</th><th>CIS Status</th></tr></thead><tbody><tr><td>0</td><td>stale</td><td></td><td></td><td></td><td></td></tr></tbody></table></div></div></td><td>---</td><td>TNCT2716H2608P694 - 6600.00</td><td></td><td>27-08-2026 15:09:56</td><td><button class="btn" onclick="fxStatus()">View Status</button></td></tr></tbody></table>' },
  draft_ia: { route: 'dashboard/fetchDraftIA', field: 'submitted_pde_list', html: '<table><tbody></tbody></table>' },
  completed_ia: { route: 'dashboard/fetchCompletedIA', field: 'submitted_pde_list', html: '<table><tbody></tbody></table>' },
  // The widget page itself (myCasesPage()), served when the tile is clicked.
  my_cases: { route: 'Portfolio_new/my_cases', field: 'html', html: '' },
  objections: { route: 'dashboard/fetchObjections', field: 'table', html: '<table id="tblFavClient"><thead><tr><th>Sr.No.</th><th>Reason</th><th>Date</th></tr></thead><tbody><tr><td colspan="3">C202600004 - Maintenance Application</td></tr><tr><td>1</td><td>Court fee deficit of Rs. 120.</td><td>21-10-2026</td></tr></tbody></table>' },
};

const dashboardPage = () => `<!doctype html><html><body>
<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="${fx.csrf}">
<ul class="navbar"><li class="dropdown"><a class="dropdown-toggle" href="#">Pleadings</a><ul class="dropdown-menu">
  <li><a href="${ORIGIN}/pdedev/?p=upload_pleading">Pleading Upload</a></li>
  <li><a href="#" onclick="fx.deleted = 1">Delete Draft</a></li></ul></li></ul>
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
        + '<tr><td>1</td><td><a href="#" onclick="return fxPdf(1)">COMPLAINT</a> (ATN20250009438D202600001)</td><td>27-08-2026 15:00:56</td><td>27-08-2026 15:09:56</td><td>Submitted</td><td>Approved</td></tr>'
        + '<tr><td>2</td><td><a href="#" onclick="return fxPdf(2)">PROOF AFFIDAVIT</a> (ATN20250009438D202600002)</td><td>27-08-2026 15:01:19</td><td>27-08-2026 15:09:56</td><td>Submitted</td><td>Approved</td></tr></tbody>';
      document.getElementById('dv_challan' + id).insertAdjacentHTML('afterbegin', '<div class="dataTables_length">Show <select><option>10</option><option>25</option><option>50</option><option>100</option></select> entries</div>');
      setTimeout(function () { document.getElementById('pop' + id).style.display = 'block'; }, 400);
    }, 600);
  }
  function fxPdf(n) {
    var box = document.getElementById('vw_doc_app_list_modal');
    if (!box) { box = document.createElement('div'); box.id = 'vw_doc_app_list_modal'; box.className = 'modal'; document.body.appendChild(box); }
    box.innerHTML = '<div id="pdfPreviewContainer">Loading document...</div>';
    box.style.display = 'block';
    setTimeout(function () { document.getElementById('pdfPreviewContainer').innerHTML = '<iframe class="pdf-frame" src="/pdedev/temp/ATN20250009438D20260000' + n + '.pdf"></iframe>'; }, 500);
    return false;
  }
  function fxAck() {
    setTimeout(function () {
      var d = document.getElementById('dv_data') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'dv_data' }));
      d.innerHTML = '<object id="myPdf" type="application/pdf" data="/pdedev/temp/ack_STC_4377_2026.pdf"></object>';
    }, 500);
    return false;
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
  // The portal's ajaxCall: form body + ajax_req + the current token; the reply's nsteptoken is the next one.
  function fxPost(url, body, cb) {
    var x = new XMLHttpRequest(); x.open('POST', document.getElementById('base_url').value + '/?p=' + url);
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.onload = function () { var obj = JSON.parse(x.responseText); if (obj.nsteptoken) document.getElementById('__csrf_magic').value = obj.nsteptoken; cb(obj); };
    x.send(body + '&ajax_req=true&__csrf_magic=' + encodeURIComponent(document.getElementById('__csrf_magic').value));
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
        var body = document.getElementById('history_body');
        body.innerHTML = obj[TILES[id].field];
        // Like jQuery's .html(): the page's own scripts run.
        Array.prototype.forEach.call(body.querySelectorAll('script'), function (old) {
          var s = document.createElement('script'); s.text = old.text; old.parentNode.replaceChild(s, old);
        });
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
  if (req.method() === 'GET' && url.pathname.endsWith('.pdf')) {
    fx.pdfServed.push(url.pathname);
    return route.fulfill({ contentType: 'application/pdf', body: `%PDF-1.4 fixture ${url.pathname}` });
  }
  if (req.method() === 'GET' && p === 'login/logOut') {
    fx.loggedOut = true;
    return route.fulfill({ contentType: 'text/html', body: '<html><body>Logged out</body></html>' });
  }
  if (req.method() === 'GET' && p === 'upload_pleading') {
    fx.mapped.push(p);
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><script src="/pdedev/js/upload_pleading.js"></script></head><body><nav class="navbar"><div class="container"><select id="state_sel"><option>Tamil Nadu</option></select></div></nav><div class="container">
<h3>Pleading Upload</h3><ul class="nav nav-tabs"><li><a href="#a">Pleading Upload</a></li><li><a href="#b">Pleading Index</a></li></ul>
<label for="sel_pde_no">e-Filing Number</label><select id="sel_pde_no"><option>Select</option><option>ATN20250009438C202600002</option></select>
<div>Document Title</div><div><input id="doc_file_name" name="doc_file_name" value="secret typed value"></div>
<button id="add_btn" onclick="submitData()">Upload</button>
<table id="tbl"><thead><tr><th>Sr.No.</th><th>Document</th></tr></thead><tbody><tr><td>1</td><td>PRIVATE CLIENT DOC</td></tr></tbody></table></div></body></html>` });
  }
  if (req.method() === 'GET' && url.pathname.endsWith('upload_pleading.js')) return route.fulfill({ contentType: 'text/javascript', body: 'function submitData(){ /* portal js */ }' });
  if (req.method() === 'GET' && p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: fx.signedOut ? loginPage : dashboardPage() });
  // The login page is the portal's root; any other page this stand-in doesn't
  // have is an ordinary (empty) portal page, not a sign-out.
  if (req.method() === 'GET' && p && p !== 'login') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><input type="hidden" id="__csrf_magic" value="${fx.csrf}"><div class="container"><h3>Not in this stand-in: ${p}</h3></div></body></html>` });
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: loginPage });

  const f = form(req.postData());
  if (req.method() === 'POST') fx.posts.push(p);
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
  // The My Cases widget's own requests. They check the token but (for a calm
  // fixture) don't rotate it, so a late reply can't break the next tile's chain.
  if (p.startsWith('portfolio/')) {
    if (fx.signedOut) return route.fulfill({ status: 200, contentType: 'text/html', body: '' });
    fx.portfolio.push({ route: p, body: req.postData() ?? '' });
    if ((f.get('__csrf_magic') ?? '') !== fx.csrf) return route.fulfill({ status: 403, body: `Invalid token#####${fx.csrf}` });
    await new Promise((r) => setTimeout(r, 300));
    const reply = (o: Record<string, unknown>) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsteptoken: fx.csrf, ...o }) });
    if (p === 'portfolio/getMyCasesData/') return reply({ mycases_dc: MY_CASES.dc, mycases_hc: MY_CASES.hc });
    if (p === 'portfolio/getRepresentingForCinos/') return reply({ existing_cases: [{ cino: 'TNCH0C0012342024', litigant_type: 1, litigant_name: 'Ramesh Kumar', llitigant_name: null }] });
    if (p === 'portfolio/getCaseHistory/' || p === 'portfolio/getFilingCaseHistory/') {
      return reply({ option: /NOPE/.test(req.postData() ?? '') ? '' : CASE_HISTORY });
    }
    if (p === 'portfolio/getViewBusiness/') return reply({ option: `<span><b>Daily Status</b></span><table><tr><td>Business</td><td>Arguments heard in part.</td></tr><tr><td>Next Purpose</td><td>Hearing</td></tr><tr><td>Next Hearing Date</td><td>${dmyOf(FUTURE)}</td></tr></table>` });
    return reply({});
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
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsteptoken: fx.csrf, [tile.field]: tile.route === 'Portfolio_new/my_cases' ? myCasesPage() : tile.html, total_record: 1 }) });
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
    // My Cases is the portfolio widget, not a list (its own tests below); the tile opened.
    expect(lists.find((l) => l.key === 'my_cases')).toMatchObject({ total: 1, error: null });
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
        { cells: ['1', 'COMPLAINT (ATN20250009438D202600001)', '27-08-2026 15:00:56', '27-08-2026 15:09:56', 'Submitted', 'Approved'], actions: ['COMPLAINT'] },
        { cells: ['2', 'PROOF AFFIDAVIT (ATN20250009438D202600002)', '27-08-2026 15:01:19', '27-08-2026 15:09:56', 'Submitted', 'Approved'], actions: ['PROOF AFFIDAVIT'] },
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

  it('a document under View Documents opens as the PDF the portal shows (clicked there, fetched in the session)', async () => {
    const row = ((await live.readPortalList(sessionId, USER, 'completed_pleadings')).rows[0] as { cells: string[] }).cells;
    const v = await live.openPortalRowAction(sessionId, USER, 'completed_pleadings', row.slice(0, 2), 'View Documents');
    const doc = v.sections[0]!.table!.rows[1] as { cells: string[]; actions?: string[] };
    expect(doc.actions).toEqual(['COMPLAINT']);
    const f = await live.openPortalFile(sessionId, USER, 'completed_pleadings', { match: row.slice(0, 2), action: 'View Documents', docRow: doc.cells.slice(0, 2), link: 'COMPLAINT' });
    expect(f.contentType).toBe('application/pdf');
    expect(f.body.toString()).toBe('%PDF-1.4 fixture /pdedev/temp/ATN20250009438D202600001.pdf');
    const doc2 = v.sections[0]!.table!.rows[2] as { cells: string[] };
    const f2 = await live.openPortalFile(sessionId, USER, 'completed_pleadings', { match: row.slice(0, 2), action: 'View Documents', docRow: doc2.cells.slice(0, 2), link: 'PROOF AFFIDAVIT' });
    expect(f2.body.toString()).toBe('%PDF-1.4 fixture /pdedev/temp/ATN20250009438D202600002.pdf');
  }, 90_000);

  it('Acknowledgement in the list row opens its PDF', async () => {
    const row = ((await live.readPortalList(sessionId, USER, 'completed_pleadings')).rows[0] as { cells: string[] }).cells;
    const f = await live.openPortalFile(sessionId, USER, 'completed_pleadings', { match: row.slice(0, 2), link: 'Acknowledgement' });
    expect(f.body.toString()).toBe('%PDF-1.4 fixture /pdedev/temp/ack_STC_4377_2026.pdf');
  }, 90_000);

  it('My Cases: the tile opens the portfolio widget; its cases are the ones its own getMyCasesData fetched, with "Last refreshed on" and the badge', async () => {
    fx.portfolio = [];
    const mc = await live.readMyCases(sessionId, USER);
    expect(fx.portfolio.map((r) => r.route)).toEqual(['portfolio/getMyCasesData/', 'portfolio/getRepresentingForCinos/']);
    expect(fx.portfolio[0]!.body).toMatch(/^configuration=D&ajax_req=true&__csrf_magic=/);
    expect(mc.count).toBe(5);
    expect(mc.lastRefreshed).toBe('23-10-2026 20:06:41');
    expect(mc.message).toBeNull();
    expect(mc.cases.map((c) => [c.court, c.caseNo, c.filing])).toEqual([
      ['d', 'OS/57/2024', false], ['d', 'CC/12/2020', false], ['d', 'OS/90/2023', false], ['d', 'OP/101/2026', true], ['h', 'WP/1234/2025', false],
    ]);
    expect(mc.cases[0]).toMatchObject({
      cino: 'TNCH0C0012342024', petName: 'Ramesh Kumar', resName: 'Suresh Babu', nextDate: FUTURE, decisionDate: null, purpose: '4-Hearing', ciCri: 'Civil',
      courtNoDesg: '1-Principal Judge', registrationDate: '2024-03-15', representing: { as: 'Petitioner', names: ['Ramesh Kumar'] }, notice: '',
    });
    expect(mc.cases[0]!.age).toMatch(/^\( \d+ year\(s\)( \d+ month\(s\))?\)$/);
    expect(mc.cases[1]).toMatchObject({ decisionDate: '2026-09-15', ciCri: 'Criminal', age: '' });
    // 5000-01-01 is the portal's "Date Not Given"; a filing number only is "(F)".
    expect(mc.cases[3]).toMatchObject({ nextDate: null, pdeNo: 'ATN20250009438C202600007', underObjection: true });
  }, 60_000);

  it('My Cases District wise: a panel per district with its count, holding a table per establishment (Both / Pending / Disposed)', async () => {
    const mc = await live.readMyCases(sessionId, USER);
    const titles = (g: Array<{ title: string; count: number }>) => g.map((x) => [x.title, x.count]);
    const inside = (g: (typeof mc.views.district.Both.d)[number]) => g.establishments.map((e) => [e.name, e.cases.map((i) => mc.cases[i]!.caseNo)]);
    const both = mc.views.district.Both;
    expect(titles(both.d)).toEqual([['Chennai,Tamil Nadu', 3], ['Coimbatore,Tamil Nadu', 1]]);
    expect(inside(both.d[0]!)).toEqual([['City Civil Court, Chennai', ['OS/57/2024', 'OS/90/2023']], ['Metropolitan Magistrate Court, Egmore', ['CC/12/2020']]]);
    expect(inside(both.d[1]!)).toEqual([['Family Court, Coimbatore', ['OP/101/2026']]]);
    expect(titles(both.h)).toEqual([['Chennai,Tamil Nadu', 1]]);
    expect(titles(mc.views.district.Pending.d)).toEqual([['Chennai,Tamil Nadu', 2], ['Coimbatore,Tamil Nadu', 1]]);
    expect(inside(mc.views.district.Pending.d[0]!)).toEqual([['City Civil Court, Chennai', ['OS/57/2024', 'OS/90/2023']]]);
    expect(titles(mc.views.district.Disposed.d)).toEqual([['Chennai,Tamil Nadu', 1]]);
    expect(mc.views.district.Disposed.h).toEqual([]);
  }, 60_000);

  it('My Cases Date wise: Disposed Cases, Date Not Given, Undated Cases on top, then each next date under its month', async () => {
    const mc = await live.readMyCases(sessionId, USER);
    const titles = (g: Array<{ title: string; count: number; divider?: string }>) => g.map((x) => [x.title, x.count, x.divider ?? '']);
    const month = (iso: string) => `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
    expect(titles(mc.views.date.Both.d)).toEqual([['Disposed Cases', 1, ''], ['Date Not Given', 1, ''], ['Undated Cases', 1, ''], [dmyOf(FUTURE), 1, month(FUTURE)]]);
    expect(titles(mc.views.date.Pending.d)).toEqual([['Date Not Given', 1, ''], ['Undated Cases', 1, ''], [dmyOf(FUTURE), 1, month(FUTURE)]]);
    expect(titles(mc.views.date.Disposed.d)).toEqual([['Disposed Cases', 1, '']]);
    expect(titles(mc.views.date.Both.h)).toEqual([[dmyOf(LATER), 1, month(LATER)]]);
    const undated = mc.views.date.Both.d[2]!;
    expect(undated.establishments).toEqual([{ name: 'City Civil Court, Chennai', district: 'Chennai', cases: [2] }]);
  }, 60_000);

  it('My Cases: a case number opens its case history, clicked in the widget as on the portal', async () => {
    fx.portfolio = [];
    const h = await live.openMyCaseHistory(sessionId, USER, 'TNCH0C0012342024', 'd');
    expect(fx.portfolio.map((r) => r.route)).toContain('portfolio/getCaseHistory/');
    expect(fx.portfolio.find((r) => r.route === 'portfolio/getCaseHistory/')!.body).toMatch(/^cino1=TNCH0C0012342024&source=mycases&.*selected_court=D/);
    expect(h.name).toBe('Case History');
    const headings = h.blocks.filter((b) => b.kind === 'heading').map((b) => b.text);
    expect(headings).toEqual(['City Civil Court, Chennai', 'Case Details', 'Case Status', 'Petitioner and Advocate', 'Case History']);
    const tables = h.blocks.filter((b) => b.kind === 'table').map((b) => b.table!);
    expect(tables[0]!.rows).toEqual([{ cells: ['Case Type', 'OS - Original Suit'] }, { cells: ['Registration Number', '57/2024'] }, { cells: ['CNR Number', 'TNCH0C0012342024'] }]);
    expect(h.blocks.find((b) => b.kind === 'text')).toEqual({ kind: 'text', lines: ['1) Ramesh Kumar', 'Advocate- S. Advocate'], links: [] });
    expect(tables[2]).toEqual({
      headers: ['Judge', 'Business on Date', 'Hearing Date', 'Purpose of hearing'],
      rows: [{ cells: ['Principal Judge', dmyOf(PAST), dmyOf(FUTURE), 'Hearing'], actions: [dmyOf(PAST)] }],
    });
  }, 60_000);

  it('My Cases: a Business on Date in the history opens the Daily Status (viewBusiness)', async () => {
    fx.portfolio = [];
    const d = await live.openMyCaseHistory(sessionId, USER, 'TNCH0C0012342024', 'd', { text: dmyOf(PAST), nth: 0 });
    expect(fx.portfolio.map((r) => r.route).slice(-1)).toEqual(['portfolio/getViewBusiness/']);
    expect(d.name).toBe('Daily Status');
    expect(d.blocks[0]).toEqual({ kind: 'text', lines: ['Daily Status'], links: [] });
    expect(d.blocks[1]!.table!.rows).toEqual([{ cells: ['Business', 'Arguments heard in part.'] }, { cells: ['Next Purpose', 'Hearing'] }, { cells: ['Next Hearing Date', dmyOf(FUTURE)] }]);
  }, 60_000);

  it('My Cases: a filing "(F)" opens getFilingCaseHistory; a case no longer there is a 409, not a crash', async () => {
    fx.portfolio = [];
    await live.openMyCaseHistory(sessionId, USER, 'TNCB0A0000012026', 'd');
    expect(fx.portfolio.map((r) => r.route)).toContain('portfolio/getFilingCaseHistory/');
    await expect(live.openMyCaseHistory(sessionId, USER, 'NOPE00000000000', 'd')).rejects.toMatchObject({ status: 502 });
  }, 60_000);

  it("My Cases (portal's newer script): the case link isn't on the page until its group opens - DifAi makes the portal's own getCaseHistory request", async () => {
    fx.lazyCaseLinks = true;
    try {
      fx.portfolio = [];
      const h = await live.openMyCaseHistory(sessionId, USER, 'TNCH0C0012342024', 'd');
      expect(fx.portfolio.find((r) => r.route === 'portfolio/getCaseHistory/')!.body).toMatch(/^cino1=TNCH0C0012342024&source=mycases&.*selected_court=D/);
      expect(h.blocks.filter((b) => b.kind === 'heading').map((b) => b.text)).toEqual(['City Civil Court, Chennai', 'Case Details', 'Case Status', 'Petitioner and Advocate', 'Case History']);
      // Its hearing dates still open the Daily Status, as on the portal.
      const d = await live.openMyCaseHistory(sessionId, USER, 'TNCH0C0012342024', 'd', { text: dmyOf(PAST), nth: 0 });
      expect(d.name).toBe('Daily Status');
    } finally {
      fx.lazyCaseLinks = false;
    }
  }, 90_000);

  it("My Cases: when the widget's records can't be read, DifAi reads the panels it drew instead", async () => {
    fx.myCasesGlobals = false;
    try {
      // A freshly loaded dashboard: no globals left over from earlier opens.
      await live.readPortalCounts(sessionId, USER);
      const mc = await live.readMyCases(sessionId, USER);
      expect(mc.cases.map((c) => [c.court, c.caseNo, c.filing, c.nextDate, c.decisionDate])).toEqual([
        ['d', 'OS/57/2024', false, FUTURE, null], ['d', 'OS/90/2023', false, PAST, null], ['d', 'CC/12/2020', false, null, '2026-09-15'], ['d', 'OP/101/2026', true, null, null], ['h', 'WP/1234/2025', false, LATER, null],
      ]);
      expect(mc.views.district.Both.d.map((g) => [g.title, g.count])).toEqual([['Chennai,Tamil Nadu', 3], ['Coimbatore,Tamil Nadu', 1]]);
      expect(mc.views.district.Both.d[0]!.establishments.map((e) => e.name)).toEqual(['City Civil Court, Chennai', 'Metropolitan Magistrate Court, Egmore']);
      expect(mc.cases[0]).toMatchObject({ petName: 'Ramesh Kumar', resName: 'Suresh Babu' });
    } finally {
      fx.myCasesGlobals = true;
    }
  }, 60_000);

  it('maps the portal\'s menus (structure only): opens menu pages, never Delete, keeps no values or table contents', async () => {
    const map = await live.mapPortal(sessionId, USER);
    expect(map.menus).toEqual([{ menu: 'Pleadings', items: [
      { text: 'Pleading Upload', href: `${ORIGIN}/pdedev/?p=upload_pleading`, onclick: '' },
      { text: 'Delete Draft', href: '#', onclick: 'fx.deleted = 1' },
    ] }]);
    expect(map.pages.map((x) => x.item)).toEqual(['Pleading Upload']);
    const pg = map.pages[0]!;
    expect(pg.headings).toContain('Pleading Upload');
    expect(pg.tabs).toEqual(['Pleading Upload', 'Pleading Index']);
    expect(pg.fields).toEqual([
      { label: 'e-Filing Number', id: 'sel_pde_no', name: '', tag: 'select', type: '', options: ['Select', 'ATN20250009438C202600002'] },
      { label: 'Document Title', id: 'doc_file_name', name: 'doc_file_name', tag: 'input', type: '' },
    ]);
    expect(pg.buttons).toEqual([{ text: 'Upload', id: 'add_btn', onclick: 'submitData()' }]);
    expect(pg.tables).toEqual([{ id: 'tbl', headers: ['Sr.No.', 'Document'], rows: 1 }]);
    expect(pg.labels).toEqual(['e-Filing Number', 'Sr.No.', 'Document']);
    const saved = JSON.stringify(map);
    expect(saved).not.toContain('secret typed value');
    expect(saved).not.toContain('PRIVATE CLIENT DOC');
    const { readFile, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    expect(await readFile(join(map.dir, 'js', 'pdedev_js_upload_pleading.js'), 'utf8')).toContain('submitData');
    await rm(map.dir, { recursive: true, force: true });
  }, 120_000);

  it('self-test (local only): walks every feature read-only, writes a report and portal screenshots', async () => {
    const { runSelfTest } = await import('../src/services/efiling-selftest.service');
    const { readdir, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const base = join(tmpdir(), 'difai-efiling-selftest');
    const before = new Set(await readdir(base).catch(() => [] as string[]));
    process.env['EFILING_SELF_TEST'] = '1';
    fx.posts = [];
    try {
      await runSelfTest(sessionId, USER);
    } finally {
      delete process.env['EFILING_SELF_TEST'];
    }
    const dir = join(base, (await readdir(base)).find((d) => !before.has(d))!);
    const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')) as { results: Array<{ step: string; ok: boolean; shot?: string }> };
    expect(report.results.length).toBeGreaterThan(30);
    const ok = (name: string) => report.results.find((r) => r.step === name)?.ok;
    expect(ok('dashboard counts + calendar + today')).toBe(true);
    expect(ok('list completed_pleadings')).toBe(true);
    expect(ok('completed_pleadings: View Documents')).toBe(true);
    expect(ok('completed_pleadings: View Documents: open document "COMPLAINT"')).toBe(true);
    expect(ok('My Cases')).toBe(true);
    expect(report.results.filter((r) => r.shot).length).toBeGreaterThan(30);
    expect((await readFile(join(dir, 'summary.txt'), 'utf8')).split('\n')[0]).toMatch(/steps ok$/);
    // Read-only: nothing that saves, submits, pays, deletes, assigns or sends an OTP.
    const writes = fx.posts.filter((r) => /insert|submit|save|delete|remove|pay|otp|assign|accept|revoke|import|efile/i.test(r)
      && !/\/(get|fetch|read|list|view|chk|fill)[A-Za-z_]*\/?$/i.test(r));
    expect(writes).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  }, 600_000);

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
