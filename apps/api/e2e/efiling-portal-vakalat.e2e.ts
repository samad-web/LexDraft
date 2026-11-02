/**
 * eFiling portal VAKALAT menu + MY PARTNERS, against fixture pages that behave
 * like filing.ecourts.gov.in's own. The two Vakalat screens copy the ids,
 * functions and requests of the portal's public js/vakalat.js
 * (docs/efiling-portal-reverse-engineering.md §7):
 *   - Assign Partners to Case: radio "cases", #sel_pde_no -> fetchData('3') ->
 *     vakalat/fetchData sel_pde_no&str=3 (#advocate, #litigant, cause title),
 *     setParty() -> party mobile + Search -> getUser(b) -> vakalat/getUser,
 *     #lit_agree, Submit -> submitData('L') -> vakalat/submitData (#frm
 *     serialized + cause_title + lcause_title)
 *   - Accept Offer (#acceptOffer = 'Y'): fetchLitigantData('N') -> DataTable
 *     #example from vakalat/fetchLitigantData (type_of_case, search_n,
 *     column_cnt) with .chk_adv_approve boxes; Send OTP (#sotp_go ->
 *     sendOTP('A')), #otp, Submit (#sv_go -> submitData('A'))
 *   - Print Vakalat (?p=vakalattemplate/generateTemplate, js/vakalat_template.js):
 *     a template's View -> viewVakalatTemplate(pde_no, partner_efiling_uid,
 *     user_state_code, type_of_case) -> vakalattemplate/viewTemplate ->
 *     window.open(result.name)
 *   - My Partners > Revoke Partnership (?p=revoke_partner/revoke_partnership,
 *     js/partners/revoke_partner.js): revoke_partner/fetchpartnersData ->
 *     #partner_table; a partner -> fetchdata1(...) asks confirm() ->
 *     revoke_partner/updatedata1; #fofferedchk -> enabledisable(); Get OTP ->
 *     getotp() -> revoke_partner/send_otp; #enter_otp; Submit ->
 *     submitData(1) -> revoke_partner/submitdata
 * The menus are the real portal's (labels, order, addresses). Server-rendered
 * parts the scripts don't show (row markup, labels) are stand-ins.
 * The real service code drives them (no live portal, no account, no DB).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Route } from 'playwright';
import * as live from '../src/services/efiling-live.service';
import * as vak from '../src/services/efiling-portal-vakalat.service';
import type { LiveItem, LiveScreen, LiveControl, LiveClick } from '../src/services/efiling-portal-vakalat.service';

const USER = 'portal-vakalat-user';
const PASSWORD = 'Secret@123';
const ORIGIN = 'https://filing.ecourts.gov.in';

const fx = {
  counter: 0,
  lastCode: '',
  csrf: 'tok0',
  signedOut: false,
  /** The portal's own requests, with what they sent (token and ajax_req left out). */
  calls: [] as Array<{ route: string; body: string }>,
  offers: Array.from({ length: 11 }, (_, i) => ({ id: `ATN20250009438C2026000${String(i + 10)}~${i + 1}`, pde: `ATN20250009438C2026000${String(i + 10)}`, title: `Party ${i + 1} Vs State`, by: `Adv. Senior ${i + 1}` })),
  partners: [
    { id: '5', code: 'ADV7', name: 'Adv. Meena Raghavan', bar: 'MS/1234/2010', mobile: '9876500000' },
    { id: '6', code: 'ADV9', name: 'Adv. Karthik Iyer', bar: 'MS/5678/2015', mobile: '9876500001' },
  ],
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

// ---- the portal shell: hidden inputs, menu bar, components.js ajaxCall / alerts ----------

const shell = (body: string, script = '') => `<!doctype html><html><head><style>.d-none{display:none!important}.dropdown-menu{display:none}</style></head><body>
<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="${fx.csrf}">
<input type="hidden" id="sessionSelCourtType" value="2"><input type="hidden" id="sessionlangid" value="0">
<nav class="navbar"><ul class="nav">
  <li><a href="${ORIGIN}/pdedev/?p=dashboard">Dashboard</a></li>
  <li class="dropdown"><a class="dropdown-toggle" href="#">Vakalat</a><ul class="dropdown-menu">
    <li><a href="${ORIGIN}/pdedev/?p=vakalat">Assign Partners to Case</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=vakalat/acceptOffer">Accept Offer</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=vakalattemplate/generateTemplate">Print Vakalat</a></li></ul></li>
  <li class="dropdown"><a class="dropdown-toggle" href="#">My Partners</a><ul class="dropdown-menu">
    <li><a href="${ORIGIN}/pdedev/?p=my_partner1/add_partner">Add Partners</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=my_partner2/accept_partnership">Accept Partnership</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=revoke_partner/revoke_partnership">Revoke Partnership</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=accept_revocution/accept_revocution_partnership">Accept Revocation</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=my_partner2/friendship_report">My Partners Report</a></li></ul></li>
  <li class="dropdown"><a class="dropdown-toggle" href="#">Portfolio</a><ul class="dropdown-menu">
    <li><a href="#" id="my_cases">My Cases</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=portfolio/search_cases">Search Cases</a></li></ul></li>
  <li><a href="${ORIGIN}/pdedev/?p=login/logOut">Logout</a></li>
</ul></nav>
<div class="content-wrapper"><div class="container">${body}</div></div>
<div id="msgbox" class="d-none"></div>
<script>
  function errorAlert(m) { var d = document.getElementById('msgbox'); d.innerHTML = m; d.className = 'alert'; }
  function successAlert(m) { var d = document.getElementById('msgbox'); d.innerHTML = m; d.className = 'alert'; }
  // components.js ajaxCall: form body + ajax_req + the current token; nsteptoken is the next one.
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
  function serialize(f) { return new URLSearchParams(new FormData(f)).toString(); }
  ${script}
</script></body></html>`;

