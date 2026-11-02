/**
 * Pleadings and Video Recording on the portal, against fixture pages that
 * behave like filing.ecourts.gov.in's own (upload_pleading.js,
 * pleading_index.js, pleading_esign_test.js, videoRecording.js,
 * dashboard.js: the same element ids, the same functions and the same
 * requests - docs/efiling-portal-reverse-engineering.md §3-4):
 *   - Pleading Upload: cases radio + #sel_pde_no -> fetchPleadingData; #add_btn
 *     -> addFile (multipart); submitData -> addData; removeFile / mergeFiles /
 *     showFile; the Pleading Index and eSign tabs with their modals
 *   - a hidden #user_name in the OTP window (the real page has it too)
 *   - the Aadhaar eSign gateway on another host inside the portal's <object>
 *   - Draft / Completed Pleadings (submit with GRN, re-submit)
 *   - Video Recording (documents, details, oath list, upload, play)
 *   - every urlencoded request carries the rotating __csrf_magic token
 * The real DifAi service drives them (no live portal, no account, no DB).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Route } from 'playwright';
import * as live from '../src/services/efiling-live.service';
import * as pl from '../src/services/efiling-portal-pleadings.service';

const USER = 'portal-pleadings-user';
const ORIGIN = 'https://filing.ecourts.gov.in';
const ESP = 'https://esign.example.gov.in';
const PDE = 'KL0601PDE2026000123';
const P1 = 'AKL20260000001D202600001';
const P2 = 'AKL20260000001D202600002';
const CASE = { source: '3', value: PDE };

// ---- fixture state ------------------------------------------------------------------

const fx = {
  lastCode: '', n: 0,
  csrf: 'tok0', csrfBad: [] as string[], lastRoute: '',
  posts: {} as Record<string, string[]>,
  multipart: {} as Record<string, string[]>,
  pleadings: [{ no: P1, title: 'Vakalat' }, { no: P2, title: 'Plaint' }] as Array<{ no: string; title: string }>,
  index: [{ no: P1, sr: '1', title: 'Vakalatnama', from: 1, to: 2 }] as Array<{ no: string; sr: string; title: string; from: number; to: number }>,
  otpTries: 0,
  esp: [] as string[],
};

const csrfInputs = () => `<input type="hidden" id="base_url" value="/pdedev"><input type="hidden" id="__csrf_magic" value="${fx.csrf}">`;

// components.js's ajaxCall / ajaxCallNew / errorAlert / successAlert, as the portal pages load them.
const components = `
function q(s){return document.querySelector(s);}
function qa(s){return [].slice.call(document.querySelectorAll(s));}
function errorAlert(m){q('#alertBox').innerHTML='<div class="err">'+m+'</div>';}
function successAlert(m){q('#alertBox').innerHTML='<div class="ok">'+m+'</div>';}
function ajaxCall(o){var x=new XMLHttpRequest();x.open('POST',q('#base_url').value+'/?p='+o.url);x.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');
  x.onload=function(){var r=JSON.parse(x.responseText);if(r.nsteptoken)q('#__csrf_magic').value=r.nsteptoken;if(r.errormsg){errorAlert(r.errormsg);r.status=false;}else{if(r.msg)successAlert(r.msg);r.status=true;}o.callback(r);};
  x.send((o.postdata?o.postdata+'&':'')+'ajax_req=true&__csrf_magic='+encodeURIComponent(q('#__csrf_magic').value));}
function ajaxCallNew(url,fd,cb){fd.append('ajax_req',true);var x=new XMLHttpRequest();x.open('POST',q('#base_url').value+'/?p='+url);
  x.onload=function(){var r=JSON.parse(x.responseText);if(r.errormsg){errorAlert(r.errormsg);r.status=false;cb(r);}if(r.msg)successAlert(r.msg);r.status=true;cb(r);q('#__csrf_magic').value=r.nsteptoken;};x.send(fd);}
function showPdfFile(path,cb){ajaxCall({url:'custom_component/readPdfFile',postdata:'filePath='+path,callback:cb});}
var labels_array={140:'Advocates',2431:'Clients',2441:'To be signed By',2322:'Resend OTP'};
var buttons_array={1:'Submit',8:'eSign',44:'Send OTP'};
var alerts_array={347:'Please Select Type of Pleading.',344:'Please Select e-Filing Number',419:'Please enter OTP',659:'Document signed Successfully',667:'Enter index title..!',668:'Page no should be greater than zero..!',669:'From Page no should not be greater than To Page no..!',670:'Please select Signature type..!',671:'Please select Clients OR Advocates..!'};
`;

const loginPage = `<!doctype html><html><body><form id="frm_login">
<select id="selState"><option value="4">Kerala</option></select><input type="radio" id="user_advocate" name="rdoUser">
<input id="user_name"><input type="password" id="user_password"><img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a" width="150" height="50">
<input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="go()">Login</button>
<div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div></form>
<script>function go(){var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=login/verify_login/');x.onload=function(){var o=JSON.parse(x.responseText);location.href=o.redirect_path;};x.send('fcaptcha_code='+document.getElementById('fcaptcha_code_mobile').value);}</script>
</body></html>`;

// The portal's menu, on every logged-in page.
const menu = `<ul class="menu"><li><a href="${ORIGIN}/pdedev/?p=dashboard">Dashboard</a></li><li><a href="#">Pleadings</a><ul><li><a href="${ORIGIN}/pdedev/?p=use_templates/index">Use Template</a></li><li><a href="${ORIGIN}/pdedev/?p=upload_pleading/index">Pleadings</a></li><li><a href="${ORIGIN}/pdedev/?p=videoRecording">Video Recording</a></li></ul></li></ul>`;

const dashboard = () => `<!doctype html><html><body>${csrfInputs()}${menu}<h3>Dashboard</h3></body></html>`;

// Pleadings > Pleading Upload (upload_pleading.js's ids and functions).
const uploadPage = (esigned: boolean) => `<!doctype html><html><body>${csrfInputs()}
<input type="hidden" id="sessionJSONDir" value="kl_user"><input type="hidden" id="server_addr" value="13">
<input type="hidden" id="hid_pde_no" value=""><input type="hidden" id="esigned" value="${esigned ? 'Y' : ''}">
<input type="hidden" id="state_user" value="KL"><input type="hidden" id="foldername" value="pleading_documents"><input type="hidden" id="esign_url" value="${ESP}/esp/start">
${menu}<div id="alertBox"></div>
<h4 class="page-title">Pleading Upload</h4>
<div><input type="radio" name="cases" id="search" value="1"><label for="search">Existing Case</label>
<input type="radio" name="cases" id="eFiled" value="3"><label for="eFiled">e-Filed Case</label></div>
<label for="sel_pde_no">e-Filing Number</label><select id="sel_pde_no"><option value="">Select e-Filing Number</option><option value="${PDE}">${PDE} - Ramesh Kumar Vs Suresh Babu</option></select>
<label for="txt_case_search">Case Number</label><select id="txt_case_search"><option value="">Select Case</option><option value="KLAL170012342026">O.S./12/2026</option></select>
<input type="hidden" id="case_cino" value="">
<ul class="nav nav-tabs"><li><a id="pleading_upload_tab" href="#up">Upload Pleading</a></li><li><a id="pleading_index_tab" href="#ix">Pleading Index</a></li><li><a id="pleading_esign_tab" href="#es">Pleading eSign</a></li></ul>
<form id="frm_doc">
  <div class="form-group"><label for="selDocType">Document Type</label><select id="selDocType" name="selDocType" onchange="show_hide_file_name()"><option value="">Select</option><option value="1">Vakalatnama</option><option value="2">Affidavit</option></select></div>
  <div class="form-group"><label for="file_name">Document Title</label><input id="file_name" name="file_name"></div>
  <div class="form-group"><label for="doc_file_name">Choose file</label><input type="file" id="doc_file_name" name="doc_file_name"></div>
  <input type="hidden" id="merge_file_cnt" name="merge_file_cnt" value="0"><input type="hidden" id="newfilesadded" name="newfilesadded">
  <button type="button" id="add_btn">Add</button>
  <ul id="upload_pdf_name" style="display:none"></ul>
  <span id="sp_pet_called_as">My Clients [Petitioner]</span><div id="clients"></div>
  <button type="button" class="btn" onclick="submitData()">Submit</button>
</form>
<table id="newtbl"></table><table id="extable"></table>
<button type="button" id="merge_btn" onclick="goToMerge(q('#hid_pde_no').value)">Merge</button>
<div id="mergeFiles" class="modal"><div class="pdfrow"></div><label for="merge_txt">Document Title</label><input id="merge_txt"></div>
<div id="viewFiles" class="modal"><div id="viewFiles-body"></div></div>
<div id="dvHideShowIndexing"><input type="checkbox" id="chkShowAll"><label for="chkShowAll">Show All</label></div>
<table id="example1"></table>
<div id="addIndex" class="modal"><form id="frm_doc_index"><input type="hidden" id="selDocument" name="selDocument">
  <label for="index_title">Index Title</label><input id="index_title" name="index_title">
  <label for="from_page_no">From Page No.</label><input id="from_page_no" name="from_page_no">
  <label for="to_page_no">To Page No.</label><input id="to_page_no" name="to_page_no"><input type="hidden" id="mrg_flag" name="mrg_flag" value="N"></form><object id="pdfiframe1"></object></div>
<div id="dvHideShoweSign"><input type="checkbox" id="chkShowAlleSign"><label for="chkShowAlleSign">Show All</label></div>
<table id="example3"></table><div id="party_adv_name" style="display:none"></div>
<div id="esignFrame" style="display:none"><object id="pdfframenew" width="600" height="400"></object></div>
<div id="verifyMsg" class="modal"><input id="mobile"><input type="button" id="sotp_go" class="btn btn-primary otpcls0" value="" onclick="sendOTP()"><input id="otp"><input type="button" id="sv_go" value="Verify" onclick="verifyOTP()">
  <input type="hidden" id="pleading_number"><input type="hidden" id="role"><input type="hidden" id="user_name"><input type="hidden" id="user_details"><input type="hidden" id="hiddencasseno"></div>
<script>${components}
var filesadded=[],newfilesadded=[],txtfilename=[];
function setCase(){fetchPleadingData();}
q('#sel_pde_no').addEventListener('change',setCase);
q('#txt_case_search').addEventListener('change',setCase);
function show_hide_file_name(){var s=q('#selDocType');q('#file_name').value=s.value?s.options[s.selectedIndex].text:'';q('#file_name').readOnly=s.value=='1';}
function fetchPleadingData(){
  filesadded=[];newfilesadded=[];txtfilename=[];q('#upload_pdf_name').innerHTML='';
  var t=(q('[name="cases"]:checked')||{}).value;var pde=q('#sel_pde_no').value,cino=q('#txt_case_search').value;
  q('#hid_pde_no').value=t==3?pde:cino;
  ajaxCall({url:'upload_pleading/fetchPleadingData',postdata:'column_cnt=2&type_of_case='+t+'&sel_pde_no='+pde+'&hid_cino='+cino,callback:function(o){
    q(t==3?'#newtbl':'#extable').innerHTML=o.tbl;q(t==3?'#extable':'#newtbl').innerHTML='';
    q('#clients').innerHTML='<label><input type="checkbox" class="chk_pet" name="chk_pet_list[]" value="1~P~0~Ramesh Kumar">Ramesh Kumar</label><label><input type="checkbox" class="chk_pet" name="chk_res_list[]" value="2~R~0~Suresh Babu">Suresh Babu</label>';
  }});
}
q('#add_btn').addEventListener('click',function(){
  if(q('[name="cases"]:checked').value==3&&q('#sel_pde_no').value==''){errorAlert(alerts_array[344]);return false;}
  var v=q('#file_name').value;
  if(v==''){errorAlert('Please Enter File Name');return false;}
  if(!/^[a-zA-Z0-9 _]+$/.test(v)){errorAlert(' File name should not contain special characters, except underscore (_)');return false;}
  var f=q('#doc_file_name').files[0];filesadded.push(f.name);txtfilename.push(v);
  var fd=new FormData(q('#frm_doc'));fd.append('file',f);fd.append('sel_pde_no',q('#sel_pde_no').value);fd.append('case_cino',q('#case_cino').value);fd.append('merge_file',q('#merge_file_cnt').value);fd.append('filesadded',filesadded);
  ajaxCallNew('upload_pleading/addFile',fd,function(r){if(!r.status||r.errormsg)return;newfilesadded.push(r.fileNameNew);q('#newfilesadded').value=newfilesadded;
    q('#upload_pdf_name').style.display='';q('#upload_pdf_name').insertAdjacentHTML('beforeend','<li id=li_'+r.fileNameNew+'><div class="row"><div class="col-lg-4 text-break"> <span> '+v+'</span></div><div class="col-lg-4 text-break"><div class="up_file_name"><a href="#">'+f.name+'</a> '+(r.signed_flg=='Y'?'<span class="badge badge-success">Digitally Signed</span>':'')+'</div><span class="up_file_size">'+(f.size/1024)+' KB</span></div></div></li>');
    q('#file_name').value='';});
});
function submitData(){
  if(qa('.chk_pet:checked').length==0){errorAlert('Please Select at least one Client');return false;}
  if(q('#upload_pdf_name').children.length==0){errorAlert('Please add File');return false;}
  var pr=qa('input[name="chk_pet_list[]"]:checked').concat(qa('input[name="chk_res_list[]"]:checked')).map(function(c){return c.value;}).join('#');
  var pd=new URLSearchParams(new FormData(q('#frm_doc'))).toString();
  pd+='&pet_res_name='+pr+'&est_name=&filesadded='+filesadded+'&fil_type=0&fil_no=0&fil_year=0&efiling_case_type=&maincase_type=&sel_pde_no='+q('#sel_pde_no').value+'&case_cino='+q('#case_cino').value+'&merge_file='+q('#merge_file_cnt').value+'&merge_txt='+q('#merge_txt').value+'&txtfilename='+txtfilename;
  ajaxCall({url:'upload_pleading/addData',postdata:pd,callback:function(o){if(o.status){q('#upload_pdf_name').innerHTML='';fetchPleadingData();}}});
}
function removeFile(no){if(!confirm('Do you want to delete this document? The associated oath recording will also be deleted permanently.'))return;
  ajaxCall({url:'upload_pleading/removeFile',postdata:'file_name='+no+'&cino_pde_no='+q('#hid_pde_no').value,callback:function(){fetchPleadingData();}});}
function showFile(no){var path=q('#sessionJSONDir').value+'/pleading_documents/'+no.substring(0,14)+'/'+no.substring(15,19)+'/'+no+'.pdf';
  showPdfFile(path,function(r){q('#viewFiles-body').innerHTML="<object data='"+r.outputFile+"' height='100%' width='100%'></object>";});}
function goToMerge(pde){q('.pdfrow').innerHTML='';q('#merge_txt').value='';
  var c=qa('.chk_'+pde+':checked');if(c.length<2){errorAlert('Please select atleast 2 documents ..!');return false;}
  c.forEach(function(x){q('.pdfrow').insertAdjacentHTML('beforeend','<div class="pdfview" id="'+x.id.replace('chk_','')+'.pdf">'+x.name+'</div>');});}
function mergeFiles(){if(!confirm('After merging document, previous indexing of documents get removed, confirm?'))return;
  var added=qa('.pdfview').map(function(e){var a=e.id.split('.pdf')[0];return a.substring(0,14)+'/'+a.substring(15,19)+'/'+e.id;});
  var t=q('#merge_txt').value;if(t==''){errorAlert('Please Enter File Document Title');return false;}
  q('#merge_file_cnt').value=added.length;var fd=new FormData(q('#frm_doc'));fd.append('addedfiles',added);fd.append('myfiles',newfilesadded);fd.append('file_title',t);
  ajaxCallNew('upload_pleading/mergedocSubmit',fd,function(){fetchPleadingData();});}
function fetchPleadingIndex(flg,chk){chk=chk||1;var h=q('#hid_pde_no').value;if(flg!=1&&h!='')chk=2;
  ajaxCall({url:'pleading_index/fetchPleadingData',postdata:'hid_pde='+h+'&chkFlag='+chk,callback:function(o){q('#example1').innerHTML=o.tbl;}});}
q('#pleading_index_tab').addEventListener('click',function(){q('#chkShowAll').checked=false;fetchPleadingIndex();});
function addIndex(no){q('#selDocument').value=no;q('#addIndex').style.display='block';}
function documentIndex(){var f=q('#from_page_no').value,t=q('#to_page_no').value;
  if(q('#index_title').value==''){errorAlert(alerts_array[667]);return false;}
  if(f<=0||t<=0){errorAlert(alerts_array[668]);return false;}
  if(parseInt(f)>parseInt(t)){errorAlert(alerts_array[669]);return false;}
  ajaxCall({url:'pleading_index/documentIndex',postdata:new URLSearchParams(new FormData(q('#frm_doc_index'))).toString(),callback:function(){}});}
function deleteIndex(no,sr){if(!confirm('Want to delete?'))return;ajaxCall({url:'pleading_index/deleteIndex',postdata:'pleading_number='+no+'&pleading_number_sr_no='+sr,callback:function(){}});}
function fetchPleadingEsign(flg,chk){chk=chk||1;var h=q('#hid_pde_no').value;if(flg!=1&&h!='')chk=2;
  ajaxCall({url:'pleading_esign_test/fetchPleadingData',postdata:'hid_pde='+h+'&chkFlag='+chk,callback:function(o){if(!o.status)return;q('#example3').innerHTML=o.tbl;var s='';for(var k in o.party_adv_name)s+="<div id='dv_"+k+"'>"+o.party_adv_name[k]+"</div>";q('#party_adv_name').innerHTML=s;}});}
q('#pleading_esign_tab').addEventListener('click',function(){fetchPleadingEsign();});
function addAuth(no,pde,m){ajaxCall({url:'pleading_index/fetchAdvLit',postdata:'pleading_number='+no+'&cases='+(q('[name="search_case"]:checked')||{}).value+'&sel_pde_no='+pde+'&txt_case_search='+pde,callback:function(){}});}
function showEsignFrame(no,sc,pc,un){var pd='filename='+no+'&sessdirname='+q('#state_user').value+'&foldername='+q('#foldername').value+'&sign_counter='+sc+'&page_created='+pc+'&party_adv_name='+encodeURIComponent(q('#dv_'+no).innerHTML)+'&username='+un+'&esign_url='+q('#esign_url').value;
  ajaxCall({url:'pleading_esign_test/esign_trans',postdata:pd,callback:function(o){q('#pdfframenew').setAttribute('data',o.url);successAlert(q('#esignFrame').innerHTML);}});}
function showEsignFrame1(no,role,un,ud,cls,hc,m){q('#mobile').value='';q('#otp').value='';q('#sotp_go').value=buttons_array[44];q('#pleading_number').value=no;q('#role').value=role;q('#user_name').value=un;q('#user_details').value=ud;q('#hiddencasseno').value=hc;
  var o=q('#sotp_go').className.split(' ');q('#sotp_go').className=o[0]+' '+o[1]+' '+cls+' btn-sm';}
function sendOTP(){var m=q('#mobile').value.trim();if(!m){alert('Please enter mobile number');return false;}if(m.length!=10){alert('Please enter 10 digit mobile number');return false;}
  ajaxCall({url:'pleading_esign_test/sendOTP',postdata:'mobile='+m+'&hidcasseno='+q('#hiddencasseno').value,callback:function(){q('#sotp_go').value=labels_array[2322];}});}
function verifyOTP(){var otp=q('#otp').value;if(otp==''){errorAlert(alerts_array[419]);return false;}
  ajaxCall({url:'pleading_esign_test/verifyOTP',postdata:'mobile='+q('#mobile').value+'&otp='+otp+'&pleading_number='+q('#pleading_number').value+'&role='+q('#role').value+'&user_name='+q('#user_name').value+'&user_details='+q('#user_details').value,callback:function(o){if(o.msg1)errorAlert(o.msg1);}});}
if(q('#esigned').value=='Y'){q('#pleading_esign_tab').click();successAlert(alerts_array[659]);}
</script></body></html>`;

// Pleadings > Use Template (use_templates_script.js + common_pleading_temp.js).
const templatePage = () => `<!doctype html><html><body>${csrfInputs()}${menu}<div id="alertBox"></div>
<h4 class="page-title">Use Template</h4>
<form id="frmusetemplates">
<input type="radio" name="cases" id="search" value="1"><label for="search">Existing Case</label>
<input type="radio" name="cases" id="eFiled" value="3" checked><label for="eFiled">e-Filed Case</label>
<label for="sel_pde_no">e-Filing Number</label><select id="sel_pde_no" name="sel_pde_no" onchange="getPartyListFromPDE()"><option value="">Select</option><option value="${PDE}">${PDE}</option></select>
<label for="txt_case_search">Case Number</label><select id="txt_case_search" name="txt_case_search"><option value="">Select</option></select>
<span id="sp_pet_called_as"></span><input type="hidden" id="hidden_pet_called_as">
<div id="case_pet_list"></div><div id="case_res_list"></div>
<label for="type_pleading">Type of Pleading</label><select id="type_pleading" name="type_pleading"></select>
<button type="button" onclick="submitData()">Generate</button><a id="rptname" href="#" style="display:none">Download</a>
</form>
<script>${components}
q('#sel_pde_no').addEventListener('change',function(){get_pleading_type(q('[name="cases"]:checked').value);});
qa('[name="cases"]').forEach(function(r){r.addEventListener('change',function(){get_pleading_type(r.value);});});
function get_pleading_type(t){var cino=t==1?q('#txt_case_search').value:q('#sel_pde_no').value;ajaxCall({url:'use_templates/get_pleading_list1',postdata:'get_case_type='+t+'&cino='+cino,callback:function(o){q('#type_pleading').innerHTML=o.option;}});}
function getPartyListFromPDE(){ajaxCall({url:'custom_component/getPartyListFromPDE/',postdata:'sel_pde_no='+q('#sel_pde_no').value,callback:function(o){q('#case_pet_list').innerHTML=o.option_pet;q('#case_res_list').innerHTML=o.option_res;q('#sp_pet_called_as').innerHTML='My Clients [<span>'+o.pet_label+'</span>]';q('#hidden_pet_called_as').value=o.pet_label;}});}
function submitData(){if(!q('#type_pleading').value){errorAlert(alerts_array[347]);return;}
  ajaxCall({url:'use_templates/generate_template',postdata:new URLSearchParams(new FormData(q('#frmusetemplates'))).toString()+'&pet_called_as='+q('#hidden_pet_called_as').value,callback:function(o){if(o.status==1){q('#rptname').style.display='';q('#rptname').href=o.name.split('.')[0]+'.doc';}}});}
</script></body></html>`;

// Pleadings > Video Recording (videoRecording.js's ids and functions).
const videoPage = () => `<!doctype html><html><body>${csrfInputs()}${menu}<div id="alertBox"></div>
<h4 class="page-title">Video Recording</h4>
<input type="radio" name="search_case" id="new" value="1" checked onclick="displayData()"><label for="new">e-Filed Case</label>
<input type="radio" name="search_case" id="existing" value="2" onclick="displayData()"><label for="existing">Existing Case</label>
<label for="sel_pde_no">e-Filing Number</label><select id="sel_pde_no"><option value="">Select</option><option value="${PDE}">${PDE}</option></select>
<label for="selDocument">Select Document</label><select id="selDocument"></select><input type="hidden" id="mrg_flag">
<div class="doc_det"><label for="est_name">Establishment</label><span id="est_name"></span><label for="cause_tit">Cause Title</label><span id="cause_tit"></span>
<label for="case_num">Case Number</label><span id="case_num"></span><label for="selClientList">Select Client</label><select id="selClientList"></select><div id="oath_txt"></div></div>
<div id="vr_screen"><button type="button" id="btn-start-recording">Start Recording</button><button type="button" id="btn-pause-recording">Pause</button></div>
<table id="example"></table>
<script>${components}
q('#sel_pde_no').addEventListener('change',function(){ajaxCall({url:'pleading_index/fetchDocument',postdata:'sel_pde_no='+q('#sel_pde_no').value+'&search_case='+q('[name="search_case"]:checked').value,callback:function(o){q('#selDocument').innerHTML=o.option;q('#mrg_flag').value=o.flag;}});});
function displayData(){ajaxCall({url:'pleading_index/getSelectBox',postdata:'sel_pde_no='+q('#sel_pde_no').value+'&search_case='+q('[name="search_case"]:checked').value,callback:function(o){q('#sel_pde_no').innerHTML=o.option;}});}
function fetchOathVideos(pde){ajaxCall({url:'videoRecording/fetchOathVideos',postdata:'sel_pde_no='+pde+'&search_case='+q('[name="search_case"]:checked').value,callback:function(o){q('#example').innerHTML=o.tbl;}});}
</script></body></html>`;

// The Aadhaar eSign gateway (another host), then its hand-back to the portal.
const espStart = `<!doctype html><html><body><h3>eSign Service</h3><p>Enter your Aadhaar Number / VID</p>
<form action="${ESP}/esp/otp" method="get"><label for="aadhaar">Aadhaar Number / VID</label><input id="aadhaar" name="aadhaar">
<label><input type="checkbox" id="consent" name="consent" value="Y">I agree to the consent</label><button type="submit">Get OTP</button></form></body></html>`;
const espOtp = `<!doctype html><html><body><h3>eSign Service</h3><p>OTP sent to your registered mobile</p>
<form action="${ESP}/esp/done" method="get"><label for="esp_otp">Enter OTP</label><input id="esp_otp" name="otp"><button type="submit">Submit</button></form></body></html>`;

const pleadingRows = () => fx.pleadings.map((p, i) => `<tr><td>${i + 1}</td><td><input type="checkbox" class="chk_${PDE}" id="chk_${p.no}" name="${p.title}"> <span id="doc_${p.no}">${p.title}</span></td><td>${PDE}</td>`
  + `<td><a href="#" onclick="showFile('${p.no}')" title="View"><i class="fa fa-eye"></i></a> <a href="#" onclick="removeFile('${p.no}')" title="Delete"><i class="fa fa-trash"></i></a></td></tr>`).join('');

const answer = (key: string, body: URLSearchParams): Record<string, unknown> => {
  switch (key) {
    case 'upload_pleading/fetchPleadingData':
      return { status: true, tbl: `<thead><tr><th>Sr. No.</th><th>Document Title</th><th>e-Filing No.</th><th>Action</th></tr></thead><tbody>${pleadingRows()}</tbody>` };
    case 'upload_pleading/addData': {
      const titles = (body.get('txtfilename') ?? '').split(',').filter(Boolean);
      for (const t of titles) fx.pleadings.push({ no: `AKL20260000001D20260000${fx.pleadings.length + 1}`, title: t });
      return { msg: 'Pleading submitted successfully' };
    }
    case 'upload_pleading/removeFile':
      fx.pleadings = fx.pleadings.filter((p) => p.no !== body.get('file_name'));
      return { id: body.get('file_name') };
    case 'custom_component/readPdfFile':
      return { outputFile: `/pdedev/files/${(body.get('filePath') ?? '').split('/').pop()}` };
    case 'pleading_index/fetchPleadingData':
      return {
        status: true,
        tbl: `<thead><tr><th>Sr. No.</th><th>Pleading</th><th>e-Filing No.</th><th>Document</th><th>Index</th><th>Action</th></tr></thead><tbody>`
          + fx.pleadings.map((p, i) => `<tr><td>${i + 1}</td><td>${p.no}</td><td>${body.get('chkFlag') === '1' ? 'All cases' : PDE}</td><td><a href="#" onclick="openPdf('${p.no}','10','')">${p.title}</a></td>`
            + `<td>${fx.index.filter((x) => x.no === p.no).map((x) => `${x.title} (${x.from}-${x.to}) <a href="#" onclick="deleteIndex('${x.no}','${x.sr}')" title="Delete Index"><i class="fa fa-trash"></i></a>`).join('<br>')}</td>`
            + `<td><button type="button" onclick="addIndex('${p.no}')">Add Index</button></td></tr>`).join('') + '</tbody>',
      };
    case 'pleading_index/documentIndex':
      fx.index.push({ no: body.get('selDocument') ?? '', sr: String(fx.index.length + 1), title: body.get('index_title') ?? '', from: Number(body.get('from_page_no')), to: Number(body.get('to_page_no')) });
      return { msg: 'Index added' };
    case 'pleading_index/deleteIndex':
      fx.index = fx.index.filter((x) => !(x.no === body.get('pleading_number') && x.sr === body.get('pleading_number_sr_no')));
      return { option: '' };
    case 'pleading_esign_test/fetchPleadingData':
      return {
        status: true,
        party_adv_name: { [P1]: 'Anil Kumar (Advocate), Ramesh Kumar' },
        tbl: `<thead><tr><th>Sr. No.</th><th>Pleading</th><th>e-Filing No.</th><th>Document</th><th>Authorisation</th><th>eSign / OTP</th></tr></thead><tbody>`
          + `<tr><td>1</td><td>${P1}</td><td>${PDE}</td><td>Vakalat</td><td><a href="#" id="auth_${P1}" onclick="addAuth('${P1}','${PDE}','2026/10')" title="Add Authorisation"><i class="fa fa-plus"></i></a></td>`
          + `<td>Anil Kumar <button type="button" onclick="showFrame('${P1}','1','N','advanil')">eSign</button><br>Ramesh Kumar <button type="button" class="otpcls1" onclick="showEsignFrame1('${P1}','L','Ramesh Kumar','1~P~Ramesh Kumar','otpcls1','${PDE}','2026/10')">OTP</button></td></tr></tbody>`,
      };
    case 'pleading_index/fetchAdvLit':
      return {
        status: true,
        adv_option: `<div><input type="checkbox" class="chk_adv${P1}" id="adv_0" value="ADV1~Anil Kumar"><label for="adv_0">Anil Kumar (K/123/2001)</label> <input type="radio" name="aesigotp[0]" id="aes_0" value="E"><label for="aes_0">eSign</label><input type="radio" name="aesigotp[0]" id="aot_0" value="O"><label for="aot_0">OTP</label></div>`,
        lit_option: `<div><input type="checkbox" class="chk_lit${P1}" id="lit_0" value="1~P~Ramesh Kumar" checked><label for="lit_0">Ramesh Kumar</label> <input type="radio" name="lesigotp[0]" id="les_0" value="E"><label for="les_0">eSign</label><input type="radio" name="lesigotp[0]" id="lot_0" value="O" checked><label for="lot_0">OTP</label></div>`,
      };
    case 'pleading_index/submitAuth':
      return { msg: 'Authorisation saved' };
    case 'pleading_esign_test/esign_trans':
      return { url: `${ESP}/esp/start?txn=T1`, dir_month: '2026/10' };
    case 'pleading_esign_test/sendOTP':
      return { msg: 'OTP sent' };
    case 'pleading_esign_test/verifyOTP':
      fx.otpTries += 1;
      return body.get('otp') === '123456' ? { msg: 'OTP Verified' } : { msg1: 'Invalid OTP' };
    case 'dashboard/fetchActivities':
      return {
        total_record: 1,
        submitted_pde_list: `<table id="example1"><thead><tr><th>Sr. No.</th><th>e-Filing No.</th><th>Case Details</th><th>GRN</th><th>Action</th></tr></thead><tbody><tr><td>1</td><td>${PDE}</td><td>MACT OP<br>Ramesh Kumar Vs Suresh Babu</td>`
          + `<td><select id="u1" class="pled_grn"><option value="">Select GRN</option><option value="KL26GRN00012345">KL26GRN00012345 - 4320.00</option></select></td>`
          + `<td><button type="button" onclick="submit_pleading('u1','3','${PDE}')">Submit</button></td></tr></tbody></table>`,
      };
    case 'dashboard/fetchCompletedActivities':
      return {
        total_record: 1,
        submitted_pde_list: `<table id="example1"><thead><tr><th>Sr. No.</th><th>e-Filing No.</th><th>Status</th><th>Action</th></tr></thead><tbody><tr><td>1</td><td>KL0601PDE2026000099</td><td>Objection</td>`
          + `<td><button type="button" onclick="resubmit_pleading('KL0601PDE2026000099')">Re-Submit</button></td></tr></tbody></table>`,
      };
    case 'Dashboard/submit_pleading/':
    case 'Dashboard/resubmit_pleading/':
      return { status: true, msg: 'Submitted' };
    case 'custom_component/get_my_cases':
      return { options: '<option value="">Select</option><option value="KLAL170099992026">O.S./99/2026 - Ramesh Kumar Vs Suresh Babu</option>' };
    case 'use_templates/get_pleading_list1':
      return { option: '<option value="">Select Type of Pleading</option><option value="5">Vakalatnama</option><option value="7">Memo of Appearance</option>' };
    case 'custom_component/getPartyListFromPDE/':
      return {
        status: true, pet_label: 'Petitioner',
        option_pet: '<label><input type="checkbox" class="chk_pet" name="chk_pet_list[]" value="1~P~0~Ramesh Kumar">Ramesh Kumar</label>',
        option_res: '<label><input type="checkbox" class="chk_res" name="chk_res_list[]" value="2~R~0~Suresh Babu">Suresh Babu</label>',
      };
    case 'use_templates/generate_template':
      return { status: 1, name: '/pdedev/templates/VAK_KL0601PDE2026000123.rtf' };
    case 'pleading_index/fetchDocument':
      return { option: `<option value="">Select Document</option><option value="${P1}~P~10">Vakalat</option>`, flag: 'N' };
    case 'pleading_index/getSelectBox':
      return { option: `<option value="">Select</option><option value="${PDE}">${PDE}</option>` };
    case 'videoRecording/fetchOathVideos':
      return { status: true, tbl: `<thead><tr><th>Sr. No.</th><th>Document</th><th>Client</th><th>Oath Video</th></tr></thead><tbody><tr><td>1</td><td>${PDE}</td><td>Vakalat</td><td>Ramesh Kumar</td><td><a href="#" onclick="setVideo('kl_user/oathvideos/oath1.webm')">Play</a></td></tr></tbody>` };
    case 'videoRecording/fetchDetails':
      return {
        est_name: 'Munsiff Court, Chengannur', cause_title: 'Ramesh Kumar Vs Suresh Babu', case_number: PDE, litigant_names: 'Ramesh Kumar',
        oathMessage: 'I, <b>Ramesh Kumar</b>, do solemnly affirm that the contents are true.',
        client_list: '<option value="">Select Client</option><option value="1~P~Ramesh Kumar">Ramesh Kumar</option>',
      };
    case 'videoRecording/readOathVideo':
      return { contents: `/pdedev/files/${(body.get('filepath') ?? '').split('/').pop()}` };
    default:
      return { status: true };
  }
};

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  if (url.hostname === new URL(ESP).hostname) {
    fx.esp.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/esp/start') return route.fulfill({ contentType: 'text/html', body: espStart });
    if (url.pathname === '/esp/otp') return route.fulfill({ contentType: 'text/html', body: espOtp });
    // The gateway hands back to the portal's response page, which reloads Pleading Upload.
    return route.fulfill({ contentType: 'text/html', body: `<script>location.href='${ORIGIN}/pdedev/?p=pleading_esign_test/response';</script>` });
  }
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('securimage_show.php')) {
    fx.lastCode = `C${++fx.n}`;
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="10" y="32" font-size="24">${fx.lastCode}</text></svg>` });
  }
  if (url.pathname.startsWith('/pdedev/templates/')) {
    return route.fulfill({ contentType: 'application/msword', body: `DOC ${url.pathname.split('/').pop()}` });
  }
  if (url.pathname.startsWith('/pdedev/files/')) {
    const name = url.pathname.split('/').pop() ?? '';
    return route.fulfill({ contentType: name.endsWith('.pdf') ? 'application/pdf' : 'video/webm', body: name.endsWith('.pdf') ? `%PDF-1.4 ${name}` : `WEBM ${name}` });
  }
  if (req.method() === 'GET') {
    if (p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: dashboard() });
    if (p === 'use_templates/index') return route.fulfill({ contentType: 'text/html', body: templatePage() });
    if (p === 'upload_pleading' || p === 'upload_pleading/index') return route.fulfill({ contentType: 'text/html', body: uploadPage(url.searchParams.get('esigned') === 'Y') });
    if (p === 'videoRecording') return route.fulfill({ contentType: 'text/html', body: videoPage() });
    if (p === 'pleading_esign_test/response') return route.fulfill({ contentType: 'text/html', body: `<script>top.location.href='${ORIGIN}/pdedev/?p=upload_pleading/index&esigned=Y';</script>` });
    return route.fulfill({ contentType: 'text/html', body: loginPage });
  }
  if (p === 'login/verify_login/') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }) });
  const type = req.headers()['content-type'] ?? '';
  const next = `tok${Number(fx.csrf.slice(3)) + 1}`;
  if (type.startsWith('multipart/')) {
    (fx.multipart[p] ??= []).push(req.postDataBuffer()?.toString('latin1') ?? '');
    fx.lastRoute = p;
    const ans = p === 'upload_pleading/addFile'
      ? { status: true, fileNameNew: `${PDE}_0003.pdf`, pleading_number: 'AKL20260000001D202600003', signed_flg: 'Y' }
      : { status: true, msg: p === 'videoRecording/selfInvoker' ? 'Oath video uploaded' : 'Done' };
    fx.csrf = next;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...ans, nsteptoken: next }) });
  }
  const raw = req.postData() ?? '';
  const body = new URLSearchParams(raw);
  if (body.get('__csrf_magic') !== fx.csrf) fx.csrfBad.push(`${p} after ${fx.lastRoute}`);
  fx.lastRoute = p;
  (fx.posts[p] ??= []).push(raw.replace(/&?ajax_req=true&__csrf_magic=[^&]*$/, ''));
  fx.csrf = next;
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...answer(p, body), nsteptoken: next }) });
}

/** The last body sent to a route, as the portal's server reads it. */
const sent = (route: string, i = -1): Record<string, string> => {
  const list = fx.posts[route] ?? [];
  return Object.fromEntries(new URLSearchParams(list.at(i) ?? ''));
};
const part = (raw: string, name: string): string | undefined => new RegExp(`name="${name.replace(/[[\]]/g, '\\$&')}"(?:; filename="[^"]*")?(?:\\r\\nContent-Type: [^\\r]*)?\\r\\n\\r\\n([^\\r]*)`).exec(raw)?.[1];
const rows = (t: pl.PleadingTable) => t.rows.filter((r): r is pl.PleadingRow => 'cells' in r);

