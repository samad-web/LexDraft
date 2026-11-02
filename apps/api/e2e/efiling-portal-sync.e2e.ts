/**
 * eFiling portal -> DifAi sync (services/efiling-portal-sync.service.ts),
 * end to end: a stand-in portal that behaves like filing.ecourts.gov.in's
 * dashboard (as in efiling-portal-flow.e2e.ts - tiles, lists in
 * #history_body, documents opened in the portal's viewer), the real API, and
 * the LIVE database inside ONE transaction that is always rolled back (as in
 * efiling.e2e.ts) - nothing is left behind.
 *
 * Covered: the first sync (started by the login itself) creates / links
 * filings, records the GRN and saves the Acknowledgement; a second sync is a
 * no-op; an objection on the portal -> objected + notification; registration
 * -> registered + CNR on the matter + eCourts link queued; unlinked filings ->
 * Link to a matter / Create matter; and the stand-in portal never receives a
 * request that saves, submits, pays or deletes anything.
 *
 * E-filing numbers and CNRs here are made up (AZZ... / ZZEE...) so they can
 * never collide with a real filing in the firm.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import type { BrowserContext, Route } from 'playwright';
import type { Server } from 'node:http';

// ---- swaps (hoisted above imports) ------------------------------------------------

const h = vi.hoisted(() => ({
  tx: null as unknown,
  jobs: [] as Array<{ name: string; data: unknown }>,
  files: new Map<string, { body: Buffer; contentType: string }>(),
}));

vi.mock('../src/db/client', () => ({ db: () => h.tx, closeDb: async () => {} }));

vi.mock('../src/services/jobs.service', () => ({
  jobs: {
    register: () => {},
    start: async () => {},
    enqueue: async (name: string, data: unknown) => { h.jobs.push({ name, data }); return null; },
  },
  ensureScheduledSyncRan: async () => {},
}));

vi.mock('../src/services/storage.service', () => ({
  storage: () => ({
    putObject: async ({ key, body, contentType }: { key: string; body: Buffer; contentType: string }) => { h.files.set(key, { body, contentType }); },
    getObject: async (key: string) => h.files.get(key) ?? null,
    delete: async (key: string) => { h.files.delete(key); },
    presignUpload: async () => { throw new Error('not used'); },
    presignDownload: async ({ key }: { key: string }) => ({ url: `memory://${key}`, expiresAt: new Date().toISOString() }),
  }),
  verifyLocalUploadUrl: () => false,
}));

import * as live from '../src/services/efiling-live.service';

// ---- the stand-in portal ------------------------------------------------------------

const ORIGIN = 'https://filing.ecourts.gov.in';
const NO1 = 'AZZ99990000001C202699001'; // Draft Cases only - unlinked, then Linked
const NO2 = 'AZZ99990000001C202699002'; // prepared in DifAi; eFiled -> objected -> registered
const NO3 = 'AZZ99990000001C202699003'; // registered; its matter is in DifAi by CNR
const NO4 = 'AZZ99990000001C202699004'; // eFiled Cases only - unlinked, then Create matter
const CNR2 = 'ZZEE0C0121292026';
const CNR3 = 'ZZEE0C0099992026';

const fx = {
  phase: 'filed' as 'filed' | 'objected' | 'registered',
  lastCode: '',
  n: 0,
  /** Every POST the stand-in received (route only). */
  posts: [] as string[],
  pdfs: [] as string[],
};

/** What the portal's dashboard requests read: nothing else may ever be sent. */
const READ_ROUTES = new Set([
  'login/verify_login/',
  'advocate_case_registration/getUnRegisteredPDE', 'advocate_case_registration/getSubmittedPDE',
  'dashboard/fetchActivities', 'dashboard/fetchCompletedActivities', 'dashboard/fetchDraftIA', 'dashboard/fetchCompletedIA',
  'dashboard/fetchObjections', 'Portfolio_new/my_cases',
]);