const dashboardPage = () => shell('<h3>Dashboard</h3><div id="efiling_activity">Draft Pleadings</div>');

// Vakalat > Assign Partners to Case (ids and functions of js/vakalat.js).
const assignPage = () => shell(`<h3>Assign Partners to Case</h3>
<form id="frm">
  <input type="hidden" id="sessionUserType" value="1"><input type="hidden" id="acceptOffer" value="N">
  <input type="hidden" id="hid_cino" name="hid_cino"><input type="hidden" id="cnr" name="cnr"><input type="hidden" id="lcause_title" name="lcause_title">
  <div class="row"><input type="radio" name="cases" id="eFiled" value="N" checked> eFiled Case <input type="radio" name="cases" id="regis" value="E"> Registered Case</div>
  <div class="row" id="pde_row"><div class="col-md-3"><label for="sel_pde_no">e-Filing Number</label></div><div class="col-md-6"><select id="sel_pde_no" name="sel_pde_no"><option value="">Select e-Filing Number</option><option value="ATN20250009438C202600002">ATN20250009438C202600002</option></select></div></div>
  <div class="case_details d-none">
    <div class="row">Cause Title : <span id="pet_name"></span><span id="res_name" class="d-none"></span></div>
    <div class="row"><label for="litigant">Select Litigant</label><select id="litigant" name="litigant"></select></div>
    <div class="row" id="party_list"></div>
    <div class="row"><label for="advocate">Select Partner Advocate</label><select id="advocate" name="advocate[]" multiple></select></div>
    <div class="row" id="pde_no_row"></div>
    <div class="row d-none" id="setAdvRow"><span id="setAdv"></span> <span id="setadv_part"></span> <span id="setParty"></span></div>
    <div class="row"><input type="checkbox" id="lit_agree" name="lit_agree" value="Y"> <label for="lit_agree">I hereby agree to the appointment</label></div>
  </div>
  <div class="row d-none" id="submit_row"><input type="button" class="btn btn-primary" value="Submit" onclick="submitData('L')"></div>
</form>`, `
  document.getElementById('sel_pde_no').addEventListener('change', function () { fetchData('3'); setTimeout(function () { setParty('L'); }, 500); });
  document.getElementById('advocate').addEventListener('change', function () { setParty('A'); });
  function fetchData(str) {
    document.getElementById('pde_no_row').innerHTML = '';
    var postdata = 'sel_pde_no=' + document.getElementById('sel_pde_no').value + '&str=' + str;
    ajaxCall({ url: 'vakalat/fetchData', postdata: postdata, callback: function (obj) {
      if (obj.errormsg || !obj.status) return;
      document.querySelector('.case_details').classList.remove('d-none');
      document.getElementById('advocate').innerHTML = obj.adv_option;
      document.getElementById('litigant').innerHTML = obj.party_option;
      document.getElementById('pet_name').innerHTML = obj.pet_name + ' <b>Vs</b> ' + obj.res_name;
      document.getElementById('cnr').value = obj.cino;
      document.getElementById('party_list').innerHTML = obj.party_chk;
      document.getElementById('setadv_part').innerHTML = 'partners';
      document.getElementById('submit_row').classList.remove('d-none');
    } });
  }
  function getPartyDetail() { setParty('L'); }
  function setParty(flg) {
    document.getElementById('setAdvRow').classList.remove('d-none');
    var html = '';
    var names = [];
    Array.prototype.forEach.call(document.querySelectorAll('input[name="chk_pet_list[]"]:checked'), function (c) {
      var v = c.value.split('~'); var b = v[0] + 'ssss' + v[2]; names.push(v[3]);
      html += "<div class='col-md-3'><label for='party_mobile" + b + "'><span style='color:#7A0000'>* </span>" + v[3] + "</label></div><div class='col-md-2'><input type='text' name=party_mobile[" + b + "] id='party_mobile" + b + "' placeholder='Mobile No' class='form-control compulsary csMobile' value='" + v[5] + "' maxlength='10'></div>";
      html += "<div class='col-md-2'><button type='button' name='party_btn' id='party_btn" + b + "' class='btn btn-sm btn-primary' value='Search' onclick=getUser('" + b + "')>Search</button></div>";
      html += "<label class='col-md-2' for='sel_party_mobile" + b + "'><b><span style='color:#7A0000'>* </span>Select User</b></label><div class='col-md-3'><select name=sel_party_mobile[" + b + "] id='sel_party_mobile" + b + "' class='form-control sel_party_mobile compulsary'><option value=''>Select User</option></select></div>";
    });
    if (flg !== 'A') document.getElementById('pde_no_row').innerHTML = html;
    var adv = Array.prototype.map.call(document.getElementById('advocate').selectedOptions, function (o) { return o.text; }).join(' and ');
    document.getElementById('setAdv').innerHTML = '<b>I' + (adv ? ' and ' + adv : '') + '</b>';
    if (flg !== 'A') document.getElementById('setParty').innerHTML = '<b>' + names.join(' and ') + '</b> appoint';
  }
  function getUser(b) {
    var mobile = document.getElementById('party_mobile' + b).value;
    if (!/^[0-9]{10}$/.test(mobile)) { errorAlert('Enter a valid 10-digit mobile number'); return false; }
    ajaxCall({ url: 'vakalat/getUser', postdata: 'mobile_no=' + mobile, callback: function (obj) { document.getElementById('sel_party_mobile' + b).innerHTML = obj.usrOptions; } });
  }
  function submitData(flg) {
    if (!document.getElementById('lit_agree').checked) { errorAlert('Please check Appointment checkbox'); return false; }
    if (document.getElementById('litigant').value === '') { errorAlert('Please Select Litigant name'); return false; }
    var postdata = serialize(document.getElementById('frm'));
    postdata = postdata + '&cause_title=' + document.getElementById('pet_name').innerHTML + ' Vs ' + document.getElementById('res_name').innerHTML + '&lcause_title=' + document.getElementById('lcause_title').value;
    ajaxCall({ url: 'vakalat/submitData', postdata: postdata, callback: function (obj) {
      if (obj.msg) { document.getElementById('submit_row').classList.add('d-none'); document.querySelector('.case_details').classList.add('d-none'); }
    } });
  }
`);