let sessionId = '';

beforeAll(async () => {
  live.__testing.setContextHook(async (context: BrowserContext) => {
    await context.route(`${ORIGIN}/**`, serve);
    await context.route(`${ESP}/**`, serve);
  });
  ({ sessionId } = await live.startEfilingSession(USER, '4', 'advocate'));
  await live.submitEfilingCredentials(sessionId, USER, 'adv@example.com', 'Secret@123');
  const r = await live.submitEfilingLoginCaptcha(sessionId, USER, fx.lastCode);
  expect(r).toEqual({ status: 'authenticated' });
});

afterAll(async () => {
  live.__testing.setContextHook(null);
  if (sessionId) await live.endEfilingSession(sessionId, USER).catch(() => {});
});

describe('Pleadings > Pleading Upload (fixture portal)', () => {
  it('opens the screen from the menu and reads it as the portal labels it', async () => {
    const s = await pl.readPleadingScreen(sessionId, USER);
    expect(s.title).toBe('Pleading Upload');
    expect(s.sources).toEqual([{ value: '1', label: 'Existing Case', checked: false }, { value: '3', label: 'e-Filed Case', checked: false }]);
    expect(s.efiled).toEqual([{ value: PDE, text: `${PDE} - Ramesh Kumar Vs Suresh Babu`, selected: false }]);
    expect(s.existing.map((o) => o.value)).toEqual(['KLAL170012342026']);
    expect(s.tabs.map((t) => t.label)).toEqual(['Upload Pleading', 'Pleading Index', 'Pleading eSign']);
    expect(s.labels).toMatchObject({ sel_pde_no: 'e-Filing Number', file_name: 'Document Title', doc_file_name: 'Choose file', add_btn: 'Add', submit: 'Submit', selDocType: 'Document Type', chkShowAll: 'Show All' });
    expect(s.docTypes?.map((o) => o.text)).toEqual(['Vakalatnama', 'Affidavit']);
  });

  it('choosing the e-filing number lists its pleadings (grouped as the portal does) and its clients', async () => {
    const v = await pl.selectPleadingCase(sessionId, USER, CASE);
    expect(sent('upload_pleading/fetchPleadingData')).toEqual({ column_cnt: '2', type_of_case: '3', sel_pde_no: PDE, hid_cino: '' });
    expect(v.table.headers).toEqual(['Sr. No.', 'Document Title', 'Action']);
    expect(v.table.rows[0]).toEqual({ group: PDE });
    const first = rows(v.table)[0]!;
    expect(first.cells).toEqual(['1', 'Vakalat', '']);
    expect(first.calls).toEqual([{ label: 'View', fn: 'showFile', args: [P1] }, { label: 'Delete', fn: 'removeFile', args: [P1] }]);
    expect(first.checks?.[0]).toMatchObject({ id: `chk_${P1}`, name: 'Vakalat' });
    expect(v.parties).toEqual([
      { side: 'pet', value: '1~P~0~Ramesh Kumar', label: 'Ramesh Kumar', checked: false },
      { side: 'res', value: '2~R~0~Suresh Babu', label: 'Suresh Babu', checked: false },
    ]);
  });

  it('existing case: the advocate types, get_my_cases fills the box, the case is chosen from it', async () => {
    const found = await pl.searchPleadingCases(sessionId, USER, { term: 'Ramesh' });
    expect(sent('custom_component/get_my_cases')).toEqual({ term: 'Ramesh', gov_pleader_allocated: '' });
    expect(found).toEqual([{ value: 'KLAL170099992026', text: 'O.S./99/2026 - Ramesh Kumar Vs Suresh Babu', selected: false }]);
    const v = await pl.selectPleadingCase(sessionId, USER, { source: '1', value: 'KLAL170099992026' });
    expect(sent('upload_pleading/fetchPleadingData')).toMatchObject({ type_of_case: '1', hid_cino: 'KLAL170099992026' });
    expect(v.clientsLabel).toBe('My Clients [Petitioner]');
  });

  it('a hidden #user_name on this page (the OTP window) is not taken for the portal\'s login page', async () => {
    await expect(pl.selectPleadingCase(sessionId, USER, CASE)).resolves.toBeTruthy();
    expect(live.efilingSessionStatus(sessionId, USER)).toMatchObject({ authenticated: true });
  });

  it('Add: the portal\'s own title check stops a bad title; a good one goes up as multipart', async () => {
    const bad = await pl.addPleadingFile(sessionId, USER, { ...CASE, title: 'Plaint (final)', file: { name: 'plaint.pdf', base64: Buffer.from('%PDF-1.4 x').toString('base64') } });
    expect(bad.ok).toBe(false);
    expect(bad.portal).toContain('File name should not contain special characters, except underscore (_)');
    expect(fx.multipart['upload_pleading/addFile']).toBeUndefined();

    const good = await pl.addPleadingFile(sessionId, USER, { ...CASE, title: 'Plaint copy', file: { name: 'plaint.pdf', base64: Buffer.from('%PDF-1.4 plaint').toString('base64') } });
    expect(good).toMatchObject({ ok: true, pleadingNumber: 'AKL20260000001D202600003', signed: true });
    expect(good.added).toEqual([{ title: 'Plaint copy', file: 'plaint.pdf', size: expect.stringMatching(/KB$/), signed: true }]);
    const raw = fx.multipart['upload_pleading/addFile']![0]!;
    expect(part(raw, 'file_name')).toBe('Plaint copy');
    expect(part(raw, 'sel_pde_no')).toBe(PDE);
    expect(part(raw, 'filesadded')).toBe('plaint.pdf');
    expect(raw).toContain('%PDF-1.4 plaint');
  });

  it('Submit needs confirmation, ticks the chosen client, sends addData and the list reloads', async () => {
    await expect(pl.submitPleadingFiles(sessionId, USER, { ...CASE, parties: ['1~P~0~Ramesh Kumar'], confirmed: false })).rejects.toThrow(/Confirm Submit/);
    const r = await pl.submitPleadingFiles(sessionId, USER, { ...CASE, parties: ['1~P~0~Ramesh Kumar'], confirmed: true });
    expect(r.ok).toBe(true);
    expect(r.portal).toContain('Pleading submitted successfully');
    expect(sent('upload_pleading/addData')).toMatchObject({ pet_res_name: '1~P~0~Ramesh Kumar', sel_pde_no: PDE, filesadded: 'plaint.pdf', txtfilename: 'Plaint copy', file_name: '' });
    expect(rows(r.view.table).map((x) => x.cells[1])).toEqual(['Vakalat', 'Plaint', 'Plaint copy']);
    expect(r.view.added).toEqual([]);
  });

  it('Submit with nothing Added says so (the portal clears Added files when the case reloads)', async () => {
    await expect(pl.submitPleadingFiles(sessionId, USER, { ...CASE, parties: [], confirmed: true })).rejects.toThrow(/No file is Added/);
  });

  it('View: showFile -> custom_component/readPdfFile -> the PDF over the session', async () => {
    const f = await pl.viewPleadingFile(sessionId, USER, { ...CASE, pleadingNumber: P1 });
    expect(sent('custom_component/readPdfFile')).toEqual({ filePath: `kl_user/pleading_documents/AKL20260000001/2026/${P1}.pdf` });
    expect(f.body.toString()).toBe(`%PDF-1.4 ${P1}.pdf`);
  });

  it('Merge: ticked documents, a title, the portal\'s confirm accepted -> mergedocSubmit', async () => {
    await expect(pl.mergePleadings(sessionId, USER, { ...CASE, pleadingNumbers: [P1, P2], title: 'Merged', confirmed: false })).rejects.toThrow(/Confirm the merge/);
    const r = await pl.mergePleadings(sessionId, USER, { ...CASE, pleadingNumbers: [P1, P2], title: 'Merged', confirmed: true });
    expect(r.ok).toBe(true);
    const raw = fx.multipart['upload_pleading/mergedocSubmit']![0]!;
    expect(part(raw, 'file_title')).toBe('Merged');
    expect(part(raw, 'addedfiles')).toBe(`AKL20260000001/2026/${P1}.pdf,AKL20260000001/2026/${P2}.pdf`);
  });

  it('Delete: confirmed -> removeFile with the case, list reloads without it', async () => {
    await expect(pl.deletePleading(sessionId, USER, { ...CASE, pleadingNumber: P2, confirmed: false })).rejects.toThrow(/Confirm the delete/);
    const r = await pl.deletePleading(sessionId, USER, { ...CASE, pleadingNumber: P2, confirmed: true });
    expect(sent('upload_pleading/removeFile')).toEqual({ file_name: P2, cino_pde_no: PDE });
    expect(rows(r.view.table).map((x) => x.cells[1])).toEqual(['Vakalat', 'Plaint copy']);
  });
});

