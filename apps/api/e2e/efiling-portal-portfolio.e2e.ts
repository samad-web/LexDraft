/**
 * eFiling portal PORTFOLIO menu (except My Cases - efiling-portal-flow.e2e.ts),
 * against fixture pages that behave like filing.ecourts.gov.in's own:
 *   - Search Cases copies the ids, functions and requests of the portal's
 *     public js/portfolio/search_cases.js: hideshow(1|2) (CNR Number / Case
 *     Status), #selDistrict -> getEstablishment(this) -> portfolio/
 *     getEstablishment/ -> #selEstSearchCases, searchBy('caseNumber') ->
 *     populateCaseTypes() -> portfolio/getCaseTypes/, caseNumberSearch() ->
 *     portfolio/getCaseNumber/ -> #case_status11, partyNameSearch() ->
 *     portfolio/getByPartyName/, a case there -> cnrsearch(this) ->
 *     portfolio/listOfCasesWebService/ + getCaseHistory/ ->
 *     #case_status111 + checkCaseExistsInMyCases/, Add Case ->
 *     addCaseButtonClicked() -> portfolio/addCase/, Back -> back(), a
 *     hearing date -> viewBusiness() -> portfolio/getViewBusiness/
 *   - Import / Export / Delete my cases are the requests of
 *     js/portfolio/mycases_common_functions.js (refreshMyCases/,
 *     insertIntoMyCases/, getMyCasesData/, deleteMyCases/)
 *   - Planner (?p=Portfolio/calendar) runs js/portfolio/calendar.js (a
 *     FullCalendar month); its page here is a simple stand-in (an event form +
 *     list) to drive DifAi's live-screen engine end to end.
 * The Portfolio menu is the real portal's: Search Cases, Planner, Export
 * Cases (onExportClick()), My Cases, Import Cases (openImport()).
 * The real service code drives them (no live portal, no account, no DB).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Route } from 'playwright';
import * as live from '../src/services/efiling-live.service';
import * as pf from '../src/services/efiling-portal-portfolio.service';
import type { LiveItem, LiveScreen, LiveControl, LiveClick } from '../src/services/efiling-portal-vakalat.service';

const USER = 'portal-portfolio-user';
const PASSWORD = 'Secret@123';
const ORIGIN = 'https://filing.ecourts.gov.in';

const DC = [
  { cino: 'TNCH0C0012342024', type_name: 'OS', case_no: '200100000572024', reg_no: '57', reg_year: '2024', fil_no: '80', fil_year: '2024', pet_name: 'Ramesh Kumar', res_name: 'Suresh Babu', state_code: '10', state_name: 'Tamil Nadu', district_code: '2', district_name: 'Chennai', establishment_code: 'TNCH0C', establishment_name: 'City Civil Court, Chennai', desgname: '1-Principal Judge', date_next_list: '5000-01-01', date_last_list: '2026-10-01', date_of_decision: null },
];
const HC = [
  { cino: 'HCMA010012342025', type_name: 'WP', case_no: '201000012342025', reg_no: '1234', reg_year: '2025', fil_no: '5000', fil_year: '2025', pet_name: 'Ramesh Kumar', res_name: 'The District Collector', state_code: '10', state_name: 'Tamil Nadu', district_code: '1', district_name: 'Chennai', establishment_code: 'HCMA01', establishment_name: 'High Court of Madras', desgname: 'Court 5', date_next_list: '2026-12-01', date_last_list: null, date_of_decision: null },
];

const fx = {
  counter: 0,
  lastCode: '',
  csrf: 'tok0',
  calls: [] as Array<{ route: string; body: string }>,
  saved: false,
  /** How many cases insertIntoMyCases/ says it added. */
  addCount: 2,
  events: [] as Array<{ date: string; title: string }>,
  dc: DC as Array<Record<string, unknown>>,
};