const loginPage = `<!doctype html><html><body><form id="frm_login">
<select id="selState"><option value="">Select</option><option value="10">Tamil Nadu</option></select>
<input type="radio" name="rdoUser" id="user_advocate" value="1"><input id="user_name"><input type="password" id="user_password">
<img id="captcha_image" src="/pdedev/securimage/securimage_show.php?a" width="150" height="50">
<input id="fcaptcha_code_mobile"><button type="button" id="verify_button1" onclick="go()">Login</button>
<div class="alert-danger4" style="display:none"><span id="msg-danger4"></span></div></form>
<script>function go(){var x=new XMLHttpRequest();x.open('POST','/pdedev/?p=login/verify_login/');x.onload=function(){var o=JSON.parse(x.responseText);if(o.redirect_path){location.href=o.redirect_path;return;}document.querySelector('.alert-danger4').style.display='block';document.getElementById('msg-danger4').innerHTML=o.errorMsg;};x.send('fcaptcha_code='+document.getElementById('fcaptcha_code_mobile').value);}</script>
</body></html>`;

const table = (heads: string[], rows: string) => `<table id="example1" class="table"><thead><tr>${heads.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
const tr = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;

/** The lists, as the real portal's columns (captured 2026-11-02), for the current phase. */
function lists(): Record<string, string> {
  const registered = fx.phase === 'registered';
  return {
    draft_cases: table(
      ['Sr. No.', 'Establishlement Name', 'E-Filing Number', 'Relief Sought', 'Case Type', 'Litigant Name', 'Mobile Number', 'Date', 'CIS Status', 'Last Modified By', 'Modified On', 'Action'],
      tr(['1', 'City Civil Court, Chennai', NO1, 'Suit', 'O.S.', 'Ramesh Kumar', '9000000000', '01-11-2026', 'Pending', 'adv', '01-11-2026', '<button class="btn">Edit</button>']),
    ),
    filed_cases: table(
      ['Sr.No.', 'Establishlement Name', 'E-Filing No', 'Relief Sought', 'Petitioner Name', 'Respondent Name', 'Registration date', 'Action'],
      tr(['1', 'The Metropolitan Magistrates Courts, Saidapet, Chennai', `${NO2}${registered ? `<br>STC/4377/2026 (${CNR2}) CIS verified eFiled case` : ''}`, 'Complaint', 'Ambeth Arivukarasan Proprietor Thoorigai Prints', 'R Venkatesh Bhat Proprietor Ms Venki Publications', registered ? '02-09-2026' : '',
        `<button class="btn" onclick="fxFile('case_${NO2}')">View</button> <a href="#" onclick="return fxFile('ack_${NO2}')">Acknowledgement</a>`])
      + tr(['2', 'Family Court, Coimbatore', NO4, 'Divorce', 'Lakshmi', 'Kannan', '', `<button class="btn" onclick="fxFile('case_${NO4}')">View</button>`]),
    ),
    efiling_activity: table(
      ['Sr.No.', 'e-Filing Number / Case Number', 'Establishment', 'Cause Title', 'Upload Pleadings (Mandatory)', 'Oath Recording', 'ePayments', 'Action'],
      '<tr><td colspan="8">No record found</td></tr>',
    ),
    completed_pleading: table(
      ['Sr.No.', 'e-Filing Number / Case Number', 'Establishment', 'Cause Title', 'Upload Pleadings (Mandatory)', 'Oath Recording', 'ePayments', 'Application Submitted', 'Last Updated on', 'Status'],
      tr(['1', `${registered ? `<b>STC/4377/2026</b><br>(${CNR2})<br>` : ''}STC - ${NO2}<br>${registered ? '<span class="badge">Court Verified eFile Case</span><br>' : ''}<a href="#" onclick="return fxFile('ack_${NO2}')">Acknowledgement</a>`,
        'The Metropolitan Magistrates Courts, Saidapet, Chennai',
        '<a href="#">Ambeth Arivukarasan Proprietor Thoorigai Prints</a><br>Vs<br><a href="#">R Venkatesh Bhat Proprietor Ms Venki Publications</a>',
        '<button class="btn">View Documents</button>', '---', 'TNCT2716H2608P694 - 6600.00', '', '27-08-2026 15:09:56', '<button class="btn">View Status</button>'])
      + tr(['2', `<b>OS/12/2026</b><br>(${CNR3})<br>OS - ${NO3}<br><span class="badge">Court Verified eFile Case</span>`, 'City Civil Court, Chennai',
        'Selvi<br>Vs<br>Kumar', '<button class="btn">View Documents</button>', '---', 'TNCT9999Z0000Y111 - 250.00', '', '20-10-2026 11:00:00', '']),
    ),
    draft_ia: '<table><tbody></tbody></table>',
    completed_ia: '<table><tbody></tbody></table>',
    objections: table(['Sr.No.', 'Reason', 'Date'], fx.phase === 'objected'
      ? '<tr><td colspan="3">C202699002 - Complaint</td></tr>' + tr(['1', 'Vakalat not signed by the party.', '02-11-2026'])
      : '<tr><td colspan="3">No data available in table</td></tr>'),
  };
}

const MY_CASES = [
  { cino: CNR3, hc_dc: 'D', type_name: 'OS', case_no: '200100000122026', reg_no: '12', reg_year: '2026', fil_no: '7', fil_year: '2026', pet_name: 'Selvi', res_name: 'Kumar', state_code: '10', state_name: 'Tamil Nadu', district_code: '2', district_name: 'Chennai', establishment_code: 'TNCH0C', establishment_name: 'City Civil Court, Chennai', desgname: '1-Principal Judge', date_next_list: '2026-12-12', date_last_list: null, date_of_decision: null, registration_date: '2026-10-20', purpose_cd: '', purpose_name: '', ci_cri: 'civil', pde_no: NO3, under_obj: 'N', updated: true },
];
const myCasesPage = () => `<div id="datewiseDistrictwiseDiv"><span id="mycases_span_id">${MY_CASES.length}</span> [Last refreshed on 02-11-2026 10:00:00]</div>
<div id="ditrictsAccordion"></div><div id="hcAccordion"></div><p id="nocasestxt" style="display:none">No cases added to My Cases</p>
<script>var CNR_Numbers_ef = ${JSON.stringify(JSON.stringify(MY_CASES))}; var CNR_Numbers_HC_ef = '[]'; var allCNRRepresentative = { '${CNR3}': [{ cino: '${CNR3}', litigant_type: 1, litigant_name: 'Selvi' }] };</script>`;

const TILES: Record<string, { route: string; field: string }> = {
  draft_cases: { route: 'advocate_case_registration/getUnRegisteredPDE', field: 'pde_list' },
  filed_cases: { route: 'advocate_case_registration/getSubmittedPDE', field: 'submitted_pde_list' },
  efiling_activity: { route: 'dashboard/fetchActivities', field: 'submitted_pde_list' },
  completed_pleading: { route: 'dashboard/fetchCompletedActivities', field: 'submitted_pde_list' },
  draft_ia: { route: 'dashboard/fetchDraftIA', field: 'submitted_pde_list' },
  completed_ia: { route: 'dashboard/fetchCompletedIA', field: 'submitted_pde_list' },
  objections: { route: 'dashboard/fetchObjections', field: 'table' },
  my_cases: { route: 'Portfolio_new/my_cases', field: 'html' },
};

const dashboardPage = () => `<!doctype html><html><body>
<input type="hidden" id="base_url" value="${ORIGIN}/pdedev"><input type="hidden" id="__csrf_magic" value="tok">
<h3>Dashboard</h3>
<div class="row panel"><div class="col tile"><span>Draft Pleadings</span><span>0</span></div><div class="col tile"><span>Completed Pleadings</span><span>2</span></div></div>
<div class="row panel"><div class="col tile"><span>Objections</span><span>${fx.phase === 'objected' ? 1 : 0}</span></div><div class="col tile"><span>My Cases</span><span>1</span></div></div>
${Object.keys(TILES).map((id) => `<a href="#" id="${id}">${id}</a>`).join(' ')}
<a href="${ORIGIN}/pdedev/?p=login/logOut">Logout</a>
<div id="db_screen"><div id="history_body"></div></div>
<script>
  // The portal's document viewer: the PDF's address goes into an <object>.
  function fxFile(name) {
    setTimeout(function () {
      var d = document.getElementById('dv_data') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'dv_data' }));
      d.innerHTML = '<object id="myPdf" type="application/pdf" data="/pdedev/temp/' + name + '.pdf"></object>';
    }, 300);
    return false;
  }
  var TILES = ${JSON.stringify(TILES)};
  Object.keys(TILES).forEach(function (id) {
    document.getElementById(id).addEventListener('click', function (e) {
      e.preventDefault();
      var x = new XMLHttpRequest(); x.open('POST', document.getElementById('base_url').value + '/?p=' + TILES[id].route);
      x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      x.onload = function () {
        var body = document.getElementById('history_body');
        body.innerHTML = JSON.parse(x.responseText)[TILES[id].field];
        Array.prototype.forEach.call(body.querySelectorAll('script'), function (old) {
          var s = document.createElement('script'); s.text = old.text; old.parentNode.replaceChild(s, old);
        });
      };
      x.send('ajax_req=true&__csrf_magic=tok');
    });
  });