describe('Pleading Index tab', () => {
  it('lists this case (chkFlag=2) or all (Show All, chkFlag=1)', async () => {
    const r = await pl.readPleadingIndex(sessionId, USER, CASE);
    expect(sent('pleading_index/fetchPleadingData')).toEqual({ hid_pde: PDE, chkFlag: '2' });
    expect(r.showAllLabel).toBe('Show All');
    expect(r.table.headers).toEqual(['Sr. No.', 'Document', 'Index', 'Action']);
    const first = rows(r.table)[0]!;
    expect(first.cells).toEqual(['1', 'Vakalat', 'Vakalatnama (1-2)', 'Add Index']);
    expect(first.calls?.map((c) => [c.fn, c.args])).toEqual([['openPdf', [P1, '10', '']], ['deleteIndex', [P1, '1']], ['addIndex', [P1]]]);
    await pl.readPleadingIndex(sessionId, USER, { ...CASE, all: true });
    expect(sent('pleading_index/fetchPleadingData')).toEqual({ hid_pde: PDE, chkFlag: '1' });
  });

  it('Add Index: the portal\'s page checks first, then documentIndex', async () => {
    const before = fx.posts['pleading_index/documentIndex']?.length ?? 0;
    const bad = await pl.addPleadingIndex(sessionId, USER, { ...CASE, pleadingNumber: P1, title: 'Annexure A', fromPage: 5, toPage: 3 });
    expect(bad.ok).toBe(false);
    expect(bad.portal).toContain('From Page no should not be greater than To Page no..!');
    expect(fx.posts['pleading_index/documentIndex']?.length ?? 0).toBe(before);
    const ok = await pl.addPleadingIndex(sessionId, USER, { ...CASE, pleadingNumber: P1, title: 'Annexure A', fromPage: 3, toPage: 5 });
    expect(ok.ok).toBe(true);
    expect(sent('pleading_index/documentIndex')).toEqual({ selDocument: P1, index_title: 'Annexure A', from_page_no: '3', to_page_no: '5', mrg_flag: 'N' });
    expect(rows(ok.table)[0]!.cells[2]).toBe('Vakalatnama (1-2)\nAnnexure A (3-5)');
  });

  it('Delete index: confirmed -> deleteIndex', async () => {
    const r = await pl.deletePleadingIndex(sessionId, USER, { ...CASE, pleadingNumber: P1, srNo: '1', confirmed: true });
    expect(sent('pleading_index/deleteIndex')).toEqual({ pleading_number: P1, pleading_number_sr_no: '1' });
    expect(rows(r.table)[0]!.cells[2]).toBe('Annexure A (3-5)');
  });
});