const svg = (code: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="12" y="34" font-size="26" font-family="monospace">${code}</text></svg>`;

const loginPage = `<!doctype html><html><body>
<form id="frm_login">
  <select id="selState"><option value="">Select</option><option value="10">Tamil Nadu</option></select>
  <input type="radio" name="rdoUser" id="user_advocate" value="1"><input type="radio" name="rdoUser" id="user_person" value="2">
  <input id="user_name"><input type="password" id="user_password"><input type="hidden" id="gennum" value="n1">
  <div id="div_captcha_mobile"><img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a1" width="150" height="50"></div>
  <input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="doLogin()">Login</button>
  <div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div>
</form>
<script>
  function doLogin() {
    var x = new XMLHttpRequest(); x.open('POST', '/pdedev/?p=login/verify_login/');
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.onload = function () { var obj = JSON.parse(x.responseText); if (obj.status === true) { window.location.href = obj.redirect_path; return; }
      document.querySelector('.alert-danger4').style.display = 'block'; document.getElementById('msg-danger4').innerHTML = obj.errorMsg; };
    x.send('user_name=' + encodeURIComponent(document.getElementById('user_name').value) + '&user_password=' + encodeURIComponent(document.getElementById('user_password').value) + '&fcaptcha_code=' + encodeURIComponent(document.getElementById('fcaptcha_code_mobile').value));
  }
</script></body></html>`;

const shell = (body: string, script = '') => `<!doctype html><html><head><style>.d-none{display:none!important}.dropdown-menu{display:none}</style></head><body>
<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="${fx.csrf}">
<input type="hidden" id="sessionSelCourtType" value="2"><input type="hidden" id="sessionlangid" value="0"><input type="hidden" id="sessionState1" value="">
<nav class="navbar"><ul class="nav">
  <li><a href="${ORIGIN}/pdedev/?p=dashboard">Dashboard</a></li>
  <li class="dropdown"><a class="dropdown-toggle" href="#">Portfolio</a><ul class="dropdown-menu">
    <li><a href="${ORIGIN}/pdedev/?p=Portfolio/search_cases">Search Cases</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=Portfolio/calendar">Planner</a></li>
    <li><a href="#" onclick="onExportClick()">Export Cases</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=Portfolio_new/my_cases">My Cases</a></li>
    <li><a href="#" onclick="openImport()">Import Cases</a></li></ul></li>
  <li><a href="${ORIGIN}/pdedev/?p=login/logOut">Logout</a></li>
</ul></nav>
<div class="content-wrapper"><div class="container">${body}</div></div>
<div id="msgbox" class="d-none"></div>
<script>
  if (document.getElementById('sessionSelCourtType').value == 2) window.sessionStorage.SELECTED_COURT = 'D'; else window.sessionStorage.SELECTED_COURT = 'H';
  window.sessionStorage.CURRENT_APP_VERSION = '3.0';
  function errorAlert(m) { var d = document.getElementById('msgbox'); d.innerHTML = m; d.className = 'alert'; }
  function successAlert(m) { var d = document.getElementById('msgbox'); d.innerHTML = m; d.className = 'alert'; }
  function ajaxCall(o) {
    var x = new XMLHttpRequest(); x.open('POST', document.getElementById('base_url').value + '/?p=' + o.url);
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    x.onload = function () {
      var t = x.responseText, obj;
      try { obj = JSON.parse(t); } catch (e) { var i = t.lastIndexOf('#####'); if (i >= 0) { document.getElementById('__csrf_magic').value = t.slice(i + 5); errorAlert(t.slice(0, i)); } return; }
      if (obj.nsteptoken) document.getElementById('__csrf_magic').value = obj.nsteptoken;
      if (obj.errormsg) { errorAlert(obj.errormsg); obj.status = false; o.callback(obj); return; }
      if (obj.msg) successAlert(obj.msg);
      obj.status = true; o.callback(obj);
    };
    x.send((o.postdata ? o.postdata + '&' : '') + 'ajax_req=true&__csrf_magic=' + encodeURIComponent(document.getElementById('__csrf_magic').value));
  }
  ${script}
</script></body></html>`;

const dashboardPage = () => shell('<h3>Dashboard</h3><div id="efiling_activity">Draft Pleadings</div>');

const SHOW = (ids: string[], on: boolean) => ids.map((id) => `document.getElementById('${id}').style.display = '${on ? 'block' : 'none'}';`).join(' ');

// Portfolio > Search Cases (ids and functions of js/portfolio/search_cases.js).
const searchPage = () => shell(`<h3>Search Cases</h3>
<div class="row"><input type="radio" name="radOpt" id="radOpt-1" onclick="hideshow(1)"> CNR Number <input type="radio" name="radOpt" id="radOpt-2" onclick="hideshow(2)" checked> Case Status</div>
<div id="cnr_search" style="display:none"><div class="row"><label for="cnr1">Enter 16 Digit CNR Number</label><input type="text" id="cnr1" maxlength="16"></div><div class="row"><input type="button" class="btn" value="Search" onclick="cnrsearch()"></div></div>
<div id="case_est">
  <input type="hidden" id="selTaggedState" value="10">
  <div class="row"><label for="selState">State</label><select id="selState"><option value="10" selected>Tamil Nadu</option></select></div>
  <div class="row"><label for="selDistrict">District</label><select id="selDistrict" onchange="getEstablishment(this)"><option value="">Select District</option><option value="2">Chennai</option></select></div>
  <div class="row"><label for="selEstSearchCases">Court Establishment</label><select id="selEstSearchCases" onchange="casestusts_show()"><option value="">Select Court Establishment</option></select></div>
</div>
<div id="case_status1" style="display:none">
  <div class="row"><input type="radio" name="search_by" id="search_by_1" onclick="searchBy('caseNumber')"> Case Number <input type="radio" name="search_by" id="search_by_2" onclick="searchBy('partyName')"> Party Name</div>
  <div id="case_number" style="display:none">
    <div class="row"><label for="case_type">Case Type</label><select id="case_type"><option value="">Select Case Type</option></select></div>
    <div class="row"><label for="search_case_no">Case Number</label><input type="text" id="search_case_no"></div>
    <div class="row"><label for="rgyear">Year</label><input type="text" id="rgyear" maxlength="4"></div>
    <div class="row"><input type="button" class="btn" value="Go" onclick="caseNumberSearch()"> <input type="button" class="btn" value="Reset" onclick="resets('caseNumber')"></div>
  </div>
  <div id="party_name_search" style="display:none">
    <div class="row"><label for="party_name">Petitioner/Respondent</label><input type="text" id="party_name"></div>
    <div class="row"><label for="rgyear_partyname">Registration Year</label><input type="text" id="rgyear_partyname"></div>
    <div class="row"><input type="radio" name="partyname_pendingdisposed_radOpt" value="Pending" checked> Pending <input type="radio" name="partyname_pendingdisposed_radOpt" value="Disposed"> Disposed <input type="radio" name="partyname_pendingdisposed_radOpt" value="Both"> Both</div>
    <div class="row"><input type="button" class="btn" value="Go" onclick="partyNameSearch()"></div>
  </div>
</div>
<div id="case_status11" style="display:none"></div>
<div id="case_status111" style="display:none"></div>
<input type="button" class="btn" id="back" value="Back" onclick="back()" style="display:none">
<div id="show_business" style="display:none"></div>`, `
  var petResArr = [], petResNameArr = [], lpetResNameArr = [], petResMobileArr = [], petRes, historyArray;
  function hideshow(option) {
    if (option == 1) { ${SHOW(['cnr_search'], true)} ${SHOW(['case_status1', 'case_est', 'case_status11', 'case_status111', 'show_business', 'back'], false)} }
    if (option == 2) { ${SHOW(['cnr_search', 'case_status111', 'back', 'show_business'], false)} ${SHOW(['case_est'], true)}
      if (document.getElementById('selDistrict').value != '' && document.getElementById('selEstSearchCases').value != '') ${SHOW(['case_status1'], true)} }
  }
  function casestusts_show() { ${SHOW(['case_status1'], true)} }
  function getEstablishment(obj) {
    var postdata = 'fstateCode=' + document.getElementById('selState').value + '&fdistCode=' + obj.value + '&selStateCode=' + document.getElementById('selTaggedState').value;
    ajaxCall({ url: 'portfolio/getEstablishment/', postdata: postdata, callback: function (o) { document.getElementById('selEstSearchCases').innerHTML = o.option; } });
  }
  function populateCaseTypes() {
    var postdata = 'dist_code=' + document.getElementById('selDistrict').value + '&court_code=' + document.getElementById('selEstSearchCases').value + '&bilingual_flag=' + document.getElementById('sessionlangid').value + '&selected_court=' + window.sessionStorage.SELECTED_COURT;
    ajaxCall({ url: 'portfolio/getCaseTypes/', postdata: postdata, callback: function (o) { document.getElementById('case_type').innerHTML = o.option; } });
  }
  function searchBy(opt) {
    ${SHOW(['case_number', 'party_name_search', 'case_status11', 'case_status111', 'back', 'show_business'], false)}
    if (opt == 'caseNumber') { populateCaseTypes(); ${SHOW(['case_number'], true)} }
    if (opt == 'partyName') { ${SHOW(['party_name_search'], true)} }
  }
  function resets(opt) { document.getElementById('search_case_no').value = ''; document.getElementById('rgyear').value = ''; document.getElementById('case_status11').innerHTML = ''; }
  function results(o) { var d = document.getElementById('case_status11'); d.style.display = 'block'; d.innerHTML = o.option; }
  function caseNumberSearch() {
    ${SHOW(['case_status111', 'back', 'show_business'], false)}
    if (document.getElementById('case_type').value == '') { alert('Please select case type'); return; }
    var postdata = 'dist_code=' + document.getElementById('selDistrict').value + '&court_code=' + document.getElementById('selEstSearchCases').value + '&case_type=' + document.getElementById('case_type').value + '&case_no=' + document.getElementById('search_case_no').value + '&case_year=' + document.getElementById('rgyear').value + '&bilingual_flag=' + document.getElementById('sessionlangid').value + '&selected_court=' + window.sessionStorage.SELECTED_COURT;
    ajaxCall({ url: 'portfolio/getCaseNumber/', postdata: postdata, callback: results });
  }
  function partyNameSearch() {
    var pd = document.querySelector("input[name='partyname_pendingdisposed_radOpt']:checked").value;
    var postdata = 'dist_code=' + document.getElementById('selDistrict').value + '&court_code=' + document.getElementById('selEstSearchCases').value + '&pet_name=' + document.getElementById('party_name').value + '&pendingDisposed=' + pd + '&year=' + document.getElementById('rgyear_partyname').value + '&bilingual_flag=' + document.getElementById('sessionlangid').value + '&selected_court=' + window.sessionStorage.SELECTED_COURT;
    ajaxCall({ url: 'portfolio/getByPartyName/', postdata: postdata, callback: results });
  }
  function cnrsearch(obj) {
    var cnr = obj ? obj.getAttribute('cino') : document.getElementById('cnr1').value;
    if (cnr.length < 16) { alert('Invalid CNR Number'); document.getElementById('cnr1').value = ''; return false; }
    ajaxCall({ url: 'portfolio/listOfCasesWebService/', postdata: 'cino1=' + cnr, callback: function (l) {
      var url = l.case_number == null ? 'portfolio/getFilingCaseHistory/' : 'portfolio/getCaseHistory/';
      ajaxCall({ url: url, postdata: 'cino1=' + cnr + '&language_flag=english&bilingual_flag=' + document.getElementById('sessionlangid').value + '&selected_court=' + window.sessionStorage.SELECTED_COURT, callback: function (h) {
        ${SHOW(['case_status11'], false)}
        var d = document.getElementById('case_status111'); d.style.display = 'block'; d.innerHTML = h.option;
        ${SHOW(['back'], true)}
        historyArray = h.historyArr;
        ajaxCall({ url: 'portfolio/checkCaseExistsInMyCases/', postdata: 'cino=' + cnr, callback: function (e) { if (e.caseExists == 'true') toggleButtonsOnSavedCase(); } });
      } });
    } });
  }
  function back() { ${SHOW(['case_status111', 'back', 'show_business'], false)} ${SHOW(['case_status11'], true)} }
  function toggleButtonsOnSavedCase() { document.getElementById('addCase').style.display = 'none'; document.getElementById('savedCase').style.display = 'inline'; }
  function addCaseButtonClicked(historyArr) { historyArray = historyArr; addCaseToMyCases(); }
  function addCaseToMyCases() {
    var historyArr = historyArray;
    var adv, mobile;
    if (petRes == 'pet') { adv = 'pet_adv'; mobile = 'petextraparty_mobile'; } else { adv = 'res_adv'; mobile = 'resextraparty_mobile'; }
    if (historyArr['date_next_list'] == 'Date Not Given') historyArr['date_next_list'] = '5000-01-01';
    var postdata = 'historyArr=' + encodeURIComponent(JSON.stringify(historyArr)) + '&petResArr=' + JSON.stringify(petResArr) + '&petResAdv=' + adv + '&petResNameArr=' + JSON.stringify(petResNameArr) + '&lpetResNameArr=' + JSON.stringify(lpetResNameArr) + '&petResMobile=' + mobile + '&petResMobileArr=' + JSON.stringify(petResMobileArr) + '&selected_court=' + window.sessionStorage.SELECTED_COURT;
    ajaxCall({ url: 'portfolio/addCase/', postdata: postdata, callback: function (o) { if (o.option === 'success') toggleButtonsOnSavedCase(); } });
  }
  function viewBusiness(court_code, dist_code, nextdate1, case_number1, state_code, disposal_flag, businessDate, court_no, selectedCourt) {
    ${SHOW(['case_status111', 'back'], false)}
    var postdata = 'court_code=' + court_code + '&dist_code=' + dist_code + '&nextdate1=' + nextdate1 + '&case_number1=' + case_number1 + '&state_code=' + state_code + '&disposal_flag=' + disposal_flag + '&businessDate=' + businessDate + '&court_no=' + court_no + '&language_flag=english&bilingual_flag=' + document.getElementById('sessionlangid').value + '&selected_court=' + window.sessionStorage.SELECTED_COURT;
    ajaxCall({ url: 'portfolio/getViewBusiness/', postdata: postdata, callback: function (o) { var d = document.getElementById('show_business'); d.style.display = 'block'; d.innerHTML = o.option; } });
  }
`);

// Portfolio > Planner: stand-in (no public script).
const plannerRows = () => fx.events.map((e, i) => `<tr><td>${i + 1}</td><td>${e.date}</td><td>${e.title}</td></tr>`).join('');
const plannerPage = () => shell(`<h3>Planner</h3>
<table id="tblEvents" class="table"><thead><tr><th>Sr.No.</th><th>Date</th><th>Event</th></tr></thead><tbody>${plannerRows()}</tbody></table>
<div class="row"><label for="event_date">Date</label><input type="date" id="event_date" name="event_date"></div>
<div class="row"><label for="event_title">Event</label><input type="text" id="event_title" name="event_title"></div>
<div class="row"><input type="button" class="btn" value="Add Event" onclick="addEvent()"></div>`, `
  function addEvent() { ajaxCall({ url: 'planner/addEvent', postdata: 'event_date=' + document.getElementById('event_date').value + '&event_title=' + encodeURIComponent(document.getElementById('event_title').value), callback: function (o) { document.querySelector('#tblEvents tbody').innerHTML = o.rows; } }); }
`);

const RESULTS = '<table class="table" id="caseTable"><thead><tr><th>Sr No</th><th>Case Number</th><th>Petitioner Name versus Respondent Name</th><th>View</th></tr></thead><tbody>'
  + '<tr><td colspan="4">City Civil Court, Chennai</td></tr>'
  + '<tr><td>1</td><td>OS/57/2024</td><td>Ramesh Kumar Vs Suresh Babu</td><td><a href="#" onclick="cnrsearch(this);return false;" cino="TNCH0C0012342024" casenumber="OS/57/2024" petname="Ramesh Kumar" resname="Suresh Babu">View</a></td></tr></tbody></table>';

const HISTORY = () => '<h2>City Civil Court, Chennai</h2><h3>Case Details</h3><table class="case_details_table"><tr><td>Case Type</td><td>OS - Original Suit</td></tr><tr><td>CNR Number</td><td>TNCH0C0012342024</td></tr></table>'
  + '<div class="row"><input type="button" class="btn" id="addCase" value="Add Case" onclick="addCaseButtonClicked(historyArray)"> <span id="savedCase" style="display:none">Case saved in My Cases</span></div>'
  + '<h3>Case History</h3><table class="history_table"><thead><tr><th>Judge</th><th>Business on Date</th><th>Hearing Date</th><th>Purpose of hearing</th></tr></thead><tbody>'
  + '<tr><td>Principal Judge</td><td><a href="#" onclick="viewBusiness(\'TNCH0C\',\'2\',\'2026-11-20\',\'200100000572024\',\'10\',\'N\',\'01-10-2026\',\'1\',\'D\');return false;">01-10-2026</a></td><td>20-11-2026</td><td>Hearing</td></tr></tbody></table>';

const form = (body: string | null) => new URLSearchParams(body ?? '');
const strip = (body: string) => body.replace(/&?ajax_req=true&__csrf_magic=[^&]*$/, '');

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  const html = (body: string) => route.fulfill({ contentType: 'text/html', body });
  if (url.pathname.endsWith('/securimage/securimage_show.php')) {
    fx.counter += 1;
    fx.lastCode = `P${fx.counter}x${fx.counter % 7}`;
    return route.fulfill({ contentType: 'image/svg+xml', body: svg(fx.lastCode) });
  }
  if (req.method() === 'GET') {
    if (p === 'login/logOut') return html('<html><body>Logged out</body></html>');
    if (p === 'dashboard') return html(dashboardPage());
    if (p === 'Portfolio/search_cases') return html(searchPage());
    if (p === 'Portfolio/calendar') return html(plannerPage());
    return html(loginPage);
  }
  const f = form(req.postData());
  if (p === 'login/verify_login/') {
    const ok = f.get('fcaptcha_code') === fx.lastCode && f.get('user_name') === 'adv@example.com' && f.get('user_password') === PASSWORD;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok ? { status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` } : { status: false, errorMsg: 'Invalid captcha' }) });
  }
  const sent = f.get('__csrf_magic') ?? '';
  if (sent !== fx.csrf) return route.fulfill({ status: 403, body: `Invalid token#####${fx.csrf}` });
  const before = fx.csrf;
  fx.csrf = `tok${fx.calls.length + 1}`;
  fx.calls.push({ route: p, body: strip(req.postData() ?? '') });
  // An array reply (insertIntoMyCases/) has no room for nsteptoken: that request keeps the token.
  const reply = (o: unknown) => {
    if (Array.isArray(o)) fx.csrf = before;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Array.isArray(o) ? o : { nsteptoken: fx.csrf, ...(o as object) }) });
  };
  switch (p) {
    case 'portfolio/getEstablishment/': return reply({ option: '<option value="">Select Court Establishment</option><option value="TNCH0C">City Civil Court, Chennai</option>' });
    case 'portfolio/getCaseTypes/': return reply({ option: '<option value="">Select Case Type</option><option value="1">OS - Original Suit</option>' });
    case 'portfolio/getCaseNumber/':
    case 'portfolio/getByPartyName/': return reply({ option: RESULTS });
    case 'portfolio/listOfCasesWebService/': return reply({ case_number: 'OS/57/2024' });
    case 'portfolio/getCaseHistory/': return reply({ option: HISTORY(), historyArr: { cino: 'TNCH0C0012342024', date_next_list: 'Date Not Given' }, main_pet_name: 'Ramesh Kumar', main_res_name: 'Suresh Babu' });
    case 'portfolio/checkCaseExistsInMyCases/': return reply({ caseExists: fx.saved ? 'true' : 'false' });
    case 'portfolio/addCase/': fx.saved = true; return reply({ option: 'success' });
    case 'portfolio/getViewBusiness/': return reply({ option: '<span><b>Daily Status</b></span><table><tr><td>Business</td><td>Arguments heard.</td></tr><tr><td>Next Hearing Date</td><td>20-11-2026</td></tr></table>' });
    case 'planner/addEvent':
      fx.events.push({ date: f.get('event_date') ?? '', title: f.get('event_title') ?? '' });
      return reply({ msg: 'Event added', rows: plannerRows() });
    case 'portfolio/getMyCasesData/': return reply({ mycases_dc: fx.dc, mycases_hc: HC });
    case 'portfolio/refreshMyCases/': {
      const cinos = (f.get('cnr_numbers') ?? '').split(',');
      return reply({ todaysCiNos: cinos.map((c) => ({ cino: c, type_name: 'OS', state_code: '10', district_code: '2', court_name: 'City Civil Court, Chennai', est_code: 'TNCH0C', state_name: 'Tamil Nadu', district_name: 'Chennai', case_no: '200100000572024', reg_year: '2024', reg_no: '57', fil_year: '2024', fil_no: '80', date_next_list: '5000-01-01', date_last_list: '2026-10-01', date_of_decision: null, courtno: '1', desgname: 'Principal Judge', purpose_next: '4', purpose_name: 'Hearing', dt_regis: '2024-03-15', ci_cri: 'civil' })) });
    }
    case 'portfolio/insertIntoMyCases/': {
      const arr = JSON.parse(f.get('casesImported') ?? '[]') as string[];
      return reply(arr.slice(0, fx.addCount));
    }
    case 'portfolio/deleteMyCases/': fx.dc = []; return reply({ option: 'success' });
    default: return route.fulfill({ status: 404, body: 'not in fixture' });
  }
}

