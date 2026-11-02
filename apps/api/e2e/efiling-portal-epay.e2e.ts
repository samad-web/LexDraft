/**
 * eFiling portal ePayments (Payment, transactions / GRN, Court Fee Wallet),
 * against fixture pages that copy the real portal's ids, functions and
 * requests (epay.js, applications.js, components.js' ajaxCall -
 * docs/efiling-portal-reverse-engineering.md §5-6):
 *   - #frm: name=cases radios #search/#regis/#eFiled (each resets the form),
 *     #sel_pde_no -> epay/getPartyListFromPDE -> #payee; payee -> getMobile()
 *     -> epay/getMobile -> #mobile; name=epayOptions radios whose labels
 *     epay/get_payment_type shows/hides; fillScheme_jd() -> #judicial_type;
 *     #amount -> price_in_words (#curancy_id) and chk_amount (#errSpan1)
 *   - #i_agree -> #div_mobile; OnClickOTP() -> epay/generate_otp -> #div_otp
 *   - verify_otp() -> epay/verify_otp_new; its reply HTML (an auto-submitting
 *     form to the bank) goes into #div_redirect and its script runs
 *   - viewDetails() -> epay/DoubleVerificationDetails -> #divTransList with
 *     getGRNGras / viewDetailsDouble / getPrevChallanGras row links
 *   - Applications Pay Fees: getSubmittedCasesPayFees -> #tr_submitted_epay_
 *     cases, setWalletBalence per tick, payCourtFees() (confirm) ->
 *     applications/payCourtFees
 * Every request checks the rotating __csrf_magic token. The real service code
 * drives them (no live portal, no account, no DB, no payment).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { ZodError } from 'zod';
import type { BrowserContext, Route } from 'playwright';
import * as live from '../src/services/efiling-live.service';
import * as epay from '../src/services/efiling-portal-epay.service';
import { efilingPortalEpayRouter } from '../src/routes/efiling-portal-epay.routes';

const USER = 'portal-epay-user';
const PASSWORD = 'Secret@123';
const ORIGIN = 'https://filing.ecourts.gov.in';
const GATEWAY = 'https://gateway.example';
const PDE = 'AKL20250001234C202600019';

// ---- fixture state ------------------------------------------------------------------

const fx = {
  counter: 0,
  lastCode: '',
  csrf: 'tok0',
  csrfBad: 0,
  signedOut: false,
  /** Every portal request after login: route + body. */
  calls: [] as Array<{ route: string; body: URLSearchParams }>,
  /** Any request that reached the bank / gateway host (must stay 0). */
  gatewayHits: [] as string[],
  walletBalance: 500,
  paidApps: [] as string[],
  pages: [] as string[],
};
const callsTo = (route: string) => fx.calls.filter((c) => c.route === route);