describe('eSign tab: authorisation, OTP, Aadhaar eSign', () => {
  it('lists the pleadings to sign with each row\'s Authorise / eSign / OTP', async () => {
    const r = await pl.readPleadingEsign(sessionId, USER, CASE);
    expect(sent('pleading_esign_test/fetchPleadingData')).toEqual({ hid_pde: PDE, chkFlag: '2' });
    const row = rows(r.table)[0]!;
    expect(row.calls?.map((c) => [c.label, c.fn])).toEqual([['Add Authorisation', 'addAuth'], ['eSign', 'showFrame'], ['OTP', 'showEsignFrame1']]);
  });

  it('"To be signed By": advocates and clients with eSign / OTP each, labelled from the portal\'s arrays', async () => {
    const a = await pl.readPleadingAuth(sessionId, USER, { ...CASE, pleadingNumber: P1, pdeNo: PDE, dirMonth: '2026/10' });
    expect(sent('pleading_index/fetchAdvLit')).toEqual({ pleading_number: P1, cases: 'undefined', sel_pde_no: PDE, txt_case_search: PDE });
    expect(a.labels).toEqual({ title: 'To be signed By', advocates: 'Advocates', clients: 'Clients', submit: 'Submit' });
    expect(a.advocates).toEqual([{ id: 'adv_0', value: 'ADV1~Anil Kumar', idx: '0', label: 'Anil Kumar (K/123/2001)', checked: false, choices: [{ value: 'E', label: 'eSign', checked: false }, { value: 'O', label: 'OTP', checked: false }] }]);
    expect(a.clients[0]).toMatchObject({ value: '1~P~Ramesh Kumar', checked: true, choices: [{ value: 'E', label: 'eSign', checked: false }, { value: 'O', label: 'OTP', checked: true }] });
  });

  it('saving the authorisation sends submitAuth as the portal builds it; a missing signature type is refused', async () => {
    await expect(pl.savePleadingAuth(sessionId, USER, { ...CASE, pleadingNumber: P1, advocates: [{ value: 'ADV1~Anil Kumar', sign: '' }], clients: [] })).rejects.toThrow('Please select Signature type..!');
    const r = await pl.savePleadingAuth(sessionId, USER, { ...CASE, pleadingNumber: P1, advocates: [{ value: 'ADV1~Anil Kumar', sign: 'E' }], clients: [{ value: '1~P~Ramesh Kumar', sign: 'O' }] });
    expect(r.ok).toBe(true);
    expect(sent('pleading_index/submitAuth')).toEqual({ pleading_number: P1, advchk: 'ADV1~Anil Kumar', litchk: '1~P~Ramesh Kumar', aesigotp: 'E', lesigotp: 'O' });
  });

  it('OTP authentication: Send OTP with the mobile, then the OTP as typed (wrong, then right)', async () => {
    const args = [P1, 'L', 'Ramesh Kumar', '1~P~Ramesh Kumar', 'otpcls1', PDE, '2026/10'];
    const s = await pl.sendPleadingOtp(sessionId, USER, { ...CASE, args, mobile: '9876543210' });
    expect(s).toMatchObject({ ok: true, button: 'Resend OTP', locked: false });
    expect(sent('pleading_esign_test/sendOTP')).toEqual({ mobile: '9876543210', hidcasseno: PDE });
    const wrong = await pl.verifyPleadingOtp(sessionId, USER, { otp: '111111' });
    expect(wrong).toMatchObject({ ok: false });
    expect(wrong.portal).toContain('Invalid OTP');
    const right = await pl.verifyPleadingOtp(sessionId, USER, { otp: '123456' });
    expect(right.ok).toBe(true);
    expect(sent('pleading_esign_test/verifyOTP')).toEqual({ mobile: '9876543210', otp: '123456', pleading_number: P1, role: 'L', user_name: 'Ramesh Kumar', user_details: '1~P~Ramesh Kumar' });
  });

  it('eSign: needs "I accept", sends esign_trans, shows the gateway\'s own fields and relays what the advocate typed', async () => {
    await expect(pl.startPleadingEsign(sessionId, USER, { ...CASE, pleadingNumber: P1, signCounter: '1', pageCreated: 'N', userName: 'advanil', accepted: false })).rejects.toThrow(/Terms & Conditions/);
    const g = await pl.startPleadingEsign(sessionId, USER, { ...CASE, pleadingNumber: P1, signCounter: '1', pageCreated: 'N', userName: 'advanil', accepted: true });
    expect(sent('pleading_esign_test/esign_trans')).toEqual({
      filename: P1, sessdirname: 'KL', foldername: 'pleading_documents', sign_counter: '1', page_created: 'N',
      party_adv_name: 'Anil Kumar (Advocate), Ramesh Kumar', username: 'advanil', esign_url: `${ESP}/esp/start`,
    });
    expect(g.done).toBe(false);
    expect(g.fields).toEqual([{ key: 'aadhaar', label: 'Aadhaar Number / VID', type: 'text' }, { key: 'consent', label: 'I agree to the consent', type: 'checkbox' }]);
    expect(g.buttons).toEqual(['Get OTP']);
    expect(g.screenshotBase64).toBeTruthy();

    const otp = await pl.stepPleadingEsign(sessionId, USER, { values: { aadhaar: '999911112222', consent: 'true' }, press: 'Get OTP' });
    expect(fx.esp.at(-1)).toBe('/esp/otp?aadhaar=999911112222&consent=Y');
    expect(otp.fields.map((f) => f.label)).toEqual(['Enter OTP']);

    const done = await pl.stepPleadingEsign(sessionId, USER, { values: { esp_otp: '654321' }, press: 'Submit' });
    expect(fx.esp.at(-1)).toBe('/esp/done?otp=654321');
    expect(done).toMatchObject({ done: true, text: ['Document signed Successfully'] });
  });
});

