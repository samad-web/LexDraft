/**
 * Case Filing on the portal (New Case Filing wizard, Draft Cases, eFiled
 * Cases, Manage Favourite Clients), against a fixture that behaves like
 * filing.ecourts.gov.in's own pages: the ids, functions and requests of
 * js/adv_case_registration/registration.js, litigant.js, macp.js,
 * favourite_client.js and components.js (as the portal serves them to a
 * logged-in advocate; docs/efiling-portal-reverse-engineering.md §2) - ajaxCall's ?p=<controller/method> POSTs with a
 * __csrf_magic token that rotates on every request, started from a
 * setTimeout; tabs that stay .disabled until the portal enables them; its
 * cascades (getEstablishment, rdoCivCrim -> get_MainCaseType_data,
 * getSubCaseType, setCaseLabel, getEstDistrict / getEstTownTaluka); its save
 * functions and their callbacks; jquery-validate's "This field is required."
 * labels; confirm() before deleting and before "eFile Case"; Draft / eFiled
 * Cases paged by the server (getUnRegisteredPDE / getSubmittedNewCases (page, 10))
 * and grouped by the page's DataTables; Manage Favourite Clients' Client /
 * Organization forms and its client list (fetchFavClient, deleteFavClient,
 * getClientCases).
 * The real DifAi service drives it. No live portal, no account, no DB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserContext, Route } from 'playwright';
import * as live from '../src/services/efiling-live.service';
import * as cf from '../src/services/efiling-portal-casefiling.service';

const USER = 'portal-casefiling-user';
const ORIGIN = 'https://filing.ecourts.gov.in';
const PDE = 'KL0601PDE2026000123';
const OLD_DRAFT = 'KL0601PDE2026000077';
const FILED = 'KL0601PDE2026000099';
const PAGE2_DRAFT = 'KL0601PDE2026000011';

interface Party { type: '1' | '2'; no: number; name: string; age: string; address: string; sex: string }

const fx = {
  lastCode: '', n: 0,
  csrf: 'tok0', tok: 0, csrfBad: [] as string[],
  posts: {} as Record<string, string[]>,
  dialogs: [] as string[],
  parties: [] as Party[],
  drafts: new Map<string, { title: string; type: string }>([[OLD_DRAFT, { title: 'Anil Kumar Vs Bindu', type: 'O.S.' }]]),
  efileError: true,
  clients: [{ id: 1, name: 'Ramesh Kumar', mobile: '9876543210', type: 'client' }, { id: 2, name: 'National Insurance Co.', mobile: '', type: 'org' }] as Array<{ id: number; name: string; mobile: string; type: string }>,
};

const loginPage = `<!doctype html><html><body><form id="frm_login">
<select id="selState"><option value="4">Kerala</option></select><input type="radio" id="user_advocate" name="rdoUser">
<input id="user_name"><input type="password" id="user_password"><img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a" width="150" height="50">
<input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="go()">Login</button>
<div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div></form>
<script>function go(){var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=login/verify_login/');x.onload=function(){var o=JSON.parse(x.responseText);location.href=o.redirect_path;};x.send('fcaptcha_code='+document.getElementById('fcaptcha_code_mobile').value);}</script>
</body></html>`;

const menu = `<nav><ul><li class="dropdown"><a href="#" class="dropdown-toggle">Case Filing</a><ul class="dropdown-menu">
<li><a href="${ORIGIN}/pdedev/?p=advocate_case_registration/">New Case Filing</a></li><li><a href="${ORIGIN}/pdedev/?p=advocate_case_registration/favourite_client">Manage Favourite Clients</a></li></ul></li></ul></nav>`;

const hiddenInputs = () => `<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="${fx.csrf}">`;

const dashboard = () => `<!doctype html><html><body>${hiddenInputs()}${menu}<h3>Dashboard</h3><a href="#" id="draft_cases">Draft Cases</a></body></html>`;

const clientsPage = () => `<!doctype html><html><head><style>.tab-pane{display:none}.tab-pane.active{display:block}</style></head><body>${hiddenInputs()}${menu}
<div class="container"><h3>Manage Favourite Clients</h3>
<ul class="nav nav-tabs"><li><a id="new_client_tab" href="#new_client" class="active">Add Client</a></li><li><a id="edit_client_tab" href="#edit_client">Client List</a></li></ul>
<div class="tab-pane active" id="new_client">
  <ul class="nav nav-tabs"><li><a href="#new_party" class="active"><span id="sp_new_party_tab">Add Client</span></a></li><li><a href="#new_organisation"><span id="sp_new_organisation_tab">Add Organization</span></a></li></ul>
  <div class="tab-pane active" id="new_party">
    <h4 id="client_heading">Add Client</h4>
    <form id="frmAdvParty"><input type="hidden" id="form_action_client" name="form_action_client" value="1"><input type="hidden" id="client_id" name="client_id" value="">
      <div class="form-group"><label for="fextra_name">* Name</label><input id="fextra_name" name="fextra_name"></div>
      <div class="form-group"><label for="fmobile">* Mobile No.</label><input id="fmobile" name="fmobile"></div>
      <div class="form-group"><label for="fextraadd">* Address</label><textarea id="fextraadd" name="fextraadd"></textarea></div>
      <div class="form-group"><label for="fphone">Phone</label><input id="fphone" name="fphone"></div>
    </form>
    <button type="button" id="btnAddSave" onclick="insertClientInformationTab()">Save</button><button type="button" onclick="cancelAddNewParty()">Cancel</button>
  </div>
  <div class="tab-pane" id="new_organisation">
    <h4 id="org_heading">Add Organization</h4>
    <form id="frmOrg">
      <div class="form-group"><label for="extraporg_name">* Organization Type</label><select id="extraporg_name" name="extraporg_name" onchange="getMinistry(this,1)"><option value="">Select</option><option value="1">Central Government</option></select></div>
      <div class="form-group"><label for="selMinistry">* Ministry</label><select id="selMinistry" name="selMinistry" onchange="getDepartment(this)"><option value="">Select</option></select></div>
      <div class="form-group"><label for="selDepartment">* Department</label><select id="selDepartment" name="selDepartment"><option value="">Select</option></select></div>
    </form>
    <button type="button" id="btnAddSaveOrg" onclick="insertOrgInformationTab()">Save</button>
  </div>
</div>
<div class="tab-pane" id="edit_client"><div id="dvClientList"></div></div>
<div id="vw_app_modal" style="display:none"><div id="vw_application"></div></div>
</div>
<script>
  function byId(i){return document.getElementById(i);}
  function ser(f){return new URLSearchParams(new FormData(byId(f))).toString();}
  function ajaxCall(o){setTimeout(function(){var x=new XMLHttpRequest();x.open('POST',byId('base_url').value+'/?p='+o.url);x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
    x.onload=function(){var r=JSON.parse(x.responseText);if(r.nsteptoken)byId('__csrf_magic').value=r.nsteptoken;r.status=true;o.callback(r);};
    x.send(o.postdata+'&ajax_req=true&__csrf_magic='+encodeURIComponent(byId('__csrf_magic').value));},50);}
  document.querySelectorAll('.nav-tabs a').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var ul=a.closest('ul');
    ul.querySelectorAll('a').forEach(function(o){o.classList.toggle('active',o===a);var p=byId(o.getAttribute('href').slice(1));if(p)p.classList.toggle('active',o===a);});});});
  byId('edit_client_tab').addEventListener('click',function(){ajaxCall({url:'advocate_case_registration/favourite_client_list/',postdata:'',callback:function(o){byId('dvClientList').innerHTML=o.client_list;}});});
  function valid(form,ids){var ok=true;document.querySelectorAll('#'+form+' label.error').forEach(function(l){l.remove();});ids.forEach(function(i){var el=byId(i);if(el&&!String(el.value).trim()){ok=false;var l=document.createElement('label');l.className='error';l.htmlFor=i;l.id=i+'-error';l.textContent='This field is required.';el.parentNode.insertBefore(l,el.nextSibling);}});return ok;}
  function insertClientInformationTab(){if(!valid('frmAdvParty',['fextra_name','fmobile','fextraadd']))return;ajaxCall({url:'advocate_case_registration/insertFavouriteParty/',postdata:'duplicate_client_flag=N&'+ser('frmAdvParty'),callback:function(o){if(o.status==true&&o.errorstatus!='1'){byId('frmAdvParty').reset();byId('client_id').value='';}}});}
  function cancelAddNewParty(){byId('frmAdvParty').reset();}
  function getMinistry(obj,flg){ajaxCall({url:'advocate_case_registration/getMinistry/',postdata:'org_type='+obj.value,callback:function(o){byId('selMinistry').innerHTML=o.option;}});}
  function getDepartment(obj){ajaxCall({url:'advocate_case_registration/getDepartment/',postdata:'org_type='+byId('extraporg_name').value+'&sel_ministry='+obj.value,callback:function(o){byId('selDepartment').innerHTML=o.option;}});}
  function insertOrgInformationTab(){if(!valid('frmOrg',['extraporg_name','selMinistry','selDepartment']))return;var dept=byId('selDepartment').options[byId('selDepartment').selectedIndex].text;ajaxCall({url:'advocate_case_registration/insertOrgInformationTab/',postdata:'dept_name='+dept+'&'+ser('frmOrg'),callback:function(o){}});}
  function fetchFavClient(id){ajaxCall({url:'advocate_case_registration/fetchFavClient/',postdata:'client_id='+id,callback:function(o){byId('new_client_tab').click();byId('form_action_client').value='2';byId('client_id').value=id;byId('btnAddSave').innerHTML='Update';byId('sp_new_party_tab').innerHTML='Update Client';byId('fextra_name').value=o.name;byId('fmobile').value=o.mobile;byId('fextraadd').value=o.address;}});}
  function deleteFavClient(id){var ans=confirm('Want to delete?');if(ans==false)return;ajaxCall({url:'advocate_case_registration/deleteFavClient/',postdata:'client_id='+id,callback:function(o){if(o&&o.client_list)byId('dvClientList').innerHTML=o.client_list;}});}
  function getClientCases(uid,type){ajaxCall({url:'advocate_case_registration/getClientCases/',postdata:'uid='+uid+'&type='+type,callback:function(o){if(o&&o.client_cases){byId('vw_app_modal').style.display='block';byId('vw_application').innerHTML=o.client_cases;}}});}
</script></body></html>`;

// The New Case Filing page: litigant.js's ids, functions and requests.
const newCasePage = () => `<!doctype html><html><head><style>.tab-pane{display:none}.tab-pane.active{display:block}</style></head><body>
${hiddenInputs()}${menu}
<input type="hidden" id="form_active_mode" value="1"><input type="hidden" id="hid_court_type" value="1"><input type="hidden" id="sel_party_type_no" value="">
<input type="hidden" id="hid_case_adv_pde" value=""><input type="hidden" id="hid_case_adv_flag" value=""><input type="hidden" id="selTagState" value="4">
<div class="alert-danger"><span id="msg-danger"></span></div><div class="alert-success"><span id="msg-success"></span></div>
<ul class="nav nav-tabs">
  <li id="li_add"><a id="new_case_tab" data-toggle="tab" href="#tab_add" class="active">New Case</a></li>
  <li id="li_edit"><a id="edit_case_tab" data-toggle="tab" href="#tab_edit">Draft Cases</a></li>
  <li><a id="old_case_tab" data-toggle="tab" href="#old_case">Filed Cases</a></li>
</ul>
<div class="tab-pane active" id="tab_add">
  <h4>Initial Inputs</h4>
  <form id="frmInitialInput1">
    <div class="form-group"><label for="selDistrict">* Select District</label><select id="selDistrict" name="selDistrict" onchange="getEstablishment()"><option value="">Select District</option><option value="6">Alappuzha</option></select></div>
    <div class="form-group"><label for="selEstablishment">* Select Establishment</label><select id="selEstablishment" name="selEstablishment"><option value="">Select an Option</option></select></div>
    <div class="form-group"><label>* Case Types</label>
      <label><input type="radio" class="rdoCivCrim" id="fcivil" name="fcasetype" value="1">Civil</label>
      <label><input type="radio" class="rdoCivCrim" id="fcriminal" name="fcasetype" value="2">Criminal</label></div>
    <div class="form-group"><label for="selMainCaseType">* Relief Sought</label><select id="selMainCaseType" name="selMainCaseType" onchange="getSubCaseType()"><option value="">Select Case</option></select></div>
    <div class="form-group"><label for="selCaseType">* Case Type</label><select id="selCaseType" name="selCaseType" onchange="setCaseLabel()"><option value="">Select an Option</option></select></div>
  </form>
  <h4>Party Details</h4>
  <form id="frmInitialInput2">
    <div class="form-group"><label for="fparty_name">* <span id="lblParty">Plaintiff</span></label><input id="fparty_name" name="fparty_name" placeholder="Plaintiff"></div>
    <div class="form-group"><label for="fparty_mobile">* Mobile Number</label><input id="fparty_mobile" name="fparty_mobile" maxlength="10"></div>
  </form>
  <button type="button" id="btnAddSave" onclick="insertNewPDE()">Save</button>
</div>
<div class="tab-pane" id="tab_edit"><input id="txtEditCaseSearch"><button type="button" id="btnEditSearch">Search</button><div id="dvEditCase"></div></div>
<div class="tab-pane" id="old_case"><button type="button" id="submitted_pde">Refresh</button><input id="txtAppSearch"><div id="dvSubmittedPDE"></div></div>
<div id="mod_new_case_status" style="display:none"><div id="db_case_body"></div></div>

<div id="dvCaseHeader" style="display:none"></div>
<ul class="nav nav-tabs">
  <li id="liVictim" style="display:none"><a id="victim_details_tab" data-toggle="tab" href="#tab6">Victim Details</a></li>
  <li><a id="litigant_tab" data-toggle="tab" href="#tab1" class="form_tab disabled">Litigant</a></li>
  <li id="li_legal_heir" style="display:none"><a id="legal_heir_tab" data-toggle="tab" href="#tab_lh" class="disabled">Legal Heir</a></li>
  <li><a id="fact_tab" data-toggle="tab" href="#tab_fact" class="form_tab disabled">Fact Details</a></li>
  <li><a id="case_detail_tab" data-toggle="tab" href="#tab2" class="form_tab disabled">Case Details</a></li>
  <li id="liMVC" style="display:none"><a id="mvc_tab" data-toggle="tab" href="#tab3" class="form_tab disabled">MACT</a></li>
  <li><a id="eFile_tab" data-toggle="tab" href="#tab5" class="form_tab disabled">eFile</a></li>
</ul>
<div class="tab-pane" id="tab6">
  <form id="frmVictimDetails">
    <div class="form-group"><label for="fvictim_name">* Victim Name</label><input id="fvictim_name" name="fvictim_name"></div>
    <div class="form-group"><label>* Injury / Death</label><label><input type="radio" name="fclaim_type" value="1">Injury</label><label><input type="radio" name="fclaim_type" value="2">Death</label></div>
  </form>
  <button type="button" onclick="insertVictimInformationTab()">Save</button>
</div>
<div class="tab-pane" id="tab1">
  <div class="dvPartyField" style="display:none"></div>
  <div id="dv_extra_party" style="display:none"><b>Party List <span id="tot_delay_count"></span></b><table id="dropdown_content10"></table></div>
  <form id="frmAdvParty">
    <input type="hidden" id="adv_pde_no" name="adv_pde_no" value=""><input type="hidden" id="form_action" name="form_action" value="1">
    <div class="form-group"><label>* Party Type</label>
      <label><input type="radio" name="ftype" id="ftype1" value="1" checked><span id="pet_label">Petitioner</span></label>
      <label><input type="radio" name="ftype" id="ftype2" value="2"><span id="res_label">Respondent</span></label></div>
    <div class="form-group"><label><input type="checkbox" id="fextraorg_check" name="fextraorg_check" value="Y">Organisation Details</label></div>
    <div class="form-group"><label for="fextra_name">* Name</label><input id="fextra_name" name="fextra_name"></div>
    <div class="form-group"><label for="fextra_father_flag">Relation</label><select id="fextra_father_flag" name="fextra_father_flag"><option value="">Select</option><option value="1">S/o</option><option value="2">D/o</option></select></div>
    <div class="form-group"><label for="fextra_father_name">Father/Mother/Husband Name</label><input id="fextra_father_name" name="fextra_father_name"></div>
    <div class="form-group"><label>Gender</label>
      <label><input type="radio" name="fextra_sex" id="fextra_sex1" value="1">Male</label><label><input type="radio" name="fextra_sex" id="fextra_sex2" value="2">Female</label><label><input type="radio" name="fextra_sex" id="fextra_sex3" value="3">Other</label></div>
    <div class="form-group"><label for="fextra_age">Age</label><input id="fextra_age" name="fextra_age" type="number"></div>
    <div class="form-group"><label for="fpet_dob">Date of Birth</label><input id="fpet_dob" name="fpet_dob" readonly></div>
    <div class="form-group"><label for="fmobile">Mobile No.</label><input id="fmobile" name="fmobile"></div>
    <div class="form-group"><label for="fextraadd">* Address</label><textarea id="fextraadd" name="fextraadd"></textarea></div>
    <div class="form-group"><label for="fstate_code_extra_off">State</label><select id="fstate_code_extra_off" name="fstate_code_extra_off" onchange="getEstDistrict(this)"><option value="">Select</option><option value="4">Kerala</option></select></div>
    <div class="form-group"><label for="fdist_code_extra_off">District</label><select id="fdist_code_extra_off" name="fdist_code_extra_off" onchange="getEstTownTaluka(this)"></select></div>
    <div class="form-group"><label for="ftaluka_code_extra_off">Taluka</label><select id="ftaluka_code_extra_off" name="ftaluka_code_extra_off"></select></div>
    <div class="otherinfo" style="display:none"><label for="fpassportno">Passport No.</label><input id="fpassportno" name="fpassportno"></div>
  </form>
  <button type="button" id="btnAddNewParty" onclick="AddNewParty()">Add New Party</button>
  <button type="button" onclick="insertPartyInformationTab()">Save</button>
</div>
<div class="tab-pane" id="tab_lh"><form id="frmAdvLegalHeirParty"><label for="fextra_name_lh">Name</label><input id="fextra_name_lh" name="fextra_name_lh"></form></div>
<div class="tab-pane" id="tab_fact">
  <form id="frmAdvFact"><div class="dvBeforeFact"></div>
    <div class="csDvFact"><label for="fact_date1">* Date</label><input class="csFactDate" id="fact_date1" name="fact_date[]"><label>* Time</label><input class="csFactTime" name="fact_time[]"><label>* Fact</label><textarea class="csFact" name="fact[]"></textarea></div>
    <div id="dvFactBtn"><button type="button" onclick="add_more_fact()">Add More</button><button type="button" id="btnRemoveFact" style="display:none" onclick="remove_fact()">Remove</button></div>
  </form>
  <button type="button" onclick="insertFactTab()">Save</button>
</div>
<div class="tab-pane" id="tab2">
  <form id="frmAdvCaseDetail">
    <div class="form-group"><label for="fcauseofaction_ci">* Cause of Action</label><textarea id="fcauseofaction_ci" name="fcauseofaction_ci"></textarea></div>
    <div class="form-group"><label for="foffense_date">* Date of Cause of Action</label><input id="foffense_date" name="foffense_date"></div>
    <div class="form-group"><label for="fprayercode_s">Prayer</label><select id="fprayercode_s" name="fprayercode_s"><option value="">Select</option><option value="3">Compensation</option></select><button type="button" onclick="set_prayer()">Prayer</button></div>
    <div class="form-group"><label for="frelief_offense">* Relief Claimed</label><textarea id="frelief_offense" name="frelief_offense"></textarea></div>
    <div class="form-group"><label for="famount">Valuation</label><input id="famount" name="famount"></div>
    <h5>Act - Section</h5>
    <table id="act_section">
      <tr id="tract1"><td><label for="fdispactcodes1">* Act</label></td><td><input id="fdispactcodes1" name="fdispactcodes1" class="csfdispactcode" onkeyup="actautofetch(1)"><input type="hidden" id="fhiddactcodes1" name="fhiddactcodes1"><input type="hidden" id="factcodes1" name="factcodes1"></td>
        <td><label for="factsection_code1">* Section</label></td><td><input id="factsection_code1" name="factsection_code1" onkeyup="autofetch(1)"></td></tr>
      <tr id="addbutton1"><td colspan="4"><button type="button" id="moreacts1" onclick="showAct_Section(1,'more','','','','')">More Acts...</button></td></tr>
    </table>
  </form>
  <button type="button" onclick="insertCaseInfo()">Save</button>
</div>
<div class="tab-pane" id="tab3">
  <form id="frmAdvMVC">
    <div class="form-group"><label for="fitem_no">Item Number</label><input id="fitem_no" name="fitem_no"></div>
    <div class="form-group"><label for="faccident_date">* Date of Accident</label><input id="faccident_date" name="faccident_date"></div>
    <div class="form-group"><label for="faccident_place">* Place of Accident</label><input id="faccident_place" name="faccident_place"></div>
  </form>
  <button type="button" onclick="insertMVC()">Save</button>
</div>
<div class="tab-pane" id="tab5">
  <div id="litigant_tab1"></div><div id="fact_detail_tab1"></div><div id="case_detail_tab1"></div><div id="mvc_tab1"></div><div id="subordinate_court_tab1"></div>
  <div class="dvFinalSubmit"><button type="button" onclick="submitEfileData()">eFile Case</button></div>
</div>
<script>
  function byId(i){return document.getElementById(i);}
  function ser(f){return new URLSearchParams(new FormData(byId(f))).toString();}
  function errorAlert(m){byId('msg-danger').textContent=m;}
  function successAlert(m){byId('msg-success').textContent=m;}
  // components.js ajaxCall: started from a setTimeout; the token rotates (nsteptoken); errormsg -> callback twice.
  function ajaxCall(o){setTimeout(function(){var x=new XMLHttpRequest();x.open('POST',byId('base_url').value+'/?p='+o.url);
    x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
    x.onload=function(){var r;try{r=JSON.parse(x.responseText);}catch(e){r={};}if(typeof r!=='object'||r===null)r={value:r};
      if(r.nsteptoken)byId('__csrf_magic').value=r.nsteptoken;
      if(r.errormsg){errorAlert(r.errormsg);r.status=false;o.callback(r);} if(r.msg)successAlert(r.msg); r.status=true; o.callback(r);};
    x.send(o.postdata+'&ajax_req=true&__csrf_magic='+encodeURIComponent(byId('__csrf_magic').value));},50);}
  function showTab(id){document.querySelectorAll('.tab-pane').forEach(function(p){p.classList.toggle('active',p.id===id);});
    document.querySelectorAll('.nav-tabs a').forEach(function(a){a.classList.toggle('active',a.getAttribute('href')==='#'+id);});}
  document.querySelectorAll('.nav-tabs a').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();if(a.classList.contains('disabled'))return;showTab(a.getAttribute('href').slice(1));
    if(a.id==='edit_case_tab')getUnRegisteredPDE();});});
  // registration.js: server-paged lists, page / limit / txtAppSearch, pagination + records_info under the table.
  function getUnRegisteredPDE(page,limit){page=page||1;limit=limit||10;showTab('tab_edit');
    ajaxCall({url:'advocate_case_registration/getUnRegisteredPDE',postdata:'page='+page+'&limit='+limit+'&txtAppSearch='+byId('txtEditCaseSearch').value,callback:function(r){
      byId('dvEditCase').innerHTML=r.pde_list;if(r.pagination)byId('dvEditCase').insertAdjacentHTML('beforeend',r.pagination);if(r.records_info)byId('dvEditCase').insertAdjacentHTML('beforeend','<div>'+r.records_info+'</div>');byId('txtEditCaseSearch').value=r.search;}});}
  function getSubmittedNewCases(page,limit){page=page||1;limit=limit||10;
    ajaxCall({url:'advocate_case_registration/getSubmittedPDE',postdata:'page='+page+'&limit='+limit+'&txtAppSearch='+byId('txtAppSearch').value,callback:function(r){byId('dvSubmittedPDE').innerHTML=r.submitted_pde_list;if(r.pagination)byId('dvSubmittedPDE').insertAdjacentHTML('beforeend',r.pagination);}});}
  byId('submitted_pde').addEventListener('click',function(){getSubmittedNewCases();});
  // macp.js
  function insertVictimInformationTab(){var pde=byId('adv_pde_no').value;if(!pde){alert('Please select/add PDE Case to fill party information');return false;}if(!valid('frmVictimDetails',['fvictim_name']))return;
    ajaxCall({url:'macp/insertVictimInformationTab/',postdata:ser('frmVictimDetails'),callback:function(o){if(!o.errormsg&&o.status){showTab('tab1');}}});}
  // jquery-validate: "This field is required." labels after the field.
  function valid(form,ids){var ok=true;document.querySelectorAll('#'+form+' label.error').forEach(function(l){l.remove();});
    ids.forEach(function(i){var el=byId(i);if(el&&!String(el.value).trim()){ok=false;var l=document.createElement('label');l.className='error';l.id=i+'-error';l.htmlFor=i;l.textContent='This field is required.';el.parentNode.insertBefore(l,el.nextSibling);}});return ok;}
  function opts(id,html){byId(id).innerHTML=html;}
  // ---- Initial Inputs
  function getEstablishment(){ajaxCall({url:'custom_component/getDistrictEstablishmentByJSON/',postdata:'fdistCode='+byId('selDistrict').value+'&selState='+byId('selTagState').value,callback:function(o){opts('selEstablishment',o.option);}});}
  document.querySelectorAll('.rdoCivCrim').forEach(function(r){r.addEventListener('change',function(){var v=document.querySelector('input[name=fcasetype]:checked').value;byId('lblParty').innerHTML='Plaintiff';
    ajaxCall({url:'advocate_case_registration/get_MainCaseType_data',postdata:'case_type='+v,callback:function(o){if(o.case_list){opts('selCaseType','');opts('selMainCaseType',o.case_list);}}});});});
  function getSubCaseType(){var civ=document.querySelector('input[name=fcasetype]:checked').value;ajaxCall({url:'advocate_case_registration/getSubCaseType/',postdata:'selMainCaseType='+byId('selMainCaseType').value+'&civ_cri='+civ,callback:function(o){if(!o.errormsg&&o.option)opts('selCaseType',o.option);}});}
  function setCaseLabel(){ajaxCall({url:'advocate_case_registration/getPartyLabel',postdata:'case_type='+byId('selCaseType').value,callback:function(o){if(o.pet_label&&o.res_label){byId('lblParty').innerHTML=o.pet_label+'/'+o.res_label;byId('fparty_name').placeholder=o.pet_label+'/'+o.res_label;}byId('liMVC').style.display=o.macp=='Y'?'':'none';byId('liVictim').style.display=o.macp=='Y'?'':'none';}});}
  function insertNewPDE(){var v1=valid('frmInitialInput1',['selDistrict','selEstablishment','selCaseType']);var v2=valid('frmInitialInput2',['fparty_name','fparty_mobile']);if(!(v1&&v2))return;
    ajaxCall({url:'advocate_case_registration/insertNewPDE/',postdata:'selMainPlaintiff=&'+ser('frmInitialInput1')+'&'+ser('frmInitialInput2'),callback:function(o){if(!o.errormsg&&o.status){
      byId('form_active_mode').value=1;byId('litigant_tab').classList.remove('disabled');byId('liMVC').style.display=o.macp=='Y'?'':'none';
      byId('adv_pde_no').value=o.pde_no;byId('fextra_name').value=byId('fparty_name').value;byId('fmobile').value=byId('fparty_mobile').value;
      if(o.pet_label)byId('pet_label').innerHTML=o.pet_label;if(o.res_label)byId('res_label').innerHTML=o.res_label;
      showTab('tab1');byId('ftype2').disabled=true;byId('selDistrict').selectedIndex=0;byId('selEstablishment').selectedIndex=0;byId('fparty_name').value='';byId('fparty_mobile').value='';}}});}
  // ---- Litigant
  function getEstDistrict(el){ajaxCall({url:'advocate_case_registration/getEstDistrict/',postdata:'selState='+el.value+'&selOption=',callback:function(o){opts(el.id.replace('fstate','fdist'),o.option);}});}
  function getEstTownTaluka(el){var p=el.value.split('~');ajaxCall({url:'advocate_case_registration/getEstTownTaluka/',postdata:'state_code='+p[0]+'&dist_code='+p[1]+'&distNationalCode='+p[2]+'&selTaluka=&selTown=',callback:function(o){opts(el.id.replace('fdist','ftaluka'),o.option);}});}
  function resetPartyForm(){['fextra_name','fextra_father_name','fextra_age','fpet_dob','fmobile','fextraadd'].forEach(function(i){byId(i).value='';});['fextra_father_flag','fstate_code_extra_off'].forEach(function(i){byId(i).selectedIndex=0;});
    document.querySelectorAll('input[name=fextra_sex]').forEach(function(r){r.checked=false;});byId('fextraorg_check').checked=false;}
  function AddNewParty(){byId('form_action').value=1;byId('ftype1').checked=true;resetPartyForm();}
  function insertPartyInformationTab(){var pde=byId('adv_pde_no').value;if(!pde){alert('Please select/add PDE Case to fill party information');return false;}if(!valid('frmAdvParty',['fextra_name','fextraadd']))return;
    ajaxCall({url:'advocate_case_registration/insertPartyInformationTab/',postdata:'sel_party_type_no='+byId('sel_party_type_no').value+'&'+ser('frmAdvParty'),callback:function(o){if(!o.errormsg&&o.status){if(o.errorstatus=='1')return;
      byId('ftype1').checked=true;byId('ftype2').disabled=false;resetPartyForm();byId('form_action').value=1;byId('sel_party_type_no').value='';
      byId('dropdown_content10').innerHTML=o.optlist;byId('dv_extra_party').style.display=o.total_party?'':'none';byId('tot_delay_count').innerHTML='('+o.total_party+')';
      if(o.pet_empty_flag==false){['litigant_tab','fact_tab','case_detail_tab'].forEach(function(i){byId(i).classList.remove('disabled');});}
      if(o.case_header){byId('dvCaseHeader').style.display='';byId('dvCaseHeader').innerHTML=o.case_header;}if(o.party_tab)byId('litigant_tab1').innerHTML=o.party_tab;}}});}
  function editPDECaseParty(sel){var p=sel.split('~');byId('sel_party_type_no').value=sel;byId(p[0]==1?'ftype1':'ftype2').checked=true;
    ajaxCall({url:'advocate_case_registration/fetchPartyData/',postdata:'sel_party_name='+sel+'&'+ser('frmAdvParty'),callback:function(o){byId('form_action').value=2;byId('fextra_name').value=o.extraparty_arr.name;byId('fextra_age').value=o.extraparty_arr.pet_age;byId('fextraadd').value=o.extraparty_add.address;byId('fextra_sex'+o.extraparty_arr.pet_sex).checked=true;}});}
  function delPDECaseParty(del){var pde=byId('adv_pde_no').value;byId('sel_party_type_no').value='';var ans=confirm('Want to delete?');if(ans==false)return;
    var p=del.split('~');if(p[1]==0){alert('You can not delete main party');return false;}
    ajaxCall({url:'advocate_case_registration/delPDECaseParty/',postdata:'party_type='+p[0]+'&party_no='+p[1]+'&fpde_no='+pde,callback:function(o){byId('dropdown_content10').innerHTML=o.optlist;byId('tot_delay_count').innerHTML='('+o.total_party+')';}});}
  // ---- Fact Details
  function add_more_fact(){var n=document.querySelectorAll('.csDvFact').length+1;byId('btnRemoveFact').style.display=n>=2?'':'none';
    ajaxCall({url:'advocate_case_registration/getFactRow',postdata:'counter='+n,callback:function(o){if(o.fact_template)byId('dvFactBtn').insertAdjacentHTML('beforebegin',o.fact_template);}});}
  function remove_fact(){if(!confirm('Want to remove?'))return false;var all=document.querySelectorAll('.csDvFact');if(all.length>=2)all[all.length-1].remove();if(document.querySelectorAll('.csDvFact').length==1)byId('btnRemoveFact').style.display='none';}
  function insertFactTab(){var pde=byId('adv_pde_no').value;var f=[].filter.call(document.querySelectorAll('.csFact'),function(e){return e.value.trim();});if(!f.length){alert('Please enter fact');return false;}
    ajaxCall({url:'advocate_case_registration/insertFact/',postdata:'adv_pde_no='+pde+'&'+ser('frmAdvFact'),callback:function(o){if(!o.errormsg&&o.status){byId('case_detail_tab').classList.remove('disabled');if(o.fact_details_tab)byId('fact_detail_tab1').innerHTML=o.fact_details_tab;}}});}
  // ---- Case Details
  function set_prayer(){var id=byId('fprayercode_s').value;if(!id){alert('Select prayer');return false;}ajaxCall({url:'advocate_case_registration/fetchPrayerDetails/',postdata:'prayer_id='+id,callback:function(o){if(o.prayer_detail){var old=byId('frelief_offense').value;byId('frelief_offense').value=old?old+'\\n'+o.prayer_detail:o.prayer_detail;}}});}
  function actautofetch(no){} function autofetch(no){}
  function showAct_Section(no,action){no=parseInt(no,10)+1;ajaxCall({url:'advocate_case_registration/fetchactsection',postdata:'no='+no+'&val=&cntnew=&roleflag=&flag=',callback:function(r){if(action=='more'){var b=byId('addbutton'+(no-1));if(b)b.remove();byId('act_section').insertAdjacentHTML('beforeend',r.selectbox);}}});}
  function insertCaseInfo(){var pde=byId('adv_pde_no').value;if(document.querySelectorAll('.csfdispactcode').length==0){alert('Please enter atleast one act');return false;}if(!valid('frmAdvCaseDetail',['fcauseofaction_ci','foffense_date','frelief_offense']))return;
    ajaxCall({url:'advocate_case_registration/insertCaseInfo/',postdata:'adv_pde_no='+pde+'&'+ser('frmAdvCaseDetail'),callback:function(o){if(!o.errormsg&&o.status){byId('case_detail_tab1').innerHTML=o.case_detail_tab+(o.act_section_tab||'');
      if(o.macp=='Y'){byId('mvc_tab').classList.remove('disabled');showTab('tab3');}else{byId('eFile_tab').classList.remove('disabled');showTab('tab5');}}}});}
  function insertMVC(){var pde=byId('adv_pde_no').value;if(!valid('frmAdvMVC',['faccident_date','faccident_place']))return;ajaxCall({url:'advocate_case_registration/insertMVC/',postdata:'adv_pde_no='+pde+'&'+ser('frmAdvMVC'),callback:function(o){if(!o.errormsg&&o.status){['litigant_tab','case_detail_tab','mvc_tab','eFile_tab'].forEach(function(i){byId(i).classList.remove('disabled');});if(o.mvc_tab)byId('mvc_tab1').innerHTML=o.mvc_tab;}}});}
  // ---- e-File
  function submitEfileData(){var pde=byId('adv_pde_no').value;if(!pde){alert('Please select case');return false;}
    var r=confirm("Do you want to submit the case? \\n Once submitted, case details can not be modfied.");if(r!=true)return true;
    var page_data=byId('litigant_tab1').innerHTML+'<p></p>'+byId('case_detail_tab1').innerHTML+'<p></p>'+byId('mvc_tab1').innerHTML+'<p></p>'+byId('subordinate_court_tab1').innerHTML+'<p></p>';
    ajaxCall({url:'advocate_case_registration/submitEfileData/',postdata:'pde_no='+pde+'&page_data='+page_data,callback:function(o){if(o.errorcode==1)return false;
      if(o.errorcode==2){for(var k in o.error_tab){document.querySelector('.nav-tabs a[href="#'+k+'"]').style.color='red';}for(var k2 in o.error_tab){showTab(k2);break;}return false;}
      showTab('old_case');byId('submitted_pde').click();}});return true;}
  // ---- drafts (Edit / Delete), filed status, case PDF
  function fetchPDECaseData(pde_no,adv_flag=0){if(!pde_no){alert('Please select Case first');return false;}byId('adv_pde_no').value=pde_no;
    ajaxCall({url:'advocate_case_registration/fetchPDECaseData/',postdata:'hid_case_adv_pde='+pde_no+'&hid_case_adv_flag='+adv_flag,callback:function(o){if(!o.errormsg!=''&&o.status){
      document.querySelectorAll('.form_tab').forEach(function(a){a.classList.remove('disabled');});showTab('tab1');byId('liMVC').style.display=o.macp=='Y'?'':'none';
      byId('eFile_tab').classList.toggle('disabled',!o.isCaseDetailFill);if(o.case_title){byId('dvCaseHeader').style.display='';byId('dvCaseHeader').innerHTML=o.case_title;}
      byId('dropdown_content10').innerHTML=o.optlist;byId('dv_extra_party').style.display=o.total_party?'':'none';if(o.party_tab)byId('litigant_tab1').innerHTML=o.party_tab;
      byId('adv_pde_no').value=pde_no;byId('form_active_mode').value=2;}}});}
  function deletePDECase(fpde_no){if(fpde_no==''){alert('Please select case');return false;}var ans=confirm('Want to delete?');if(ans==false)return;
    ajaxCall({url:'advocate_case_registration/deletePDECase/',postdata:'fpde_no='+fpde_no,callback:function(o){if(o&&o.pde_list)byId('dvEditCase').innerHTML=o.pde_list;}});}
  function generateCasePDF(pde){ajaxCall({url:'advocate_case_registration/generateCasePDF',postdata:'sel_pde='+pde,callback:function(o){}});}
  function getStatus(est,pde,el){ajaxCall({url:'dashboard/getStatus',postdata:'est_code='+est+'&pde_no='+pde,callback:function(r){if(r.status1!=''){byId('mod_new_case_status').style.display='block';byId('db_case_body').innerHTML=r.status1;}}});}
</script></body></html>`;

// ---- what the portal answers --------------------------------------------------

const partyKey = (p: Party) => `${p.type}~${p.no}`;
const optlist = () => `<thead><tr><th>Sr No</th><th>Party Name</th><th>Party Type</th><th>Action</th></tr></thead><tbody>${fx.parties.map((p, i) =>
  `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.type === '1' ? 'Petitioner' : 'Respondent'}</td><td><a href="#" title="Edit" onclick="editPDECaseParty('${partyKey(p)}');return false;"><i class="fa fa-pencil"></i></a> <a href="#" onclick="delPDECaseParty('${partyKey(p)}');return false;"><i class="fa fa-trash"></i></a></td></tr>`).join('')}</tbody>`;
const partyTab = () => `<table><thead><tr><th>Petitioner</th><th>Respondent</th></tr></thead><tbody><tr><td>${fx.parties.filter((p) => p.type === '1').map((p) => p.name).join(', ')}</td><td>${fx.parties.filter((p) => p.type === '2').map((p) => p.name).join(', ')}</td></tr></tbody></table>`;
// Columns 1 (establishment) and 7 (court) are what the page's DataTables groups by and hides.
const draftRow = (no: string, d: { title: string; type: string }, i: number) =>
  `<tr><td>${i + 1}</td><td>Munsiff Court, Chengannur</td><td>${no}</td><td>${d.type}</td><td>${d.title}</td><td>01-11-2026</td><td><a href="#" title="Edit" onclick="fetchPDECaseData('${no}');return false;"><i class="fa fa-edit"></i></a> <a href="#" onclick="deletePDECase('${no}');return false;"><i class="fa fa-trash"></i></a> <a href="#" onclick="generateCasePDF('${no}');return false;">View</a></td><td>District Court</td></tr>`;
const draftHead = '<thead><tr><th>Sr No</th><th>Establishment</th><th>eFiling No</th><th>Case Type</th><th>Petitioner Vs Respondent</th><th>Created On</th><th>Action</th><th>Court</th></tr></thead>';
const pager = '<ul class="pagination"><li class="active"><a href="#" class="case-page-link-btn" data-page="1">1</a></li><li><a href="#" class="case-page-link-btn" data-page="2">2</a></li></ul>';
const draftList = (page: number, search: string) => {
  const rows = page === 2 ? [[PAGE2_DRAFT, { title: 'Old Matter Vs Someone', type: 'O.P.' }] as const]
    : [...fx.drafts].filter(([no, d]) => !search || `${no} ${d.title}`.toLowerCase().includes(search.toLowerCase()));
  return `<table id="example">${draftHead}<tbody>${rows.map(([no, d], i) => draftRow(no, d, i)).join('')}</tbody></table>`;
};
const filedList = `<table id="example123"><thead><tr><th>Sr No</th><th>Establishment</th><th>eFiling No</th><th>Case Type</th><th>Petitioner Vs Respondent</th><th>Filed On</th><th>Status</th></tr></thead><tbody>
<tr><td>1</td><td>Munsiff Court, Chengannur</td><td>${FILED}</td><td>O.S.</td><td>Anil Vs State</td><td>01-10-2026</td><td><button type="button" id="sts-btn-${FILED}" onclick="getStatus('KLAL17','${FILED}',this)">View Status</button></td></tr></tbody></table>`;
const clientList = () => `<table id="tblFavClient"><thead><tr><th>Sr No</th><th>Client Name</th><th>Mobile No</th><th>Cases</th><th>Action</th></tr></thead><tbody>${fx.clients.map((c, i) =>
  `<tr><td>${i + 1}</td><td>${c.name}</td><td>${c.mobile}</td><td><a href="#" onclick="getClientCases('${c.id}','${c.type}');return false;">View Cases</a></td><td><a href="#" onclick="fetchFavClient(${c.id});return false;"><i class="fa fa-edit"></i></a> <a href="#" onclick="deleteFavClient(${c.id});return false;"><i class="fa fa-trash"></i></a></td></tr>`).join('')}</tbody></table>`;

function answer(key: string, form: URLSearchParams): unknown {
  switch (key) {
    case 'getDistrictEstablishmentByJSON': return { option: '<option value="">Select</option><option value="4~6~16">Sub Court, Mavelikkara</option><option value="4~6~17">Munsiff Court, Chengannur</option>' };
    case 'get_MainCaseType_data': return { case_list: '<option value="">Select Case</option><option value="10">Suit</option><option value="20">Compensation</option>' };
    case 'getSubCaseType': return { option: '<option value="">Select an Option</option><option value="7">O.S. - Original Suit</option><option value="31">M.A.C.T. O.P.</option>' };
    case 'getPartyLabel': return { pet_label: 'Petitioner', res_label: 'Respondent', macp: form.get('case_type') === '31' ? 'Y' : 'N', matter_type: 1 };
    case 'insertNewPDE':
      fx.drafts.set(PDE, { title: `${form.get('fparty_name')} Vs`, type: 'M.A.C.T. O.P.' });
      return { pde_no: PDE, macp: 'Y', pet_label: 'Petitioner', res_label: 'Respondent', total_count: 0 };
    case 'getEstDistrict': return { option: '<option value="">Select</option><option value="4~6~506">Alappuzha</option>' };
    case 'getEstTownTaluka': return { option: '<option value="">Select</option><option value="4~61~5061">Chengannur</option>' };
    case 'insertPartyInformationTab': {
      const sel = form.get('sel_party_type_no');
      const p: Party = { type: form.get('ftype') === '2' ? '2' : '1', no: 0, name: form.get('fextra_name') ?? '', age: form.get('fextra_age') ?? '', address: form.get('fextraadd') ?? '', sex: form.get('fextra_sex') ?? '' };
      const existing = sel ? fx.parties.find((x) => partyKey(x) === sel) : undefined;
      if (existing) Object.assign(existing, { ...p, no: existing.no });
      else {
        p.no = fx.parties.filter((x) => x.type === p.type).length;
        fx.parties.push(p);
      }
      return { status: true, errorstatus: '0', is_legal_heir: false, optlist: optlist(), total_party: fx.parties.length, pde_no: PDE, case_header: 'Ramesh Kumar Vs Suresh Babu', party_tab: partyTab(), pet_empty_flag: false };
    }
    case 'fetchPartyData': {
      const p = fx.parties.find((x) => partyKey(x) === form.get('sel_party_name'))!;
      return { extraparty_arr: { name: p.name, pet_age: p.age, pet_sex: p.sex || 1 }, extraparty_add: { address: p.address }, extraparty_info: {}, extraparty_other_info1: {} };
    }
    case 'delPDECaseParty':
      fx.parties = fx.parties.filter((x) => !(x.type === form.get('party_type') && String(x.no) === form.get('party_no')));
      return { optlist: optlist(), total_party: fx.parties.length };
    case 'getFactRow': {
      const n = form.get('counter');
      return { fact_template: `<div class="csDvFact"><label for="fact_date${n}">* Date</label><input class="csFactDate" id="fact_date${n}" name="fact_date[]"><label>* Time</label><input class="csFactTime" name="fact_time[]"><label>* Fact</label><textarea class="csFact" name="fact[]"></textarea></div>` };
    }
    case 'insertFact': return { fact_details_tab: '<table><tbody><tr><td>10-02-2026</td><td>Lorry hit the petitioner.</td></tr></tbody></table>' };
    case 'getActs': return { act: [{ label: 'Motor Vehicles Act, 1988', value: 'Motor Vehicles Act, 1988', national_code: '1988059', actvalue: '59' }, { label: 'Motor Transport Workers Act, 1961', value: 'Motor Transport Workers Act, 1961', national_code: '1961027', actvalue: '27' }] };
    case 'autocomplete_section': return [{ label: '166', value: '166', secvalue: '166' }, { label: '163A', value: '163A', secvalue: '163A' }];
    case 'fetch_sectioncode': return form.get('label');
    case 'fetchactsection': {
      const n = form.get('no');
      return { selectbox: `<tr id="tract${n}"><td><label for="fdispactcodes${n}">* Act</label></td><td><input id="fdispactcodes${n}" name="fdispactcodes${n}" class="csfdispactcode" onkeyup="actautofetch(${n})"><input type="hidden" id="fhiddactcodes${n}" name="fhiddactcodes${n}"><input type="hidden" id="factcodes${n}" name="factcodes${n}"></td><td><label for="factsection_code${n}">* Section</label></td><td><input id="factsection_code${n}" name="factsection_code${n}"></td></tr><tr id="addbutton${n}"><td colspan="4"><button type="button" id="moreacts${n}" onclick="showAct_Section(${n},'more','','','','')">More Acts...</button></td></tr>` };
    }
    case 'fetchPrayerDetails': return { prayer_detail: 'Award compensation with interest' };
    case 'insertCaseInfo': return { case_detail_tab: '<table><tbody><tr><td>Cause of Action</td><td>Accident on MC Road</td></tr></tbody></table>', macp: 'Y' };
    case 'insertMVC': return { mvc_tab: '<table><tbody><tr><td>Place of Accident</td><td>MC Road</td></tr></tbody></table>' };
    case 'submitEfileData':
      if (fx.efileError) { fx.efileError = false; return { errorcode: 2, error_tab: { tab2: 'Case Details' } }; }
      fx.drafts.delete(PDE);
      return { errorcode: 0 };
    case 'fetchPDECaseData': {
      const no = form.get('hid_case_adv_pde') ?? '';
      if (!fx.drafts.has(no)) return { errormsg: 'Case not found' };
      return { macp: 'N', isCaseDetailFill: false, case_title: fx.drafts.get(no)!.title, optlist: no === PDE ? optlist() : '', total_party: no === PDE ? fx.parties.length : 0, party_tab: '', pet_empty_flag: false, tot_fact: 0 };
    }
    case 'getUnRegisteredPDE': {
      const page = Number(form.get('page') || 1);
      const search = form.get('txtAppSearch') ?? '';
      return { pde_list: draftList(page, search), total_record: fx.drafts.size + 1, pagination: pager, records_info: `Showing page ${page} of 2`, search };
    }
    case 'deletePDECase': fx.drafts.delete(form.get('fpde_no') ?? ''); return { pde_list: draftList(1, ''), total_record: fx.drafts.size };
    case 'getSubmittedPDE': return { submitted_pde_list: filedList, total_record: 1, pagination: '', search: form.get('txtAppSearch') ?? '' };
    case 'insertVictimInformationTab': return { status: true, macp_tab: '<table><tbody><tr><td>Victim</td></tr></tbody></table>' };
    case 'favourite_client_list': return { client_list: clientList(), record_count: fx.clients.length };
    case 'fetchFavClient': { const c = fx.clients.find((x) => String(x.id) === form.get('client_id'))!; return { client_type: c.type, name: c.name, mobile: c.mobile, address: 'MC Road' }; }
    case 'deleteFavClient': fx.clients = fx.clients.filter((x) => String(x.id) !== form.get('client_id')); return { client_list: clientList(), record_count: fx.clients.length };
    case 'getClientCases': return { client_cases: `<table id="tblClientCases"><thead><tr><th>Sr No</th><th>Case</th></tr></thead><tbody><tr><td>1</td><td>${PDE}</td></tr></tbody></table>` };
    case 'insertFavouriteParty': {
      const id = Number(form.get('client_id'));
      if (id) Object.assign(fx.clients.find((x) => x.id === id)!, { name: form.get('fextra_name'), mobile: form.get('fmobile') });
      else fx.clients.push({ id: fx.clients.length + 1, name: form.get('fextra_name') ?? '', mobile: form.get('fmobile') ?? '', type: 'client' });
      return { status: true, errorstatus: '0' };
    }
    case 'getMinistry': return { option: '<option value="">Select</option><option value="11">Ministry of Road Transport</option>' };
    case 'getDepartment': return { option: '<option value="">Select</option><option value="21">National Highways Authority</option>' };
    case 'insertOrgInformationTab': return { status: true };
    case 'getStatus': return { status1: 'Still case is not consumed in CIS' };
    case 'generateCasePDF': return { viewPDF: `/pdedev/temp/${form.get('sel_pde')}.pdf` };
    default: return { status: true };
  }
}

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('securimage_show.php')) {
    fx.lastCode = `C${++fx.n}`;
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="10" y="32" font-size="24">${fx.lastCode}</text></svg>` });
  }
  if (url.pathname.startsWith('/pdedev/temp/')) return route.fulfill({ contentType: 'application/pdf', body: Buffer.from(`%PDF-1.4\n% case ${url.pathname}\n%%EOF`) });
  if (req.method() === 'GET') {
    if (p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: dashboard() });
    if (p === 'advocate_case_registration/') return route.fulfill({ contentType: 'text/html', body: newCasePage() });
    if (p === 'advocate_case_registration/favourite_client') return route.fulfill({ contentType: 'text/html', body: clientsPage() });
    return route.fulfill({ contentType: 'text/html', body: loginPage });
  }
  const body = req.postData() ?? '';
  if (p === 'login/verify_login/') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }) });
  const form = new URLSearchParams(body);
  // The token must be the one the last answer gave.
  if (form.get('__csrf_magic') !== fx.csrf) fx.csrfBad.push(`${p}: ${form.get('__csrf_magic')}`);
  const key = p.replace(/^[^/]+\//, '').replace(/\/$/, '');
  (fx.posts[key] ??= []).push(body);
  const a = answer(key, form);
  // A JSON object carries the next token (nsteptoken); the autocompletes' bare lists / strings don't rotate it.
  const rotate = Boolean(a) && typeof a === 'object' && !Array.isArray(a);
  if (rotate) fx.csrf = `tok${++fx.tok}`;
  const out = rotate ? { ...(a as object), nsteptoken: fx.csrf } : a;
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(out) });
}

const sent = (key: string, i = -1) => {
  const all = fx.posts[key] ?? [];
  return Object.fromEntries(new URLSearchParams(all.at(i) ?? ''));
};
const field = (w: cf.CaseFilingWizard, key: string) => w.tabs.find((t) => t.key === w.tab)!.sections!.flatMap((s) => s.fields).find((f) => f.key === key);
const tabOf = (w: cf.CaseFilingWizard, key: cf.CaseFilingTabKey) => w.tabs.find((t) => t.key === key)!;
let sessionId = '';

beforeAll(async () => {
  live.__testing.setContextHook(async (context: BrowserContext) => { await context.route(`${ORIGIN}/**`, serve); });
  ({ sessionId } = await live.startEfilingSession(USER, '4', 'advocate'));
  await live.submitEfilingCredentials(sessionId, USER, 'adv@example.com', 'Secret@123');
  const r = await live.submitEfilingLoginCaptcha(sessionId, USER, fx.lastCode);
  expect(r).toEqual({ status: 'authenticated' });
  live.__testing.pageOf(sessionId)!.on('dialog', (d) => { fx.dialogs.push(d.message()); });
});

afterAll(async () => {
  live.__testing.setContextHook(null);
  if (sessionId) await live.endEfilingSession(sessionId, USER).catch(() => {});
});

describe('Case Filing > New Case Filing (fixture PDE wizard)', () => {
  it('opens the screen from the portal menu and shows its tabs and Initial Inputs fields as the page has them', async () => {
    const { wizard: w } = await cf.openCaseFilingWizard(sessionId, USER, { fresh: true });
    expect(w.pdeNo).toBeNull();
    expect(w.tab).toBe('initial');
    expect(w.tabs.filter((t) => t.present && t.shown).map((t) => [t.key, t.label, t.enabled])).toEqual([
      ['initial', 'New Case', true], ['litigant', 'Litigant', false], ['facts', 'Fact Details', false], ['case_details', 'Case Details', false], ['efile', 'eFile', false],
    ]);
    // Legal Heir and MACT exist on the page but stay hidden until the portal shows them.
    expect(tabOf(w, 'mvc')).toMatchObject({ present: true, shown: false, label: 'MACT' });
    expect(tabOf(w, 'legal_heir')).toMatchObject({ present: true, shown: false });
    const initial = tabOf(w, 'initial');
    expect(initial.sections!.map((s) => s.title)).toEqual(['Initial Inputs', 'Party Details']);
    expect(initial.sections!.flatMap((s) => s.fields).map((f) => [f.key, f.label, f.kind, f.required, f.live])).toEqual([
      ['#selDistrict', 'Select District', 'select', true, true],
      ['#selEstablishment', 'Select Establishment', 'select', true, false],
      ['radio:fcasetype', 'Case Types', 'radio', true, true],
      ['#selMainCaseType', 'Relief Sought', 'select', true, true],
      ['#selCaseType', 'Case Type', 'select', true, true],
      ['#fparty_name', 'Plaintiff', 'text', true, false],
      ['#fparty_mobile', 'Mobile Number', 'text', true, false],
    ]);
    expect(field(w, 'radio:fcasetype')!.options).toEqual([{ value: '1', text: 'Civil' }, { value: '2', text: 'Criminal' }]);
    expect(field(w, '#fparty_mobile')!.maxLength).toBe(10);
    expect(initial.buttons).toEqual([{ key: '#btnAddSave', text: 'Save', fn: 'insertNewPDE', kind: 'save', disabled: false }]);
  });

  it('runs the portal\'s cascades one field at a time: District -> Establishment, Civil -> Relief Sought -> Case Type -> party label', async () => {
    let r = await cf.setCaseFilingFields(sessionId, USER, { tab: 'initial', values: [{ key: '#selDistrict', value: '6' }] });
    expect(field(r.wizard, '#selEstablishment')!.options!.map((o) => o.text)).toEqual(['Select', 'Sub Court, Mavelikkara', 'Munsiff Court, Chengannur']);
    expect(sent('getDistrictEstablishmentByJSON')).toMatchObject({ fdistCode: '6', selState: '4', ajax_req: 'true' });
    r = await cf.setCaseFilingFields(sessionId, USER, {
      tab: 'initial',
      values: [{ key: '#selEstablishment', value: '4~6~17' }, { key: 'radio:fcasetype', value: '1' }, { key: '#selMainCaseType', value: '20' }, { key: '#selCaseType', value: '31' }],
    });
    expect(r.notApplied).toEqual([]);
    expect(sent('get_MainCaseType_data')).toMatchObject({ case_type: '1' });
    expect(sent('getSubCaseType')).toMatchObject({ selMainCaseType: '20', civ_cri: '1' });
    expect(sent('getPartyLabel')).toMatchObject({ case_type: '31' });
    expect(field(r.wizard, '#selCaseType')!.value).toBe('31');
    expect(field(r.wizard, '#fparty_name')!.label).toBe('Petitioner/Respondent');
    // A choice the portal doesn't offer is not forced in.
    const bad = await cf.setCaseFilingFields(sessionId, USER, { tab: 'initial', values: [{ key: '#selDistrict', value: '99' }] });
    expect(bad.notApplied).toEqual([{ key: '#selDistrict', reason: 'not a choice the portal offers' }]);
  });

  it('Save with a required field empty: nothing is sent, the portal\'s own message shows under the field', async () => {
    const r = await cf.saveCaseFilingTab(sessionId, USER, { tab: 'initial', values: [{ key: '#fparty_mobile', value: '9876543210' }] });
    expect(r.ok).toBe(false);
    expect(fx.posts['insertNewPDE']).toBeUndefined();
    expect(field(r.wizard, '#fparty_name')!.error).toBe('This field is required.');
    expect(r.portal).toContain('The portal did not save - see the marked fields.');
  });

  it('Save Initial Inputs: insertNewPDE gives the temporary e-filing number and the portal moves to Litigant', async () => {
    const r = await cf.saveCaseFilingTab(sessionId, USER, { tab: 'initial', values: [{ key: '#fparty_name', value: 'Ramesh Kumar' }, { key: '#fparty_mobile', value: '9876543210' }] });
    expect(r.ok).toBe(true);
    expect(r.wizard.pdeNo).toBe(PDE);
    expect(sent('insertNewPDE')).toMatchObject({
      selMainPlaintiff: '', selDistrict: '6', selEstablishment: '4~6~17', fcasetype: '1', selMainCaseType: '20', selCaseType: '31', fparty_name: 'Ramesh Kumar', fparty_mobile: '9876543210',
    });
    expect(r.wizard.tab).toBe('litigant');
    expect(tabOf(r.wizard, 'litigant')).toMatchObject({ enabled: true, active: true });
    expect(tabOf(r.wizard, 'mvc')).toMatchObject({ shown: true, enabled: false });
    // The page carries the main party over into the Litigant form.
    expect(field(r.wizard, '#fextra_name')!.value).toBe('Ramesh Kumar');
    expect(field(r.wizard, 'radio:ftype')!.options).toEqual([{ value: '1', text: 'Petitioner' }, { value: '2', text: 'Respondent', disabled: true }]);
    // Hidden "other info" stays hidden, as on the portal.
    expect(field(r.wizard, '#fpassportno')).toBeUndefined();
  });

  it('a tab the portal keeps switched off does not open', async () => {
    const r = await cf.showCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'facts' });
    expect(r.ok).toBe(false);
    expect(r.portal).toContain('The portal opens "Fact Details" after the earlier tabs are saved.');
  });

  it('Litigant: saves parties (State -> District -> Taluka cascade), lists them with Edit / Delete', async () => {
    let r = await cf.setCaseFilingFields(sessionId, USER, { pdeNo: PDE, tab: 'litigant', values: [{ key: '#fstate_code_extra_off', value: '4' }] });
    expect(field(r.wizard, '#fdist_code_extra_off')!.options!.map((o) => o.value)).toEqual(['', '4~6~506']);
    r = await cf.setCaseFilingFields(sessionId, USER, { pdeNo: PDE, tab: 'litigant', values: [{ key: '#fdist_code_extra_off', value: '4~6~506' }] });
    expect(sent('getEstTownTaluka')).toMatchObject({ state_code: '4', dist_code: '6', distNationalCode: '506' });
    r = await cf.saveCaseFilingTab(sessionId, USER, {
      pdeNo: PDE, tab: 'litigant',
      values: [{ key: 'radio:fextra_sex', value: '1' }, { key: '#fextra_age', value: '52' }, { key: '#fextraadd', value: 'MC Road, Chengannur' }, { key: '#ftaluka_code_extra_off', value: '4~61~5061' }],
    });
    expect(r.ok).toBe(true);
    expect(sent('insertPartyInformationTab')).toMatchObject({ adv_pde_no: PDE, ftype: '1', fextra_name: 'Ramesh Kumar', fextra_sex: '1', fextra_age: '52', fextraadd: 'MC Road, Chengannur', fstate_code_extra_off: '4', ftaluka_code_extra_off: '4~61~5061' });
    r = await cf.saveCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'litigant', values: [{ key: 'radio:ftype', value: '2' }, { key: '#fextra_name', value: 'Suresh Babu' }, { key: '#fextraadd', value: 'Kallissery' }] });
    r = await cf.saveCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'litigant', values: [{ key: 'radio:ftype', value: '2' }, { key: '#fextra_name', value: 'National Insurance Co.' }, { key: '#fextraorg_check', value: true }, { key: '#fextraadd', value: 'Kochi' }] });
    expect(sent('insertPartyInformationTab')).toMatchObject({ ftype: '2', fextra_name: 'National Insurance Co.', fextraorg_check: 'Y' });
    const list = tabOf(r.wizard, 'litigant').lists!;
    expect(list.map((l) => [l.key, l.title, l.total])).toEqual([['parties', 'Parties', 3]]);
    expect(list[0]!.table.headers).toEqual(['Sr No', 'Party Name', 'Party Type', 'Action']);
    expect(list[0]!.table.rows[2]).toEqual({
      // The Action column holds only icons: an empty cell, its buttons named by their title / function.
      cells: ['3', 'National Insurance Co.', 'Respondent', ''],
      actions: [{ label: 'Edit', fn: 'editPDECaseParty', kind: 'edit', arg: '2~1', cell: 3 }, { label: 'Delete', fn: 'delPDECaseParty', kind: 'delete', arg: '2~1', cell: 3 }],
    });
    expect(r.wizard.caseTitle).toBe('Ramesh Kumar Vs Suresh Babu');
    expect(tabOf(r.wizard, 'facts').enabled).toBe(true);
    expect(fx.csrfBad).toEqual([]);
  });

  it('a party\'s Edit loads it into the form; Delete only with confirmation, then the portal\'s confirm is accepted', async () => {
    let r = await cf.caseFilingPartyAction(sessionId, USER, { pdeNo: PDE, list: 'parties', match: ['1', 'Ramesh Kumar'], action: 'Edit' });
    expect(sent('fetchPartyData')).toMatchObject({ sel_party_name: '1~0' });
    expect(field(r.wizard, '#fextra_age')!.value).toBe('52');
    expect(field(r.wizard, 'radio:fextra_sex')!.value).toBe('1');
    await expect(cf.caseFilingPartyAction(sessionId, USER, { pdeNo: PDE, list: 'parties', match: ['3', 'National Insurance Co.'], action: 'Delete' })).rejects.toThrow(/Confirm "Delete"/);
    expect(fx.posts['delPDECaseParty']).toBeUndefined();
    r = await cf.caseFilingPartyAction(sessionId, USER, { pdeNo: PDE, list: 'parties', match: ['3', 'National Insurance Co.'], action: 'Delete', confirmed: true });
    expect(sent('delPDECaseParty')).toMatchObject({ party_type: '2', party_no: '1', fpde_no: PDE });
    expect(fx.dialogs).toContain('Want to delete?');
    expect(tabOf(r.wizard, 'litigant').lists![0]!.table.rows).toHaveLength(2);
  });

  it('Fact Details: the portal\'s Add More gives a new row; each row\'s date, time and fact are saved', async () => {
    await cf.showCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'facts' });
    let r = await cf.openCaseFilingWizard(sessionId, USER, { pdeNo: PDE, tab: 'facts' });
    const add = tabOf(r.wizard, 'facts').buttons!.find((b) => b.text === 'Add More')!;
    expect(add).toMatchObject({ fn: 'add_more_fact', kind: 'action' });
    r = await cf.pressCaseFilingButton(sessionId, USER, { pdeNo: PDE, tab: 'facts', key: add.key, text: add.text });
    expect(sent('getFactRow')).toMatchObject({ counter: '2' });
    const keys = tabOf(r.wizard, 'facts').sections!.flatMap((s) => s.fields).map((f) => [f.key, f.label, f.kind]);
    expect(keys).toEqual([
      ['#fact_date1', 'Date', 'date'], ['fact_time[]@0', 'Time', 'text'], ['fact[]@0', 'Fact', 'textarea'],
      ['#fact_date2', 'Date', 'date'], ['fact_time[]@1', 'Time', 'text'], ['fact[]@1', 'Fact', 'textarea'],
    ]);
    // "Remove" deletes a row: it needs confirmation.
    const remove = tabOf(r.wizard, 'facts').buttons!.find((b) => b.text === 'Remove')!;
    expect(remove.kind).toBe('delete');
    await expect(cf.pressCaseFilingButton(sessionId, USER, { pdeNo: PDE, tab: 'facts', key: remove.key, text: remove.text })).rejects.toThrow(/Confirm "Remove"/);
    r = await cf.saveCaseFilingTab(sessionId, USER, {
      pdeNo: PDE, tab: 'facts',
      values: [
        { key: '#fact_date1', value: '10-02-2026' }, { key: 'fact_time[]@0', value: '18:30' }, { key: 'fact[]@0', value: 'Lorry hit the petitioner.' },
        { key: '#fact_date2', value: '11-02-2026' }, { key: 'fact_time[]@1', value: '10:00' }, { key: 'fact[]@1', value: 'FIR registered.' },
      ],
    });
    expect(r.ok).toBe(true);
    expect(new URLSearchParams(fx.posts['insertFact']!.at(-1)).getAll('fact[]')).toEqual(['Lorry hit the petitioner.', 'FIR registered.']);
    expect(new URLSearchParams(fx.posts['insertFact']!.at(-1)).getAll('fact_date[]')).toEqual(['10-02-2026', '11-02-2026']);
  });

  it('Case Details: act and section from the portal\'s suggestions, More Acts..., Prayer, then Save moves on to MACT', async () => {
    await cf.showCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'case_details' });
    const s = await cf.suggestCaseFiling(sessionId, USER, { pdeNo: PDE, tab: 'case_details', key: '#fdispactcodes1', term: 'Motor' });
    expect(s.items).toEqual(['Motor Vehicles Act, 1988', 'Motor Transport Workers Act, 1961']);
    expect(sent('getActs')).toMatchObject({ term: 'Motor' });
    let r = await cf.pickCaseFilingSuggestion(sessionId, USER, { pdeNo: PDE, tab: 'case_details', key: '#fdispactcodes1', term: 'Motor', index: 0 });
    expect(field(r.wizard, '#fdispactcodes1')).toMatchObject({ value: 'Motor Vehicles Act, 1988', suggest: 'act', required: true });
    expect((await cf.suggestCaseFiling(sessionId, USER, { pdeNo: PDE, tab: 'case_details', key: '#factsection_code1', term: '166' })).items).toEqual(['166', '163A']);
    expect(sent('autocomplete_section')).toMatchObject({ term: '166', national_code: '1988059' });
    r = await cf.pickCaseFilingSuggestion(sessionId, USER, { pdeNo: PDE, tab: 'case_details', key: '#factsection_code1', term: '166', index: 0 });
    expect(sent('fetch_sectioncode')).toMatchObject({ label: '166', prevval: '166' });
    const more = tabOf(r.wizard, 'case_details').buttons!.find((b) => b.text === 'More Acts...')!;
    r = await cf.pressCaseFilingButton(sessionId, USER, { pdeNo: PDE, tab: 'case_details', key: more.key, text: more.text });
    expect(sent('fetchactsection')).toMatchObject({ no: '2' });
    expect(field(r.wizard, '#fdispactcodes2')).toMatchObject({ suggest: 'act' });
    const prayer = tabOf(r.wizard, 'case_details').buttons!.find((b) => b.text === 'Prayer')!;
    r = await cf.pressCaseFilingButton(sessionId, USER, { pdeNo: PDE, tab: 'case_details', key: prayer.key, text: prayer.text, values: [{ key: '#fprayercode_s', value: '3' }] });
    expect(sent('fetchPrayerDetails')).toMatchObject({ prayer_id: '3' });
    expect(field(r.wizard, '#frelief_offense')!.value).toBe('Award compensation with interest');
    r = await cf.saveCaseFilingTab(sessionId, USER, {
      pdeNo: PDE, tab: 'case_details',
      values: [{ key: '#fcauseofaction_ci', value: 'Accident on MC Road' }, { key: '#foffense_date', value: '10-02-2026' }, { key: '#famount', value: '500000' }],
    });
    expect(r.ok).toBe(true);
    expect(sent('insertCaseInfo')).toMatchObject({
      adv_pde_no: PDE, fcauseofaction_ci: 'Accident on MC Road', foffense_date: '10-02-2026', frelief_offense: 'Award compensation with interest', famount: '500000',
      fdispactcodes1: 'Motor Vehicles Act, 1988', fhiddactcodes1: '1988059', factcodes1: '59', factsection_code1: '166',
    });
    // The portal moves on to MACT by itself (macp == 'Y').
    expect(r.wizard.tab).toBe('mvc');
    expect(tabOf(r.wizard, 'mvc')).toMatchObject({ enabled: true, active: true });
  });

  it('MACT Victim Details (macp.js): shown for a MACT case type, saved by insertVictimInformationTab, then the portal moves to Litigant', async () => {
    let r = await cf.showCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'victim' });
    expect(r.ok).toBe(true);
    // In the page's own order: Victim Details sits before Litigant.
    expect(r.wizard.tabs.filter((t) => t.present && t.shown).map((t) => t.key).slice(0, 3)).toEqual(['initial', 'victim', 'litigant']);
    expect(tabOf(r.wizard, 'victim').sections!.flatMap((s) => s.fields).map((f) => [f.key, f.label, f.required])).toEqual([['#fvictim_name', 'Victim Name', true], ['radio:fclaim_type', 'Injury / Death', true]]);
    r = await cf.saveCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'victim', values: [{ key: '#fvictim_name', value: 'Ramesh Kumar' }, { key: 'radio:fclaim_type', value: '1' }] });
    expect(r.ok).toBe(true);
    expect(sent('insertVictimInformationTab')).toMatchObject({ fvictim_name: 'Ramesh Kumar', fclaim_type: '1' });
    expect(r.wizard.tab).toBe('litigant');
    await cf.showCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'mvc' });
  });

  it('MACT: saved, which opens e-File', async () => {
    const r = await cf.saveCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'mvc', values: [{ key: '#fitem_no', value: '12' }, { key: '#faccident_date', value: '10-02-2026' }, { key: '#faccident_place', value: 'MC Road' }] });
    expect(r.ok).toBe(true);
    expect(sent('insertMVC')).toMatchObject({ adv_pde_no: PDE, fitem_no: '12', faccident_place: 'MC Road' });
    expect(tabOf(r.wizard, 'efile').enabled).toBe(true);
  });

  it('e-File tab shows what each tab saved; "eFile Case" only with confirmation; a tab the portal rejects is reported', async () => {
    const { wizard } = await cf.openCaseFilingWizard(sessionId, USER, { pdeNo: PDE, tab: 'efile' });
    const ef = tabOf(wizard, 'efile');
    expect(ef.summary!.map((s) => s.title)).toEqual(['Litigant', 'Fact Details', 'Case Details', 'MVC']);
    expect(ef.summary![0]!.tables[0]).toEqual({ headers: ['Petitioner', 'Respondent'], rows: [{ cells: ['Ramesh Kumar', 'Suresh Babu, National Insurance Co.'] }] });
    expect(ef.buttons).toEqual([{ key: 'btn@0', text: 'eFile Case', fn: 'submitEfileData', kind: 'efile', disabled: false }]);
    await expect(cf.pressCaseFilingButton(sessionId, USER, { pdeNo: PDE, tab: 'efile', key: 'btn@0', text: 'eFile Case' })).rejects.toThrow(/Use "eFile Case"/);
    await expect(cf.efileCase(sessionId, USER, { pdeNo: PDE, confirmed: false })).rejects.toThrow(/Confirm "eFile Case"/);
    expect(fx.posts['submitEfileData']).toBeUndefined();
    // First try: the portal sends the case back to Case Details.
    let r = await cf.efileCase(sessionId, USER, { pdeNo: PDE, confirmed: true });
    expect(r).toMatchObject({ ok: false, errorTabs: ['case_details'] });
    expect(fx.dialogs).toContain('Do you want to submit the case? \n Once submitted, case details can not be modfied.');
    expect(tabOf(r.wizard!, 'case_details').error).toBe(true);
    r = await cf.efileCase(sessionId, USER, { pdeNo: PDE, confirmed: true });
    expect(r).toMatchObject({ ok: true, pdeNo: PDE, errorTabs: [] });
    expect(sent('submitEfileData').pde_no).toBe(PDE);
    expect(sent('submitEfileData').page_data).toContain('Ramesh Kumar');
    expect(fx.csrfBad).toEqual([]);
  });
});

describe('Case Filing > Draft Cases / eFiled Cases', () => {
  it('Draft Cases: the page\'s getUnRegisteredPDE(page, 10), grouped as its DataTables groups them, with each row\'s Edit / Delete / View', async () => {
    const l = await cf.readCaseFilingList(sessionId, USER, 'draft');
    expect(sent('getUnRegisteredPDE')).toMatchObject({ page: '1', limit: '10', txtAppSearch: '' });
    expect(l).toMatchObject({ list: 'draft', label: 'Draft Cases', error: null, page: 1, pages: 2, info: 'Showing page 1 of 2', headers: ['Sr No', 'eFiling No', 'Case Type', 'Petitioner Vs Respondent', 'Created On', 'Action'] });
    expect(l.rows).toEqual([
      { group: 'District Court' }, { group: 'Munsiff Court, Chengannur' },
      {
        cells: ['1', OLD_DRAFT, 'O.S.', 'Anil Kumar Vs Bindu', '01-11-2026', 'View'],
        actions: [
          { label: 'Edit', fn: 'fetchPDECaseData', kind: 'open', arg: OLD_DRAFT, cell: 5 },
          { label: 'Delete', fn: 'deletePDECase', kind: 'delete', arg: OLD_DRAFT, cell: 5 },
          { label: 'View', fn: 'generateCasePDF', kind: 'pdf', arg: OLD_DRAFT, cell: 5 },
        ],
      },
    ]);
  });

  it('pages and search go to the portal, as its pager and Search box do', async () => {
    const p2 = await cf.readCaseFilingList(sessionId, USER, 'draft', { page: 2 });
    expect(sent('getUnRegisteredPDE')).toMatchObject({ page: '2', limit: '10' });
    expect(p2.rows.filter((r) => 'cells' in r).map((r) => ('cells' in r ? r.cells[1] : ''))).toEqual([PAGE2_DRAFT]);
    const found = await cf.readCaseFilingList(sessionId, USER, 'draft', { search: 'Bindu' });
    expect(sent('getUnRegisteredPDE')).toMatchObject({ page: '1', txtAppSearch: 'Bindu' });
    expect(found.search).toBe('Bindu');
  });

  it('Edit opens the draft in the wizard (fetchPDECaseData)', async () => {
    const r = await cf.caseFilingListAction(sessionId, USER, { list: 'draft', match: ['1', OLD_DRAFT], action: 'Edit' });
    expect(r.kind).toBe('open');
    expect(r.ok).toBe(true);
    expect(sent('fetchPDECaseData')).toMatchObject({ hid_case_adv_pde: OLD_DRAFT, hid_case_adv_flag: '0' });
    expect(r.wizard).toMatchObject({ screen: 'new_case', pdeNo: OLD_DRAFT, caseTitle: 'Anil Kumar Vs Bindu', mode: 'edit', tab: 'litigant' });
    expect(tabOf(r.wizard!, 'efile').enabled).toBe(false);
  });

  it('a step for another draft re-opens that draft first', async () => {
    fx.drafts.set(PDE, { title: 'Ramesh Kumar Vs Suresh Babu', type: 'M.A.C.T. O.P.' });
    const before = fx.posts['fetchPDECaseData']!.length;
    const r = await cf.showCaseFilingTab(sessionId, USER, { pdeNo: PDE, tab: 'litigant' });
    expect(fx.posts['fetchPDECaseData']!.length).toBe(before + 1);
    expect(sent('fetchPDECaseData').hid_case_adv_pde).toBe(PDE);
    expect(r.wizard.pdeNo).toBe(PDE);
  });

  it('View gives the case PDF the portal makes (generateCasePDF)', async () => {
    const r = await cf.caseFilingListAction(sessionId, USER, { list: 'draft', match: ['1', OLD_DRAFT], action: 'View' });
    expect(r).toMatchObject({ kind: 'pdf', pdeNo: OLD_DRAFT });
    const f = await cf.caseFilingPdf(sessionId, USER, OLD_DRAFT);
    expect(sent('generateCasePDF')).toMatchObject({ sel_pde: OLD_DRAFT });
    expect(f.contentType).toBe('application/pdf');
    expect(f.body.toString('latin1')).toContain(`case /pdedev/temp/${OLD_DRAFT}.pdf`);
  });

  it('Delete only with confirmation; then deletePDECase and the refreshed list', async () => {
    await expect(cf.caseFilingListAction(sessionId, USER, { list: 'draft', match: ['1', OLD_DRAFT], action: 'Delete' })).rejects.toThrow(/Confirm "Delete"/);
    expect(fx.posts['deletePDECase']).toBeUndefined();
    const r = await cf.caseFilingListAction(sessionId, USER, { list: 'draft', match: ['1', OLD_DRAFT], action: 'Delete', confirmed: true });
    expect(r).toMatchObject({ kind: 'delete', ok: true });
    expect(sent('deletePDECase')).toMatchObject({ fpde_no: OLD_DRAFT });
    expect(r.list!.rows.filter((x) => 'cells' in x).map((x) => ('cells' in x ? x.cells[1] : ''))).toEqual([PDE]);
  });

  it('eFiled Cases: getSubmittedNewCases(page, 10) grouped by establishment and case type, and a row\'s View Status', async () => {
    const l = await cf.readCaseFilingList(sessionId, USER, 'filed');
    expect(sent('getSubmittedPDE')).toMatchObject({ page: '1', limit: '10', txtAppSearch: '' });
    expect(l).toMatchObject({ label: 'eFiled Cases', total: 1, pages: 1, headers: ['Sr No', 'eFiling No', 'Petitioner Vs Respondent', 'Filed On', 'Status'] });
    expect(l.rows).toEqual([
      { group: 'Munsiff Court, Chengannur' }, { group: 'O.S.' },
      { cells: ['1', FILED, 'Anil Vs State', '01-10-2026', 'View Status'], actions: [{ label: 'View Status', fn: 'getStatus', kind: 'status', arg: 'KLAL17', cell: 4 }] },
    ]);
    const r = await cf.caseFilingListAction(sessionId, USER, { list: 'filed', match: ['1', FILED], action: 'View Status' });
    expect(r).toMatchObject({ kind: 'status', ok: true, text: 'Still case is not consumed in CIS' });
    expect(sent('getStatus')).toMatchObject({ est_code: 'KLAL17', pde_no: FILED });
  });
});

describe('Case Filing > Manage Favourite Clients (favourite_client.js)', () => {
  it('opens from the portal menu: its Client and Organization forms as the page has them', async () => {
    const { wizard: w } = await cf.openCaseFilingWizard(sessionId, USER, { screen: 'clients' });
    expect(w.screen).toBe('clients');
    expect(w.tab).toBe('client');
    expect(w.tabs.map((t) => [t.key, t.label, t.present, t.enabled])).toEqual([['client', 'Add Client', true, true], ['organisation', 'Add Organization', true, true]]);
    const c = tabOf(w, 'client');
    expect(c.sections!.map((s) => s.title)).toEqual(['Add Client']);
    expect(c.sections![0]!.fields.map((f) => [f.key, f.label, f.required])).toEqual([['#fextra_name', 'Name', true], ['#fmobile', 'Mobile No.', true], ['#fextraadd', 'Address', true], ['#fphone', 'Phone', false]]);
    expect(c.buttons!.map((b) => [b.text, b.fn, b.kind])).toEqual([['Save', 'insertClientInformationTab', 'save'], ['Cancel', 'cancelAddNewParty', 'action']]);
  });

  it('Save a client: insertFavouriteParty; a missing field shows the portal\'s message', async () => {
    let r = await cf.saveCaseFilingTab(sessionId, USER, { screen: 'clients', tab: 'client', values: [{ key: '#fextra_name', value: 'Suresh Babu' }] });
    expect(r.ok).toBe(false);
    expect(tabOf(r.wizard, 'client').sections![0]!.fields.find((f) => f.key === '#fmobile')!.error).toBe('This field is required.');
    r = await cf.saveCaseFilingTab(sessionId, USER, { screen: 'clients', tab: 'client', values: [{ key: '#fmobile', value: '9000000001' }, { key: '#fextraadd', value: 'Kallissery' }] });
    expect(r.ok).toBe(true);
    expect(sent('insertFavouriteParty')).toMatchObject({ duplicate_client_flag: 'N', fextra_name: 'Suresh Babu', fmobile: '9000000001', fextraadd: 'Kallissery', form_action_client: '1' });
  });

  it('Organization: Organization Type -> Ministry -> Department cascade, then insertOrgInformationTab', async () => {
    await cf.showCaseFilingTab(sessionId, USER, { screen: 'clients', tab: 'organisation' });
    let r = await cf.setCaseFilingFields(sessionId, USER, { screen: 'clients', tab: 'organisation', values: [{ key: '#extraporg_name', value: '1' }, { key: '#selMinistry', value: '11' }] });
    expect(sent('getMinistry')).toMatchObject({ org_type: '1' });
    expect(sent('getDepartment')).toMatchObject({ org_type: '1', sel_ministry: '11' });
    expect(tabOf(r.wizard, 'organisation').sections![0]!.fields.find((f) => f.key === '#selDepartment')!.options!.map((o) => o.text)).toEqual(['Select', 'National Highways Authority']);
    r = await cf.saveCaseFilingTab(sessionId, USER, { screen: 'clients', tab: 'organisation', values: [{ key: '#selDepartment', value: '21' }] });
    expect(r.ok).toBe(true);
    expect(sent('insertOrgInformationTab')).toMatchObject({ dept_name: 'National Highways Authority', extraporg_name: '1', selMinistry: '11', selDepartment: '21' });
  });

  it('the client list (favourite_client_list), a client\'s cases, Edit into the form, Delete only with confirmation', async () => {
    const l = await cf.readCaseFilingList(sessionId, USER, 'clients');
    expect(l).toMatchObject({ label: 'Favourite Clients', total: 3, headers: ['Sr No', 'Client Name', 'Mobile No', 'Cases', 'Action'] });
    expect(l.rows[2]).toEqual({
      cells: ['3', 'Suresh Babu', '9000000001', 'View Cases', ''],
      actions: [{ label: 'View Cases', fn: 'getClientCases', kind: 'other', arg: '3', cell: 3 }, { label: 'Edit', fn: 'fetchFavClient', kind: 'edit', arg: '3', cell: 4 }, { label: 'Delete', fn: 'deleteFavClient', kind: 'delete', arg: '3', cell: 4 }],
    });
    const cases = await cf.caseFilingListAction(sessionId, USER, { list: 'clients', match: ['1', 'Ramesh Kumar'], action: 'View Cases' });
    expect(sent('getClientCases')).toMatchObject({ uid: '1', type: 'client' });
    expect(cases.tables).toEqual([{ headers: ['Sr No', 'Case'], rows: [{ cells: ['1', PDE] }] }]);
    const ed = await cf.caseFilingListAction(sessionId, USER, { list: 'clients', match: ['3', 'Suresh Babu'], action: 'Edit' });
    expect(ed.kind).toBe('edit');
    expect(ed.wizard).toMatchObject({ screen: 'clients', tab: 'client' });
    expect(tabOf(ed.wizard!, 'client')).toMatchObject({ label: 'Update Client' });
    expect(tabOf(ed.wizard!, 'client').sections![0]!.fields.find((f) => f.key === '#fextra_name')!.value).toBe('Suresh Babu');
    await expect(cf.caseFilingListAction(sessionId, USER, { list: 'clients', match: ['3', 'Suresh Babu'], action: 'Delete' })).rejects.toThrow(/Confirm "Delete"/);
    const del = await cf.caseFilingListAction(sessionId, USER, { list: 'clients', match: ['3', 'Suresh Babu'], action: 'Delete', confirmed: true });
    expect(sent('deleteFavClient')).toMatchObject({ client_id: '3' });
    expect(del.list!.rows).toHaveLength(2);
    expect(fx.csrfBad).toEqual([]);
  });

  it('going back to New Case Filing opens it from the menu again', async () => {
    const { wizard } = await cf.openCaseFilingWizard(sessionId, USER, {});
    expect(wizard.screen).toBe('new_case');
    expect(wizard.tabs.some((t) => t.key === 'initial' && t.present)).toBe(true);
  });
});