const svg = (code: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="12" y="34" font-size="26" font-family="monospace">${code}</text></svg>`;

const loginPage = `<!doctype html><html><body>
<form id="frm_login">
  <select id="selState"><option value="">Select</option><option value="4">Kerala</option></select>
  <input type="radio" name="rdoUser" id="user_advocate" value="1"><input type="radio" name="rdoUser" id="user_person" value="2">
  <input id="user_name"><input type="password" id="user_password"><input type="hidden" id="gennum" value="n1">
  <div id="div_captcha_mobile"><img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a1" width="150" height="50"></div>
  <input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="doLogin()">Login</button>
  <div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div>
</form>
<div id="regForPassModal"><img id="captcha_image2" src="/pdedev/securimage/securimage_show.php?b2" width="150" height="50"></div>
<div id="alert_invalid_pin" style="display:none"><form id="frm_duplicate_login">
  <input type="password" id="user_pwd"><img id="captcha_image1" src="/pdedev/securimage/securimage_show.php?c3" width="150" height="50">
  <input id="fcaptcha_code_mobile1"><button type="button" id="re_verify_button">Logout and Login</button>
</form></div>
<script>
  function doLogin() {
    var x = new XMLHttpRequest(); x.open('POST', '/pdedev/?p=login/verify_login/');
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.onload = function () {
      var obj = JSON.parse(x.responseText);
      if (obj.status === true && obj.redirect_path) { window.location.href = obj.redirect_path; return; }
      document.querySelector('.alert-danger4').style.display = 'block';
      document.getElementById('msg-danger4').innerHTML = obj.errorMsg;
      document.getElementById('captcha_image').src = '/pdedev/securimage/securimage_show.php?' + Math.random();
    };
    x.send('user_name=' + encodeURIComponent(document.getElementById('user_name').value)
      + '&user_password=' + encodeURIComponent(document.getElementById('user_password').value)
      + '&fcaptcha_code=' + encodeURIComponent(document.getElementById('fcaptcha_code_mobile').value));
  }
</script></body></html>`;

// The portal's menu bar (every logged-in page has it).
const menu = `<ul class="navbar">
<li class="dropdown"><a class="dropdown-toggle" href="#">ePayments</a><ul class="dropdown-menu">
  <li><a href="${ORIGIN}/pdedev/?p=epay">Payment</a></li>
  <li><a href="${ORIGIN}/pdedev/?p=epay/courtFeeWallet">Court Fee Wallet</a></li></ul></li>
<li class="dropdown"><a class="dropdown-toggle" href="#">Applications</a><ul class="dropdown-menu">
  <li><a href="${ORIGIN}/pdedev/?p=applications">Applications</a></li></ul></li>
<li><a href="${ORIGIN}/pdedev/?p=dashboard">Dashboard</a></li>
</ul>`;

// components.js: ajaxCall (form body + ajax_req + the current token; the
// reply's nsteptoken is the next one; errormsg -> errorAlert, msg -> successAlert).
const commonJs = `
function errorAlert(m) { var e = document.getElementById('msg-danger'); if (e) e.innerHTML = m; }
function successAlert(m) { var e = document.getElementById('msg-success'); if (e) e.innerHTML = m; }
function ajaxCall(o) {
  setTimeout(function () {
    var tok = document.getElementById('__csrf_magic');
    var x = new XMLHttpRequest(); x.open('POST', document.getElementById('base_url').value + '/?p=' + o.url);
    x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    x.onload = function () {
      if (x.status !== 200) {
        var parts = x.responseText.split('#####');
        if (parts[0]) errorAlert(parts[0]);
        if (parts[1]) tok.value = parts[1];
        o.callback({ status: false });
        return;
      }
      var r = JSON.parse(x.responseText);
      if (r.errormsg) { errorAlert(r.errormsg); r.status = false; o.callback(r); }
      if (r.msg) successAlert(r.msg);
      r.status = true;
      o.callback(r);
      tok.value = r.nsteptoken;
    };
    x.send(o.postdata + '&ajax_req=true&__csrf_magic=' + tok.value);
  }, 50);
}
function show(id, on) { var e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; }
function runScripts(box) {
  Array.prototype.forEach.call(box.querySelectorAll('script'), function (old) { var s = document.createElement('script'); s.text = old.text; old.parentNode.replaceChild(s, old); });
}
`;

const hidden = (ids: string[]) => ids.map((id) => `<input type="hidden" id="${id}" value="">`).join('');
const head = () => `<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="${fx.csrf}">
<div class="alert-danger"><span id="msg-danger"></span></div><div class="alert-success"><span id="msg-success"></span></div>`;

const dashboardPage = () => `<!doctype html><html><body>${head()}${menu}<h3>Dashboard</h3>
<a href="#" id="efiling_activity">Draft Pleadings</a><div id="db_screen"><div id="history_body"></div></div></body></html>`;

// ---- ePayments > Payment (epay.js) ----------------------------------------------------

const epayPage = () => `<!doctype html><html><body>${head()}${menu}
<div class="container"><h3>Payment</h3>
<form id="frm">
  ${hidden(['hid_establishment_code', 'hid_state_code', 'hid_dist_code', 'hid_cino', 'hdn_cino', 'hid_regcase_type', 'hid_reg_no', 'hid_reg_year', 'hid_filcase_type', 'hid_fil_no', 'hid_fil_year', 'hid_maincase_type', 'hid_type_name', 'CHALLAN_AMOUNT', 'AMOUNT1', 'ADDRESS1', 'ADDRESS2', 'ADDRESS3', 'state_code', 'dist_code', 'national_court_code'])}
  <input type="hidden" id="sess_state_code" value="4"><input type="hidden" id="flag" value="Y">
  <div class="form-group"><span>Search Case By</span>
    <label for="search"><input type="radio" name="cases" id="search" value="1"> Search Keyword</label>
    <label for="regis"><input type="radio" name="cases" id="regis" value="2"> Case Number</label>
    <label for="eFiled"><input type="radio" name="cases" id="eFiled" value="3"> e-Filing Number</label>
  </div>
  <div id="div_keyword" style="display:none"><label for="txt_case_search">Search Keyword</label><select id="txt_case_search" name="txt_case_search"><option value="">Select</option><option value="KLER010012342024">OS/1234/2024</option></select></div>
  <div id="div_regis" style="display:none">
    <label for="selComponentDistrict">District</label><select id="selComponentDistrict" name="selComponentDistrict"><option value="">Select</option><option value="7">Ernakulam</option></select>
    <label for="selComponentEst">Establishment</label><select id="selComponentEst" name="selComponentEst"><option value="">Select</option><option value="KLER01">District Court, Ernakulam</option></select>
    <label for="case_type">Case Type</label><select id="case_type" name="case_type"><option value="">Select</option><option value="1">OS</option></select>
    <label for="case_no">Case Number</label><input id="case_no" name="case_no">
    <label for="case_year">Year</label><input id="case_year" name="case_year">
  </div>
  <div id="div_pde" style="display:none"><label for="sel_pde_no">e-Filing Number <span>*</span></label>
    <select id="sel_pde_no" name="sel_pde_no" onchange="fxPdeChanged()"><option value="">Select</option><option value="${PDE}">C202600019</option></select></div>
  <div id="displayCaseNocase"></div>
  <div class="form-group"><span>Payment Type</span>
    <label id="courtFeeLabel" style="display:none"><input type="radio" name="epayOptions" id="courtFee_radio" value="C" onclick="fillScheme_jd()"> Court Fee</label>
    <label id="JudicialDepositLabel" style="display:none"><input type="radio" name="epayOptions" id="JudicialDeposit_radio" value="JD" onclick="fillScheme_jd()"> Judicial Deposit</label>
    <label id="penaltyLabel" style="display:none"><input type="radio" name="epayOptions" id="penalty_radio" value="P" onclick="fillScheme_jd()"> Penalty</label>
    <label id="FineLabel" style="display:none"><input type="radio" name="epayOptions" id="Fine_radio" value="F" onclick="fillScheme_jd()"> Fine</label>
    <label id="othersLabel" style="display:none"><input type="radio" name="epayOptions" id="others_radio" value="O" onclick="fillScheme_jd()"> Others</label>
  </div>
  <div id="jd_type" style="display:none"><label for="judicial_type">Judicial Deposit Type</label><select id="judicial_type" name="judicial_type"></select></div>
  <div id="scheme_div" style="display:none"><label for="scheme_code">Scheme</label><select id="scheme_code" name="scheme_code"></select></div>
  <div id="other_pay_type" style="display:none"><label for="sub_payment_type">Other Payment Type</label><select id="sub_payment_type" name="sub_payment_type"></select></div>
  <div class="form-group"><label for="payee">Payee Name <span>*</span></label><select id="payee" name="payee" onchange="getMobile(this.value); hideExtraParty()"><option value="">Select</option></select></div>
  <div id="extra_party_div" class="form-group"><label for="extraparty">Other Payee Name</label><input id="extraparty" name="extraparty"></div>
  <div class="form-group"><label for="mobile">Mobile No <span>*</span></label><input id="mobile" name="mobile" maxlength="10"></div>
  <div class="form-group"><label for="amount">Amount <span>*</span></label><input id="amount" name="amount" oninput="price_in_words(this)" onblur="chk_amount(event, this.value)"><span id="curancy_id"></span></div>
  <span id="errSpan1" style="display:none"></span>
  <div class="form-group"><label for="Remark">Remark</label><textarea id="Remark" name="Remark"></textarea></div>
</form>
<div><input type="checkbox" id="i_agree" onclick="funTermsAccepted()"><label for="i_agree">I agree that the details above are correct and the fee once paid is not refundable</label></div>
<div id="div_mobile" style="display:none">
  <button type="button" id="button_mobile" onclick="OnClickOTP('button_mobile')">Send OTP</button>
  <button type="button" id="button_mobileR" style="display:none" onclick="OnClickOTP('button_mobileR')">Resend OTP</button>
</div>
<div class="alert-success3" style="display:none"><span id="msg-success3"></span></div><div class="alert-danger3"><span id="msg-danger3"></span></div>
<div id="div_otp" style="display:none"><label for="user_otp1">Enter OTP</label><input id="user_otp1" maxlength="10"><span id="countdown"></span>
  <button type="button" id="btn_verify" onclick="verify_otp()">Verify and Pay</button></div>
<div id="div_otp2" style="display:none"><input id="user_otp2"></div>
<div id="div_redirect"></div>
<button type="button" id="btnViewC" onclick="viewDetails()">View Transactions</button>
<div class="modal" id="myModal" style="display:none"><div id="divTransList"></div></div>
<input type="hidden" id="folder_name" value="">
</div>
<script>
${commonJs}
var EPAY_NFS_URL = 'https://epaynfs.example/epay';
// $(document).ready: get_payment_type(); court fee checked.
document.getElementById('courtFee_radio').checked = true;
get_payment_type();
function get_payment_type() {
  ajaxCall({ url: 'epay/get_payment_type', postdata: '', callback: function (obj) {
    show('courtFeeLabel', obj.court_fee == 'Y'); show('JudicialDepositLabel', obj.judicial_deposit == 'Y');
    show('penaltyLabel', obj.penalty == 'Y'); show('FineLabel', obj.fine == 'Y'); show('othersLabel', obj.other_fee == 'Y');
  } });
}
// $('#eFiled').click / $('#search').click / $('#regis').click: court fee, reset the form, show the source's part.
function source(id) {
  document.getElementById('frm').reset();
  document.getElementById('courtFee_radio').checked = true;
  document.getElementById(id).checked = true;
  show('div_pde', id === 'eFiled'); show('div_keyword', id === 'search'); show('div_regis', id === 'regis');
  show('jd_type', false); show('scheme_div', false); show('other_pay_type', false);
}
['eFiled', 'search', 'regis'].forEach(function (id) { document.getElementById(id).addEventListener('click', function () { source(id); }); });
function fxPdeChanged() {
  ajaxCall({ url: 'epay/getPartyListFromPDE', postdata: 'pde_no=' + document.getElementById('sel_pde_no').value, callback: function (obj) {
    if (!obj.party_options) return;
    document.getElementById('payee').innerHTML = obj.party_options;
    document.getElementById('hid_establishment_code').value = obj.pde_est_code;
    document.getElementById('hid_state_code').value = '4';
    document.getElementById('hid_dist_code').value = '7';
    document.getElementById('hdn_cino').value = obj.cino;
    document.getElementById('displayCaseNocase').textContent = obj.case_text;
  } });
}
function getMobile(name) {
  var pde_no = document.getElementById('sel_pde_no').value;
  var party_no = name.split('~')[1];
  if (name != '') {
    document.getElementById('extraparty').disabled = true;
    ajaxCall({ url: 'epay/getMobile', postdata: 'pde_no=' + pde_no + '&party_no=' + party_no, callback: function (obj) { if (obj.mobile) document.getElementById('mobile').value = obj.mobile; } });
  }
}
function hideExtraParty() {
  var on = document.getElementById('payee').value == '';
  if (!on) document.getElementById('extraparty').value = '';
  show('extra_party_div', on);
}
function fillScheme_jd() {
  var existingcase = (document.querySelector("input[name='cases']:checked") || {}).value;
  var epayOptions = document.querySelector("input[name='epayOptions']:checked").value;
  if (existingcase == 3 && document.getElementById('sel_pde_no').value == '') { alert('Please select eFilling number'); return false; }
  var postdata = 'state_code=' + document.getElementById('hid_state_code').value + '&existingcase=' + existingcase + '&cino=' + document.getElementById('hdn_cino').value
    + '&dist_code=' + document.getElementById('hid_dist_code').value + '&national_court_code=' + document.getElementById('hid_establishment_code').value
    + '&existingcase=' + existingcase + '&epayOptions=' + epayOptions + '&action_code=fillScheme_jd';
  ajaxCall({ url: 'epay/fillScheme_jd', postdata: postdata, callback: function (result) {
    var fill = function (s, sel) { sel.innerHTML = ''; s.split('#').forEach(function (p) { if (!p) return; var kv = p.split('~'); sel.add(new Option(kv[1], kv[0])); }); };
    if (epayOptions == 'JD') { show('scheme_div', false); show('other_pay_type', false); if (result.fill_JudicialType != '') { show('jd_type', true); fill(result.fill_JudicialType, document.getElementById('judicial_type')); } }
    else if (epayOptions == 'O') { show('scheme_div', false); show('jd_type', false); if (result.fillPaymentType != '') { show('other_pay_type', true); fill(result.fillPaymentType, document.getElementById('sub_payment_type')); } }
    else { show('jd_type', false); show('other_pay_type', false); show('scheme_div', false); }
  } });
}
function price_in_words(obj) {
  document.getElementById('curancy_id').innerHTML = obj.value === '4320' ? '[ Rupees Four Thousand Three Hundred and Twenty Only ]' : obj.value ? '[ Rupees ' + obj.value + ' Only ]' : '';
}
function chk_amount(event, amount) {
  event.preventDefault();
  var epayOptions = document.querySelector("input[name='epayOptions']:checked").value;
  var cnr_num = document.getElementById('hid_cino').value;
  ajaxCall({ url: 'epay/chk_amount', postdata: 'action_code=chk_amount&state_code=' + document.getElementById('hid_state_code').value + '&amount=' + amount + '&epayOptions=' + epayOptions + '&cnr_no=' + cnr_num, callback: function (result) {
    var e = document.getElementById('errSpan1');
    if (result.msg != '') { e.style.display = ''; e.innerHTML = "<p align='center' style='color:red;'><strong>" + result.msg + '</strong></p>'; } else e.style.display = 'none';
  } });
}
function funTermsAccepted() { show('div_mobile', document.getElementById('i_agree').checked); }
function OnClickOTP(buttonId) { generate_otp(); }
function generate_otp() {
  var mobile = document.getElementById('mobile').value;
  var search_case = (document.querySelector("input[name='cases']:checked") || {}).value;
  var party_name = document.getElementById('payee').value;
  if (!party_name && document.getElementById('extraparty').value == '') { alert('Please select party or enter payee name'); return false; }
  if (mobile == '') { alert('Enter Mobile No'); return; }
  if (mobile.length != 10) { alert('Enter 10 digit Mobile No'); return; }
  var dataString = 'mobile=' + mobile + '&amount=' + document.getElementById('amount').value + '&epay_type=' + document.querySelector("input[name='epayOptions']:checked").value
    + '&case_num=' + document.getElementById('hid_reg_no').value + '&case_type=' + document.getElementById('hid_type_name').value + '&case_year=' + document.getElementById('hid_reg_year').value + '&search_case=' + search_case;
  ajaxCall({ url: 'epay/generate_otp', postdata: dataString, callback: function (result) {
    show('div_otp', true);
    document.getElementById('user_otp2').value = '';
    document.getElementById('div_otp2').style.display = 'none';
    if (result.status == 'success') { show('div_otp', true); document.querySelector('.alert-success3').style.display = ''; document.getElementById('msg-success3').innerHTML = result.msg; }
    else document.getElementById('msg-danger3').innerHTML = result.msg || '';
  } });
}
function verify_otp() {
  var mobile = document.getElementById('mobile').value, user_otp = document.getElementById('user_otp1').value;
  var search_case = document.querySelector("input[name='cases']:checked").value;
  var epay_type = document.querySelector("input[name='epayOptions']:checked").value;
  var case_sel = search_case == 3 ? 'New' : 'cnr';
  var sel_pde_no = document.getElementById('sel_pde_no').value;
  if (user_otp == '') { alert('Enter OTP'); return; }
  var Amount3 = document.getElementById('amount').value;
  if (Amount3 <= 0.0) { alert('Please Enter valid Amount'); return false; }
  var payee = document.getElementById('payee');
  var party_name = payee.value ? payee.options[payee.selectedIndex].text : document.getElementById('extraparty').value;
  var party_no = payee.value || '';
  var send_str = 'mobile=' + mobile + '&user_otp=' + user_otp + '&state_code=' + document.getElementById('sess_state_code').value + '&dist_code=' + document.getElementById('hid_dist_code').value
    + '&national_court_code=' + document.getElementById('hid_establishment_code').value + '&Amount=' + Amount3 + '&CHALLAN_AMOUNT=' + Amount3;
  if (Amount3 >= 100000) { if (!confirm('The amount is more than ₹1,00,000. Please check and confirm to continue.')) return false; }
  send_str += '&Amount_lbf=&Amount_awf=&Amount_acwf=&party_name=' + party_name + '&party_no=' + party_no + '&Remark=' + document.getElementById('Remark').value
    + '&epay_type=' + epay_type + '&case_sel=' + case_sel + '&scheme_code=';
  if (epay_type == 'JD') send_str += '&judicial_type=' + document.getElementById('judicial_type').value;
  send_str += '&cino=' + document.getElementById('hid_cino').value + '&case_sel=' + case_sel
    + '&hid_regcase_type=0&hid_reg_no=0&hid_reg_year=0&hid_filcase_type=0&hid_fil_no=0&hid_fil_year=0&hid_maincase_type=0'
    + '&casedetail=' + document.getElementById('displayCaseNocase').textContent + '&sel_pde_no=' + sel_pde_no + '&search_case_type=' + search_case + '&action_code=verify_otp_new';
  ajaxCall({ url: 'epay/verify_otp_new', postdata: send_str, callback: function (result) {
    if (!result.errormsg && result.status) {
      if (result.msg == 'Please Regenerate One Time Password') { show('div_otp', false); }
      else { document.getElementById('user_otp1').value = ''; var box = document.getElementById('div_redirect'); box.innerHTML = result.data; runScripts(box); }
    }
  } });
}
function viewDetails() {
  ajaxCall({ url: 'epay/DoubleVerificationDetails', postdata: 'action_code=viewTransaction', callback: function (result) {
    if (result.data != '') { document.getElementById('myModal').style.display = 'block'; document.getElementById('divTransList').innerHTML = result.data; }
  } });
}
function getGRNGras(pde_transaction_id, state_code, pay_from, payment_type, national_court_code, cnt, other_fee_sub_code) {
  var send_str = 'state_code=' + state_code + '&pde_transaction_id=' + pde_transaction_id + '&pay_from=' + pay_from + '&payment_type=' + payment_type
    + '&national_court_code=' + national_court_code + '&other_fee_sub_code=' + other_fee_sub_code + '&action_code=getGRNGras';
  ajaxCall({ url: 'epay/getGRNGras', postdata: send_str, callback: function (result) {
    result = result.data;
    if (result == null) { alert('Challan Details not found'); return false; }
    var r = result.split('~');
    if (r[0] == '') { alert('Challan Details not found'); return false; }
    show('grn_' + cnt, true); document.getElementById('grn_' + cnt).innerHTML = r[0]; show('grnHref_' + cnt, false);
    if (r[1]) { show('cin_' + cnt, true); document.getElementById('cin_' + cnt).innerHTML = r[1]; show('cinHref_' + cnt, false); }
  } });
}
function viewDetailsDouble(pde_transaction_id, merchant_order_no) {
  ajaxCall({ url: 'epay/viewDetailsDouble', postdata: 'pde_transaction_id=' + pde_transaction_id + '&merchant_order_no=' + merchant_order_no, callback: function (result) {
    if (result.url != '') {
      var a = document.getElementById('mylinkbtn');
      if (a) a.setAttribute('href', result.url);
      else { a = document.createElement('a'); a.href = result.url; a.target = '_blank'; a.id = 'mylinkbtn'; document.body.appendChild(a); }
      a.click();
    } else { alert('Bank Details  Not Found'); }
  } });
}
function getPrevChallanGras(id, department_id, pay_type, ext, vendor_name) {
  var count = id.split('_');
  var grn = document.getElementById('grn_' + count[1]).innerText, bankcin = document.getElementById('cin_' + count[1]).innerText;
  var ajax_res = '', folder_name = document.getElementById('folder_name').value, vendor = vendor_name;
  if (grn.substring(0, 1) != 'M') {
    ajaxCall({ url: 'epay/getPrevChallanGras', postdata: 'grn=' + grn + '&department_id=' + department_id + '&vendor_name=' + vendor_name + '&action_code=getPrevChallanGras', callback: function (result) {
      if (result.data != '') {
        if (vendor == 'egras') folder_name = 'HR_Challan';
        if (vendor == 'jegras' || vendor == 'KHAJANE' || vendor == 'klgras' || vendor == 'rjegras') window.open(result.data);
        else window.open(EPAY_NFS_URL + '/challan_alias/' + folder_name + '/' + grn + '.pdf');
      } else alert('Challan details not found');
    } });
  }
  if (ajax_res != 'Y') {
    if (vendor == 'KHAJANE' || vendor == 'rjegras' || vendor == 'klgras') return false;
    if (grn != '' && bankcin != '') { if (vendor == 'egras') folder_name = 'HR_Challan'; window.open(EPAY_NFS_URL + '/challan_alias/' + folder_name + '/' + grn + '.pdf'); }
    else if (grn == '') alert("Please click on Get Challan Details first and then click on 'View Challan' to view Challan");
  }
}
</script></body></html>`;

// The rows DoubleVerificationDetails returns: GRN / CIN spans hidden until fetched.
const TXN_LIST = () => `<table id="example" class="table"><thead><tr><th>Sr.No.</th><th>Transaction Id</th><th>e-Filing No / CNR</th><th>Payee Name</th><th>Amount</th><th>Transaction Date</th><th>GRN / Bank CIN</th><th>Action</th></tr></thead><tbody>
<tr><td>1</td><td>PDE000123</td><td>${PDE}</td><td>Ramesh Kumar</td><td id="amt_1">4320.00</td><td>02-11-2026 10:15:00</td>
<td><span id="grn_1" style="display:none"></span><span id="grnHref_1"><a href="#" onclick="getGRNGras('PDE000123','4','E','C','KLER01','1','0')">Get GRN</a></span><br><span id="cin_1" style="display:none"></span><span id="cinHref_1"></span></td>
<td><a href="#" id="chalan_1" onclick="getPrevChallanGras('chalan_1','12','C','pdf','egras')">View Challan</a><br><a href="#" onclick="viewDetailsDouble('PDE000123','MO000123')">Verify</a></td></tr>
<tr><td>2</td><td>PDE000099</td><td>KLER010012342024</td><td>Suresh Babu</td><td id="amt_2">150.00</td><td>20-10-2026 16:40:00</td>
<td><span id="grn_2">KL26GRN00009999</span><br><span id="cin_2">CIN112233</span></td>
<td><a href="#" id="chalan_2" onclick="getPrevChallanGras('chalan_2','12','C','pdf','jegras')">View Challan</a><a href="#" style="display:none" onclick="getGRNGras('PDE000099','4','E','C','KLER01','2','0')">Get GRN</a></td></tr>
</tbody></table>`;

// ---- ePayments > Court Fee Wallet (no public JS: a plain page) -----------------------------

const walletPage = () => `<!doctype html><html><body>${head()}${menu}<div class="container"><h3>Court Fee Wallet</h3>
<table class="table"><thead><tr><th>Sr.No.</th><th>Establishment</th><th>Balance</th></tr></thead><tbody><tr><td>1</td><td>District Court, Ernakulam</td><td>${fx.walletBalance}.00</td></tr></tbody></table></div></body></html>`;

// ---- Applications > Pay Fees (applications.js) ---------------------------------------------

const APPS = [
  { id: '1', title: 'IA 12/2026 - Stay Petition', fee: 200 },
  { id: '2', title: 'IA 13/2026 - Condonation of Delay', fee: 400 },
];
const payFeesTable = () => {
  const apps = APPS.filter((a) => !fx.paidApps.includes(a.id));
  return `<form id="frm_epay_submission"><table class="tblePayApplication table"><thead><tr><th>Sr.No.</th><th>Application</th><th>Court Fee</th><th>Pay</th></tr></thead><tbody>
<tr><td colspan="4"><input type="checkbox" id="chkMainEstablishment_KLER01" onclick="setMainEstApplication('KLER01')"> District Court, Ernakulam - Wallet Balance: <span id="rem_bal_KLER01">${fx.walletBalance}</span> Sub Total: <span id="sp_sub_total_KLER01">0</span></td></tr>
${apps.map((a, i) => `<tr><td>${i + 1}</td><td>${a.title}</td><td>${a.fee}</td><td><input type="checkbox" class="chkEstApp chk_KLER01" id="chk_app_${a.id}" name="chkEstApp[]" value="${a.id}" onclick="setWalletBalence(this, ${a.fee}, 'KLER01')"></td></tr>`).join('')}
</tbody></table></form>`;
};

const applicationsPage = () => `<!doctype html><html><body>${head()}${menu}<div class="container"><h3>Applications</h3>
<ul class="nav nav-tabs"><li><a href="#" id="app_tab">Applications</a></li><li><a href="#" id="epay_tab">Pay Fees</a></li></ul>
<label for="txtAppSearch">Search</label><input id="txtAppSearch">
<button type="button" onclick="refreshConnEst()">Refresh Establishments</button>
<div id="tr_submitted_cases"></div><div id="tr_submitted_epay_cases" style="display:none"></div>
<button type="button" id="btnPayEpay" style="display:none" onclick="payCourtFees()">Pay</button>
</div><script>
${commonJs}
var alerts_array = []; alerts_array[638] = 'Insufficient balance in court fee wallet for this establishment';
function reset_application_form() {}
function refreshConnEst() { ajaxCall({ url: 'applications/refreshConnEst', postdata: '', callback: function () { setTimeout(function () { getSubmittedCasesPayFees(); }, 500); } }); }
function getSubmittedCasesPayFees(page, limit) {
  page = page || 1; limit = limit || 10;
  reset_application_form();
  var txt = document.getElementById('txtAppSearch').value || '';
  ajaxCall({ url: 'applications/getSubmittedCasesPayFees', postdata: 'page=' + page + '&limit=' + limit + '&txtAppSearch=' + txt, callback: function (obj) {
    if (!obj.errormsg && obj.status) {
      var box = document.getElementById('tr_submitted_epay_cases');
      box.style.display = ''; box.innerHTML = obj.table;
      if (obj.pagination) box.insertAdjacentHTML('beforeend', obj.pagination);
      if (obj.records_info) box.insertAdjacentHTML('beforeend', "<div class='mt-2 text-muted small'>" + obj.records_info + '</div>');
      show('btnPayEpay', obj.tot_record >= 1);
    }
  } });
}
document.getElementById('epay_tab').addEventListener('click', function (e) { e.preventDefault(); getSubmittedCasesPayFees(undefined, 20); });
function setMainEstApplication(est) { var on = document.getElementById('chkMainEstablishment_' + est).checked; document.querySelectorAll('.chk_' + est).forEach(function (c) { c.checked = on; }); }
function setWalletBalence(obj, case_fee, est_code) {
  var rem = document.getElementById('rem_bal_' + est_code), sub = document.getElementById('sp_sub_total_' + est_code);
  var rem_balence = rem.innerHTML, sub_total = sub.innerHTML || 0;
  if (obj.checked) {
    if (rem_balence > 0 && case_fee <= rem_balence) { rem.innerHTML = parseInt(rem_balence) - parseInt(case_fee); sub.innerHTML = parseInt(sub_total) + parseInt(case_fee); document.getElementById('btnPayEpay').disabled = false; }
    else { alert(alerts_array[638]); document.getElementById('btnPayEpay').disabled = true; obj.checked = false; return false; }
  } else { rem.innerHTML = parseInt(rem_balence) + parseInt(case_fee); sub.innerHTML = parseInt(sub_total) - parseInt(case_fee); document.getElementById('btnPayEpay').disabled = false; }
}
function payCourtFees() {
  if (document.querySelectorAll('.chkEstApp:checked').length == 0) { alert('Please select application to pay'); return false; }
  if (!confirm(' Do you want to pay for application?')) return false;
  var postdata = Array.prototype.map.call(document.querySelectorAll('#frm_epay_submission .chkEstApp:checked'), function (c) { return encodeURIComponent(c.name) + '=' + c.value; }).join('&');
  ajaxCall({ url: 'applications/payCourtFees', postdata: postdata, callback: function (obj) { if (!obj.errormsg && obj.status) getSubmittedCasesPayFees(); } });
}
</script></body></html>`;

// ---- the fixture server -----------------------------------------------------------------

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('/securimage/securimage_show.php')) {
    fx.counter += 1;
    fx.lastCode = `K${fx.counter}x${fx.counter % 7}`;
    return route.fulfill({ contentType: 'image/svg+xml', body: svg(fx.lastCode) });
  }
  if (req.method() === 'GET' && url.pathname.endsWith('.pdf')) {
    return route.fulfill({ contentType: 'application/pdf', body: `%PDF-1.4 fixture ${url.pathname}` });
  }
  if (req.method() === 'GET') {
    if (p) fx.pages.push(p);
    if (fx.signedOut && p) return route.fulfill({ contentType: 'text/html', body: loginPage });
    if (p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: dashboardPage() });
    if (p === 'epay') return route.fulfill({ contentType: 'text/html', body: epayPage() });
    if (p === 'epay/courtFeeWallet') return route.fulfill({ contentType: 'text/html', body: walletPage() });
    if (p === 'applications') return route.fulfill({ contentType: 'text/html', body: applicationsPage() });
    return route.fulfill({ contentType: 'text/html', body: loginPage });
  }
  const f = new URLSearchParams(req.postData() ?? '');
  if (p === 'login/verify_login/') {
    const ok = f.get('fcaptcha_code') === fx.lastCode && f.get('user_name') === 'adv@example.com' && f.get('user_password') === PASSWORD;
    if (!ok) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: false, errorMsg: 'Invalid captcha', duplicate_login: 0 }) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }) });
  }
  // Every logged-in request: the rotating token, anything but the latest refused.
  if ((f.get('__csrf_magic') ?? '') !== fx.csrf) {
    fx.csrfBad += 1;
    return route.fulfill({ status: 403, body: `Invalid token#####${fx.csrf}` });
  }
  fx.calls.push({ route: p, body: f });
  fx.csrf = `tok${fx.calls.length}`;
  const reply = (o: Record<string, unknown>) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsteptoken: fx.csrf, ...o }) });
  switch (p) {
    case 'epay/get_payment_type': return reply({ court_fee: 'Y', judicial_deposit: 'Y', penalty: 'N', fine: 'N', other_fee: 'Y' });
    case 'epay/getPartyListFromPDE':
      return reply({
        party_options: '<option value="">Select</option><option value="1~1">Ramesh Kumar</option><option value="2~1">Suresh Babu</option>',
        pde_est_code: 'KLER01', cino: '', case_text: 'OS - C202600019, District Court, Ernakulam',
      });
    case 'epay/getMobile': return reply({ mobile: f.get('party_no') === '1' ? '9876543210' : '' });
    case 'epay/fillScheme_jd': return reply({ fill_Scheme: null, fill_JudicialType: '1~Civil Court Deposit#2~Criminal Court Deposit#', fillPaymentType: '10~Copying Fee#11~Process Fee#' });
    case 'epay/chk_amount': return reply({ msg: Number(f.get('amount')) > 500000 ? 'Amount exceeds the limit for this payment' : '' });
    case 'epay/generate_otp': return reply({ status: 'success', msg: 'OTP sent to your mobile number' });
    case 'epay/verify_otp_new':
      if (f.get('user_otp') !== '123456') return reply({ errormsg: 'Invalid OTP' });
      return reply({
        data: `<p>Redirecting to payment gateway...</p><form name="frmGateway" id="frmGateway" method="post" action="${GATEWAY}/pay">`
          + '<input type="hidden" name="encdata" value="ENC123"><input type="hidden" name="merchant_code" value="ECOURTS"></form>'
          + '<script>document.frmGateway.submit();</script>',
      });
    case 'epay/DoubleVerificationDetails': return reply({ data: TXN_LIST() });
    case 'epay/getGRNGras': return reply({ data: 'KL26GRN00012345~CIN998877' });
    case 'epay/viewDetailsDouble': return reply({ url: `${GATEWAY}/status?mo=${f.get('merchant_order_no')}` });
    case 'epay/getPrevChallanGras':
      return reply({ data: f.get('vendor_name') === 'jegras' ? `${ORIGIN}/pdedev/temp/challan_${f.get('grn')}.pdf` : 'Y' });
    case 'applications/refreshConnEst': return reply({});
    case 'applications/getSubmittedCasesPayFees': {
      const n = APPS.filter((a) => !fx.paidApps.includes(a.id)).length;
      return reply({ table: payFeesTable(), tot_record: n, pagination: '<ul class="pagination"><li class="active"><a href="#" class="pay-page-link-btn" data-page="1">1</a></li></ul>', records_info: `Showing 1 to ${n} of ${n} entries`, txtsearch: f.get('txtAppSearch') ?? '' });
    }
    case 'applications/payCourtFees': {
      const ids = f.getAll('chkEstApp[]');
      fx.paidApps.push(...ids);
      fx.walletBalance -= APPS.filter((a) => ids.includes(a.id)).reduce((s, a) => s + a.fee, 0);
      return reply({});
    }
    default: return route.fulfill({ status: 404, body: 'not in fixture' });
  }
}

