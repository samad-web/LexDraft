/**
 * Applications on the portal (Interlocutory Application Filing, Pay Fees,
 * Authentication, Submitted Applications), against fixture pages that behave
 * like filing.ecourts.gov.in's. The element ids, the functions and what each
 * one sends are copied from the portal's public js/applications.js (and
 * components.js's ajaxCall / errorAlert / successAlert): #frmapplications,
 * radio `cases`, #sel_pde_no, .chk_pet / .chk_res in #case_pet_list /
 * #case_res_list, #application_type -> getPrayerPreamble ({MY_LIT_CALLED_AS}
 * in appl_template), add_more_para / remove_para ("Remove paragraph?"),
 * submitApplication (hidden_edit 2 -> "Do you want to Update the
 * application ?"), editApplication / delApplication, #epay_tab ->
 * getSubmittedCasesPayFees, setWalletBalence, payCourtFees ("Do you want to
 * pay for application?"), #otp_tab -> getMySubmittedCases, checkTermCondition
 * (.disabledcs), setPartyMobile -> #vw_otp_modal (#user_name, #user_mobile),
 * generateOTP -> applications/generateOTPForAuthentication/, verifyOTP ->
 * applications/verify_otp/ -> submitFinalData, searchApplication ->
 * applications/searchSubmittedApplication, getPrayerPreambleData ->
 * custom_component/readPdfFile -> #vw_app_modal.
 *
 * The page LAYOUT around them (labels, button texts, which radio is which) is
 * a stand-in: the portal renders it on the server and it is not public. The
 * #sel_pde_no change request (applications/getPdeParties) is fixture-only for
 * the same reason. DifAi's code reads whatever layout is there.
 * No live portal, no account, no DB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Route } from 'playwright';
import * as live from '../src/services/efiling-live.service';
import * as apps from '../src/services/efiling-portal-applications.service';
import type { AppControl, AppItem, AppsScreen } from '../src/services/efiling-portal-applications.service';

const USER = 'portal-apps-user';
const ORIGIN = 'https://filing.ecourts.gov.in';
const PDE = 'ATN20250009438C202600002';

const fx = {
  lastCode: '',
  n: 0,
  csrf: 'tok0',
  badTokens: 0,
  posts: {} as Record<string, string[]>,
  pdfServed: [] as string[],
};

const loginPage = `<!doctype html><html><body><form id="frm_login">
<select id="selState"><option value="4">Kerala</option></select><input type="radio" id="user_advocate" name="rdoUser">
<input id="user_name"><input type="password" id="user_password"><img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a" width="150" height="50">
<input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="go()">Login</button>
<div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div></form>
<script>function go(){var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=login/verify_login/');x.onload=function(){var o=JSON.parse(x.responseText);location.href=o.redirect_path;};x.send('fcaptcha_code='+document.getElementById('fcaptcha_code_mobile').value);}</script>
</body></html>`;

const menu = () => `<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="${fx.csrf}">
<nav class="navbar"><ul>
  <li class="dropdown"><a class="dropdown-toggle" href="#">Applications</a><ul class="dropdown-menu">
    <li><a href="${ORIGIN}/pdedev/?p=applications">Interlocutory Application Filing</a></li>
    <li><a href="${ORIGIN}/pdedev/?p=applications/submitted_applications">Submitted Applications</a></li></ul></li>
  <li><a href="${ORIGIN}/pdedev/?p=dashboard">Dashboard</a></li><li><a href="${ORIGIN}/pdedev/?p=login/logOut">Logout</a></li>
</ul></nav>`;

const dashboard = () => `<!doctype html><html><body>${menu()}<h3>Dashboard</h3><a href="#" id="efiling_activity">Draft Pleadings</a><div id="db_screen"><div id="history_body"></div></div></body></html>`;

// components.js: ajaxCall (form body + ajax_req + the current token; the
// reply's nsteptoken is the next one), errorAlert / successAlert (#validateError).
const COMMON = `<style>.modal{display:none}.disabledcs{pointer-events:none;opacity:.5}</style>
<div class="modal" id="validateError"><div class="modal-content"><div class="alert-danger-cust"></div><div class="alert-success-cust"></div></div></div>
<div class="modal" id="vw_app_modal"><div class="modal-content"><div class="modal-header"><h4 class="modal-title">Application</h4><button type="button" class="close" onclick="fxHide('vw_app_modal')">x</button></div><div id="vw_application"></div></div></div>
<script>
function q(s){return document.querySelector(s);}
function fxShow(id){var m=document.getElementById(id);m.style.display='block';m.classList.add('show');}
function fxHide(id){var m=document.getElementById(id);m.style.display='none';m.classList.remove('show');}
function errorAlert(msg){q('.alert-danger-cust').innerHTML=msg;fxShow('validateError');}
function successAlert(msg){q('.alert-success-cust').innerHTML=msg;fxShow('validateError');}
function ajaxCall(o){setTimeout(function(){
  var x=new XMLHttpRequest();x.open('POST',q('#base_url').value+'/?p='+o.url);
  x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
  x.onload=function(){
    var r;try{r=JSON.parse(x.responseText);}catch(e){var a=x.responseText.split('#####');if(a[1])q('#__csrf_magic').value=a[1];errorAlert(a[0]);o.callback({status:false});return;}
    if(r.errormsg){errorAlert(r.errormsg);r.status=false;o.callback(r);}
    if(r.msg)successAlert(r.msg);
    r.status=true;o.callback(r);q('#__csrf_magic').value=r.nsteptoken;
  };
  x.send(o.postdata+'&ajax_req=true&__csrf_magic='+encodeURIComponent(q('#__csrf_magic').value));
},50);}
function serialize(form){var out=[];Array.prototype.forEach.call(form.querySelectorAll('input,select,textarea'),function(e){
  if(!e.name||e.disabled)return;if((e.type==='checkbox'||e.type==='radio')&&!e.checked)return;if(e.type==='button')return;
  out.push(encodeURIComponent(e.name)+'='+encodeURIComponent(e.value));});return out.join('&');}
function showPdfFile(filePath,cb){ajaxCall({url:'custom_component/readPdfFile',postdata:'filePath='+filePath,callback:cb});}
function getPrayerPreambleData(application_serial, app_id){
  var pet=q('#hidden_pet_called_as')?q('#hidden_pet_called_as').value:'';
  ajaxCall({url:'applications/getPrayerPreambleData',postdata:'application_serial='+application_serial+'&app_id='+app_id+'&pet_called_as='+pet,callback:function(obj){
    q('#vw_application').innerHTML='';fxHide('vw_app_modal');
    if(!obj.errormsg&&obj.status&&obj.flag=='pdf'){showPdfFile(obj.ode_generated,function(result){fxShow('vw_app_modal');q('#vw_application').innerHTML='<object id="myPdf" type="application/pdf" data="'+result.outputFile+'"></object>';});}
  }});
}
</script>`;

const applicationsPage = () => `<!doctype html><html><body>${menu()}${COMMON}
<div class="container">
<h3>Interlocutory Application Filing</h3>
<ul class="nav nav-tabs"><li class="active"><a id="app_tab" href="#tab_app" onclick="return fxTab('tab_app')">Applications</a></li><li><a id="epay_tab" href="#tab_epay" onclick="return fxTab('tab_epay')">Pay Fees</a></li><li><a id="otp_tab" href="#tab_otp" onclick="return fxTab('tab_otp')">Authentication</a></li></ul>
<div class="tab-content">
<div class="tab-pane active" id="tab_app">
<form id="frmapplications">
  <input type="hidden" id="hidden_edit" name="hidden_edit" value="1"><input type="hidden" id="hidden_pde_cnr_sr" name="hidden_pde_cnr_sr" value=""><input type="hidden" id="hidden_pet_called_as" value="Petitioner">
  <div class="row"><div class="col-md-3"><label>Select Case</label></div><div class="col-md-8">
    <input type="radio" name="cases" id="new" value="1" onclick="fxCases(1)"> e-Filing Number
    <input type="radio" name="cases" id="search" value="2" onclick="fxCases(2)"> Case registered in the Court
    <input type="radio" name="cases" id="date" value="4" onclick="fxCases(4)"> Next Date
  </div></div>
  <div class="row" id="dv_new" style="display:none"><div class="col-md-3"><label for="sel_pde_no">e-Filing Number</label></div><div class="col-md-8"><select id="sel_pde_no" name="sel_pde_no" onchange="fxPdeParties()"><option value="">Select</option><option value="${PDE}">STC - ${PDE}</option></select></div></div>
  <div id="dv_date" style="display:none"><div class="row"><div class="col-md-3"><label for="dt_next_date">Next Date</label></div><div class="col-md-8"><input id="dt_next_date" name="dt_next_date"> <button type="button" onclick="getMyCases()">Go</button></div></div><div id="tr_my_case" style="display:none"></div></div>
  <div class="cs_party_result" style="display:none">
    <div id="case_main_party_title"></div>
    <div class="row"><div class="col-md-6"><b id="sp_pet_called_as">Petitioner</b><div id="case_pet_list"></div></div><div class="col-md-6"><b id="sp_res_called_as">Respondent</b><div id="case_res_list"></div></div></div>
    <div id="dv_extra_party_lh" style="display:none"><span>Prefilled Applications <span id="tot_delay_count_lh"></span></span><div id="dropdown_content_lh"></div></div>
  </div>
  <div class="dvPreamblePrayer" style="display:none">
    <div id="dvEditApplication" style="display:none"><span>Edit Application:</span> <span id="dvEditApp_info"></span></div>
    <div class="row"><div class="col-md-3"><label for="application_type">Application Type</label></div><div class="col-md-8">
      <select id="application_type" name="application_type" style="display:none" onchange="getPrayerPreamble()"><option value="">Select Application Type</option><option value="12">Taking Adjournment</option><option value="31">Condonation of Delay</option></select>
      <div id="application_type_chosen" class="chosen-container"><a class="chosen-single"><span>Select Application Type</span></a></div></div></div>
    <div class="row"><div class="col-md-3"><label>Court Fee (Rs.)</label></div><div class="col-md-8"><span id="txt_court_fee"></span></div></div>
    <div class="row"><div class="col-md-3"><label for="txt_preamble">Preamble</label></div><div class="col-md-8"><textarea id="txt_preamble" name="txt_preamble"></textarea></div></div>
    <div class="row py-2 csDvPara"><div class="col-md-3 text-lg-right font-weight-bold"><label>Paragraph1:</label></div><div class="col-md-8"><textarea class="form-control" name="txt_para[]" id="txt_para1"></textarea></div></div>
    <div id="dvParaBtn"><button type="button" onclick="add_more_para()">Add More Paragraph</button> <button type="button" id="btnRemovePara" style="display:none" onclick="remove_para()">Remove Paragraph</button></div>
    <div class="row"><div class="col-md-3"><label for="txt_prayer">Prayer</label></div><div class="col-md-8"><textarea id="txt_prayer" name="txt_prayer"></textarea></div></div>
    <button type="button" onclick="submitApplication()"><span id="spnAppAddUpdate">Submit</span></button>
  </div>
</form></div>
<div class="tab-pane" id="tab_epay" style="display:none"><form id="frm_epay_submission"><div id="tr_submitted_epay_cases"></div>
  <button type="button" id="btnPayEpay" style="display:none" onclick="payCourtFees()">Pay Court Fee</button></form></div>
<div class="tab-pane" id="tab_otp" style="display:none"><form id="frmotpsubmission">
  <input type="hidden" id="hidden_user_mobile" name="hidden_user_mobile"><input type="hidden" id="hidden_pde_cnr" name="hidden_pde_cnr"><input type="hidden" id="hidden_pde_cnr_serial_no" name="hidden_pde_cnr_serial_no">
  <input type="hidden" id="hidden_signed_by_adv_lit" name="hidden_signed_by_adv_lit"><input type="hidden" id="hidden_sign_sr_no" name="hidden_sign_sr_no"><input type="hidden" id="hidden_litigant_party_id" name="hidden_litigant_party_id"><input type="hidden" id="hidden_sel_application_count" name="hidden_sel_application_count">
  <div id="tr_submitted_cases"></div>
  <div class="modal" id="vw_otp_modal"><div class="modal-content"><div class="modal-header"><h4 class="modal-title">OTP Authentication</h4><button type="button" class="close" onclick="fxHide('vw_otp_modal')">x</button></div>
    <div class="modal-body">
      <div class="row"><div class="col-md-4"><label>User Type</label></div><div class="col-md-8"><span id="otp_user_type"></span></div></div>
      <div class="row"><div class="col-md-4"><label>Name</label></div><div class="col-md-8"><span id="user_name"></span></div></div>
      <div class="row"><div class="col-md-4"><label>Mobile Number</label></div><div class="col-md-8"><span id="user_mobile"></span></div></div>
      <input type="button" id="btn_mobile_verify" value="Send OTP" onclick="generateOTP()"> <span id="spSendOTP"></span>
      <div class="row"><div class="col-md-4"><label for="user_otp">Enter OTP</label></div><div class="col-md-8"><input id="user_otp" name="user_otp"></div></div>
      <input type="button" id="mobile_veri_otp" value="Verify OTP" onclick="verifyOTP()">
    </div></div></div>
</form></div>
</div></div>
<script>
var labels_array={140:'Advocate',2216:'Litigant'};
function fxTab(id){['tab_app','tab_epay','tab_otp'].forEach(function(t){document.getElementById(t).style.display=t===id?'block':'none';});
  if(id==='tab_epay')getSubmittedCasesPayFees(1,20);if(id==='tab_otp')getMySubmittedCases(1,20);return false;}
function fxCases(v){q('#dv_new').style.display=v==1?'flex':'none';q('#dv_date').style.display=v==4?'block':'none';}
// Stand-in for the server-rendered #sel_pde_no onchange (not in the public JS).
function fxPdeParties(){ajaxCall({url:'applications/getPdeParties',postdata:'sel_pde_no='+q('#sel_pde_no').value,callback:function(obj){
  if(!obj.errormsg&&obj.status){q('.cs_party_result').style.display='block';q('#case_pet_list').innerHTML=obj.option_pet;q('#case_res_list').innerHTML=obj.option_res;
  q('#case_main_party_title').innerHTML=obj.case_title;q('.dvPreamblePrayer').style.display='block';
  if(obj.total_party){q('#dv_extra_party_lh').style.display='block';q('#dropdown_content_lh').innerHTML=obj.table;q('#tot_delay_count_lh').innerHTML='('+obj.total_party+')';}}}});}
// ---- applications.js ----
function getPrayerPreamble(){var selApplication=q('#application_type').value;if(!selApplication){alert('Please select application type');return false;}
  ajaxCall({url:'applications/getPrayerPreamble',postdata:'selApplication='+selApplication,callback:function(obj){
    q('#txt_preamble').value='';q('#txt_prayer').value='';
    if(q('#hidden_edit').value!=2){Array.prototype.forEach.call(document.querySelectorAll('.csExtraPara'),function(e){e.remove();});q('#btnRemovePara').style.display='none';}
    if(!obj.errormsg&&obj.status){q('#txt_prayer').value=obj.prayer;q('#txt_court_fee').textContent=obj.court_fees;
      if(obj.appl_template)q('#txt_preamble').value=obj.appl_template.replace('{MY_LIT_CALLED_AS}',q('#hidden_pet_called_as').value);}}});}
function add_more_para(para_text){para_text=para_text||'';var n=document.querySelectorAll('.csDvPara').length+1;
  q('#dvParaBtn').insertAdjacentHTML('beforebegin',"<div class='row py-2 csDvPara csExtraPara'><div class='col-md-3 text-lg-right font-weight-bold'><label id=''>Paragraph"+n+":</label></div><div class='col-md-8'><textarea class='form-control' name='txt_para[]' id='txt_para"+n+"' placeholder='Enter text...'>"+para_text+"</textarea></div></div>");
  q('#btnRemovePara').style.display=n>=2?'inline-block':'none';}
function remove_para(){var total=document.querySelectorAll('.csDvPara').length;if(!confirm('Remove paragraph?'))return false;
  if(total>=2){var all=document.querySelectorAll('.csDvPara');all[all.length-1].remove();}
  if(document.querySelectorAll('.csDvPara').length==1)q('#btnRemovePara').style.display='none';}
function editApplication(sel_application){var temp=sel_application.split('~');if(temp[2]>0)alert('Rs. '+temp[2]+' fees will be deposited back to your wallet');
  q('#hidden_edit').value=2;q('#hidden_pde_cnr_sr').value=temp[1];
  ajaxCall({url:'applications/editApplication',postdata:'selApplication='+sel_application,callback:function(obj){if(!obj.errormsg&&obj.status){
    q('#application_type').value=obj.application_type;q('#txt_preamble').value=obj.preamble;q('#txt_prayer').value=obj.prayer;q('#txt_court_fee').textContent=obj.court_fees;
    Array.prototype.forEach.call(document.querySelectorAll('.csExtraPara'),function(e){e.remove();});
    var p=obj.paragraph.split('###~###');q('#txt_para1').value=p[0];for(var i=1;i<p.length;i++)add_more_para(p[i]);
    q('#dvEditApplication').style.display='block';q('#dvEditApp_info').innerHTML=obj.short_app_no+' - Taking Adjournment';q('#spnAppAddUpdate').innerHTML='Update';}}});}
function delApplication(sel_application){if(!confirm('  Do you want to Delete the application ? \\n  Note: After delete, the fees (if paid) will be deposited back to your wallet'))return false;
  ajaxCall({url:'applications/delApplication',postdata:'selApplication='+sel_application,callback:function(){}});}
function submitApplication(){var selOption=(document.querySelector('input[name=cases]:checked')||{}).value;
  if(selOption==1&&document.querySelectorAll('.chk_pet:checked').length<=0){alert('Please select client');return false;}
  if(q('#hidden_edit').value==2&&!confirm(' Do you want to Update the application ? \\n Note: After update, you will need to re-authenticate the application and the fees (if paid) will be \\n deposited back to your wallet'))return false;
  if(!q('#application_type').value){var c=q('#application_type_chosen');if(!c.nextElementSibling||!c.nextElementSibling.classList.contains('error'))c.insertAdjacentHTML('afterend','<label class="error">Please select application type</label>');return false;}
  ajaxCall({url:'applications/submitApplication',postdata:serialize(q('#frmapplications')),callback:function(obj){if(!obj.errormsg&&obj.status){q('#txt_preamble').value='';q('#txt_prayer').value='';q('#txt_para1').value='';q('#hidden_edit').value=1;}}});}
function getSubmittedCasesPayFees(page,limit){ajaxCall({url:'applications/getSubmittedCasesPayFees',postdata:'page='+(page||1)+'&limit='+(limit||10)+'&txtAppSearch=',callback:function(obj){
  if(!obj.errormsg&&obj.status){q('#tr_submitted_epay_cases').innerHTML=obj.table;q('#btnPayEpay').style.display=obj.tot_record>=1?'inline-block':'none';}}});}
function setWalletBalence(obj,case_fee,est_code){var rb=q('#rem_bal_'+est_code),st=q('#sp_sub_total_'+est_code);var rem=parseInt(rb.innerHTML),sub=parseInt(st.innerHTML||'0');
  if(obj.checked){if(rem>0&&case_fee<=rem){rb.innerHTML=rem-case_fee;st.innerHTML=sub+case_fee;}else{alert('Insufficient wallet balance');obj.checked=false;}}
  else{rb.innerHTML=rem+case_fee;st.innerHTML=sub-case_fee;}}
function payCourtFees(){if(document.querySelectorAll('.chkEstApp:checked').length==0){alert('Please select application to pay');return false;}
  if(!confirm(' Do you want to pay for application?'))return false;
  ajaxCall({url:'applications/payCourtFees',postdata:serialize(q('#frm_epay_submission')),callback:function(obj){if(!obj.errormsg&&obj.status)getSubmittedCasesPayFees();}});}
function getMySubmittedCases(page,limit){q('#user_otp').value='';ajaxCall({url:'applications/getMySubmittedCases',postdata:serialize(q('#frmotpsubmission'))+'&page='+(page||1)+'&limit='+(limit||10),callback:function(obj){
  if(!obj.errormsg&&obj.status){q('#user_name').innerHTML='';q('#user_mobile').innerHTML='';q('#tr_submitted_cases').innerHTML=obj.table;}}});}
function checkTermCondition(obj,count){q('#user_name').innerHTML='';q('#user_mobile').innerHTML='';q('#user_otp').value='';
  var d=q('#dv_auth_pet_'+count);if(obj.checked)d.classList.remove('disabledcs');else d.classList.add('disabledcs');}
function setPartyMobile(party,flag){q('#otp_user_type').innerHTML=flag==1?labels_array[140]:labels_array[2216];var d=party.split('~');
  q('#hidden_pde_cnr').value=d[3];q('#hidden_pde_cnr_serial_no').value=d[4];q('#hidden_signed_by_adv_lit').value=d[5];q('#hidden_sign_sr_no').value=d[6];q('#hidden_litigant_party_id').value=d[7];
  q('#hidden_user_mobile').value=d[1];q('#user_mobile').innerHTML=d[2];q('#btn_mobile_verify').value='Send OTP';q('#user_name').innerHTML=d[0];fxShow('vw_otp_modal');}
function generateOTP(){var m=q('#hidden_user_mobile').value;if(!m){alert('Please select user to authenticate');return false;}
  ajaxCall({url:'applications/generateOTPForAuthentication/',postdata:'user_mobile='+m+'&hidden_pde_cnr_serial_no='+q('#hidden_pde_cnr_serial_no').value+'&hidden_signed_by_adv_lit='+q('#hidden_signed_by_adv_lit').value+'&hidden_sign_sr_no='+q('#hidden_sign_sr_no').value+'&hidden_litigant_party_id='+q('#hidden_litigant_party_id').value+'&user_name='+q('#user_name').innerHTML+'&hidden_sel_application_count='+q('#hidden_sel_application_count').value,
  callback:function(obj){if(!obj.errormsg&&obj.status)q('#spSendOTP').innerHTML='Resend OTP';}});}
var mobile_otp_counter_one=0;
function verifyOTP(){var m=q('#hidden_user_mobile').value;if(!m){alert('Please select user to authenticate');return false;}var otp=q('#user_otp').value;if(!otp){alert('Please enter OTP');return false;}
  mobile_otp_counter_one+=1;
  ajaxCall({url:'applications/verify_otp/',postdata:'user_mobile='+m+'&mobile_otp='+otp+'&hidden_pde_cnr_serial_no='+q('#hidden_pde_cnr_serial_no').value+'&hidden_signed_by_adv_lit='+q('#hidden_signed_by_adv_lit').value+'&hidden_sign_sr_no='+q('#hidden_sign_sr_no').value+'&hidden_litigant_party_id='+q('#hidden_litigant_party_id').value+'&user_name='+q('#user_name').innerHTML,
  callback:function(obj){var left=5-mobile_otp_counter_one;if(obj.msg1)errorAlert(obj.msg1+' , total attempt '+left+' times remaining');if(!obj.msg1&&obj.status)submitFinalData();}});}
function submitFinalData(){var body=serialize(q('#frmotpsubmission'));q('#user_otp').value='';
  ajaxCall({url:'applications/submitFinalData',postdata:body,callback:function(obj){if(!obj.errormsg&&obj.status){fxHide('vw_otp_modal');q('#tr_submitted_cases').innerHTML='';getMySubmittedCases();}}});}
</script></body></html>`;

const submittedPage = () => `<!doctype html><html><body>${menu()}${COMMON}
<div class="container"><h3>Submitted Applications</h3>
<form id="frm_submitted_application"><div class="row"><div class="col-md-2"><label for="from_date">From Date</label></div><div class="col-md-3"><input id="from_date" name="from_date"></div>
<div class="col-md-2"><label for="to_date">To Date</label></div><div class="col-md-3"><input id="to_date" name="to_date"></div></div>
<button type="button" onclick="searchApplication()">Search</button></form>
<div id="tr_submitted_applications" style="display:none"></div></div>
<script>
function searchApplication(){var ok=true;['from_date','to_date'].forEach(function(id){var e=q('#'+id);var n=e.nextElementSibling;
  if(!e.value){ok=false;if(!n||!n.classList.contains('error'))e.insertAdjacentHTML('afterend','<label class="error">'+(id==='from_date'?'Please select From Date':'Please select To Date')+'</label>');}
  else if(n&&n.classList.contains('error'))n.remove();});
  if(!ok)return;
  ajaxCall({url:'applications/searchSubmittedApplication',postdata:serialize(q('#frm_submitted_application')),callback:function(obj){if(!obj.errormsg&&obj.status){var t=q('#tr_submitted_applications');t.style.display='block';t.innerHTML=obj.table;}}});}
</script></body></html>`;

const APPLICATION_ROW = `<table id="tblPrefilled"><thead><tr><th>Sr.No.</th><th>Application</th><th>Action</th></tr></thead><tbody>
<tr><td>1</td><td>IA/1/2026<br>Taking Adjournment</td><td><button type="button" class="btn" onclick="editApplication('${PDE}~1~0')">Edit</button> <button type="button" class="btn" onclick="delApplication('${PDE}~1~0')">Delete</button></td></tr></tbody></table>`;

const EPAY_TABLE = `<table class="tblePayApplication"><thead><tr><th>Sr.No.</th><th>Application</th><th>Court Fee</th><th>Pay</th></tr></thead><tbody>
<tr><td colspan="4"><input type="checkbox" id="chkMainEstablishment_KLAL17"> Munsiff Court, Chengannur - Wallet Balance: <span id="rem_bal_KLAL17">100</span> Sub Total: <span id="sp_sub_total_KLAL17">0</span></td></tr>
<tr><td>1</td><td>IA/1/2026<br>Taking Adjournment</td><td>10</td><td><input type="checkbox" class="chkEstApp chk_KLAL17" id="chkApp1" name="chkEstApp[]" value="${PDE}~1" onclick="setWalletBalence(this, 10, 'KLAL17')"></td></tr></tbody></table>`;

const OTP_TABLE = `<table class="tblFinalSubmit"><thead><tr><th>Sr.No.</th><th>Application</th><th>Declaration</th><th>Authenticate</th></tr></thead><tbody>
<tr><td colspan="4">STC - ${PDE} - Ramesh Kumar Vs Suresh Babu</td></tr>
<tr><td>1</td><td class="cs_application_name"><span class="csColor1">IA/1/2026</span> <span class="csColor2">Taking Adjournment</span><br><a href="#" onclick="getPrayerPreambleData('1','12');return false;">View</a></td>
<td><input type="checkbox" class="tc_application tc_KLAL17" id="tc_1" name="tc_application[]" value="1" onclick="checkTermCondition(this, 1)"> I have viewed the application and wish to submit</td>
<td><div id="dv_auth_pet_1" class="disabledcs"><button type="button" class="btn btn-primary" onclick="setPartyMobile('Ramesh Kumar~9876543210~XXXXXX3210~${PDE}~1~L~1~1',0)">Authenticate Litigant</button></div></td></tr></tbody></table>`;

const SUBMITTED_TABLE = `<table class="tblFinalSubmit"><thead><tr><th>Sr.No.</th><th>Application</th><th>Submitted On</th><th>Status</th></tr></thead><tbody>
<tr><td colspan="4">STC - ${PDE}</td></tr>
<tr><td>1</td><td>IA/1/2026 Taking Adjournment<br><a href="#" onclick="getPrayerPreambleData('5','12');return false;">View Application</a></td><td>02-11-2026 11:00:00</td><td>Submitted</td></tr></tbody></table>`;

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('securimage_show.php')) {
    fx.lastCode = `C${++fx.n}`;
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="10" y="32" font-size="24">${fx.lastCode}</text></svg>` });
  }
  if (req.method() === 'GET' && url.pathname.endsWith('.pdf')) {
    fx.pdfServed.push(url.pathname);
    return route.fulfill({ contentType: 'application/pdf', body: `%PDF-1.4 fixture ${url.pathname}` });
  }
  if (req.method() === 'GET') {
    if (p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: dashboard() });
    if (p === 'applications') return route.fulfill({ contentType: 'text/html', body: applicationsPage() });
    if (p === 'applications/submitted_applications') return route.fulfill({ contentType: 'text/html', body: submittedPage() });
    return route.fulfill({ contentType: 'text/html', body: loginPage });
  }
  const body = req.postData() ?? '';
  if (p === 'login/verify_login/') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }) });
  // The rotating token: anything but the latest is refused.
  const f = new URLSearchParams(body);
  if (f.get('__csrf_magic') !== fx.csrf) {
    fx.badTokens++;
    return route.fulfill({ status: 403, body: `Invalid token#####${fx.csrf}` });
  }
  fx.csrf = `tok${Number(fx.csrf.slice(3)) + 1}`;
  const key = p.replace(/^(applications|custom_component)\//, '').replace(/\/$/, '');
  (fx.posts[key] ??= []).push(body);
  const answers: Record<string, unknown> = {
    getPdeParties: {
      option_pet: '<input type="checkbox" class="chk_pet" name="chk_pet[]" value="1~1~Ramesh Kumar"> Ramesh Kumar<br>',
      option_res: '<input type="checkbox" class="chk_res" name="chk_res[]" value="2~1~Suresh Babu" disabled> Suresh Babu<br>',
      case_title: 'Ramesh Kumar Vs Suresh Babu', total_party: 1, table: APPLICATION_ROW,
    },
    getPrayerPreamble: { prayer: 'It is therefore prayed that this Hon\'ble Court may be pleased to adjourn the case.', court_fees: '10', appl_template: 'The {MY_LIT_CALLED_AS} above named most respectfully submits as follows:' },
    submitApplication: { msg: 'Application Added Successfully' },
    editApplication: { application_type: '12', preamble: 'Old preamble', prayer: 'Old prayer', court_fees: '0', paragraph: 'First para###~###Second para', short_app_no: 'IA/1/2026', to_be_signed_by_litigants: '1~1~Ramesh Kumar' },
    delApplication: { msg: 'Application deleted successfully' },
    getSubmittedCasesPayFees: { table: EPAY_TABLE, tot_record: 1 },
    payCourtFees: { msg: 'Court fee paid successfully' },
    getMySubmittedCases: { table: OTP_TABLE, tot_record: 1 },
    generateOTPForAuthentication: { msg: 'OTP sent to XXXXXX3210' },
    verify_otp: f.get('mobile_otp') === '123456' ? {} : { msg1: 'Invalid OTP' },
    submitFinalData: { msg: 'Application submitted successfully' },
    searchSubmittedApplication: { table: SUBMITTED_TABLE, tot_record: 1 },
    getPrayerPreambleData: { flag: 'pdf', ode_generated: '/application_documents/ATN2025/2026/app5.pdf' },
    readPdfFile: { outputFile: `/pdedev/temp/app${f.get('filePath')?.includes('app5') ? '5' : 'x'}.pdf` },
  };
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsteptoken: fx.csrf, ...(answers[key] as object ?? { status: true }) }) });
}

// ---- helpers over what DifAi read -----------------------------------------------------

const allItems = (s: AppsScreen): AppItem[] => [...s.items, ...s.modals.flatMap((m) => m.items)];
const controls = (s: AppsScreen): AppControl[] => allItems(s).flatMap((i) => {
  if (i.kind === 'field' || i.kind === 'button') return [i.control];
  if (i.kind === 'table') return i.rows.flatMap((r) => ('cells' in r ? r.cells.flatMap((c) => c.controls) : []));
  return [];
});
const byId = (s: AppsScreen, id: string) => {
  const c = controls(s).find((x) => x.id === id);
  if (!c) throw new Error(`no #${id} on the screen`);
  return c;
};
const byLabel = (s: AppsScreen, re: RegExp) => {
  const c = controls(s).find((x) => re.test(x.label));
  if (!c) throw new Error(`no control labelled ${re} (have: ${controls(s).map((x) => x.label).join(' | ')})`);
  return c;
};
const texts = (s: AppsScreen) => allItems(s).filter((i): i is Extract<AppItem, { kind: 'text' }> => i.kind === 'text');
const tables = (s: AppsScreen) => allItems(s).filter((i): i is Extract<AppItem, { kind: 'table' }> => i.kind === 'table');
const posted = (key: string, i = -1) => {
  const list = fx.posts[key] ?? [];
  return new URLSearchParams(list.at(i) ?? '');
};

let sessionId = '';
let s: AppsScreen;

beforeAll(async () => {
  live.__testing.setContextHook(async (context: BrowserContext) => { await context.route(`${ORIGIN}/**`, serve); });
  ({ sessionId } = await live.startEfilingSession(USER, '4', 'advocate'));
  await live.submitEfilingCredentials(sessionId, USER, 'adv@example.com', 'Secret@123');
  const r = await live.submitEfilingLoginCaptcha(sessionId, USER, fx.lastCode);
  expect(r).toEqual({ status: 'authenticated' });
});

afterAll(async () => {
  live.__testing.setContextHook(null);
  if (sessionId) await live.endEfilingSession(sessionId, USER).catch(() => {});
});

describe('Applications > Interlocutory Application Filing (fixture portal)', () => {
  it('opens from the portal menu and shows its tabs and fields as the portal draws them', async () => {
    s = await apps.readApplicationsScreen(sessionId, USER, 'applications');
    expect(s.onScreen).toBe(true);
    expect(s.tabs.map((t) => [t.id, t.text, t.active])).toEqual([['app_tab', 'Applications', true], ['epay_tab', 'Pay Fees', false], ['otp_tab', 'Authentication', false]]);
    expect(allItems(s).some((i) => i.kind === 'heading' && i.text === 'Interlocutory Application Filing')).toBe(true);
    // The case choice: radio `cases` with the portal's own wording beside each.
    const radios = controls(s).filter((c) => c.name === 'cases');
    expect(radios.map((r) => [r.id, r.value, r.label])).toEqual([['new', '1', 'e-Filing Number'], ['search', '2', 'Case registered in the Court'], ['date', '4', 'Next Date']]);
    expect(texts(s).some((t) => t.text === 'Select Case')).toBe(true);
    // Nothing else is shown until a case is chosen (the portal hides them).
    expect(controls(s).some((c) => c.id === 'application_type')).toBe(false);
    // Never the menu bar or logout.
    expect(controls(s).some((c) => /logout/i.test(c.label))).toBe(false);
  });

  it('e-Filing Number -> the case\'s parties as tick boxes, its applications with Edit / Delete', async () => {
    s = await apps.setApplicationsField(sessionId, USER, 'applications', byId(s, 'new').ref, { checked: true });
    const pde = byId(s, 'sel_pde_no');
    expect(pde.label).toBe('e-Filing Number');
    expect(pde.options?.map((o) => o.value)).toEqual(['', PDE]);
    s = await apps.setApplicationsField(sessionId, USER, 'applications', pde.ref, { value: PDE });
    expect(posted('getPdeParties').get('sel_pde_no')).toBe(PDE);
    const pet = controls(s).find((c) => c.name === 'chk_pet[]')!;
    expect(pet).toMatchObject({ type: 'checkbox', label: 'Ramesh Kumar', checked: false, disabled: false });
    expect(controls(s).find((c) => c.name === 'chk_res[]')).toMatchObject({ label: 'Suresh Babu', disabled: true });
    expect(texts(s).map((t) => t.text)).toEqual(expect.arrayContaining(['Ramesh Kumar Vs Suresh Babu', 'Petitioner', 'Respondent', 'Prefilled Applications (1)']));
    const prefilled = tables(s).find((t) => t.id === 'tblPrefilled')!;
    expect(prefilled.headers).toEqual(['Sr.No.', 'Application', 'Action']);
    const row = prefilled.rows[0] as { cells: Array<{ text: string; controls: AppControl[] }> };
    expect(row.cells[1]!.text).toBe('IA/1/2026\nTaking Adjournment');
    expect(row.cells[2]!.controls.map((c) => [c.label, c.risky])).toEqual([['Edit', false], ['Delete', true]]);
    // The Application Type select is hidden behind the portal's chosen box - still read.
    const type = byId(s, 'application_type');
    expect(type.label).toBe('Application Type');
    expect(type.options?.map((o) => o.text)).toEqual(['Select Application Type', 'Taking Adjournment', 'Condonation of Delay']);
    s = await apps.setApplicationsField(sessionId, USER, 'applications', pet.ref, { checked: true });
    expect(controls(s).find((c) => c.name === 'chk_pet[]')!.checked).toBe(true);
  });

  it('Application Type -> the portal fills preamble (with how the client is called), prayer and court fee', async () => {
    s = await apps.setApplicationsField(sessionId, USER, 'applications', byId(s, 'application_type').ref, { value: '12' });
    expect(posted('getPrayerPreamble').get('selApplication')).toBe('12');
    expect(byId(s, 'txt_preamble')).toMatchObject({ label: 'Preamble', value: 'The Petitioner above named most respectfully submits as follows:' });
    expect(byId(s, 'txt_prayer').value).toMatch(/adjourn the case/);
    expect(texts(s).find((t) => t.id === 'txt_court_fee')).toMatchObject({ label: 'Court Fee (Rs.)', text: '10' });
    expect(byId(s, 'txt_para1').label).toBe('Paragraph1:');
  });

  it('Add More Paragraph / Remove Paragraph, with the portal\'s own "Remove paragraph?" asked of the advocate', async () => {
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', byLabel(s, /^Add More Paragraph$/).ref, false);
    expect(byId(s, 'txt_para2').label).toBe('Paragraph2:');
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', byLabel(s, /^Add More Paragraph$/).ref, false);
    expect(byId(s, 'txt_para3').label).toBe('Paragraph3:');
    // Not confirmed: the portal's confirm() is answered Cancel and handed back.
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', byLabel(s, /^Remove Paragraph$/).ref, false);
    expect(s.confirm).toBe('Remove paragraph?');
    expect(controls(s).some((c) => c.id === 'txt_para3')).toBe(true);
    // The same button, found again in the new read, to press once the advocate says OK.
    expect(s.confirmRef).toBe(byLabel(s, /^Remove Paragraph$/).ref);
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', s.confirmRef!, true);
    expect(s.confirm).toBeNull();
    expect(controls(s).some((c) => c.id === 'txt_para3')).toBe(false);
    s = await apps.setApplicationsField(sessionId, USER, 'applications', byId(s, 'txt_para1').ref, { value: 'The case stands posted for evidence.' });
    s = await apps.setApplicationsField(sessionId, USER, 'applications', byId(s, 'txt_para2').ref, { value: 'Counsel is unwell.' });
    expect(byId(s, 'txt_para2').value).toBe('Counsel is unwell.');
  });

  it('Submit needs the advocate\'s confirmation; then the portal gets the whole form', async () => {
    const submit = byLabel(s, /^Submit$/);
    expect(submit.risky).toBe(true);
    await expect(apps.pressApplicationsControl(sessionId, USER, 'applications', submit.ref, false)).rejects.toMatchObject({ status: 409 });
    expect(fx.posts['submitApplication']).toBeUndefined();
    await expect(apps.submitApplication(sessionId, USER, false)).rejects.toMatchObject({ status: 409 });
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', submit.ref, true);
    expect(s.messages).toContain('Application Added Successfully');
    const f = posted('submitApplication');
    expect(f.get('cases')).toBe('1');
    expect(f.get('sel_pde_no')).toBe(PDE);
    expect(f.getAll('chk_pet[]')).toEqual(['1~1~Ramesh Kumar']);
    expect(f.get('application_type')).toBe('12');
    expect(f.getAll('txt_para[]')).toEqual(['The case stands posted for evidence.', 'Counsel is unwell.']);
    expect(f.get('txt_prayer')).toMatch(/adjourn/);
    expect(f.get('hidden_edit')).toBe('1');
    expect(fx.badTokens).toBe(0);
  });

  it('Edit an added application -> Update asks the portal\'s re-authentication question; Delete only when confirmed', async () => {
    const prefilled = () => (tables(s).find((t) => t.id === 'tblPrefilled')!.rows[0] as { cells: Array<{ controls: AppControl[] }> }).cells[2]!.controls;
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', prefilled().find((c) => c.label === 'Edit')!.ref, false);
    expect(posted('editApplication').get('selApplication')).toBe(`${PDE}~1~0`);
    expect(byId(s, 'txt_para2').value).toBe('Second para');
    expect(texts(s).find((t) => t.id === 'dvEditApplication')?.text).toBe('Edit Application: IA/1/2026 - Taking Adjournment');
    const update = byLabel(s, /^Update$/);
    expect(update.risky).toBe(true);
    const before = fx.posts['submitApplication']!.length;
    s = await apps.submitApplication(sessionId, USER, true);
    expect(fx.posts['submitApplication']!.length).toBe(before + 1);
    expect(posted('submitApplication').get('hidden_edit')).toBe('2');

    await expect(apps.pressApplicationsControl(sessionId, USER, 'applications', prefilled().find((c) => c.label === 'Delete')!.ref, false)).rejects.toMatchObject({ status: 409 });
    expect(fx.posts['delApplication']).toBeUndefined();
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', prefilled().find((c) => c.label === 'Delete')!.ref, true);
    expect(posted('delApplication').get('selApplication')).toBe(`${PDE}~1~0`);
    expect(s.messages).toContain('Application deleted successfully');
  });

  it('a ref from an older read is refused, not guessed', async () => {
    await expect(apps.pressApplicationsControl(sessionId, USER, 'applications', 'a99999', true)).rejects.toMatchObject({ status: 409 });
  });
});

describe('Applications > Pay Fees tab (#epay_tab)', () => {
  it('lists applications per establishment with the wallet balance; ticking updates it; Pay only when confirmed', async () => {
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', s.tabs.find((t) => t.id === 'epay_tab')!.ref, false);
    expect(posted('getSubmittedCasesPayFees').get('page')).toBe('1');
    expect(s.tabs.find((t) => t.id === 'epay_tab')!.active).toBe(true);
    expect(controls(s).some((c) => c.id === 'txt_preamble')).toBe(false);
    const t = tables(s)[0]!;
    expect(t.headers).toEqual(['Sr.No.', 'Application', 'Court Fee', 'Pay']);
    const est = t.rows[0] as { cells: Array<{ text: string }> };
    expect(est.cells[0]!.text).toMatch(/Wallet Balance: 100 Sub Total: 0/);
    s = await apps.setApplicationsField(sessionId, USER, 'applications', byId(s, 'chkApp1').ref, { checked: true });
    expect((tables(s)[0]!.rows[0] as { cells: Array<{ text: string }> }).cells[0]!.text).toMatch(/Wallet Balance: 90 Sub Total: 10/);
    const pay = byLabel(s, /^Pay Court Fee$/);
    expect(pay.risky).toBe(true);
    await expect(apps.payApplicationFees(sessionId, USER, false)).rejects.toMatchObject({ status: 409 });
    s = await apps.payApplicationFees(sessionId, USER, true);
    expect(posted('payCourtFees').getAll('chkEstApp[]')).toEqual([`${PDE}~1`]);
    expect(s.messages).toContain('Court fee paid successfully');
  });
});

describe('Applications > Authentication tab (#otp_tab)', () => {
  it('the declaration unlocks Authenticate; it opens the OTP window with the litigant\'s name and masked mobile', async () => {
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', s.tabs.find((t) => t.id === 'otp_tab')!.ref, false);
    expect(fx.posts['getMySubmittedCases']).toHaveLength(1);
    const t = tables(s)[0]!;
    expect(t.rows[0]).toEqual({ group: `STC - ${PDE} - Ramesh Kumar Vs Suresh Babu` });
    expect(byLabel(s, /^Authenticate Litigant$/).disabled).toBe(true);
    const tc = byId(s, 'tc_1');
    expect(tc.label).toBe('I have viewed the application and wish to submit');
    s = await apps.setApplicationsField(sessionId, USER, 'applications', tc.ref, { checked: true });
    const auth = byLabel(s, /^Authenticate Litigant$/);
    expect(auth.disabled).toBe(false);
    s = await apps.pressApplicationsControl(sessionId, USER, 'applications', auth.ref, false);
    const modal = s.modals.find((m) => m.id === 'vw_otp_modal')!;
    expect(modal.title).toBe('OTP Authentication');
    expect(modal.closeRef).toMatch(/^a\d+$/);
    const shown = Object.fromEntries(modal.items.filter((i): i is Extract<AppItem, { kind: 'text' }> => i.kind === 'text' && !!i.id).map((i) => [i.label, i.text]));
    expect(shown).toMatchObject({ 'User Type': 'Litigant', Name: 'Ramesh Kumar', 'Mobile Number': 'XXXXXX3210' });
    expect(modal.items.some((i) => i.kind === 'field' && i.control.id === 'user_otp' && i.control.label === 'Enter OTP')).toBe(true);
    // The OTP window's #user_name must not look like a logged-out portal to DifAi.
    expect(live.efilingSessionStatus(sessionId, USER).authenticated).toBe(true);
    s = await apps.readApplicationsScreen(sessionId, USER, 'applications');
    expect(s.modals.some((m) => m.id === 'vw_otp_modal')).toBe(true);
  });

  it('Send OTP posts what the portal sends; a wrong OTP is reported; the right one (typed by the advocate) submits', async () => {
    s = await apps.sendApplicationOtp(sessionId, USER);
    const g = posted('generateOTPForAuthentication');
    expect(Object.fromEntries(g)).toMatchObject({ user_mobile: '9876543210', hidden_pde_cnr_serial_no: '1', hidden_signed_by_adv_lit: 'L', hidden_sign_sr_no: '1', hidden_litigant_party_id: '1', user_name: 'Ramesh Kumar' });
    expect(s.messages).toContain('OTP sent to XXXXXX3210');
    await expect(apps.verifyApplicationOtp(sessionId, USER, '123456', false)).rejects.toMatchObject({ status: 409 });
    s = await apps.verifyApplicationOtp(sessionId, USER, '000000', true);
    expect(s.messages.join(' ')).toMatch(/Invalid OTP , total attempt 4 times remaining/);
    expect(fx.posts['submitFinalData']).toBeUndefined();
    s = await apps.verifyApplicationOtp(sessionId, USER, '123456', true);
    expect(posted('verify_otp').get('mobile_otp')).toBe('123456');
    expect(posted('submitFinalData').get('hidden_pde_cnr')).toBe(PDE);
    expect(s.messages).toContain('Application submitted successfully');
    expect(s.modals.some((m) => m.id === 'vw_otp_modal')).toBe(false);
    expect(fx.badTokens).toBe(0);
  });

  it('View in a row opens the application document the portal shows', async () => {
    const view = byLabel(s, /^View$/);
    const f = await apps.openApplicationsDocument(sessionId, USER, 'applications', view.ref);
    expect(f.contentType).toBe('application/pdf');
    expect(f.body.toString()).toContain('%PDF-1.4');
    expect(posted('getPrayerPreambleData', 0).get('application_serial')).toBe('1');
  });
});

describe('Applications > Submitted Applications', () => {
  it('opens from the menu; Search with no dates shows the portal\'s own messages', async () => {
    s = await apps.readApplicationsScreen(sessionId, USER, 'submitted');
    expect(s.onScreen).toBe(true);
    expect(byId(s, 'from_date').label).toBe('From Date');
    expect(byId(s, 'to_date').label).toBe('To Date');
    s = await apps.pressApplicationsControl(sessionId, USER, 'submitted', byLabel(s, /^Search$/).ref, false);
    expect(byId(s, 'from_date').error).toBe('Please select From Date');
    expect(fx.posts['searchSubmittedApplication']).toBeUndefined();
  });

  it('From / To Date -> the submitted applications, grouped by case; View Application -> the PDF', async () => {
    s = await apps.searchSubmittedApplications(sessionId, USER, '01-10-2026', '02-11-2026');
    expect(Object.fromEntries(posted('searchSubmittedApplication'))).toMatchObject({ from_date: '01-10-2026', to_date: '02-11-2026' });
    const t = tables(s)[0]!;
    expect(t.headers).toEqual(['Sr.No.', 'Application', 'Submitted On', 'Status']);
    expect(t.rows[0]).toEqual({ group: `STC - ${PDE}` });
    const row = t.rows[1] as { cells: Array<{ text: string; controls: AppControl[] }> };
    expect(row.cells[1]!.text).toBe('IA/1/2026 Taking Adjournment');
    const f = await apps.openApplicationsDocument(sessionId, USER, 'submitted', row.cells[1]!.controls[0]!.ref);
    expect(f.body.toString()).toContain('app5.pdf');
    expect(fx.pdfServed).toContain('/pdedev/temp/app5.pdf');
    expect(byId(s, 'from_date').error).toBeUndefined();
  });

  it('a step for one screen while the portal shows the other is refused', async () => {
    await expect(apps.submitApplication(sessionId, USER, true)).rejects.toMatchObject({ status: 409 });
    await expect(apps.pressApplicationsControl(sessionId, USER, 'applications', 'a1', false)).rejects.toMatchObject({ status: 409 });
  });
});