</script></body></html>`;

async function serve(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.searchParams.get('p') ?? '';
  if (url.pathname.endsWith('securimage_show.php')) {
    fx.lastCode = `Q${++fx.n}z`;
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><rect width="150" height="50" fill="#fff"/><text x="10" y="32" font-size="24">${fx.lastCode}</text></svg>` });
  }
  if (req.method() === 'GET' && url.pathname.endsWith('.pdf')) {
    fx.pdfs.push(url.pathname);
    return route.fulfill({ contentType: 'application/pdf', body: `%PDF-1.4 stand-in ${url.pathname}` });
  }
  if (req.method() === 'GET' && p === 'dashboard') return route.fulfill({ contentType: 'text/html', body: dashboardPage() });
  if (req.method() === 'GET' && p === 'login/logOut') return route.fulfill({ contentType: 'text/html', body: '<html><body>Logged out</body></html>' });
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: loginPage });
  fx.posts.push(p);
  if (p === 'login/verify_login/') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: true, redirect_path: `${ORIGIN}/pdedev/?p=dashboard` }) });
  }
  const tile = Object.entries(TILES).find(([, t]) => t.route === p);
  if (tile) {
    const html = tile[0] === 'my_cases' ? myCasesPage() : lists()[tile[0]]!;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ nsteptoken: 'tok', [tile[1].field]: html, total_record: 1 }) });
  }
  return route.fulfill({ status: 404, body: 'not in the stand-in' });
}