// Vakalat > Accept Offer (#acceptOffer = 'Y' -> fetchLitigantData('N')).
const acceptPage = () => shell(`<h3>Accept Offer</h3>
<form id="frm">
  <input type="hidden" id="sessionUserType" value="1"><input type="hidden" id="acceptOffer" value="Y">
  <div id="example_length"><label>Show <select><option value="10">10</option><option value="25">25</option><option value="-1">All</option></select> entries</label></div>
  <table id="example" class="table"><thead>
    <tr><th></th><th>Sr.No.</th><th class="pde_cino">e-Filing Number</th><th>Cause Title</th><th>Offered By</th></tr>
    <tr id="search_head"><th>Search</th><th>Sr.No.</th><th>e-Filing Number</th><th>Cause Title</th><th>Offered By</th></tr>
  </thead><tbody></tbody></table>
  <div class="row"><input type="button" class="btn" id="sotp_go" value="Send OTP" onclick="sendOTP('A')"></div>
  <div class="row"><label for="otp">Enter OTP</label><input type="text" id="otp" name="otp" maxlength="6"></div>
  <div class="row"><input type="button" class="btn" id="sv_go" value="Submit" onclick="submitData('A')"></div>
</form>`, `
  document.getElementById('sotp_go').disabled = true; document.getElementById('sv_go').disabled = true; document.getElementById('otp').disabled = true;
  document.addEventListener('change', function (e) { if (e.target.classList && e.target.classList.contains('chk_adv_approve')) document.getElementById('sotp_go').disabled = document.querySelectorAll('.chk_adv_approve:checked').length === 0; });
  document.getElementById('sotp_go').addEventListener('click', function () { document.getElementById('otp').disabled = false; });
  document.getElementById('otp').addEventListener('input', function () { document.getElementById('sv_go').disabled = this.value.trim().length <= 5; });
  var len = 10;
  document.querySelector('#example_length select').addEventListener('change', function () { len = Number(this.value); draw(); });
  // fetchLitigantData('N'): the search row becomes inputs (the first a Search button).
  (function () {
    var i = 0;
    Array.prototype.forEach.call(document.querySelectorAll('#search_head th'), function (th) {
      var title = th.textContent;
      if (i > 0) th.innerHTML = '<label for="search_' + i + '" class="visually-hidden" style="display:none">' + title + '</label><input id="search_' + i + '" type="text" placeholder="' + title + '">';
      else th.innerHTML = '<input id="search_0" type="button" class="btn" value="Search">';
      i++;
    });
    document.getElementById('search_0').addEventListener('click', draw);
  })();
  function draw() {
    var post = 'sEcho=1&iDisplayStart=0&iDisplayLength=' + len + '&type_of_case=N';
    var j = 1; Array.prototype.forEach.call(document.querySelectorAll('#search_head th'), function () { var el = document.getElementById('search_' + j); post += '&search_' + j + '=' + encodeURIComponent(el ? el.value : ''); j++; });
    post += '&column_cnt=' + j;
    ajaxCall({ url: 'vakalat/fetchLitigantData', postdata: post, callback: function (r) {
      document.querySelector('#example tbody').innerHTML = r.aaData.map(function (row) { return '<tr>' + row.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('');
    } });
  }
  draw();
  function sendOTP(flg) {
    if (document.querySelectorAll('.chk_adv_approve:checked').length === 0) { errorAlert('Please check atleast one case'); return false; }
    ajaxCall({ url: 'vakalat/sendOTP', postdata: 'flg=' + flg, callback: function () { document.getElementById('sotp_go').value = 'Resend OTP'; } });
  }
  function submitData(flg) {
    if (document.querySelectorAll('.chk_adv_approve:checked').length === 0) { errorAlert('Please check atleast one case'); return false; }
    if (document.getElementById('otp').value === '') { errorAlert('Please enter OTP'); return false; }
    var pet = document.getElementById('pet_name'), res = document.getElementById('res_name'), lc = document.getElementById('lcause_title');
    var postdata = serialize(document.getElementById('frm')) + '&flg=' + flg + '&cause_title=' + (pet ? pet.innerHTML : undefined) + ' Vs ' + (res ? res.innerHTML : undefined) + '&lcause_title=' + (lc ? lc.value : undefined);
    ajaxCall({ url: 'vakalat/submitData', postdata: postdata, callback: function (obj) { if (obj.msg) { document.getElementById('otp').value = ''; draw(); } } });
  }
`);

// Print Vakalat: stand-in (no public script).
// Vakalat > Print Vakalat (js/vakalat_template.js): a template row's View -> viewVakalatTemplate(...).
const printPage = () => shell(`<h3>Print Vakalat</h3>
<table id="tblTemplates" class="table"><thead><tr><th>Sr.No.</th><th>e-Filing Number</th><th>Cause Title</th><th>Vakalat</th></tr></thead><tbody>
<tr><td>1</td><td>ATN20250009438C202600002</td><td>Ramesh Kumar Vs Suresh Babu</td><td><a href="#" onclick="viewVakalatTemplate('ATN20250009438C202600002','UID42','10','N');return false;">View</a></td></tr>
</tbody></table>`, `
  function viewVakalatTemplate(pde_no, partner_efiling_uid, user_state_code, type_of_case) {
    var postdata = 'pde_no=' + pde_no + '&partner_efiling_uid=' + partner_efiling_uid + '&user_state_code=' + user_state_code + '&type_of_case=' + type_of_case;
    ajaxCall({ url: 'vakalattemplate/viewTemplate', postdata: postdata, callback: function (result) { window.open(result.name); } });
  }
`);