describe('Dashboard: Draft Pleadings submit with GRN, Completed Pleadings re-submit', () => {
  it('Draft Pleadings lists each row\'s GRN choices and its Submit', async () => {
    const d = await pl.readDraftPleadings(sessionId, USER, 'draft');
    expect(d.total).toBe(1);
    const row = rows(d)[0]!;
    expect(row.cells).toEqual(['1', PDE, 'MACT OP\nRamesh Kumar Vs Suresh Babu', '', 'Submit']);
    expect(row.selects?.[0]?.options.map((o) => o.value)).toEqual(['', 'KL26GRN00012345']);
    expect(row.calls).toEqual([{ label: 'Submit', fn: 'submit_pleading', args: ['u1', '3', PDE] }]);
  });

  it('Submit: confirmation, a GRN the portal offers (or "without court fee"), then submit_pleading', async () => {
    const base = { uniqueId: 'u1', typeOfCase: '3', efilingNumber: PDE };
    await expect(pl.submitDraftPleading(sessionId, USER, { ...base, grn: 'KL26GRN00012345', confirmed: false })).rejects.toThrow(/Confirm the submission/);
    await expect(pl.submitDraftPleading(sessionId, USER, { ...base, grn: '', confirmed: true })).rejects.toThrow(/without court fee/);
    await expect(pl.submitDraftPleading(sessionId, USER, { ...base, grn: 'KL26GRN99999999', confirmed: true })).rejects.toThrow(/not offered/);
    const r = await pl.submitDraftPleading(sessionId, USER, { ...base, grn: 'KL26GRN00012345', confirmed: true });
    expect(r.ok).toBe(true);
    expect(sent('Dashboard/submit_pleading/')).toEqual({ unique_id: 'u1', type_of_case: '3', grn: 'KL26GRN00012345', efiling_number: PDE });
  });

  it('Re-submit after objections: confirmed -> resubmit_pleading', async () => {
    const r = await pl.resubmitPleading(sessionId, USER, { efilingNumber: 'KL0601PDE2026000099', confirmed: true });
    expect(r.ok).toBe(true);
    expect(sent('Dashboard/resubmit_pleading/')).toEqual({ efiling_number: 'KL0601PDE2026000099' });
    await expect(pl.resubmitPleading(sessionId, USER, { efilingNumber: PDE, confirmed: true })).rejects.toThrow(/no Re-submit/);
  });
});