const controls = (s: LiveScreen): LiveControl[] => s.items.flatMap((i: LiveItem) => (i.kind === 'control' ? [i.control] : []));
const control = (s: LiveScreen, key: string) => controls(s).find((c) => c.key === key);
const clicks = (s: LiveScreen): LiveClick[] => s.items.flatMap((i: LiveItem) => (i.kind === 'click' ? [i.click] : i.kind === 'text' ? i.clicks : i.kind === 'table' ? i.table.rows.flatMap((r) => ('cells' in r ? r.cells.flatMap((c) => c.clicks) : [])) : []));
const headings = (s: LiveScreen) => s.items.flatMap((i: LiveItem) => (i.kind === 'heading' ? [i.text] : []));
const texts = (s: LiveScreen) => s.items.flatMap((i: LiveItem) => (i.kind === 'text' ? i.lines : []));
const tables = (s: LiveScreen) => s.items.flatMap((i: LiveItem) => (i.kind === 'table' ? [i.table] : []));
const callsTo = (route: string) => fx.calls.filter((c) => c.route === route);

let sessionId = '';

beforeAll(async () => {
  live.__testing.setContextHook(async (context: BrowserContext) => {
    await context.route(`${ORIGIN}/**`, serve);
  });
  ({ sessionId } = await live.startEfilingSession(USER, '10', 'advocate'));
  await live.submitEfilingCredentials(sessionId, USER, 'adv@example.com', PASSWORD);
  expect(await live.submitEfilingLoginCaptcha(sessionId, USER, fx.lastCode)).toEqual({ status: 'authenticated' });
}, 120_000);