// My Partners > Revoke Partnership (js/partners/revoke_partner.js; the table rows are server-rendered: stand-in).
const partnerTable = () => `<thead><tr><th>Sr.No.</th><th>Partner Advocate</th><th>Bar Registration No.</th></tr></thead><tbody>${fx.partners.map((p, i) => `<tr><td>${i + 1}</td><td><a href="#" onclick="fetchdata1('${p.id}','${p.code}','${p.mobile}','${p.name}','Adv. Main','Adv. Main','0','1','10','10');return false;">${p.name}</a></td><td>${p.bar}</td></tr>`).join('')}</tbody>`;
const revokePage = () => shell(`<h3>Revoke Partnership</h3>
<table id="partner_table" class="table"></table>
<div id="secondary_div"><span id="fofferedlabel"></span></div>
<input type="hidden" id="partner_adv_no"><input type="hidden" id="partner_sr_no"><input type="hidden" id="partner_mobile_no"><input type="hidden" id="rad_val"><input type="hidden" id="otherstate_id"><input type="hidden" id="mystate_id">
<div class="row" id="tr_fofferedchk"><input type="checkbox" id="fofferedchk" onclick="enabledisable()"> <label for="fofferedchk">I wish to revoke the partnership</label></div>
<div class="row" id="otp_btn"><button type="button" class="btn" id="otpdata" onclick="getotp()">Get OTP</button></div>
<div class="row" id="tr_otp_text"><label for="enter_otp">Enter OTP</label><input type="text" id="enter_otp" maxlength="6"></div>
<div class="row"><input type="button" class="btn" id="submitdata" value="Submit" onclick="submitData(1)"></div>`, `
  function hide(ids) { ids.forEach(function (id) { document.getElementById(id).style.display = 'none'; }); }
  function show(ids) { ids.forEach(function (id) { document.getElementById(id).style.display = ''; }); }
  fetchData();
  function fetchData() {
    ajaxCall({ url: 'revoke_partner/fetchpartnersData', postdata: '', callback: function (result) {
      hide(['submitdata']);
      if (result.count > 0) document.getElementById('partner_table').innerHTML = result.partner_data;
      else { hide(['partner_table', 'tr_fofferedchk', 'tr_otp_text', 'otp_btn']); document.getElementById('partner_table').innerHTML = result.partner_data; }
      hide(['secondary_div']);
    } });
  }
  hide(['tr_fofferedchk', 'tr_otp_text', 'otp_btn']);
  function enabledisable() {
    if (document.getElementById('fofferedchk').checked) show(['submitdata', 'tr_fofferedchk', 'tr_otp_text', 'otp_btn']);
    else hide(['submitdata', 'tr_otp_text', 'otp_btn']);
  }
  function fetchdata1(partner_sr_no, partner_adv_code, partner_mobile_no, partner_adv_name, main_adv_name, session_adv_name, sessionlang_id, rad_val, mystate_id, otherstate_id) {
    var result = confirm('Do you want to revoke partnership?');
    if (result == true) {
      show(['submitdata', 'tr_fofferedchk', 'tr_otp_text', 'otp_btn', 'secondary_div']);
      var postdata = 'rad_val=' + rad_val + '&partner_sr_no=' + partner_sr_no + '&partner_adv_code=' + partner_adv_code + '&otherstate_id=' + otherstate_id + '&mystate_id=' + mystate_id;
      ajaxCall({ url: 'revoke_partner/updatedata1', postdata: postdata, callback: function () {
        document.getElementById('fofferedlabel').innerHTML = 'I ' + session_adv_name + ' revoke partnership with ' + partner_adv_name;
        document.getElementById('partner_adv_no').value = partner_adv_code; document.getElementById('partner_sr_no').value = partner_sr_no;
        document.getElementById('partner_mobile_no').value = partner_mobile_no; document.getElementById('rad_val').value = rad_val;
        document.getElementById('otherstate_id').value = otherstate_id; document.getElementById('mystate_id').value = mystate_id;
      } });
    } else hide(['submitdata', 'tr_fofferedchk', 'tr_otp_text', 'otp_btn', 'secondary_div']);
  }
  function getotp() {
    if (!document.getElementById('fofferedchk').checked) { errorAlert('Please check the checkbox'); return false; }
    ajaxCall({ url: 'revoke_partner/send_otp', postdata: 'rad_val=' + document.getElementById('rad_val').value + '&chkval=1', callback: function () { document.getElementById('otpdata').innerHTML = 'Resend OTP'; show(['submitdata']); } });
  }
  function submitData(flag) {
    var otp = document.getElementById('enter_otp').value;
    if (!document.getElementById('fofferedchk').checked) { errorAlert('Please check the checkbox'); return false; }
    if (otp == '') { errorAlert('Please enter OTP'); return false; }
    var g = function (id) { return document.getElementById(id).value; };
    var postdata = 'enter_otp=' + otp + '&flag=' + flag + '&partner_sr_no=' + g('partner_sr_no') + '&partner_adv_code=' + g('partner_adv_no') + '&rad_val=' + g('rad_val') + '&partner_mobile_no=' + g('partner_mobile_no') + '&chkval=1&otherstate_id=' + g('otherstate_id') + '&mystate_id=' + g('mystate_id');
    ajaxCall({ url: 'revoke_partner/submitdata', postdata: postdata, callback: function (result) {
      if (result.errormsg == '') { document.getElementById('fofferedchk').checked = false; document.getElementById('enter_otp').value = ''; hide(['submitdata', 'tr_fofferedchk', 'tr_otp_text', 'otp_btn']); fetchData(); }
      else document.getElementById('enter_otp').value = '';
    } });
  }
`);