// ---- the API router over the same session (validation + confirmation) ---------------------

let sessionId = '';
let server: Server | null = null;
let api = '';

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${api}/api/efiling${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

beforeAll(async () => {
  live.__testing.setContextHook(async (context: BrowserContext) => {
    await context.route(`${ORIGIN}/**`, serve);
    // The bank: anything that reaches it is recorded (and must not happen).
    await context.route(`${GATEWAY}/**`, (r) => { fx.gatewayHits.push(r.request().url()); return r.fulfill({ contentType: 'text/html', body: '<html><body>BANK</body></html>' }); });
    await context.route('https://epaynfs.example/**', (r) => { fx.gatewayHits.push(r.request().url()); return r.fulfill({ contentType: 'application/pdf', body: '%PDF nfs' }); });
  });
  ({ sessionId } = await live.startEfilingSession(USER, '4', 'advocate'));
  await live.submitEfilingCredentials(sessionId, USER, 'adv@example.com', PASSWORD);
  const r = await live.submitEfilingLoginCaptcha(sessionId, USER, fx.lastCode);
  expect(r).toEqual({ status: 'authenticated' });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { user: { id: string } }).user = { id: USER }; next(); });
  app.use('/api/efiling', efilingPortalEpayRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) { res.status(400).json({ error: 'Validation failed' }); return; }
    const e = err as { status?: number; message?: string };
    res.status(e.status ?? 500).json({ error: e.message });
  });
  server = app.listen(0);
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  server?.close();
  live.__testing.setContextHook(null);
  if (sessionId) await live.endEfilingSession(sessionId, USER).catch(() => {});
});