describe('Pleadings > Use Template', () => {
  it('opens Use Template from the menu and reads its case choices and labels', async () => {
    const s = await pl.readTemplateScreen(sessionId, USER);
    expect(s.title).toBe('Use Template');
    expect(s.sources.map((x) => [x.value, x.label])).toEqual([['1', 'Existing Case'], ['3', 'e-Filed Case']]);
    expect(s.efiled.map((o) => o.value)).toEqual([PDE]);
    expect(s.labels).toMatchObject({ type_pleading: 'Type of Pleading', submit: 'Generate' });
  });

  it('a case: its clients (getPartyListFromPDE) and the types of pleading (get_pleading_list1)', async () => {
    const v = await pl.selectTemplateCase(sessionId, USER, CASE);
    expect(sent('use_templates/get_pleading_list1')).toEqual({ get_case_type: '3', cino: PDE });
    expect(v.pleadingTypes.map((o) => o.text)).toEqual(['Vakalatnama', 'Memo of Appearance']);
    expect(v.parties.map((x) => [x.side, x.label])).toEqual([['pet', 'Ramesh Kumar'], ['res', 'Suresh Babu']]);
    expect(v.clientsLabel).toBe('My Clients [Petitioner]');
  });

  it('Generate: generate_template with the type and clients, and the .doc the portal links', async () => {
    const r = await pl.generateTemplate(sessionId, USER, { ...CASE, typePleading: '5', parties: ['1~P~0~Ramesh Kumar'] });
    expect(sent('use_templates/generate_template')).toMatchObject({ sel_pde_no: PDE, type_pleading: '5', 'chk_pet_list[]': '1~P~0~Ramesh Kumar', pet_called_as: 'Petitioner', cases: '3' });
    expect(r.ok).toBe(true);
    expect(r.file?.name).toBe('VAK_KL0601PDE2026000123.doc');
    expect(r.file?.body.toString()).toBe('DOC VAK_KL0601PDE2026000123.doc');
  });
});