const offerRow = (o: (typeof fx.offers)[number], i: number) => [`<input type="checkbox" class="chk_adv_approve" name="chk_adv_approve[]" value="${o.id}">`, String(i + 1), o.pde, o.title, o.by];

const form = (body: string | null) => new URLSearchParams(body ?? '');
const strip = (body: string) => body.replace(/&?ajax_req=true&__csrf_magic=[^&]*$/, '');

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  const html = (body: string) => route.fulfill({ contentType: 'text/html', body });
  if (url.pathname.endsWith('/securimage/securimage_show.php')) {
    fx.counter += 1;
    fx.lastCode = `V${fx.counter}x${fx.counter % 7}`;
    return route.fulfill({ contentType: 'image/svg+xml', body: svg(fx.lastCode) });
  }
  if (req.method() === 'GET' && url.pathname.endsWith('.pdf')) return route.fulfill({ contentType: 'application/pdf', body: `%PDF-1.4 fixture ${url.pathname}` });
  if (req.method() === 'GET') {
    if (p === 'login/logOut') return html('<html><body>Logged out</body></html>');
    if (fx.signedOut && p) return html(loginPage);
    if (p === 'dashboard') return html(dashboardPage());
    if (p === 'vakalat') return html(assignPage());
    if (p === 'vakalat/acceptOffer') return html(acceptPage());
    if (p === 'vakalattemplate/generateTemplate') return html(printPage());
    if (p === 'revoke_partner/revoke_partnership') return html(revokePage());
    return html(loginPage);
  }
  const f = form(req.postData());
  if (p === 'login/verify_login/') {
    const ok = f.get('fcaptcha_code') === fx.lastCode && f.get('user_name') === 'adv@example.com' && f.get('user_password') === PASSWORD;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ok ? { status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` } : { status: false, errorMsg: 'Invalid captcha', duplicate_login: 0 }) });
  }
  // Every logged-in request: the rotating token, or refused.
  const sent = f.get('__csrf_magic') ?? '';
  if (sent !== fx.csrf) return route.fulfill({ status: 403, body: `Invalid token#####${fx.csrf}` });
  fx.csrf = `tok${fx.calls.length + 1}`;
  fx.calls.push({ route: p, body: strip(req.postData() ?? '') });
  const reply = (o: Record<string, unknown>) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsteptoken: fx.csrf, ...o }) });
  switch (p) {
    case 'vakalat/fetchData':
      return reply({
        adv_option: '<option value="ADV7">Adv. Meena Raghavan (MS/1234/2010)</option><option value="ADV9">Adv. Karthik Iyer (MS/5678/2015)</option>',
        party_option: '<option value="">Select Litigant</option><option value="1~1">Ramesh Kumar</option>',
        pet_name: 'Ramesh Kumar', res_name: 'Suresh Babu', lpet_name: '', lres_name: '', cino: 'TNCH0C0012342026',
        party_chk: '<input type="checkbox" name="chk_pet_list[]" id="chk_pet_1" value="1~1~0~Ramesh Kumar~P~" onclick="getPartyDetail(this)"> <label for="chk_pet_1">Ramesh Kumar (Petitioner)</label>',
      });
    case 'vakalat/getUser':
      return reply({ usrOptions: '<option value="">Select User</option><option value="USR42">Ramesh Kumar (9876543210)</option>' });
    case 'vakalat/submitData':
      if (f.get('flg') === 'A') {
        if (f.get('otp') !== '123456') return reply({ errormsg: 'Invalid OTP' });
        const picked = f.getAll('chk_adv_approve[]');
        fx.offers = fx.offers.filter((o) => !picked.includes(o.id));
        return reply({ msg: 'Offer accepted successfully' });
      }
      return reply({ msg: 'Vakalat assigned successfully' });
    case 'vakalat/fetchLitigantData': {
      const n = Number(f.get('iDisplayLength'));
      const rows = fx.offers.map(offerRow);
      return reply({ aaData: n < 0 ? rows : rows.slice(0, n), iTotalRecords: rows.length, iTotalDisplayRecords: rows.length });
    }
    case 'vakalat/sendOTP':
      return reply({ msg: 'OTP sent to your registered mobile number' });
    case 'vakalattemplate/viewTemplate':
      return reply({ name: `/pdedev/temp/vakalat_${f.get('pde_no')}.pdf` });
    case 'revoke_partner/fetchpartnersData':
      return reply({ count: fx.partners.length, partner_data: partnerTable() });
    case 'revoke_partner/updatedata1':
      return reply({});
    case 'revoke_partner/send_otp':
      return reply({ msg: 'OTP sent' });
    case 'revoke_partner/submitdata':
      if (f.get('enter_otp') !== '123456') return reply({ errormsg: 'Invalid OTP' });
      fx.partners = fx.partners.filter((x) => x.id !== f.get('partner_sr_no'));
      return reply({ errormsg: '', msg: 'Partnership revoked' });
    default:
      return route.fulfill({ status: 404, body: 'not in fixture' });
  }
}

// ---- helpers to look at a screen as the advocate would -------------------------------------

const controls = (s: LiveScreen): LiveControl[] => s.items.flatMap((i: LiveItem) => (i.kind === 'control' ? [i.control] : i.kind === 'table' ? i.table.rows.flatMap((r) => ('cells' in r ? r.cells.flatMap((c) => c.controls) : [])) : []));
const control = (s: LiveScreen, key: string) => controls(s).find((c) => c.key === key);
const clicks = (s: LiveScreen): LiveClick[] => s.items.flatMap((i: LiveItem) => (i.kind === 'click' ? [i.click] : i.kind === 'text' ? i.clicks : i.kind === 'table' ? i.table.rows.flatMap((r) => ('cells' in r ? r.cells.flatMap((c) => c.clicks) : [])) : []));
const texts = (s: LiveScreen) => s.items.flatMap((i: LiveItem) => (i.kind === 'text' ? i.lines : i.kind === 'heading' ? [i.text] : []));
const table = (s: LiveScreen, id: string) => s.items.flatMap((i: LiveItem) => (i.kind === 'table' && i.table.id === id ? [i.table] : []))[0];
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