const field = (v: epay.EpayFormView, key: string) => v.fields.find((x) => x.key === key);

describe('ePayments > Payment (fixture portal)', () => {
  it('opens Payment from the portal menu and shows its form in the portal\'s order and words', async () => {
    const v = await epay.openEpayForm(sessionId, USER, true);
    expect(fx.pages).toContain('epay');
    expect(v.title).toBe('Payment');
    // The page's own on-ready request decided which payment types show.
    expect(callsTo('epay/get_payment_type')).toHaveLength(1);
    expect(v.fields.map((x) => x.key)).toEqual(['cases', 'epayOptions', 'payee', 'extraparty', 'mobile', 'amount', 'Remark']);
    expect(field(v, 'cases')).toMatchObject({
      label: 'Search Case By',
      choices: [
        { value: '1', label: 'Search Keyword', checked: false },
        { value: '2', label: 'Case Number', checked: false },
        { value: '3', label: 'e-Filing Number', checked: false },
      ],
    });
    expect(field(v, 'epayOptions')).toMatchObject({ label: 'Payment Type', value: 'C' });
    expect(field(v, 'epayOptions')!.choices!.map((c) => c.label)).toEqual(['Court Fee', 'Judicial Deposit', 'Others']);
    expect(field(v, 'payee')).toMatchObject({ label: 'Payee Name', required: true, options: [{ value: '', text: 'Select' }] });
    expect(field(v, 'mobile')).toMatchObject({ label: 'Mobile No', required: true, maxLength: 10 });
    expect(v.terms).toEqual({ label: 'I agree that the details above are correct and the fee once paid is not refundable', checked: false });
    expect(v.otp.shown).toBe(false);
    expect(v.buttons).toContainEqual({ label: 'View Transactions', id: 'btnViewC', kind: 'transactions', disabled: false });
    expect(v.redirect).toBeNull();
  }, 90_000);

  it('e-Filing Number: picking the source and the number runs the portal\'s own requests (parties, mobile)', async () => {
    let v = await epay.setEpayFields(sessionId, USER, [{ key: 'cases', value: '3' }]);
    expect(field(v, 'sel_pde_no')).toMatchObject({ label: 'e-Filing Number', required: true, options: [{ value: '', text: 'Select' }, { value: PDE, text: 'C202600019' }] });
    expect(v.fields.map((x) => x.key).slice(0, 3)).toEqual(['cases', 'sel_pde_no', 'epayOptions']);
    v = await epay.setEpayFields(sessionId, USER, [{ key: 'sel_pde_no', value: PDE }]);
    expect(callsTo('epay/getPartyListFromPDE').at(-1)!.body.get('pde_no')).toBe(PDE);
    expect(v.caseDetails).toBe('OS - C202600019, District Court, Ernakulam');
    expect(field(v, 'payee')!.options!.map((o) => o.text)).toEqual(['Select', 'Ramesh Kumar', 'Suresh Babu']);
    v = await epay.setEpayFields(sessionId, USER, [{ key: 'payee', value: '1~1' }]);
    expect(callsTo('epay/getMobile').at(-1)!.body.get('party_no')).toBe('1');
    expect(field(v, 'mobile')!.value).toBe('9876543210');
    // hideExtraParty(): a chosen party hides "Other Payee Name".
    expect(field(v, 'extraparty')).toBeUndefined();
  }, 90_000);

  it('payment type: Judicial Deposit loads its types through fillScheme_jd; back to Court Fee', async () => {
    let v = await epay.setEpayFields(sessionId, USER, [{ key: 'epayOptions', value: 'JD' }]);
    const sent = callsTo('epay/fillScheme_jd').at(-1)!.body;
    expect(sent.get('epayOptions')).toBe('JD');
    expect(sent.get('national_court_code')).toBe('KLER01');
    expect(field(v, 'judicial_type')).toMatchObject({ label: 'Judicial Deposit Type', options: [{ value: '1', text: 'Civil Court Deposit' }, { value: '2', text: 'Criminal Court Deposit' }] });
    v = await epay.setEpayFields(sessionId, USER, [{ key: 'epayOptions', value: 'C' }]);
    expect(field(v, 'judicial_type')).toBeUndefined();
    expect(field(v, 'epayOptions')!.value).toBe('C');
  }, 90_000);

  it('amount: the portal writes it in words and checks it (chk_amount); unknown fields are reported, not guessed', async () => {
    let v = await epay.setEpayFields(sessionId, USER, [{ key: 'amount', value: '600000' }]);
    expect(callsTo('epay/chk_amount').at(-1)!.body.get('amount')).toBe('600000');
    expect(v.amountError).toBe('Amount exceeds the limit for this payment');
    v = await epay.setEpayFields(sessionId, USER, [{ key: 'amount', value: '4320' }, { key: 'Remark', value: 'Court fee for OS' }, { key: 'nope', value: 'x' }, { key: 'payee', value: '9~9' }]);
    expect(v.amountError).toBe('');
    expect(v.amountWords).toEqual({ amount: '[ Rupees Four Thousand Three Hundred and Twenty Only ]' });
    expect(field(v, 'Remark')!.value).toBe('Court fee for OS');
    expect(v.messages).toContain('The portal\'s form has no "nope" field now.');
    expect(v.messages).toContain('"9~9" is not a choice for "payee" on the portal now.');
    expect(field(v, 'payee')!.value).toBe('1~1');
  }, 90_000);

  it('"I agree" + Send OTP: the portal\'s button sends epay/generate_otp with the form\'s mobile and amount', async () => {
    await expect(epay.sendEpayOtp(sessionId, USER, false)).rejects.toMatchObject({ status: 400 });
    // Ticking "I agree" on the portal (funTermsAccepted) shows its OTP button, with its own label.
    const agreed = await epay.setEpayFields(sessionId, USER, [{ key: 'i_agree', value: 'Y' }]);
    expect(agreed.terms!.checked).toBe(true);
    expect(agreed.otp.buttons).toEqual([{ label: 'Send OTP', id: 'button_mobile', kind: 'otp', disabled: false }]);
    expect(callsTo('epay/generate_otp')).toHaveLength(0);
    const v = await epay.sendEpayOtp(sessionId, USER, true);
    const sent = callsTo('epay/generate_otp');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.get('mobile')).toBe('9876543210');
    expect(sent[0]!.body.get('amount')).toBe('4320');
    expect(sent[0]!.body.get('epay_type')).toBe('C');
    expect(sent[0]!.body.get('search_case')).toBe('3');
    expect(v.terms!.checked).toBe(true);
    expect(v.otp).toMatchObject({ shown: true, label: 'Enter OTP', message: 'OTP sent to your mobile number' });
    expect(v.otp.buttons.map((b) => [b.label, b.kind])).toEqual([['Send OTP', 'otp'], ['Verify and Pay', 'verify']]);
  }, 90_000);

  it('nothing is paid without confirmation: no confirmed:true -> 400, and verify_otp_new is never sent', async () => {
    await expect(epay.proceedToGateway(sessionId, USER, '123456', false)).rejects.toMatchObject({ status: 400 });
    const r1 = await call('POST', `/live/session/${sessionId}/epay/form/proceed`, { otp: '123456' });
    expect(r1.status).toBe(400);
    const r2 = await call('POST', `/live/session/${sessionId}/epay/form/proceed`, { otp: '123456', confirmed: false });
    expect(r2.status).toBe(400);
    const r3 = await call('POST', `/live/session/${sessionId}/epay/wallet/pay`, { checks: ['chk_app_1'] });
    expect(r3.status).toBe(400);
    expect(callsTo('epay/verify_otp_new')).toHaveLength(0);
    expect(callsTo('applications/payCourtFees')).toHaveLength(0);
    expect(fx.gatewayHits).toEqual([]);
  }, 60_000);

  it('a wrong OTP: the portal\'s own message, no gateway', async () => {
    const r = await epay.proceedToGateway(sessionId, USER, '111111', true);
    expect(callsTo('epay/verify_otp_new')).toHaveLength(1);
    expect(r.messages).toContain('Invalid OTP');
    expect(r.gateway).toBeNull();
    expect(r.form.redirect).toBeNull();
  }, 90_000);

  it('confirmed: verify_otp_new prepares the payment; its auto-submitting gateway form is caught for the advocate, never followed', async () => {
    const res = await call('POST', `/live/session/${sessionId}/epay/form/proceed`, { otp: '123456', confirmed: true });
    expect(res.status).toBe(200);
    const sent = callsTo('epay/verify_otp_new').at(-1)!.body;
    expect(sent.get('user_otp')).toBe('123456');
    expect(sent.get('Amount')).toBe('4320');
    expect(sent.get('CHALLAN_AMOUNT')).toBe('4320');
    expect(sent.get('party_name')).toBe('Ramesh Kumar');
    expect(sent.get('party_no')).toBe('1~1');
    expect(sent.get('epay_type')).toBe('C');
    expect(sent.get('case_sel')).toBe('New');
    expect(sent.get('sel_pde_no')).toBe(PDE);
    expect(sent.get('national_court_code')).toBe('KLER01');
    expect(sent.get('Remark')).toBe('Court fee for OS');
    expect(sent.get('action_code')).toBe('verify_otp_new');
    const r = res.json as epay.EpayProceedResult;
    expect(r.gateway).toEqual({ method: 'POST', url: `${GATEWAY}/pay`, target: '', fields: [{ name: 'encdata', value: 'ENC123' }, { name: 'merchant_code', value: 'ECOURTS' }] });
    expect(r.form.redirect?.text).toMatch(/Redirecting to payment gateway/);
    // The advocate's portal page stayed on the portal; the bank was never reached.
    expect(fx.gatewayHits).toEqual([]);
    expect(live.__testing.pageOf(sessionId)!.url()).toBe(`${ORIGIN}/pdedev/?p=epay`);
  }, 90_000);
});