afterAll(async () => {
  live.__testing.setContextHook(null);
  if (sessionId) await live.endEfilingSession(sessionId, USER).catch(() => {});
});

describe('Portfolio > Search Cases (fixture portal)', () => {
  it("the Portfolio menu as the portal draws it", async () => {
    const { readPortalMenus } = await import('../src/services/efiling-portal-vakalat.service');
    const menus = await readPortalMenus(sessionId, USER);
    expect(menus.find((m) => m.menu === 'Portfolio')!.items.map((i) => i.text)).toEqual(['Search Cases', 'Planner', 'Export Cases', 'My Cases', 'Import Cases']);
  });

  it('opens from the Portfolio menu: CNR Number / Case Status and the court fields, as the portal draws them', async () => {
    const s = await pf.openPortfolioScreen(sessionId, USER, 'search_cases');
    expect(s).toMatchObject({ view: 'search_cases', label: 'Search Cases', title: 'Search Cases' });
    expect(control(s, '#radOpt-1')).toMatchObject({ type: 'radio', label: 'CNR Number', checked: false });
    expect(control(s, '#radOpt-2')).toMatchObject({ type: 'radio', label: 'Case Status', checked: true });
    expect(controls(s).map((c) => c.label)).toEqual(['CNR Number', 'Case Status', 'State', 'District', 'Court Establishment']);
    // The Case Status search types show once a court is chosen (casestusts_show).
    expect(control(s, '#search_by_1')).toBeUndefined();
  });

  it("choosing the District runs the portal's getEstablishment(this) -> portfolio/getEstablishment/; the establishment shows the search types", async () => {
    fx.calls = [];
    const r = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { fill: [{ key: '#selDistrict', value: '2' }] });
    expect(callsTo('portfolio/getEstablishment/').map((c) => c.body)).toEqual(['fstateCode=10&fdistCode=2&selStateCode=10']);
    expect(control(r.screen, '#selEstSearchCases')!.options!.map((o) => o.text)).toEqual(['Select Court Establishment', 'City Civil Court, Chennai']);
    const r2 = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { fill: [{ key: '#selEstSearchCases', value: 'TNCH0C' }] });
    expect(control(r2.screen, '#search_by_1')).toMatchObject({ label: 'Case Number' });
    expect(control(r2.screen, '#search_by_2')).toMatchObject({ label: 'Party Name' });
  });

  it("Case Number: searchBy('caseNumber') -> portfolio/getCaseTypes/; Go -> caseNumberSearch() -> portfolio/getCaseNumber/ with the portal's own fields", async () => {
    fx.calls = [];
    const r = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { fill: [{ key: '#search_by_1', checked: true }] });
    expect(callsTo('portfolio/getCaseTypes/').map((c) => c.body)).toEqual(['dist_code=2&court_code=TNCH0C&bilingual_flag=0&selected_court=D']);
    expect(controls(r.screen).slice(-3).map((c) => c.label)).toEqual(['Case Type', 'Case Number', 'Year']);
    expect(clicks(r.screen).map((c) => c.text)).toEqual(['Go', 'Reset']);
    const go = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', {
      fill: [{ key: '#case_type', value: '1' }, { key: '#search_case_no', value: '57' }, { key: '#rgyear', value: '2024' }],
      press: { text: 'Go' },
    });
    expect(callsTo('portfolio/getCaseNumber/').map((c) => c.body)).toEqual(['dist_code=2&court_code=TNCH0C&case_type=1&case_no=57&case_year=2024&bilingual_flag=0&selected_court=D']);
    const t = tables(go.screen).find((x) => x.id === 'caseTable')!;
    expect(t.headers).toEqual(['Sr No', 'Case Number', 'Petitioner Name versus Respondent Name', 'View']);
    expect(t.rows[0]).toEqual({ group: 'City Civil Court, Chennai' });
    expect((t.rows[1] as { cells: Array<{ text: string; clicks: LiveClick[] }> }).cells.map((c) => c.text)).toEqual(['1', 'OS/57/2024', 'Ramesh Kumar Vs Suresh Babu', 'View']);
    expect((t.rows[1] as { cells: Array<{ clicks: LiveClick[] }> }).cells[3]!.clicks).toEqual([{ text: 'View', nth: 0, kind: 'link', disabled: false, id: '' }]);
  }, 60_000);

  it('a case in the results opens its history (cnrsearch -> listOfCasesWebService/ + getCaseHistory/), with Add Case and Back', async () => {
    fx.calls = [];
    const r = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { press: { text: 'View' } });
    expect(fx.calls.map((c) => c.route)).toEqual(['portfolio/listOfCasesWebService/', 'portfolio/getCaseHistory/', 'portfolio/checkCaseExistsInMyCases/']);
    expect(fx.calls[0]!.body).toBe('cino1=TNCH0C0012342024');
    expect(fx.calls[1]!.body).toBe('cino1=TNCH0C0012342024&language_flag=english&bilingual_flag=0&selected_court=D');
    expect(headings(r.screen)).toEqual(['Search Cases', 'City Civil Court, Chennai', 'Case Details', 'Case History']);
    // The Case Number box stays open above (search_cases.js doesn't hide it).
    expect(clicks(r.screen).map((c) => c.text)).toEqual(['Go', 'Reset', 'Add Case', '01-10-2026', 'Back']);
    expect(tables(r.screen).find((x) => x.id === 'caseTable')).toBeUndefined();
  }, 60_000);

  it('a hearing date opens the Daily Status (viewBusiness -> portfolio/getViewBusiness/)', async () => {
    fx.calls = [];
    const r = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { press: { text: '01-10-2026' } });
    expect(callsTo('portfolio/getViewBusiness/').map((c) => c.body)).toEqual(['court_code=TNCH0C&dist_code=2&nextdate1=2026-11-20&case_number1=200100000572024&state_code=10&disposal_flag=N&businessDate=01-10-2026&court_no=1&language_flag=english&bilingual_flag=0&selected_court=D']);
    expect(texts(r.screen)).toContain('Daily Status');
    expect(tables(r.screen)[0]!.rows).toEqual([
      { cells: [{ text: 'Business', controls: [], clicks: [] }, { text: 'Arguments heard.', controls: [], clicks: [] }] },
      { cells: [{ text: 'Next Hearing Date', controls: [], clicks: [] }, { text: '20-11-2026', controls: [], clicks: [] }] },
    ]);
  }, 60_000);

  it('Add Case puts the case in My Cases on the portal: refused without confirmation, then portfolio/addCase/ as the portal sends it', async () => {
    await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { fill: [{ key: '#search_by_1', checked: true }] });
    await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { fill: [{ key: '#case_type', value: '1' }, { key: '#search_case_no', value: '57' }, { key: '#rgyear', value: '2024' }], press: { text: 'Go' } });
    await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { press: { text: 'View' } });
    await expect(pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { press: { text: 'Add Case' } })).rejects.toMatchObject({ status: 400 });
    fx.calls = [];
    const r = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { press: { text: 'Add Case' }, confirmed: true });
    expect(callsTo('portfolio/addCase/').map((c) => c.body)).toEqual([
      `historyArr=${encodeURIComponent(JSON.stringify({ cino: 'TNCH0C0012342024', date_next_list: '5000-01-01' }))}&petResArr=[]&petResAdv=res_adv&petResNameArr=[]&lpetResNameArr=[]&petResMobile=resextraparty_mobile&petResMobileArr=[]&selected_court=D`,
    ]);
    expect(clicks(r.screen).map((c) => c.text)).not.toContain('Add Case');
    expect(texts(r.screen)).toContain('Case saved in My Cases');
    // Back: the results again, as back() shows them.
    const b = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { press: { text: 'Back' } });
    expect(tables(b.screen).find((x) => x.id === 'caseTable')).toBeDefined();
  }, 90_000);

  it("CNR Number: hideshow(1) shows the CNR box; Search runs the portal's cnrsearch()", async () => {
    const r = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { fill: [{ key: '#radOpt-1', checked: true }] });
    expect(controls(r.screen).map((c) => c.label)).toEqual(['CNR Number', 'Case Status', 'Enter 16 Digit CNR Number']);
    const bad = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { fill: [{ key: '#cnr1', value: 'TNCH0C' }], press: { text: 'Search' } });
    expect(bad.messages).toEqual([{ kind: 'alert', text: 'Invalid CNR Number' }]);
    fx.calls = [];
    const ok = await pf.stepPortfolioScreen(sessionId, USER, 'search_cases', { fill: [{ key: '#cnr1', value: 'TNCH0C0012342024' }], press: { text: 'Search' } });
    expect(fx.calls[0]).toEqual({ route: 'portfolio/listOfCasesWebService/', body: 'cino1=TNCH0C0012342024' });
    expect(headings(ok.screen)).toContain('Case Details');
  }, 60_000);
});