describe('Vakalat menu (fixture portal)', () => {
  it("reads the portal's menu bar: Vakalat's items in the portal's order", async () => {
    const menus = await vak.readPortalMenus(sessionId, USER);
    expect(menus.find((m) => m.menu === 'Vakalat')!.items.map((i) => i.text)).toEqual(['Assign Partners to Case', 'Accept Offer', 'Print Vakalat']);
    expect(menus.find((m) => m.menu === 'My Partners')!.items.map((i) => i.text)).toEqual(['Add Partners', 'Accept Partnership', 'Revoke Partnership', 'Accept Revocation', 'My Partners Report']);
  });

  it('Assign Partners to Case opens from the menu: the page as the portal draws it (case details hidden until a case is picked)', async () => {
    const s = await vak.openVakalatScreen(sessionId, USER, 'vakalat');
    expect(s).toMatchObject({ view: 'vakalat', label: 'Assign Partners to Case', title: 'Assign Partners to Case' });
    expect(s.url).toBe(`${ORIGIN}/pdedev/?p=vakalat`);
    expect(control(s, '#eFiled')).toMatchObject({ type: 'radio', label: 'eFiled Case', checked: true });
    expect(control(s, '#regis')).toMatchObject({ type: 'radio', label: 'Registered Case', checked: false });
    const pde = control(s, '#sel_pde_no')!;
    expect(pde.label).toBe('e-Filing Number');
    expect(pde.options!.map((o) => o.text)).toEqual(['Select e-Filing Number', 'ATN20250009438C202600002']);
    // Hidden parts of the page are not shown: no partners, no Submit yet.
    expect(control(s, '#advocate')).toBeUndefined();
    expect(clicks(s).map((c) => c.text)).not.toContain('Submit');
    // The menu bar is not part of the screen.
    expect(clicks(s).map((c) => c.text)).not.toContain('Logout');
    // The radio captions are the controls' labels, not extra text.
    expect(texts(s)).not.toContain('eFiled Case');
  });

  it("picking the e-Filing Number runs the portal's fetchData('3'): partners, litigant, cause title, parties, Submit", async () => {
    fx.calls = [];
    const r = await vak.stepVakalatScreen(sessionId, USER, 'vakalat', { fill: [{ key: '#sel_pde_no', value: 'ATN20250009438C202600002' }] });
    expect(callsTo('vakalat/fetchData').map((c) => c.body)).toEqual(['sel_pde_no=ATN20250009438C202600002&str=3']);
    const s = r.screen;
    expect(control(s, '#advocate')).toMatchObject({ type: 'select-multiple', label: 'Select Partner Advocate' });
    expect(control(s, '#advocate')!.options!.map((o) => o.text)).toEqual(['Adv. Meena Raghavan (MS/1234/2010)', 'Adv. Karthik Iyer (MS/5678/2015)']);
    expect(control(s, '#litigant')!.options!.map((o) => o.value)).toEqual(['', '1~1']);
    expect(control(s, '#chk_pet_1')).toMatchObject({ type: 'checkbox', label: 'Ramesh Kumar (Petitioner)', checked: false });
    expect(control(s, '#lit_agree')).toMatchObject({ type: 'checkbox', label: 'I hereby agree to the appointment' });
    expect(texts(s).join(' ')).toContain('Cause Title : Ramesh Kumar Vs Suresh Babu');
    expect(clicks(s).map((c) => c.text)).toContain('Submit');
  });

  it("ticking a party draws its mobile box + Search (setParty); Search runs getUser -> vakalat/getUser and fills Select User", async () => {
    const r1 = await vak.stepVakalatScreen(sessionId, USER, 'vakalat', { fill: [{ key: '#chk_pet_1', checked: true }] });
    const mobile = control(r1.screen, '#party_mobile1ssss0')!;
    expect(mobile).toMatchObject({ label: 'Ramesh Kumar', required: true, maxLength: 10 });
    expect(control(r1.screen, '#sel_party_mobile1ssss0')).toMatchObject({ label: 'Select User', required: true });
    fx.calls = [];
    const r2 = await vak.stepVakalatScreen(sessionId, USER, 'vakalat', { fill: [{ key: '#party_mobile1ssss0', value: '9876543210' }], press: { text: 'Search', nth: 0 } });
    expect(callsTo('vakalat/getUser').map((c) => c.body)).toEqual(['mobile_no=9876543210']);
    expect(control(r2.screen, '#sel_party_mobile1ssss0')!.options!.map((o) => o.text)).toEqual(['Select User', 'Ramesh Kumar (9876543210)']);
  });

  it('Submit assigns partners on the portal: refused without confirmation; the portal\'s own checks; then vakalat/submitData with the whole form', async () => {
    await expect(vak.stepVakalatScreen(sessionId, USER, 'vakalat', { press: { text: 'Submit' } })).rejects.toMatchObject({ status: 400 });
    fx.calls = [];
    const r1 = await vak.stepVakalatScreen(sessionId, USER, 'vakalat', { fill: [{ key: '#litigant', value: '1~1' }], press: { text: 'Submit' }, confirmed: true });
    expect(r1.messages).toEqual([{ kind: 'error', text: 'Please check Appointment checkbox' }]);
    expect(callsTo('vakalat/submitData')).toHaveLength(0);
    const r2 = await vak.stepVakalatScreen(sessionId, USER, 'vakalat', {
      fill: [{ key: '#advocate', value: ['ADV7', 'ADV9'] }, { key: '#sel_party_mobile1ssss0', value: 'USR42' }, { key: '#lit_agree', checked: true }],
      press: { text: 'Submit' }, confirmed: true,
    });
    expect(r2.messages).toEqual([{ kind: 'success', text: 'Vakalat assigned successfully' }]);
    const sent = callsTo('vakalat/submitData');
    expect(sent).toHaveLength(1);
    const body = new URLSearchParams(sent[0]!.body);
    expect(body.get('cases')).toBe('N');
    expect(body.get('sel_pde_no')).toBe('ATN20250009438C202600002');
    expect(body.get('cnr')).toBe('TNCH0C0012342026');
    expect(body.get('litigant')).toBe('1~1');
    expect(body.getAll('advocate[]')).toEqual(['ADV7', 'ADV9']);
    expect(body.getAll('chk_pet_list[]')).toEqual(['1~1~0~Ramesh Kumar~P~']);
    expect(body.get('party_mobile[1ssss0]')).toBe('9876543210');
    expect(body.get('sel_party_mobile[1ssss0]')).toBe('USR42');
    expect(body.get('lit_agree')).toBe('Y');
    expect(body.get('cause_title')).toBe('Ramesh Kumar <b>Vs</b> Suresh Babu Vs ');
  }, 60_000);

  it('Accept Offer: every offer in the portal\'s DataTable (All entries), its column search boxes, Send OTP disabled until one is ticked', async () => {
    fx.calls = [];
    const s = await vak.openVakalatScreen(sessionId, USER, 'accept_offer');
    expect(s.label).toBe('Accept Offer');
    const lists = callsTo('vakalat/fetchLitigantData');
    expect(lists.map((c) => new URLSearchParams(c.body).get('iDisplayLength'))).toEqual(['10', '-1']);
    expect(lists[0]!.body).toBe('sEcho=1&iDisplayStart=0&iDisplayLength=10&type_of_case=N&search_1=&search_2=&search_3=&search_4=&search_5=&column_cnt=6');
    const t = table(s, 'example')!;
    expect(t.headers).toEqual(['', 'Sr.No.', 'e-Filing Number', 'Cause Title', 'Offered By']);
    expect(t.filters!.map((c) => c.controls.map((x) => x.placeholder)[0] ?? c.clicks[0]?.text)).toEqual(['Search', 'Sr.No.', 'e-Filing Number', 'Cause Title', 'Offered By']);
    expect(t.rows).toHaveLength(11);
    const row = t.rows[1] as { cells: Array<{ text: string; controls: LiveControl[] }> };
    expect(row.cells.map((c) => c.text)).toEqual(['', '2', 'ATN20250009438C202600011', 'Party 2 Vs State', 'Adv. Senior 2']);
    expect(row.cells[0]!.controls[0]).toMatchObject({ type: 'checkbox', key: '[name="chk_adv_approve\\[\\]"][value="ATN20250009438C202600011\\~2"]', checked: false });
    expect(clicks(s).find((c) => c.text === 'Send OTP')).toMatchObject({ disabled: true });
    expect(control(s, '#otp')).toMatchObject({ label: 'Enter OTP', disabled: true });
  }, 60_000);

  it('ticking an offer enables Send OTP (sendOTP(\'A\') -> vakalat/sendOTP flg=A); a wrong OTP is the portal\'s error; the right one accepts it', async () => {
    const s0 = await vak.openVakalatScreen(sessionId, USER, 'accept_offer');
    const box = ((table(s0, 'example')!.rows[1] as { cells: Array<{ controls: LiveControl[] }> }).cells[0]!.controls[0]!).key;
    const r1 = await vak.stepVakalatScreen(sessionId, USER, 'accept_offer', { fill: [{ key: box, checked: true }] });
    expect(clicks(r1.screen).find((c) => c.text === 'Send OTP')).toMatchObject({ disabled: false });
    fx.calls = [];
    const r2 = await vak.stepVakalatScreen(sessionId, USER, 'accept_offer', { press: { text: 'Send OTP' } });
    expect(callsTo('vakalat/sendOTP').map((c) => c.body)).toEqual(['flg=A']);
    expect(r2.messages).toEqual([{ kind: 'success', text: 'OTP sent to your registered mobile number' }]);
    expect(clicks(r2.screen).map((c) => c.text)).toContain('Resend OTP');
    expect(control(r2.screen, '#otp')).toMatchObject({ disabled: false });
    // The OTP is typed by the advocate; Submit (disabled until 6 characters) is pressed after it is filled.
    await expect(vak.stepVakalatScreen(sessionId, USER, 'accept_offer', { fill: [{ key: '#otp', value: '111111' }], press: { text: 'Submit' } })).rejects.toMatchObject({ status: 400 });
    const r3 = await vak.stepVakalatScreen(sessionId, USER, 'accept_offer', { fill: [{ key: '#otp', value: '111111' }], press: { text: 'Submit' }, confirmed: true });
    expect(r3.messages).toEqual([{ kind: 'error', text: 'Invalid OTP' }]);
    fx.calls = [];
    const r4 = await vak.stepVakalatScreen(sessionId, USER, 'accept_offer', { fill: [{ key: '#otp', value: '123456' }], press: { text: 'Submit' }, confirmed: true });
    expect(r4.messages).toEqual([{ kind: 'success', text: 'Offer accepted successfully' }]);
    const body = callsTo('vakalat/submitData')[0]!.body;
    expect(body).toBe('chk_adv_approve%5B%5D=ATN20250009438C202600011%7E2&otp=123456&flg=A&cause_title=undefined Vs undefined&lcause_title=undefined');
    expect(table(r4.screen, 'example')!.rows).toHaveLength(10);
  }, 90_000);

  it("Print Vakalat: a template's View runs viewVakalatTemplate -> vakalattemplate/viewTemplate; the PDF it opens comes back", async () => {
    const s = await vak.openVakalatScreen(sessionId, USER, 'print_vakalat');
    expect(s.url).toBe(`${ORIGIN}/pdedev/?p=vakalattemplate/generateTemplate`);
    expect(table(s, 'tblTemplates')!.headers).toEqual(['Sr.No.', 'e-Filing Number', 'Cause Title', 'Vakalat']);
    fx.calls = [];
    const r = await vak.stepVakalatScreen(sessionId, USER, 'print_vakalat', { press: { text: 'View' } });
    expect(callsTo('vakalattemplate/viewTemplate').map((c) => c.body)).toEqual(['pde_no=ATN20250009438C202600002&partner_efiling_uid=UID42&user_state_code=10&type_of_case=N']);
    expect(r.file).toMatchObject({ name: 'vakalat_ATN20250009438C202600002.pdf', contentType: 'application/pdf' });
    expect(Buffer.from(r.file!.base64, 'base64').toString()).toBe('%PDF-1.4 fixture /pdedev/temp/vakalat_ATN20250009438C202600002.pdf');
  }, 60_000);
});