describe('ePayments transactions: GRN, bank CIN, verification, challan (fixture portal)', () => {
  it('lists every transaction the portal\'s viewDetails shows, with each row\'s own links', async () => {
    const t = await epay.readEpayTransactions(sessionId, USER);
    expect(callsTo('epay/DoubleVerificationDetails').at(-1)!.body.get('action_code')).toBe('viewTransaction');
    expect(t.tables).toHaveLength(1);
    expect(t.tables[0]!.headers).toEqual(['Sr.No.', 'Transaction Id', 'e-Filing No / CNR', 'Payee Name', 'Amount', 'Transaction Date', 'GRN / Bank CIN', 'Action']);
    expect(t.tables[0]!.rows).toEqual([
      { ref: '0:1', cells: ['1', 'PDE000123', PDE, 'Ramesh Kumar', '4320.00', '02-11-2026 10:15:00', 'Get GRN', 'View Challan\nVerify'], actions: [{ label: 'Get GRN', fn: 'getGRNGras' }, { label: 'View Challan', fn: 'getPrevChallanGras' }, { label: 'Verify', fn: 'viewDetailsDouble' }] },
      { ref: '0:2', cells: ['2', 'PDE000099', 'KLER010012342024', 'Suresh Babu', '150.00', '20-10-2026 16:40:00', 'KL26GRN00009999\nCIN112233', 'View Challan'], actions: [{ label: 'View Challan', fn: 'getPrevChallanGras' }] },
    ]);
  }, 90_000);

  it('Get GRN: the portal\'s getGRNGras request, then the row shows the GRN and bank CIN', async () => {
    const r = await epay.runEpayTransactionAction(sessionId, USER, '0:1', 'getGRNGras');
    const sent = callsTo('epay/getGRNGras').at(-1)!.body;
    expect(Object.fromEntries([...sent].filter(([k]) => !['ajax_req', '__csrf_magic'].includes(k)))).toEqual({
      state_code: '4', pde_transaction_id: 'PDE000123', pay_from: 'E', payment_type: 'C', national_court_code: 'KLER01', other_fee_sub_code: '0', action_code: 'getGRNGras',
    });
    const row = r.transactions.tables[0]!.rows[0] as { cells: string[]; actions: unknown[] };
    expect(row.cells[6]).toBe('KL26GRN00012345\nCIN998877');
    expect(row.actions).toEqual([{ label: 'View Challan', fn: 'getPrevChallanGras' }, { label: 'Verify', fn: 'viewDetailsDouble' }]);
    expect(r.opened).toEqual([]);
  }, 90_000);

  it('Verify (double verification): the bank status page the portal opens is handed over, not visited', async () => {
    const r = await epay.runEpayTransactionAction(sessionId, USER, '0:1', 'viewDetailsDouble');
    expect(callsTo('epay/viewDetailsDouble').at(-1)!.body.get('merchant_order_no')).toBe('MO000123');
    expect(r.opened).toEqual([{ url: `${GATEWAY}/status?mo=MO000123`, file: null }]);
    expect(fx.gatewayHits).toEqual([]);
  }, 90_000);

  it('View Challan: a receipt on the portal comes back as the file; the state treasury copy as its link', async () => {
    const r = await epay.runEpayTransactionAction(sessionId, USER, '0:2', 'getPrevChallanGras');
    expect(callsTo('epay/getPrevChallanGras').at(-1)!.body.get('grn')).toBe('KL26GRN00009999');
    const portalFile = r.opened.find((o) => o.file);
    expect(portalFile!.url).toBe(`${ORIGIN}/pdedev/temp/challan_KL26GRN00009999.pdf`);
    expect(Buffer.from(portalFile!.file!.base64, 'base64').toString()).toBe('%PDF-1.4 fixture /pdedev/temp/challan_KL26GRN00009999.pdf');
    expect(portalFile!.file!.contentType).toBe('application/pdf');
    expect(r.opened.map((o) => o.url)).toContain('https://epaynfs.example/epay/challan_alias//KL26GRN00009999.pdf');
    expect(fx.gatewayHits).toEqual([]);
  }, 90_000);

  it('only the transaction list\'s status links can be pressed', async () => {
    await expect(epay.runEpayTransactionAction(sessionId, USER, '0:1', 'verify_otp')).rejects.toMatchObject({ status: 400 });
    const r = await call('POST', `/live/session/${sessionId}/epay/transactions/action`, { ref: '0:1', fn: 'payCourtFees' });
    expect(r.status).toBe(400);
  }, 30_000);
});