describe('Portfolio > Planner (fixture portal)', () => {
  it('opens from the menu and adds an event only when confirmed', async () => {
    const s = await pf.openPortfolioScreen(sessionId, USER, 'planner');
    expect(s.label).toBe('Planner');
    expect(controls(s).map((c) => [c.label, c.type])).toEqual([['Date', 'date'], ['Event', 'text']]);
    await expect(pf.stepPortfolioScreen(sessionId, USER, 'planner', { press: { text: 'Add Event' } })).rejects.toMatchObject({ status: 400 });
    const r = await pf.stepPortfolioScreen(sessionId, USER, 'planner', { fill: [{ key: '#event_date', value: '2026-11-20' }, { key: '#event_title', value: 'Hearing OS 57/2024' }], press: { text: 'Add Event' }, confirmed: true });
    expect(r.messages).toEqual([{ kind: 'success', text: 'Event added' }]);
    expect((tables(r.screen)[0]!.rows[0] as { cells: Array<{ text: string }> }).cells.map((c) => c.text)).toEqual(['1', '2026-11-20', 'Hearing OS 57/2024']);
  }, 60_000);
});

describe('Portfolio > Import / Export / Delete my cases (fixture portal)', () => {
  it('Export: getMyCasesData/ with the session court, the file the portal writes (keys in its order), per court', async () => {
    fx.calls = [];
    const d = await pf.exportMyCases(sessionId, USER, 'D');
    expect(callsTo('portfolio/getMyCasesData/').map((c) => c.body)).toEqual(['configuration=D']);
    expect(d).toMatchObject({ court: 'D', fileName: 'myCases.txt', count: 1, message: null });
    expect(d.content).toBe(JSON.stringify([JSON.stringify({
      cino: 'TNCH0C0012342024', type_name: 'OS', case_no: '200100000572024', reg_year: '2024', reg_no: '57', petparty_name: 'Ramesh Kumar', resparty_name: 'Suresh Babu',
      fil_year: '2024', fil_no: '80', establishment_name: 'City Civil Court, Chennai', establishment_code: 'TNCH0C', state_code: '10', district_code: '2', state_name: 'Tamil Nadu',
      district_name: 'Chennai', date_next_list: 'Date Not Given', date_of_decision: null, date_last_list: '2026-10-01', updated: '',
    })]));
    const h = await pf.exportMyCases(sessionId, USER, 'H');
    expect(h).toMatchObject({ fileName: 'hcMyCases.txt', count: 1 });
    expect(JSON.parse(JSON.parse(h.content)[0]).cino).toBe('HCMA010012342025');
  });

  it("Import: the portal's file checks (name, format) before anything is sent; refused without confirmation", async () => {
    const file = JSON.stringify([JSON.stringify({ cino: 'TNCH0C0012342024', petparty_name: 'Ramesh Kumar', resparty_name: 'Suresh Babu' })]);
    await expect(pf.importMyCases(sessionId, USER, 'D', 'myCases.txt', file, false)).rejects.toMatchObject({ status: 400 });
    await expect(pf.importMyCases(sessionId, USER, 'D', 'hcMyCases.txt', file, true)).rejects.toMatchObject({ status: 400, message: 'Please select file myCases.txt' });
    await expect(pf.importMyCases(sessionId, USER, 'H', 'myCases.txt', file, true)).rejects.toMatchObject({ status: 400, message: 'Please select file hcMyCases.txt' });
    await expect(pf.importMyCases(sessionId, USER, 'D', 'myCases.txt', 'not json', true)).rejects.toMatchObject({ status: 400, message: 'Incorrect file format' });
  });

  it('Import: refreshMyCases/ for the CNRs, each case rebuilt from the portal\'s record, then insertIntoMyCases/; "Unable to add n cases" as the portal says', async () => {
    const file = JSON.stringify([
      JSON.stringify({ cino: 'TNCH0C0012342024', petparty_name: 'Ramesh Kumar', resparty_name: 'Suresh Babu' }),
      JSON.stringify({ cino: 'TNCH0C0099992023', pet_name: 'Lakshmi', res_name: 'Kannan' }),
    ]);
    fx.calls = [];
    fx.addCount = 1;
    const r = await pf.importMyCases(sessionId, USER, 'D', 'myCases.txt', file, true);
    expect(callsTo('portfolio/refreshMyCases/').map((c) => c.body)).toEqual(['cnr_numbers=TNCH0C0012342024,TNCH0C0099992023&action_code=list&version_number=3.0&language_flag=english&bilingual_flag=0&selected_court=D']);
    const ins = new URLSearchParams(callsTo('portfolio/insertIntoMyCases/')[0]!.body);
    expect(ins.get('configuration')).toBe('D');
    const cases = (JSON.parse(ins.get('casesImported')!) as string[]).map((x) => JSON.parse(x) as Record<string, unknown>);
    expect(Object.keys(cases[0]!)).toEqual(['type_name', 'state_code', 'district_code', 'establishment_name', 'establishment_code', 'state_name', 'district_name', 'case_no', 'reg_year', 'reg_no', 'fil_year', 'fil_no', 'date_next_list', 'date_last_list', 'date_of_decision', 'updated', 'desgname', 'pet_name', 'res_name', 'ldesgname', 'purpose_name', 'purpose_cd', 'registration_date', 'ci_cri', 'cino']);
    expect(cases[0]).toMatchObject({ cino: 'TNCH0C0012342024', pet_name: 'Ramesh Kumar', res_name: 'Suresh Babu', desgname: '1-Principal Judge', date_next_list: 'Date Not Given', establishment_name: 'City Civil Court, Chennai' });
    expect(cases[1]).toMatchObject({ cino: 'TNCH0C0099992023', pet_name: 'Lakshmi', res_name: 'Kannan' });
    expect(r).toEqual({ inFile: 2, added: 1, messages: ['Unable to add 1 cases'] });
    fx.addCount = 2;
  });

  it('Delete my cases: only when confirmed, then portfolio/deleteMyCases/ (option success); Export then says "No Cases to Export"', async () => {
    await expect(pf.deleteMyCases(sessionId, USER, false)).rejects.toMatchObject({ status: 400 });
    fx.calls = [];
    expect(await pf.deleteMyCases(sessionId, USER, true)).toEqual({ ok: true, message: null });
    expect(callsTo('portfolio/deleteMyCases/').map((c) => c.body)).toEqual(['']);
    const e = await pf.exportMyCases(sessionId, USER, 'D');
    expect(e).toMatchObject({ count: 0, content: '[]', message: 'No Cases to Export' });
  });
});