describe('My Partners (fixture portal)', () => {
  it('Revoke Partnership opens from the My Partners menu: the partners the portal lists (revoke_partner/fetchpartnersData)', async () => {
    fx.calls = [];
    const s = await vak.openVakalatScreen(sessionId, USER, 'revoke_partnership');
    expect(s.label).toBe('Revoke Partnership');
    expect(s.url).toBe(`${ORIGIN}/pdedev/?p=revoke_partner/revoke_partnership`);
    expect(callsTo('revoke_partner/fetchpartnersData').map((c) => c.body)).toEqual(['']);
    const t = table(s, 'partner_table')!;
    expect(t.headers).toEqual(['Sr.No.', 'Partner Advocate', 'Bar Registration No.']);
    expect(t.rows.map((r) => ('cells' in r ? r.cells.map((c) => c.text) : []))).toEqual([
      ['1', 'Adv. Meena Raghavan', 'MS/1234/2010'],
      ['2', 'Adv. Karthik Iyer', 'MS/5678/2015'],
    ]);
    // OTP and Submit are hidden until a partner is picked.
    expect(control(s, '#enter_otp')).toBeUndefined();
    expect(clicks(s).map((c) => c.text)).not.toContain('Submit');
  });

  it("the portal's own confirm() is answered Cancel unless the step was confirmed; then updatedata1, Get OTP, Submit", async () => {
    fx.calls = [];
    const asked = await vak.stepVakalatScreen(sessionId, USER, 'revoke_partnership', { press: { text: 'Adv. Karthik Iyer' } });
    expect(asked.messages).toEqual([{ kind: 'confirm', text: 'Do you want to revoke partnership?' }]);
    expect(callsTo('revoke_partner/updatedata1')).toHaveLength(0);
    const ok = await vak.stepVakalatScreen(sessionId, USER, 'revoke_partnership', { press: { text: 'Adv. Karthik Iyer' }, confirmed: true });
    expect(callsTo('revoke_partner/updatedata1').map((c) => c.body)).toEqual(['rad_val=1&partner_sr_no=6&partner_adv_code=ADV9&otherstate_id=10&mystate_id=10']);
    expect(texts(ok.screen)).toContain('I Adv. Main revoke partnership with Adv. Karthik Iyer');
    expect(control(ok.screen, '#fofferedchk')).toMatchObject({ label: 'I wish to revoke the partnership', checked: false });
    const otp = await vak.stepVakalatScreen(sessionId, USER, 'revoke_partnership', { fill: [{ key: '#fofferedchk', checked: true }], press: { text: 'Get OTP' } });
    expect(callsTo('revoke_partner/send_otp').map((c) => c.body)).toEqual(['rad_val=1&chkval=1']);
    expect(clicks(otp.screen).map((c) => c.text)).toContain('Resend OTP');
    await expect(vak.stepVakalatScreen(sessionId, USER, 'revoke_partnership', { fill: [{ key: '#enter_otp', value: '123456' }], press: { text: 'Submit' } })).rejects.toMatchObject({ status: 400 });
    const done = await vak.stepVakalatScreen(sessionId, USER, 'revoke_partnership', { fill: [{ key: '#enter_otp', value: '123456' }], press: { text: 'Submit' }, confirmed: true });
    expect(callsTo('revoke_partner/submitdata').map((c) => c.body)).toEqual(['enter_otp=123456&flag=1&partner_sr_no=6&partner_adv_code=ADV9&rad_val=1&partner_mobile_no=9876500001&chkval=1&otherstate_id=10&mystate_id=10']);
    expect(done.messages).toEqual([{ kind: 'success', text: 'Partnership revoked' }]);
    expect(table(done.screen, 'partner_table')!.rows).toHaveLength(1);
  }, 60_000);

  it('a step on a screen whose portal page another screen replaced is a 409 (open it again), not a wrong click', async () => {
    await vak.openVakalatScreen(sessionId, USER, 'print_vakalat');
    await expect(vak.stepVakalatScreen(sessionId, USER, 'revoke_partnership', { press: { text: 'Submit' }, confirmed: true })).rejects.toMatchObject({ status: 409 });
  });

  it('the portal signed the session out: 410 "log in again", never 401', async () => {
    fx.signedOut = true;
    try {
      const err = await vak.openVakalatScreen(sessionId, USER, 'revoke_partnership').then(() => null, (e: { status?: number; message?: string }) => e);
      expect(err?.status).toBe(410);
      expect(err?.message).toMatch(/Log in again/);
    } finally {
      fx.signedOut = false;
    }
  }, 60_000);
});