describe('ePayments > Court Fee Wallet (fixture portal)', () => {
  it('reads the wallet page as shown, and the wallet\'s Pay Fees list with balances and ticks', async () => {
    const w = await epay.readEpayWallet(sessionId, USER);
    expect(w.page).toMatchObject({ title: 'Court Fee Wallet', tables: [{ headers: ['Sr.No.', 'Establishment', 'Balance'], rows: [{ cells: ['1', 'District Court, Ernakulam', '500.00'] }] }] });
    expect(callsTo('applications/getSubmittedCasesPayFees').at(-1)!.body.get('limit')).toBe('20');
    const pf = w.payFees!;
    expect(pf.balances).toEqual([{ est: 'KLER01', label: 'District Court, Ernakulam - Wallet Balance: 500 Sub Total: 0', balance: '500', subTotal: '0' }]);
    expect(pf.tables[0]!.headers).toEqual(['Sr.No.', 'Application', 'Court Fee', 'Pay']);
    expect(pf.tables[0]!.rows).toEqual([
      { group: 'District Court, Ernakulam - Wallet Balance: 500 Sub Total: 0', check: { id: 'chkMainEstablishment_KLER01', checked: false, disabled: false } },
      { cells: ['1', 'IA 12/2026 - Stay Petition', '200', ''], check: { id: 'chk_app_1', checked: false, disabled: false } },
      { cells: ['2', 'IA 13/2026 - Condonation of Delay', '400', ''], check: { id: 'chk_app_2', checked: false, disabled: false } },
    ]);
    expect(pf.payButton).toEqual({ label: 'Pay', disabled: false });
    expect(pf.refreshButton).toBe('Refresh Establishments');
    expect(pf.pages).toEqual([{ label: '1', page: 1, current: true }]);
    expect(pf.info).toBe('Showing 1 to 2 of 2 entries');
  }, 90_000);

  it('ticks each fee as the advocate would: over the balance the portal refuses it and keeps Pay disabled - nothing is paid', async () => {
    const r = await epay.payFromWallet(sessionId, USER, ['chk_app_1', 'chk_app_2'], true);
    expect(r.paid).toBe(false);
    expect(r.messages).toContain('Insufficient balance in court fee wallet for this establishment');
    expect(r.messages.at(-1)).toMatch(/keeps Pay disabled/);
    expect(callsTo('applications/payCourtFees')).toHaveLength(0);
  }, 90_000);

  it('confirmed: pays the ticked fee from the wallet (the portal\'s own confirm accepted only then)', async () => {
    const r = await epay.payFromWallet(sessionId, USER, ['chk_app_1'], true);
    expect(r.messages).toContain('Do you want to pay for application?');
    expect(callsTo('applications/payCourtFees')).toHaveLength(1);
    expect(callsTo('applications/payCourtFees')[0]!.body.getAll('chkEstApp[]')).toEqual(['1']);
    expect(r.paid).toBe(true);
    expect(r.wallet.payFees!.balances[0]!.balance).toBe('300');
    expect(r.wallet.payFees!.tables[0]!.rows).toHaveLength(2);
    await expect(epay.payFromWallet(sessionId, USER, ['chk_app_2'], false)).rejects.toMatchObject({ status: 400 });
    expect(callsTo('applications/payCourtFees')).toHaveLength(1);
  }, 90_000);

  it('kept the portal\'s token chain on every request', () => {
    expect(fx.csrfBad).toBe(0);
  });
});

describe('session ended on the portal', () => {
  it('410 "log in again", never 401', async () => {
    fx.signedOut = true;
    try {
      await expect(epay.openEpayForm(sessionId, USER, true)).rejects.toMatchObject({ status: 410 });
    } finally {
      fx.signedOut = false;
    }
  }, 60_000);
});