describe('Pleadings > Video Recording (oath)', () => {
  it('opens the screen: case choices, e-filing numbers, labels, recorder buttons', async () => {
    const s = await pl.readOathScreen(sessionId, USER);
    expect(s.title).toBe('Video Recording');
    expect(s.sources).toEqual([{ value: '1', label: 'e-Filed Case', checked: true }, { value: '2', label: 'Existing Case', checked: false }]);
    expect(s.cases.map((o) => o.value)).toEqual([PDE]);
    expect(s.labels).toMatchObject({ sel_pde_no: 'e-Filing Number', selDocument: 'Select Document', selClientList: 'Select Client', est_name: 'Establishment', recorder0: 'Start Recording' });
  });

  it('a case: its documents (fetchDocument) and its oath videos (fetchOathVideos)', async () => {
    const r = await pl.selectOathCase(sessionId, USER, { searchCase: '1', pdeNo: PDE });
    expect(sent('pleading_index/fetchDocument')).toEqual({ sel_pde_no: PDE, search_case: '1' });
    expect(r.documents).toEqual([{ value: `${P1}~P~10`, text: 'Vakalat', selected: false }]);
    expect(sent('videoRecording/fetchOathVideos')).toEqual({ sel_pde_no: PDE, search_case: '1' });
    expect(r.videos.rows[0]).toEqual({ group: PDE });
    expect(rows(r.videos)[0]!.calls).toEqual([{ label: 'Play', fn: 'setVideo', args: ['kl_user/oathvideos/oath1.webm'] }]);
  });

  it('a document: case details, the oath text and the clients (fetchDetails)', async () => {
    const d = await pl.oathDocumentDetails(sessionId, USER, { searchCase: '1', pdeNo: PDE, document: `${P1}~P~10` });
    expect(sent('videoRecording/fetchDetails')).toEqual({ sel_pde_no: PDE, search_case: '1', doc_id: P1 });
    expect(d).toMatchObject({ establishment: 'Munsiff Court, Chengannur', causeTitle: 'Ramesh Kumar Vs Suresh Babu', oathMessage: 'I, Ramesh Kumar , do solemnly affirm that the contents are true.' });
    expect(d.clients).toEqual([{ value: '1~P~Ramesh Kumar', text: 'Ramesh Kumar' }]);
  });

  it('upload: confirmed -> selfInvoker with the recorder\'s fields; play -> readOathVideo', async () => {
    const input = { searchCase: '1', pdeNo: PDE, document: `${P1}~P~10`, client: '1~P~Ramesh Kumar', video: { base64: Buffer.from('WEBMDATA').toString('base64'), mimeType: 'video/webm' } };
    await expect(pl.uploadOathVideo(sessionId, USER, { ...input, confirmed: false })).rejects.toThrow(/Confirm the upload/);
    const r = await pl.uploadOathVideo(sessionId, USER, { ...input, confirmed: true });
    expect(r.ok).toBe(true);
    expect(r.portal).toContain('Oath video uploaded');
    const raw = fx.multipart['videoRecording/selfInvoker']![0]!;
    expect(part(raw, 'video-filename')).toMatch(/^RecordRTC-\d+-\w+\.webm$/);
    expect(part(raw, 'search_case')).toBe('1');
    expect(part(raw, 'sel_pde_no')).toBe(PDE);
    expect(part(raw, 'selDocument')).toBe(`${P1}~P~10`);
    expect(part(raw, 'selClient')).toBe('1~P~Ramesh Kumar');
    expect(raw).toContain('WEBMDATA');
    const v = await pl.playOathVideo(sessionId, USER, { filepath: 'kl_user/oathvideos/oath1.webm' });
    expect(sent('videoRecording/readOathVideo')).toEqual({ filepath: 'kl_user/oathvideos/oath1.webm' });
    expect(v.body.toString()).toBe('WEBM oath1.webm');
  });

  it('every urlencoded request DifAi sent carried the current __csrf_magic token', () => {
    // The exceptions are the portal's own: mergeFiles' callback reloads the
    // list before ajaxCallNew stores the new token (components.js stores it
    // after calling back), and Use Template's #sel_pde_no change sends
    // getPartyListFromPDE and get_pleading_list1 at once - the real pages do the same.
    const portalOwn = ['upload_pleading/fetchPleadingData after upload_pleading/mergedocSubmit', 'use_templates/get_pleading_list1 after custom_component/getPartyListFromPDE/'];
    expect(fx.csrfBad.filter((x) => !portalOwn.includes(x))).toEqual([]);
  });
});