// ---- DB + API plumbing (as efiling.e2e.ts) ----------------------------------------

class Rollback extends Error {}
const PORT = 4103;
const TABLES = ['efiling_filings', 'efiling_filing_events', 'efiling_documents', 'efiling_payments'];

let raw: ReturnType<typeof postgres>;
let releaseTx: () => void;
let txDone: Promise<void>;
let server: Server;
let token: string;
let firmId: string;
let userId: string;
let sessionId = '';
const cases: Record<'a' | 'b' | 'r', string> = { a: '', b: '', r: '' };
let filing2 = '';
const before: Record<string, number> = {};
const sql = () => h.tx as ReturnType<typeof postgres>;

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`http://localhost:${PORT}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as T };
}

interface Summary {
  linked: number; updated: number; created: number; errors: string[]; at: string;
  items: Array<{ efilingNo: string; filingId: string | null; caseId: string | null; status: string | null; changes: string[]; lastChange: string | null; title: string }>;
  unlinked: Array<{ efilingNo: string; title: string; candidates?: Array<{ caseId: string; title: string }> }>;
}

const filingOf = async (no: string) => (await sql()<Array<{ id: string; case_id: string; status: string; cnr: string | null; registration_no: string | null; objections: string | null; steps: Record<string, string> }>>`
  select id, case_id, status, cnr, registration_no, objections, steps from efiling_filings where firm_id = ${firmId}::uuid and efiling_no = ${no}`)[0];
const eventsOf = async (id: string) => sql()<Array<{ from_status: string | null; to_status: string | null; note: string | null; source: string }>>`
  select from_status, to_status, note, source from efiling_filing_events where filing_id = ${id}::uuid order by created_at, id`;
/** Everything the sync writes for our filings, to show a second run adds nothing. */
async function footprint(): Promise<Record<string, number>> {
  const ids = (await sql()<Array<{ id: string }>>`select id from efiling_filings where firm_id = ${firmId}::uuid and efiling_no like 'AZZ99990000001%'`).map((r) => r.id);
  const [r] = await sql()<Array<Record<string, number>>>`
    select
      (select count(*)::int from efiling_filing_events where filing_id = any(${sql().array(ids)}::uuid[])) as events,
      (select count(*)::int from efiling_payments where filing_id = any(${sql().array(ids)}::uuid[])) as payments,
      (select count(*)::int from efiling_documents where filing_id = any(${sql().array(ids)}::uuid[])) as links,
      (select count(*)::int from documents where firm_id = ${firmId}::uuid and name like ${'%AZZ99990000001%'}) as documents`;
  return { filings: ids.length, ...r! };
}

beforeAll(async () => {
  process.env['EFILING_AUTO_SYNC'] = '1';
  raw = postgres(process.env['DATABASE_URL']!, { ssl: 'require', max: 1, prepare: false, onnotice: () => {} });
  for (const t of TABLES) before[t] = (await raw.unsafe(`select count(*)::int as n from ${t}`))[0]!.n as number;

  let ready!: () => void;
  const isReady = new Promise<void>((r) => { ready = r; });
  const release = new Promise<void>((r) => { releaseTx = r; });
  txDone = raw.begin(async (tx) => {
    h.tx = new Proxy(tx, {
      get: (target, prop) => (prop === 'begin' ? (fn: (s: unknown) => unknown) => target.savepoint(fn as never) : (target as never)[prop]),
      apply: (target, thisArg, args) => Reflect.apply(target as never, thisArg, args),
    });
    ready();
    await release;
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; }) as Promise<void>;
  await isReady;

  const [u] = await sql()`select id, email, role, is_superadmin, firm_id from users where name ilike 'riyaz%' and firm_id is not null limit 1`;
  userId = u!.id; firmId = u!.firm_id;
  token = jwt.sign({ sub: u!.id, email: u!.email, role: u!.role, isSuperadmin: !!u!.is_superadmin }, process.env['JWT_SECRET']!, { expiresIn: '30m' });

  // Three matters, inside the transaction: NO2's (prepared in DifAi), NO3's (CNR known), and one that looks like NO1.
  const mk = async (title: string, cnr: string) => (await sql()`
    insert into cases (firm_id, cnr, title, court, stage, client, type, created_by_user_id)
    values (${firmId}, ${cnr}, ${title}, 'Court', 'Filing', ${title.split(' v. ')[0]!.replace('E2E ', '')}, 'Civil', ${userId})
    returning id`)[0]!.id as string;
  cases.a = await mk('E2E Ambeth Arivukarasan v. R Venkatesh Bhat', `TEMP-E2E-A-${Date.now()}`);
  cases.b = await mk('E2E Selvi v. Kumar', CNR3);
  cases.r = await mk('E2E Ramesh Kumar v. Suresh Babu', `TEMP-E2E-R-${Date.now()}`);
  await sql()`insert into case_parties (case_id, side, party_name, position, source) values (${cases.r}, 'petitioner', 'Ramesh Kumar', 0, 'manual')`;
  const [f] = await sql()`
    insert into efiling_filings (firm_id, case_id, kind, title, status, efiling_no, created_by_user_id)
    values (${firmId}, ${cases.a}, 'new_case', 'New case: Ambeth v. Venki', 'ready', ${NO2}, ${userId}) returning id`;
  filing2 = f!.id as string;

  const { createApp } = await import('../src/app');
  server = createApp().listen(PORT);
  live.__testing.setContextHook(async (context: BrowserContext) => { await context.route(`${ORIGIN}/**`, serve); });
});

afterAll(async () => {
  live.__testing.setContextHook(null);
  if (sessionId) await live.endEfilingSession(sessionId, userId).catch(() => {});
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  releaseTx?.();
  await txDone;
  const leftover: string[] = [];
  for (const t of TABLES) {
    const n = (await raw.unsafe(`select count(*)::int as n from ${t}`))[0]!.n as number;
    if (n !== before[t]) leftover.push(`${t}: before ${before[t]}, after ${n}`);
  }
  const [c] = await raw`select count(*)::int as n from cases where cnr like 'TEMP-E2E-%' or cnr like 'ZZEE%' or cnr like 'TEMP-AZZ%' or title like 'E2E %'`;
  const [d] = await raw`select count(*)::int as n from documents where name like '%AZZ99990000001%'`;
  const [n] = await raw`select count(*)::int as n from notifications where title like '%E2E Ambeth%' or title like '%E2E Selvi%'`;
  await raw.end();
  delete process.env['EFILING_AUTO_SYNC'];
  console.log('ROLLBACK CHECK:', leftover.length === 0 && c!.n + d!.n + n!.n === 0 ? 'clean - nothing left in the database' : `LEFTOVER ${leftover.join('; ')} cases=${c!.n} documents=${d!.n} notifications=${n!.n}`);
  expect(leftover).toEqual([]);
  expect(c!.n + d!.n + n!.n).toBe(0);
});

// ---- the checks ------------------------------------------------------------------------

describe('eFiling portal -> DifAi sync', () => {
  it('logging in starts the first sync: filings linked / created, GRN recorded, Acknowledgement + case PDF saved, registration attached', async () => {
    ({ sessionId } = await live.startEfilingSession(userId, '10', 'advocate'));
    await live.submitEfilingCredentials(sessionId, userId, 'adv@example.com', 'Secret@123');
    expect(await live.submitEfilingLoginCaptcha(sessionId, userId, fx.lastCode)).toEqual({ status: 'authenticated' });

    // Nobody pressed Sync: the login started it.
    let s: { summary: Summary | null; running: boolean } = { summary: null, running: true };
    await expect.poll(async () => {
      s = (await api<typeof s>('GET', `/efiling/live/session/${sessionId}/sync`)).body;
      return !!s.summary && !s.running;
    }, { timeout: 180_000, interval: 1000 }).toBe(true);
    const sum = s.summary!;
    expect(sum.errors).toEqual([]);
    expect(sum).toMatchObject({ linked: 2, created: 1, updated: 1 });
    expect(sum.unlinked.map((u) => u.efilingNo).sort()).toEqual([NO1, NO4]);

    // NO2: prepared in DifAi (ready) -> eFiled -> final submitted, each move recorded.
    const f2 = (await filingOf(NO2))!;
    expect(f2).toMatchObject({ id: filing2, status: 'submitted' });
    expect(f2.steps).toMatchObject({ efile_case: 'done', final_submit: 'done', court_fee: 'done' });
    const ev = await eventsOf(filing2);
    // (Inside the test transaction now() doesn't move, so events are compared as a set.)
    expect(ev.filter((e) => e.to_status).map((e) => `${e.from_status}->${e.to_status}`).sort()).toEqual(['efiled->submitted', 'ready->efiled']);
    expect(ev.every((e) => e.source === 'tracker' && /^From filing\.ecourts\.gov\.in/.test(e.note ?? ''))).toBe(true);
    const pay = await sql()`select grn, amount_inr::float as amount, mode from efiling_payments where filing_id = ${filing2}::uuid`;
    expect(pay).toEqual([{ grn: 'TNCT2716H2608P694', amount: 6600, mode: 'epay' }]);

    // The portal's Acknowledgement (and the eFiled case PDF) saved once on the matter and on the filing.
    const docs = await sql()<Array<{ name: string; storage_key: string; case_id: string }>>`
      select name, storage_key, case_id from documents where firm_id = ${firmId}::uuid and case_id = ${cases.a}::uuid order by name`;
    expect(docs.map((d) => d.name)).toEqual([`eFiled case - ${NO2}`, `eFiling acknowledgement - ${NO2}`]);
    expect(h.files.get(docs[1]!.storage_key)?.body.toString()).toBe(`%PDF-1.4 stand-in /pdedev/temp/ack_${NO2}.pdf`);
    const links = await sql()`select label from efiling_documents where filing_id = ${filing2}::uuid order by position`;
    expect(links.map((l) => l.label).sort()).toEqual([`eFiled case - ${NO2}`, `eFiling acknowledgement - ${NO2}`]);

    // NO3: no DifAi filing, but its matter has the CNR -> filing created, registered, eCourts link queued.
    const f3 = (await filingOf(NO3))!;
    expect(f3).toMatchObject({ case_id: cases.b, status: 'registered', cnr: CNR3, registration_no: 'OS/12/2026' });
    expect(h.jobs).toContainEqual({ name: 'ecourts.case.link', data: { caseId: cases.b, firmId } });
    const [reg] = await sql()`select title from notifications where user_id = ${userId}::uuid and dedupe_key = ${`efiling-filing:${f3.id}`}`;
    expect(reg?.title).toBe('Registered by the court: E2E Selvi v. Kumar');

    // NO1 looks like the Ramesh Kumar matter: offered, not linked silently.
    expect(sum.unlinked.find((u) => u.efilingNo === NO1)!.candidates!.map((c) => c.caseId)).toContain(cases.r);
    expect(await filingOf(NO1)).toBeUndefined();
  }, 240_000);

  it('a second sync with nothing new on the portal changes nothing', async () => {
    const was = await footprint();
    const pdfs = fx.pdfs.length;
    const r = await api<Summary>('POST', `/efiling/live/session/${sessionId}/sync`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 0, updated: 0, linked: 2, errors: [] });
    expect(r.body.items.every((i) => i.changes.length === 0)).toBe(true);
    expect(await footprint()).toEqual(was);
    // Already-saved documents are not fetched from the portal again.
    expect(fx.pdfs.length).toBe(pdfs);
  }, 180_000);

  it('an objection on the portal -> objected with its text, and a notification', async () => {
    fx.phase = 'objected';
    const r = await api<Summary>('POST', `/efiling/live/session/${sessionId}/sync`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ updated: 1, created: 0 });
    const f2 = (await filingOf(NO2))!;
    expect(f2).toMatchObject({ status: 'objected', objections: 'Vakalat not signed by the party. (02-11-2026)' });
    expect(await eventsOf(filing2)).toContainEqual(expect.objectContaining({ from_status: 'submitted', to_status: 'objected', source: 'tracker' }));
    const [n] = await sql()`select title, tone from notifications where user_id = ${userId}::uuid and dedupe_key = ${`efiling-objection:${filing2}`}`;
    expect(n).toMatchObject({ title: 'Objection on eFiling: E2E Ambeth Arivukarasan v. R Venkatesh Bhat', tone: 'amber' });
    // Again: still objected, nothing new.
    const again = await api<Summary>('POST', `/efiling/live/session/${sessionId}/sync`);
    expect(again.body).toMatchObject({ updated: 0, created: 0 });
  }, 240_000);

  it('registration on the portal -> objection cleared, registered, CNR on the matter, eCourts link queued', async () => {
    fx.phase = 'registered';
    h.jobs.length = 0;
    const r = await api<Summary>('POST', `/efiling/live/session/${sessionId}/sync`);
    expect(r.status).toBe(200);
    expect(r.body.errors).toEqual([]);
    const f2 = (await filingOf(NO2))!;
    expect(f2).toMatchObject({ status: 'registered', cnr: CNR2, registration_no: 'STC/4377/2026' });
    const moves = (await eventsOf(filing2)).filter((e) => e.to_status).map((e) => `${e.from_status}->${e.to_status}`);
    expect(moves.sort()).toEqual(['efiled->submitted', 'objected->refiled', 'ready->efiled', 'refiled->registered', 'submitted->objected']);
    const [c] = await sql()`select cnr, ecourts_link_status from cases where id = ${cases.a}::uuid`;
    expect(c).toMatchObject({ cnr: CNR2, ecourts_link_status: 'pending' });
    expect(h.jobs).toContainEqual({ name: 'ecourts.case.link', data: { caseId: cases.a, firmId } });
    const [cleared] = await sql()`select title from notifications where user_id = ${userId}::uuid and dedupe_key = ${`efiling-objection:${filing2}`}`;
    expect(cleared?.title).toBe('Objection cleared: E2E Ambeth Arivukarasan v. R Venkatesh Bhat');
    const [reg] = await sql()`select title from notifications where user_id = ${userId}::uuid and dedupe_key = ${`efiling-filing:${filing2}`}`;
    expect(reg?.title).toBe('Registered by the court: E2E Ambeth Arivukarasan v. R Venkatesh Bhat');
  }, 240_000);

  it('an unlinked portal filing: Link to an existing matter, or Create the matter from the portal', async () => {
    const linked = await api<Summary['items'][number]>('POST', `/efiling/live/session/${sessionId}/sync/link`, { portalEfilingNo: NO1, caseId: cases.r });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ efilingNo: NO1, caseId: cases.r, status: 'ready' });
    expect((await filingOf(NO1))!).toMatchObject({ case_id: cases.r, status: 'ready' });

    const made = await api<Summary['items'][number]>('POST', `/efiling/live/session/${sessionId}/sync/link`, { portalEfilingNo: NO4, createCase: true });
    expect(made.status).toBe(200);
    expect(made.body).toMatchObject({ efilingNo: NO4, status: 'efiled', caseTitle: 'Lakshmi vs Kannan' });
    const [mc] = await sql()`select title, cnr, court from cases where id = ${made.body.caseId}::uuid`;
    expect(mc).toMatchObject({ title: 'Lakshmi vs Kannan', cnr: `TEMP-${NO4}`, court: 'Family Court, Coimbatore' });
    // Its eFiled case PDF is saved on the new matter (the filing is still being prepared, so not on its bundle).
    const [doc] = await sql()`select name from documents where case_id = ${made.body.caseId}::uuid`;
    expect(doc?.name).toBe(`eFiled case - ${NO4}`);

    // Linking the same number twice is refused; a session DifAi doesn't know is 404, never 401.
    expect((await api('POST', `/efiling/live/session/${sessionId}/sync/link`, { portalEfilingNo: NO4, createCase: true })).status).toBe(409);
    expect((await api('POST', '/efiling/live/session/00000000-0000-4000-8000-000000000000/sync')).status).toBe(404);

    const s = (await api<{ summary: Summary }>('GET', `/efiling/live/session/${sessionId}/sync`)).body.summary;
    expect(s.unlinked).toEqual([]);
    expect(s.linked).toBe(4);
    // The next sync knows them by their eFiling numbers.
    const next = await api<Summary>('POST', `/efiling/live/session/${sessionId}/sync`);
    expect(next.body).toMatchObject({ linked: 4, created: 0, updated: 0, unlinked: [] });
  }, 240_000);

  it('nothing on the portal was ever saved, submitted, paid or deleted', () => {
    expect(fx.posts.length).toBeGreaterThan(0);
    expect(fx.posts.filter((p) => !READ_ROUTES.has(p))).toEqual([]);
  });
});
