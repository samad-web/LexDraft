/**
 * New Case Filing on the portal, against a fixture that behaves like
 * filing.ecourts.gov.in's PDE wizard (litigant.js: element ids, cascades and
 * its insertNewPDE / insertPartyInformationTab / insertFactTab /
 * insertCaseInfo / insertMVC / submitEfileData functions - see
 * docs/efiling-portal-reverse-engineering.md §2). The real DifAi service fills
 * it from a prepared filing; the fixture records what each tab submitted.
 * No live portal, no account, no DB (the filing data is a fixed sample).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Route } from 'playwright';

const FILING_ID = '11111111-1111-4111-8111-111111111111';
const CASE_ID = '22222222-2222-4222-8222-222222222222';

const h = vi.hoisted(() => ({ transitions: [] as unknown[], updates: [] as unknown[], efilingNo: null as string | null }));

vi.mock('../src/services/efiling-filings.service', () => ({
  efilingFilingsService: {
    get: async () => ({
      id: FILING_ID, caseId: CASE_ID, kind: 'new_case', status: h.efilingNo ? 'efiled' : 'ready', efilingNo: h.efilingNo, title: 'Ramesh Kumar v. Suresh Babu (MACT)',
      payments: [{ id: 'pay1', purpose: 'court_fee', amountInr: 4320, grn: 'KL26GRN00012345', paidOn: '2026-10-21', payerName: null, mode: 'epay', createdAt: '' }],
    }),
    update: async (_id: string, _f: string, _u: string, patch: unknown) => { h.updates.push(patch); return {}; },
    transition: async (_id: string, _f: string, _u: string, input: { efilingNo?: string }) => { h.transitions.push(input); if (input.efilingNo) h.efilingNo = input.efilingNo; return {}; },
  },
}));

vi.mock('../src/services/efiling-bundle.service', () => ({
  efilingBundleService: { download: async () => ({ body: Buffer.from('%PDF-1.4\n% DifAi bundle\n%%EOF'), filename: 'bundle.pdf' }) },
}));

vi.mock('../src/services/efiling-particulars.service', () => ({
  efilingParticularsService: {
    get: async () => ({
      particulars: {
        caseId: CASE_ID, courtTier: 'DC', stateCode: 4, districtCode: 6, courtCode: 17, estCode: 'KLAL17', courtComplexCode: null,
        establishmentName: 'Munsiff Court, Chengannur', caseTypeCode: '31', caseTypeName: 'M.A.C.T. O.P.', isUrgent: false,
        hcSide: 'civil', hcMatterType: null, hcBench: null,
        causeOfAction: 'Accident on MC Road', causeOfActionDate: '2026-02-10', disputePlace: null, subject: 'Motor accident claim',
        prayer: 'Award Rs. 5,00,000 as compensation', reliefParticulars: null, valuationInr: 500000, claimAmountInr: null,
        acts: [{ act: 'Motor Vehicles Act, 1988', section: '166' }], hideParty: false, hidePartyReason: null, localLanguage: null, plaintLocal: null,
        mact: { itemNo: '12', accidentDate: '2026-02-10', accidentTime: '18:30', accidentPlace: 'MC Road, Chengannur', injuryType: 'serious', injuredName: 'Ramesh Kumar', policeStation: 'Chengannur PS', firType: 'FIR', firNo: '231', firYear: 2026, vehicleType: 'Lorry', vehicleRegNo: 'KL-30-A-1234', drivingLicenceNo: 'KL3020150001234', licenceIssuingAuthority: 'RTO Chengannur', insurer: 'National Insurance Co.', compensationClaimedInr: 500000 },
        extra: { reliefSought: 'Compensation' }, updatedAt: null,
      },
      parties: [
        { id: 'p1', caseId: CASE_ID, side: 'petitioner', position: 0, isClient: true, isOrganization: false, name: 'Ramesh Kumar', relationType: 'S/o', relationName: 'Krishnan', gender: 'M', age: 52, dateOfBirth: null, occupation: 'Business', address: 'MC Road, Chengannur', district: null, state: null, pinCode: '689121', mobile: '9876543210', email: 'ramesh@example.com', isMinor: false, guardianName: null, orgRepresentative: null, legalHeirOf: null, nameLocal: null, addressLocal: null, extra: {} },
        { id: 'p2', caseId: CASE_ID, side: 'respondent', position: 0, isClient: false, isOrganization: false, name: 'Suresh Babu', relationType: null, relationName: null, gender: 'M', age: 47, dateOfBirth: null, occupation: null, address: 'Kallissery, Chengannur', district: null, state: null, pinCode: null, mobile: null, email: null, isMinor: false, guardianName: null, orgRepresentative: null, legalHeirOf: null, nameLocal: null, addressLocal: null, extra: {} },
      ],
      facts: [
        { id: 'f1', caseId: CASE_ID, position: 0, factDate: '2026-02-10', factTime: '18:30', description: 'Lorry hit the petitioner.' },
        { id: 'f2', caseId: CASE_ID, position: 1, factDate: '2026-02-11', factTime: null, description: 'FIR registered.' },
      ],
    }),
  },
}));

const live = await import('../src/services/efiling-live.service');
const filing = await import('../src/services/efiling-portal-filing.service');

const USER = 'portal-newcase-user';
const ORIGIN = 'https://filing.ecourts.gov.in';
const fx = { lastCode: '', n: 0, posts: {} as Record<string, string[]>, upload: null as null | { title: string; pdf: boolean; pde: string } };

const loginPage = `<!doctype html><html><body><form id="frm_login">
<select id="selState"><option value="4">Kerala</option></select><input type="radio" id="user_advocate" name="rdoUser">
<input id="user_name"><input type="password" id="user_password"><img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a" width="150" height="50">
<input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="go()">Login</button>
<div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div></form>
<script>function go(){var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=login/verify_login/');x.onload=function(){var o=JSON.parse(x.responseText);location.href=o.redirect_path;};x.send('fcaptcha_code='+document.getElementById('fcaptcha_code_mobile').value);}</script>
</body></html>`;

// Dashboard: the Draft Pleadings tile lists rows with a GRN select and a
// Submit that calls dashboard.js's submit_pleading(unique_id, type, efiling_no).
const dashboard = `<!doctype html><html><body><h3>Dashboard</h3><a href="${ORIGIN}/pdedev/?p=newcase">New Case Filing</a>
<a href="#" id="efiling_activity">Draft Pleadings</a><div id="db_screen"><div id="history_body"></div></div>
<script>
  function q(s){return document.querySelector(s);}
  q('#efiling_activity').addEventListener('click',function(e){e.preventDefault();var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=dashboard/fetchActivities');x.onload=function(){q('#history_body').innerHTML=JSON.parse(x.responseText).submitted_pde_list;};x.send('');});
  function submit_pleading(uid,type,no){var grn=document.getElementById(uid).value;if(grn==''&&!confirm('You have not selected GRN ... submit case without court fee..?'))return false;var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=Dashboard/submit_pleading/');x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');x.send('unique_id='+uid+'&type_of_case='+type+'&grn='+encodeURIComponent(grn)+'&efiling_number='+no);}
</script></body></html>`;

// The PDE wizard: labels as on the portal, ids as litigant.js uses them.
const newCase = `<!doctype html><html><body>
<input type="hidden" id="adv_pde_no" value="">
<form id="frmInitialInput1">
  <label for="selDistrict">* Select District</label><select id="selDistrict" name="dist"><option value="">Select District</option><option value="4~6~506">Alappuzha</option></select>
  <label for="selEstablishment">* Select Establishment</label><select id="selEstablishment" name="est"><option value="">Select an Option</option></select>
  <label><input type="radio" class="rdoCivCrim" name="fcasetype" value="1">Civil</label><label><input type="radio" class="rdoCivCrim" name="fcasetype" value="2">Criminal</label>
  <label for="selMainCaseType">* Relief Sought</label><select id="selMainCaseType" name="main"><option value="">Select Case</option></select>
  <label for="selCaseType">* Case Type</label><select id="selCaseType" name="ctype"><option value="">Select an Option</option></select>
</form>
<form id="frmInitialInput2"><div class="form-group"><label>* Plaintiff</label><input name="plaintiff"></div><div class="form-group"><label>* Mobile Number</label><input name="mobile"></div></form>
<a href="${ORIGIN}/pdedev/?p=pleadings">Pleadings</a>
<a id="litigant_tab" href="#tab1" class="disabled">Litigant</a><a id="fact_tab" class="disabled">Fact Details</a><a id="case_detail_tab" class="disabled">Case Details</a><a id="mvc_tab" class="disabled">MVC</a><a id="eFile_tab" class="disabled">e-File</a>
<div id="dropdown_content10"></div>
<form id="frmAdvParty">
  <label><input type="radio" name="ptype" value="1">Petitioner</label><label><input type="radio" name="ptype" value="2">Respondent</label>
  <div class="form-group"><label>* Complainant/Accused</label><input name="pname"></div>
  <div class="form-group"><label>Relation</label><select name="rel"><option value="">Select</option><option value="S/o">S/o</option><option value="D/o">D/o</option></select></div>
  <div class="form-group"><label>Father/Mother/Husband Name</label><input name="rname"></div>
  <label><input type="radio" name="sex" value="M">Male</label><label><input type="radio" name="sex" value="F">Female</label><label><input type="radio" name="sex" value="T">Other</label>
  <div class="form-group"><label>* Age</label><input name="age"></div>
  <div class="form-group"><label>Email</label><input name="email"></div>
  <div class="form-group"><label>Mobile No.</label><input name="pmobile"></div>
  <div class="form-group"><label>Occupation</label><input name="occ"></div>
  <div class="form-group"><label>* Address</label><textarea name="addr"></textarea></div>
  <div class="form-group"><label>Pin Code</label><input name="pin"></div>
</form>
<form id="frmAdvFact"><div class="factrow"><input class="csFactDate" name="fact_date1"><input class="csFactTime" name="fact_time1"><textarea class="csFact" name="fact1"></textarea></div></form>
<form id="frmAdvCaseDetail">
  <div class="form-group"><label>* Cause of Action</label><textarea name="coa"></textarea></div>
  <div class="form-group"><label>* Date of Cause of Action</label><input name="coad"></div>
  <div class="form-group"><label>Important Information or Subject or Reason</label><input name="subj"></div>
  <div class="form-group"><label>Prayer</label><textarea id="frelief_offense" name="prayer"></textarea></div>
  <div class="form-group"><label>Valuation [&#8377;]</label><input name="val"></div>
  <div id="act_section"><input type="text" id="fdispact1" name="act1" placeholder="Act"><input type="text" id="fdispsection1" name="section1" placeholder="Section"></div>
</form>
<form id="frmAdvMVC">
  <div class="form-group"><label>Item Number</label><input name="item"></div>
  <div class="form-group"><label>* Police Station</label><select name="ps"><option value="">Select Police Station</option><option value="77">Chengannur PS</option></select></div>
  <div class="form-group"><label>FIR Type</label><select name="firtype"><option value="">Select</option><option value="1">FIR</option></select></div>
  <div class="form-group"><label>* FIR Number</label><input name="firno"></div>
  <div class="form-group"><label>* Year</label><input name="firyear"></div>
  <div class="form-group"><label>* Date of Accident</label><input name="accdate"></div>
  <div class="form-group"><label>Time of Accident</label><input name="acctime"></div>
  <div class="form-group"><label>* Place of Accident</label><input name="accplace"></div>
  <label><input type="radio" name="inj" value="1">Simple</label><label><input type="radio" name="inj" value="2">Serious</label>
  <div class="form-group"><label>Name</label><input name="injname"></div>
  <div class="form-group"><label>Compensation Claimed</label><input name="comp"></div>
  <div class="form-group"><label>Insurance Company</label><input name="ins"></div>
  <div class="form-group"><label>Vehicle Type</label><input name="vtype"></div>
  <div class="form-group"><label>Vehicle Regn. No.</label><input name="vreg"></div>
  <div class="form-group"><label>Driving License</label><input name="dl"></div>
  <div class="form-group"><label>Issuing Authority</label><input name="ia"></div>
</form>
<script>
  function q(s){return document.querySelector(s);}
  function ser(f){return new URLSearchParams(new FormData(q(f))).toString();}
  function post(route, body, cb){var x=new XMLHttpRequest();x.open('POST','/pdedev/?p='+route);x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');x.onload=function(){cb&&cb(JSON.parse(x.responseText));};x.send(body);}
  function opts(sel, list){q(sel).innerHTML='<option value="">Select</option>'+list.map(function(o){return '<option value="'+o[0]+'">'+o[1]+'</option>';}).join('');}
  q('#selDistrict').addEventListener('change',function(){setTimeout(function(){opts('#selEstablishment',[['4~6~KLAL16','Sub Court, Mavelikkara'],['4~6~KLAL17','Munsiff Court, Chengannur']]);},200);});
  document.querySelectorAll('.rdoCivCrim').forEach(function(r){r.addEventListener('change',function(){setTimeout(function(){opts('#selMainCaseType',[['10','Suit'],['20','Compensation']]);q('#selCaseType').innerHTML='<option value="">Select an Option</option>';},200);});});
  q('#selMainCaseType').addEventListener('change',function(){setTimeout(function(){opts('#selCaseType',[['7','O.S. - Original Suit'],['31','MACT OP - Motor Accident Claims']]);},200);});
  function insertNewPDE(){post('advocate_case_registration/insertNewPDE/', ser('#frmInitialInput1')+'&'+ser('#frmInitialInput2'), function(o){q('#adv_pde_no').value=o.pde_no;q('#dropdown_content10').innerHTML='<a href="#" onclick="editPDECaseParty(this);return false;">'+q('[name=plaintiff]').value+'</a>';});}
  function editPDECaseParty(el){post('advocate_case_registration/fetchPartyData/','sel_party_name=1',function(){document.querySelector('[name=ptype][value="1"]').checked=true;q('[name=pname]').value=el.textContent;});}
  function insertPartyInformationTab(){post('advocate_case_registration/insertPartyInformationTab/', 'adv_pde_no='+q('#adv_pde_no').value+'&'+ser('#frmAdvParty'), function(){q('#frmAdvParty').reset();});}
  function add_more_fact(){var n=document.querySelectorAll('.factrow').length+1;var d=document.createElement('div');d.className='factrow';d.innerHTML='<input class="csFactDate" name="fact_date'+n+'"><input class="csFactTime" name="fact_time'+n+'"><textarea class="csFact" name="fact'+n+'"></textarea>';q('#frmAdvFact').appendChild(d);}
  function insertFactTab(){post('advocate_case_registration/insertFact/', 'adv_pde_no='+q('#adv_pde_no').value+'&'+ser('#frmAdvFact'));}
  function insertCaseInfo(){post('advocate_case_registration/insertCaseInfo/', 'adv_pde_no='+q('#adv_pde_no').value+'&'+ser('#frmAdvCaseDetail'));}
  function insertMVC(){post('advocate_case_registration/insertMVC/', 'adv_pde_no='+q('#adv_pde_no').value+'&'+ser('#frmAdvMVC'));}
  function submitEfileData(){ if(!confirm('Do you want to submit the case?\\n Once submitted, case details can not be modfied.')) return; post('advocate_case_registration/submitEfileData/', 'pde_no='+q('#adv_pde_no').value); }
</script></body></html>`;

// Pleadings > Pleading Upload, with upload_pleading.js's ids and functions.
const pleadings = `<!doctype html><html><body>
<a href="${ORIGIN}/pdedev/?p=dashboard">Dashboard</a>
<label><input type="radio" name="cases" id="regis" value="1">Existing Case</label><label><input type="radio" name="cases" id="eFiled" value="3">eFiled Case</label>
<form id="frm_doc">
  <select id="sel_pde_no" name="sel_pde_no"><option value="">Select</option></select>
  <input id="file_name" name="file_name"><input type="file" id="doc_file_name" name="doc_file_name">
  <button type="button" id="add_btn">Add File</button>
  <div id="parties"></div>
</form>
<script>
  function q(s){return document.querySelector(s);}
  q('#eFiled').addEventListener('click',function(){setTimeout(function(){q('#sel_pde_no').innerHTML='<option value="">Select</option><option value="KL0601PDE2026000123">KL0601PDE2026000123 - Ramesh Kumar Vs Suresh Babu</option>';},200);});
  q('#sel_pde_no').addEventListener('change',function(){q('#parties').innerHTML='<label><input type="checkbox" name="chk_pet_list[]" value="1">Ramesh Kumar</label><label><input type="checkbox" name="chk_res_list[]" value="1">Suresh Babu</label>';});
  q('#add_btn').addEventListener('click',function(){var fd=new FormData(q('#frm_doc'));fd.append('file',q('#doc_file_name').files[0]);fd.append('ajax_req','true');var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=upload_pleading/addFile');x.send(fd);});
  function submitData(){var pet=[].slice.call(document.querySelectorAll('input[name="chk_pet_list[]"]:checked')).map(function(c){return c.parentNode.textContent;}).join('#');var b=new URLSearchParams();b.set('sel_pde_no',q('#sel_pde_no').value);b.set('file_name',q('#file_name').value);b.set('pet_res_name',pet);var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=upload_pleading/addData');x.setRequestHeader('Content-Type','application/x-www-form-urlencoded');x.send(b.toString());}
</script></body></html>`;

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('securimage_show.php')) {
    fx.lastCode = `C${++fx.n}`;
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="10" y="32" font-size="24">${fx.lastCode}</text></svg>` });
  }
  if (req.method() === 'GET') {
    if (p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: dashboard });
    if (p === 'newcase') return route.fulfill({ contentType: 'text/html', body: newCase });
    if (p === 'pleadings') return route.fulfill({ contentType: 'text/html', body: pleadings });
    return route.fulfill({ contentType: 'text/html', body: loginPage });
  }
  if (p === 'upload_pleading/addFile') {
    const raw = req.postDataBuffer()?.toString('latin1') ?? '';
    fx.upload = {
      title: /name="file_name"\r\n\r\n([^\r]*)/.exec(raw)?.[1] ?? '',
      pdf: raw.includes('%PDF-1.4'),
      pde: /name="sel_pde_no"\r\n\r\n([^\r]*)/.exec(raw)?.[1] ?? '',
    };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, fileNameNew: 'f1.pdf', pleading_number: 'AKL20260000001D202600001' }) });
  }
  const body = req.postData() ?? '';
  if (p === 'login/verify_login/') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }) });
  const key = p.replace(/^(advocate_case_registration|upload_pleading|dashboard|Dashboard)\//, '').replace(/\/$/, '');
  (fx.posts[key] ??= []).push(body);
  const answers: Record<string, unknown> = {
    insertNewPDE: { pde_no: 'KL0601PDE2026000123', macp: 'Y' },
    fetchActivities: { total_record: 1, submitted_pde_list: `<table id="example1"><tbody><tr><td>1</td><td>MACT OP - KL0601PDE2026000123</td><td><select id="u1" class="pled_grn"><option value="">Select GRN</option><option value="KL26GRN00012345">KL26GRN00012345 - 4320.00</option></select></td><td><button type="button" onclick="submit_pleading('u1','3','KL0601PDE2026000123')">Submit</button></td></tr></tbody></table>` },
    submit_pleading: { status: true },
    insertCaseInfo: { macp: 'Y' },
    submitEfileData: { errorcode: 0 },
  };
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(answers[key] ?? { status: true }) });
}

const form = (key: string, i = 0) => new URLSearchParams(fx.posts[key]?.[i] ?? '');
let sessionId = '';

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

describe('New Case Filing on the portal (fixture PDE wizard)', () => {
  let report: Awaited<ReturnType<typeof filing.fillNewCaseOnPortal>>;

  it('fills every tab from the prepared filing and gets the temporary e-filing number', async () => {
    report = await filing.fillNewCaseOnPortal(sessionId, USER, 'firm-1', FILING_ID);
    expect(report.pdeNo).toBe('KL0601PDE2026000123');
    expect(report.tabs.map((t) => [t.tab, t.status])).toEqual([
      ['initial', 'done'], ['litigant', 'done'], ['facts', 'done'], ['case_details', 'done'], ['mvc', 'done'],
    ]);
    expect(report.tabs.flatMap((t) => t.missing)).toEqual([]);
    expect(h.updates).toContainEqual({ efilingNo: 'KL0601PDE2026000123' });
  });

  it('Initial Inputs: district -> establishment, Civil -> Relief Sought -> Case Type, plaintiff and mobile', () => {
    expect(Object.fromEntries(form('insertNewPDE'))).toMatchObject({
      dist: '4~6~506', est: '4~6~KLAL17', fcasetype: '1', main: '20', ctype: '31', plaintiff: 'Ramesh Kumar', mobile: '9876543210',
    });
  });

  it('Litigant: completes the main petitioner, then adds the respondent', () => {
    expect(fx.posts['fetchPartyData']).toHaveLength(1);
    expect(Object.fromEntries(form('insertPartyInformationTab', 0))).toMatchObject({
      ptype: '1', pname: 'Ramesh Kumar', rel: 'S/o', rname: 'Krishnan', sex: 'M', age: '52', email: 'ramesh@example.com',
      pmobile: '9876543210', occ: 'Business', addr: 'MC Road, Chengannur', pin: '689121',
    });
    expect(Object.fromEntries(form('insertPartyInformationTab', 1))).toMatchObject({
      ptype: '2', pname: 'Suresh Babu', sex: 'M', age: '47', addr: 'Kallissery, Chengannur',
    });
  });

  it('Fact Details: one row per dated fact, dates as the portal writes them', () => {
    expect(Object.fromEntries(form('insertFact'))).toMatchObject({
      fact_date1: '10-02-2026', fact_time1: '18:30', fact1: 'Lorry hit the petitioner.',
      fact_date2: '11-02-2026', fact2: 'FIR registered.',
    });
  });

  it('Case Details and MVC carry every field', () => {
    expect(Object.fromEntries(form('insertCaseInfo'))).toMatchObject({
      coa: 'Accident on MC Road', coad: '10-02-2026', subj: 'Motor accident claim', prayer: 'Award Rs. 5,00,000 as compensation',
      val: '500000', act1: 'Motor Vehicles Act, 1988', section1: '166',
    });
    expect(Object.fromEntries(form('insertMVC'))).toMatchObject({
      item: '12', ps: '77', firtype: '1', firno: '231', firyear: '2026', accdate: '10-02-2026', acctime: '18:30',
      accplace: 'MC Road, Chengannur', inj: '2', injname: 'Ramesh Kumar', comp: '500000', ins: 'National Insurance Co.',
      vtype: 'Lorry', vreg: 'KL-30-A-1234', dl: 'KL3020150001234', ia: 'RTO Chengannur',
    });
  });

  it('"eFile Case" only with the advocate\'s confirmation; then the portal\'s own confirm is accepted', async () => {
    await expect(filing.efileCaseOnPortal(sessionId, USER, 'firm-1', FILING_ID, false)).rejects.toThrow(/Confirm "eFile Case"/);
    expect(fx.posts['submitEfileData']).toBeUndefined();
    const r = await filing.efileCaseOnPortal(sessionId, USER, 'firm-1', FILING_ID, true);
    expect(r).toMatchObject({ ok: true, pdeNo: 'KL0601PDE2026000123' });
    expect(Object.fromEntries(form('submitEfileData'))).toEqual({ pde_no: 'KL0601PDE2026000123' });
    expect(h.transitions).toEqual([{ to: 'efiled', efilingNo: 'KL0601PDE2026000123' }]);
  });

  it('Pleadings > Pleading Upload: the bundle PDF goes up against the e-filing number, then Submit', async () => {
    const r = await filing.uploadPleadingOnPortal(sessionId, USER, 'firm-1', FILING_ID);
    expect(r).toMatchObject({ ok: true, pdeNo: 'KL0601PDE2026000123', title: 'Ramesh Kumar v Suresh Babu MACT', pleadingNumber: 'AKL20260000001D202600001' });
    expect(fx.upload).toEqual({ title: 'Ramesh Kumar v Suresh Babu MACT', pdf: true, pde: 'KL0601PDE2026000123' });
    expect(Object.fromEntries(form('addData'))).toMatchObject({ sel_pde_no: 'KL0601PDE2026000123', file_name: 'Ramesh Kumar v Suresh Babu MACT', pet_res_name: 'Ramesh Kumar' });
    expect(h.updates).toContainEqual({ steps: { upload: 'done' } });
  });

  it('Final submit: Draft Pleadings row of this case, its GRN chosen, Submit - only with confirmation', async () => {
    await expect(filing.submitPleadingOnPortal(sessionId, USER, 'firm-1', FILING_ID, false)).rejects.toThrow(/Confirm the final submission/);
    expect(fx.posts['submit_pleading']).toBeUndefined();
    const r = await filing.submitPleadingOnPortal(sessionId, USER, 'firm-1', FILING_ID, true);
    expect(r).toMatchObject({ ok: true, grn: 'KL26GRN00012345' });
    expect(Object.fromEntries(form('submit_pleading'))).toEqual({ unique_id: 'u1', type_of_case: '3', grn: 'KL26GRN00012345', efiling_number: 'KL0601PDE2026000123' });
    expect(h.transitions).toContainEqual({ to: 'submitted' });
  });
});
