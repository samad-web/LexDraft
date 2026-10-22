/**
 * eFiling - every field and every endpoint, through the real UI and the real
 * API, against the LIVE database inside ONE transaction that is rolled back.
 *
 * How it stays side-effect free:
 *   - db() is swapped for a transaction-bound handle; afterAll rolls it back
 *     and asserts the eFiling tables hold exactly what they held before.
 *   - file storage is in memory (no bundle PDFs written to disk/S3)
 *   - the job queue only records (no pg-boss rows)
 *   - eCourts is stubbed (no live calls, no throttling)
 * The browser runs the real web app (localhost:5173); its /api calls are
 * re-routed to this test API instance (port 4100).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import { PDFDocument } from 'pdf-lib';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import type { Server } from 'node:http';

// ---- swaps (hoisted above imports) ------------------------------------------------

const h = vi.hoisted(() => ({
  tx: null as unknown,
  jobs: [] as Array<{ name: string; data: unknown }>,
  files: new Map<string, { body: Buffer; contentType: string }>(),
  candidates: [] as Array<Record<string, unknown>>,
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

vi.mock('../src/services/ecourts.service', async (orig) => {
  const real = await orig<typeof import('../src/services/ecourts.service')>();
  const est = (rows: Array<Record<string, unknown>>) => ({ 0: { court_code: '17', establishment_name: 'Munsiff Court, Chengannur', caseNos: rows }, no_of_establishments: 1 });
  return {
    ...real,
    listStates: async (court: 'DC' | 'HC' = 'DC') => (court === 'HC'
      ? [{ state_code: 4, state_name: 'Kerala High Court' }]
      : [{ state_code: 4, state_name: 'Kerala' }, { state_code: 10, state_name: 'Tamil Nadu' }]),
    listDistricts: async () => [{ dist_code: 6, dist_name: 'Alappuzha' }],
    listCaseTypes: async () => [{ code: '7', name: 'O.S. - Original Suit' }, { code: '31', name: 'M.A.C.T. O.P.' }],
    listJudgeBenches: async () => [],
    fetchCourtLocation: async () => null,
    searchByFilingNumber: async () => est(h.candidates),
    searchByPartyName: async () => est(h.candidates),
  };
});

// ---- test plumbing ------------------------------------------------------------------

class Rollback extends Error {}
const PORT = 4100;
const WEB = 'http://localhost:5173';
const EFILING_TABLES = ['efiling_filings', 'efiling_filing_events', 'efiling_documents', 'efiling_payments', 'case_filing_particulars', 'case_filing_parties', 'case_facts', 'advocate_practice_locations', 'efiling_tracking_runs'];

let raw: ReturnType<typeof postgres>;
let releaseTx: () => void;
let txDone: Promise<void>;
let server: Server;
let browser: Browser;
let page: Page;
let token: string;
let firmId: string;
let userId: string;
let caseId: string;
let docIds: string[] = [];
const before: Record<string, number> = {};

async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`http://localhost:${PORT}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as T };
}

async function pdf(pages: number, label: string): Promise<Buffer> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage().drawText(`${label} p${i + 1}`, { x: 50, y: 700 });
  return Buffer.from(await d.save());
}

/** The control inside a <label> whose own caption is exactly label (the
 *  app's labels wrap their control, so the control's accessible name also
 *  carries its current value - match on the caption span instead). */
const fieldIn = (scope: Page | Locator, label: string) => {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Required fields carry the portal's "*" before the caption.
  return scope.locator('label').filter({ has: page.locator('span', { hasText: new RegExp(`^\\s*\\*?\\s*${esc}\\s*(·.*)?$`) }) }).locator('input, select, textarea').first();
};
const field = (label: string) => fieldIn(page, label);
/** A portal section ("Case Types", "MVC Information", ...) by its bar title. */
const sec = (title: string) => page.locator(`section[aria-label="${title}"]`).last();
/** expect.poll with a realistic ceiling (default is 1 s). */
const pollFor = <T>(fn: () => Promise<T> | T, opts: { timeout?: number } = {}) => expect.poll(fn, { timeout: 20_000, interval: 250, ...opts });
/** Full-page screenshot for review, only when E2E_SHOTS is set. */
const shot = async (name: string) => {
  if (process.env['E2E_SHOTS']) await page.screenshot({ path: `${process.env['E2E_SHOTS']}/efiling-${name}.png`, fullPage: true });
};

beforeAll(async () => {
  raw = postgres(process.env['DATABASE_URL']!, { ssl: 'require', max: 1, prepare: false, onnotice: () => {} });
  for (const t of EFILING_TABLES) before[t] = (await raw.unsafe(`select count(*)::int as n from ${t}`))[0]!.n as number;

  let ready!: () => void;
  const isReady = new Promise<void>((r) => { ready = r; });
  const release = new Promise<void>((r) => { releaseTx = r; });
  txDone = raw.begin(async (tx) => {
    // Services call sql.begin(); inside a transaction that's a savepoint.
    h.tx = new Proxy(tx, {
      get: (target, prop) => (prop === 'begin' ? (fn: (s: unknown) => unknown) => target.savepoint(fn as never) : (target as never)[prop]),
      apply: (target, thisArg, args) => Reflect.apply(target as never, thisArg, args),
    });
    ready();
    await release;
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; }) as Promise<void>;
  await isReady;

  const sql = h.tx as ReturnType<typeof postgres>;
  const [u] = await sql`select id, email, role, is_superadmin, firm_id from users where name ilike 'riyaz%' and firm_id is not null limit 1`;
  userId = u!.id; firmId = u!.firm_id;
  token = jwt.sign({ sub: u!.id, email: u!.email, role: u!.role, isSuperadmin: !!u!.is_superadmin }, process.env['JWT_SECRET']!, { expiresIn: '30m' });

  // A matter + its eCourts parties + two PDFs, all inside the transaction.
  const [c] = await sql`
    insert into cases (firm_id, cnr, title, court, stage, client, type, state_code, district_code, court_code, est_code, created_by_user_id)
    values (${firmId}, ${'TEMP-E2E-' + Date.now()}, 'E2E Ramesh Kumar v. Suresh Babu', 'Munsiff Court, Chengannur', 'Filing', 'Ramesh Kumar', 'Civil', 4, 6, 17, '17', ${userId})
    returning id`;
  caseId = c!.id;
  await sql`insert into case_parties (case_id, side, party_name, position, source) values (${caseId}, 'petitioner', 'Ramesh Kumar', 0, 'manual'), (${caseId}, 'respondent', 'Suresh Babu', 0, 'manual')`;
  for (const [name, pages] of [['Plaint', 3], ['Vakalatnama', 1]] as const) {
    const key = `e2e/${name}.pdf`;
    h.files.set(key, { body: await pdf(pages, name), contentType: 'application/pdf' });
    const [d] = await sql`
      insert into documents (firm_id, case_id, case_label, name, type, storage_key, file_name, file_mime, file_size)
      values (${firmId}, ${caseId}, 'E2E Ramesh Kumar v. Suresh Babu', ${name}, 'Pleading', ${key}, ${name + '.pdf'}, 'application/pdf', ${h.files.get(key)!.body.length})
      returning id`;
    docIds.push(d!.id);
  }

  const { createApp } = await import('../src/app');
  server = createApp().listen(PORT);

  browser = await chromium.launch({ headless: true });
  const me = await api<{ user?: unknown }>('GET', '/auth/me');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.addInitScript(([t, usr]) => {
    localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: usr, token: t, actAs: null, previousSession: null }, version: 0 }));
    localStorage.removeItem('lexdraft.ecourts.court');
  }, [token, me.body.user ?? me.body] as const);
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  page.on('response', async (r) => {
    if (!r.url().includes('/api/efiling') || r.status() < 400) return;
    const body = await r.text().catch(() => '');
    console.log(`API ${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()} ${body.slice(0, 300)}`);
  });
  // Browser -> this test API (inside the transaction).
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    // Live streams (team chat SSE) can't be relayed by route.fetch and
    // aren't part of eFiling.
    if (url.pathname.endsWith('/stream')) return route.abort();
    try {
      const res = await route.fetch({ url: `http://localhost:${PORT}${url.pathname}${url.search}` });
      await route.fulfill({ response: res });
    } catch {
      // Page navigated away / browser closing - nothing to relay.
      await route.abort().catch(() => {});
    }
  });
});

afterEach(async (ctx) => {
  if (ctx.task.result?.state === 'fail' && page) {
    const name = ctx.task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
    await page.screenshot({ path: `${process.env['E2E_SHOTS'] ?? '.e2e-shots'}/FAIL-${name}.png`, fullPage: true }).catch(() => {});
  }
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  releaseTx?.();
  await txDone;
  const leftover: string[] = [];
  for (const t of EFILING_TABLES) {
    const n = (await raw.unsafe(`select count(*)::int as n from ${t}`))[0]!.n as number;
    if (n !== before[t]) leftover.push(`${t}: before ${before[t]}, after ${n}`);
  }
  const [cases] = await raw`select count(*)::int as n from cases where cnr like 'TEMP-E2E-%'`;
  await raw.end();
  console.log('ROLLBACK CHECK:', leftover.length === 0 && cases!.n === 0 ? 'clean - nothing left in the database' : `LEFTOVER ${leftover.join('; ')} cases=${cases!.n}`);
  expect(leftover).toEqual([]);
  expect(cases!.n).toBe(0);
});

// ---- the checks ------------------------------------------------------------------------

let filingId = '';

describe('eFiling: every field and endpoint', () => {
  it('creates a new-case filing from the UI and prefills from the matter', async () => {
    await page.goto(`${WEB}/app/efiling?m=filings`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '+ New filing' }).click();
    await page.locator('select').filter({ hasText: 'Select matter' }).selectOption(caseId);
    await page.getByRole('button', { name: 'Create filing' }).click();
    await page.getByText('Filing particulars (portal New Case tabs 1–6)').waitFor();
    filingId = new URL(page.url()).searchParams.get('filing') ?? '';
    expect(filingId).toMatch(/[0-9a-f-]{36}/);
    const p = await api<{ particulars: Record<string, unknown>; parties: Array<Record<string, unknown>> }>('GET', `/efiling/cases/${caseId}/particulars`);
    expect(p.body.particulars).toMatchObject({ stateCode: 4, districtCode: 6, courtCode: 17 });
    // Client pre-marked from the matter's client name.
    expect(p.body.parties.find((x) => x.name === 'Ramesh Kumar')).toMatchObject({ isClient: true });
  });

  it('saves every court / case-details field', async () => {
    await field('Court tier').selectOption('DC');
    await field('State').selectOption('4');
    await field('District').selectOption('6');
    await field('Court complex').selectOption('1040071');
    await field('Court').selectOption('17');
    await field('Court name (as on the portal)').fill('Munsiff Court, Chengannur');
    await page.getByRole('checkbox', { name: 'Urgent matter' }).check();
    // Initial Inputs > Case Types, as the portal lays it out.
    const types = sec('Case Types');
    await types.getByRole('radio', { name: 'Civil' }).check();
    await fieldIn(types, 'Relief Sought').selectOption('Suit');
    await fieldIn(types, 'Case Type').selectOption('7');
    // Case Details.
    await field('Cause of Action').fill('Non-payment of rent from March 2026');
    await field('Date of Cause of Action').fill('2026-03-05');
    await field('Valuation [₹]').fill('240000');
    await field('Important Information or Subject or Reason').fill('Recovery of rent arrears');
    await field('Prayer').fill('Decree for Rs. 2,40,000 with interest');
    const dispute = sec('Dispute Arising Out Of');
    await fieldIn(dispute, 'State').fill('Kerala');
    await fieldIn(dispute, 'District').fill('Alappuzha');
    await fieldIn(dispute, 'Taluka').fill('Chengannur');
    await fieldIn(dispute, 'Village').fill('Puliyoor');
    await page.getByRole('button', { name: '+ More Acts...' }).click();
    await field('Act1').fill('Code of Civil Procedure, 1908');
    await field('Section1').fill('O.VII R.1');
    await page.getByRole('checkbox', { name: 'Plaint in Local Language' }).check();
    await field('Local language').fill('Malayalam');
    await field('Plaint in Malayalam').fill('വാടക കുടിശ്ശിക');
    await field('Cause of action in local language').fill('വാടക നൽകിയില്ല');
    await field('Prayer in local language').fill('ഡിക്രി');
    await field('Important information in local language').fill('വാടക കുടിശ്ശിക');
    // LexDraft's own extras.
    await field('Place where the dispute arose').fill('Chengannur');
    await field('Claim amount (₹)').fill('250000');
    await field('Relief particulars').fill('Arrears and future rent');
    await page.getByLabel(/Hide party identity/).check();
    await field('Reason for hiding identity').fill('Matrimonial');
    await page.getByRole('button', { name: 'Save court and case details' }).click();
    await page.getByText('Saved.').first().waitFor();

    const p = (await api<{ particulars: Record<string, unknown> }>('GET', `/efiling/cases/${caseId}/particulars`)).body.particulars;
    expect(p).toMatchObject({
      courtTier: 'DC', stateCode: 4, districtCode: 6, courtComplexCode: '1040071', courtCode: 17, estCode: '17',
      caseTypeCode: '7', establishmentName: 'Munsiff Court, Chengannur', isUrgent: true, hcSide: 'civil',
      causeOfAction: 'Non-payment of rent from March 2026', causeOfActionDate: '2026-03-05', disputePlace: 'Chengannur',
      valuationInr: 240000, claimAmountInr: 250000, subject: 'Recovery of rent arrears', prayer: 'Decree for Rs. 2,40,000 with interest',
      reliefParticulars: 'Arrears and future rent', acts: [{ act: 'Code of Civil Procedure, 1908', section: 'O.VII R.1' }],
      hideParty: true, hidePartyReason: 'Matrimonial', localLanguage: 'Malayalam', plaintLocal: 'വാടക കുടിശ്ശിക',
      extra: {
        reliefSought: 'Suit', disputeState: 'Kerala', disputeDistrict: 'Alappuzha', disputeTaluka: 'Chengannur', disputeVillage: 'Puliyoor',
        causeOfActionLocal: 'വാടക നൽകിയില്ല', prayerLocal: 'ഡിക്രി', subjectLocal: 'വാടക കുടിശ്ശിക',
      },
    });
  });

  it('saves the High Court fields, and an appeal\'s Subordinate Court', async () => {
    await field('Court tier').selectOption('HC');
    const types = sec('Case Types');
    await types.getByRole('radio', { name: 'Criminal' }).check();
    await field('Matter type').fill('Writ Petition');
    await field('Bench').fill('Principal Seat');
    // Relief Sought = Appeal opens the portal's Subordinate Court section.
    await fieldIn(types, 'Relief Sought').selectOption('Appeal');
    const sub = sec('Subordinate Court');
    await fieldIn(sub, 'District').fill('Alappuzha');
    await fieldIn(sub, 'Select Establishment').fill('Munsiff Court, Chengannur');
    await fieldIn(sub, 'Case Type').fill('O.S.');
    await fieldIn(sub, 'Case Number').fill('57');
    await fieldIn(sub, 'Year').fill('2024');
    await fieldIn(sub, 'Disposal Date').fill('2026-01-15');
    await fieldIn(sub, 'CC Applied Date').fill('2026-01-20');
    await fieldIn(sub, 'CC Ready Date').fill('2026-02-01');
    await page.getByRole('button', { name: 'Save court and case details' }).click();
    await pollFor(async () => (await api<{ particulars: Record<string, unknown> }>('GET', `/efiling/cases/${caseId}/particulars`)).body.particulars.hcBench).toBe('Principal Seat');
    const p = (await api<{ particulars: Record<string, unknown> }>('GET', `/efiling/cases/${caseId}/particulars`)).body.particulars;
    expect(p).toMatchObject({
      courtTier: 'HC', hcSide: 'criminal', hcMatterType: 'Writ Petition', hcBench: 'Principal Seat',
      extra: {
        reliefSought: 'Appeal', subCourtDistrict: 'Alappuzha', subCourtEstablishment: 'Munsiff Court, Chengannur', subCourtCaseType: 'O.S.',
        subCourtCaseNo: '57', subCourtCaseYear: '2024', subCourtDisposalDate: '2026-01-15', subCourtCcAppliedDate: '2026-01-20', subCourtCcReadyDate: '2026-02-01',
      },
    });
    // Back to the district court (a civil suit) for the rest of the flow.
    await field('Court tier').selectOption('DC');
    await field('State').selectOption('4');
    await field('District').selectOption('6');
    await field('Court complex').selectOption('1040071');
    await field('Court').selectOption('17');
    await types.getByRole('radio', { name: 'Civil' }).check();
    await fieldIn(types, 'Relief Sought').selectOption('Compensation');
    await fieldIn(types, 'Case Type').selectOption('31'); // M.A.C.T. -> shows the MVC tab
    await page.getByRole('button', { name: 'Save court and case details' }).click();
    await sec('MVC Information').waitFor();
  });

  it('saves every MVC (motor accident) field', async () => {
    const mvc: Array<[string, string, string]> = [
      ['MVC Information', 'Item Number', '12'], ['MVC Information', 'State', 'Kerala'], ['MVC Information', 'District', 'Alappuzha'],
      ['MVC Information', 'Taluka', 'Chengannur'], ['MVC Information', 'Police Station', 'Chengannur PS'],
      ['MVC Information', 'FIR Number', '231'], ['MVC Information', 'Year', '2026'],
      ['Accident Information', 'Date of Accident', '2026-02-10'], ['Accident Information', 'Time of Accident', '18:30'],
      ['Accident Information', 'Place of Accident', 'MC Road, Chengannur'], ['Accident Information', 'Name', 'Ramesh Kumar'],
      ['Claim Information', 'Compensation Claimed', '500000'], ['Claim Information', 'Insurance Company', 'National Insurance Co.'],
      ['Vehicle Information', 'Vehicle Type', 'Lorry'], ['Vehicle Information', 'Vehicle Regn. No.', 'KL-30-A-1234'],
      ['Vehicle Information', 'Driving License', 'KL3020150001234'], ['Vehicle Information', 'Issuing Authority', 'RTO Chengannur'],
    ];
    for (const [section, label, value] of mvc) await fieldIn(sec(section), label).fill(value);
    await fieldIn(sec('MVC Information'), 'FIR Type').selectOption('FIR');
    await sec('Accident Information').getByRole('radio', { name: 'Serious' }).check();
    await sec('MVC Information').getByRole('checkbox', { name: 'Other Police Station' }).check();
    await page.getByRole('button', { name: 'Save court and case details' }).click();
    await pollFor(async () => (await api<{ particulars: { mact: Record<string, unknown> | null } }>('GET', `/efiling/cases/${caseId}/particulars`)).body.particulars.mact?.itemNo).toBe('12');
    const p = (await api<{ particulars: { mact: Record<string, unknown> } }>('GET', `/efiling/cases/${caseId}/particulars`)).body.particulars;
    expect(p.mact).toMatchObject({
      itemNo: '12', policeState: 'Kerala', policeDistrict: 'Alappuzha', policeTaluka: 'Chengannur', otherPoliceStation: true,
      accidentDate: '2026-02-10', accidentTime: '18:30', accidentPlace: 'MC Road, Chengannur', injuryType: 'serious', injuredName: 'Ramesh Kumar',
      policeStation: 'Chengannur PS', firType: 'FIR', firNo: '231', firYear: 2026, vehicleType: 'Lorry', vehicleRegNo: 'KL-30-A-1234',
      drivingLicenceNo: 'KL3020150001234', licenceIssuingAuthority: 'RTO Chengannur', insurer: 'National Insurance Co.', compensationClaimedInr: 500000,
    });
  });

  it('saves every party field (individual, minor, legal heir, other info) and an organisation; deletes a party', async () => {
    // Edit the prefilled petitioner with every individual field.
    await page.locator('div.row', { hasText: 'Ramesh Kumar' }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).first().getByRole('button', { name: 'Edit' }).click();
    const partyForm = () => page.locator('div.col', { has: page.getByRole('button', { name: 'Update', exact: true }) }).last();
    const form = partyForm();
    await fieldIn(form, 'Relation').selectOption('S/o');
    await fieldIn(form, 'Name').fill('Krishnan');
    await form.getByRole('radio', { name: 'Male', exact: true }).check();
    await fieldIn(form, 'Age').fill('52');
    await form.getByRole('checkbox', { name: 'Differently Abled' }).check();
    await fieldIn(form, 'Date of Birth').fill('1974-05-01');
    await fieldIn(form, 'Caste').fill('General');
    await fieldIn(form, 'Extra Petitioner Count').fill('1');
    await fieldIn(form, 'Occupation').fill('Business');
    await fieldIn(form, 'Address').fill('MC Road, Chengannur');
    await fieldIn(form, 'District').fill('Alappuzha');
    await fieldIn(form, 'State').fill('Kerala');
    await fieldIn(form, 'Taluka').fill('Chengannur');
    await fieldIn(form, 'Village').fill('Puliyoor');
    await fieldIn(form, 'Pin Code').fill('689121');
    await fieldIn(form, 'Mobile No.').fill('9876543210');
    await fieldIn(form, 'Email').fill('ramesh@example.com');
    await fieldIn(form, 'Name in local language').fill('രമേഷ് കുമാർ');
    await fieldIn(form, 'Address in local language').fill('എം.സി. റോഡ്');
    await form.getByRole('checkbox', { name: 'Other Information' }).check();
    await fieldIn(form, 'Passport number').fill('P1234567');
    await fieldIn(form, 'PAN').fill('ABCDE1234F');
    await fieldIn(form, 'Fax').fill('0479-245000');
    await fieldIn(form, 'Alternate address').fill('Kallissery, Chengannur');
    await form.getByRole('button', { name: 'Update', exact: true }).click();
    await pollFor(async () => (await api<{ parties: Array<{ name: string; email: string | null }> }>('GET', `/efiling/cases/${caseId}/particulars`))
      .body.parties.find((x) => x.name === 'Ramesh Kumar')?.email).toBe('ramesh@example.com');
    await page.getByText('Our client').first().waitFor();

    // Complete the prefilled respondent (only a name came from eCourts).
    await page.locator('div.row', { hasText: 'Suresh Babu' }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).first().getByRole('button', { name: 'Edit' }).click();
    const fr = partyForm();
    await fr.getByRole('radio', { name: 'Male', exact: true }).check();
    await fieldIn(fr, 'Age').fill('47');
    await fieldIn(fr, 'Address').fill('Kallissery, Chengannur');
    await fr.getByRole('button', { name: 'Update', exact: true }).click();
    await page.locator('div.row', { hasText: 'Suresh Babu' }).getByText(/47 yrs/).waitFor();

    // Add a minor petitioner who is a legal heir of Ramesh, with a guardian.
    await page.getByRole('button', { name: '+ Add petitioner' }).click();
    const f2 = partyForm();
    await fieldIn(f2, 'Party Name').fill('Anu Ramesh');
    await f2.getByRole('radio', { name: 'Female', exact: true }).check();
    await fieldIn(f2, 'Age').fill('12');
    await f2.getByRole('checkbox', { name: 'Minor' }).check();
    await fieldIn(f2, 'Guardian / next friend').fill('Lakshmi Ramesh');
    await fieldIn(f2, 'Address').fill('MC Road, Chengannur');
    await fieldIn(f2, 'Legal heir of').selectOption({ label: 'Ramesh Kumar' });
    await f2.getByRole('button', { name: 'Update', exact: true }).click();
    await page.getByText('legal heir of Ramesh Kumar').first().waitFor();

    // Add an organisation respondent.
    await page.getByRole('button', { name: '+ Add respondent' }).click();
    const f3 = partyForm();
    await f3.getByRole('checkbox', { name: 'Organisation Details' }).check();
    await fieldIn(f3, 'Organisation Type').fill('Insurance Company');
    await fieldIn(f3, 'Organisation Name').fill('National Insurance Co. Ltd.');
    await fieldIn(f3, 'Represented by (name and designation)').fill('Branch Manager, Chengannur');
    await fieldIn(f3, 'Address').fill('Main Road, Chengannur');
    await f3.getByRole('button', { name: 'Update', exact: true }).click();
    await page.getByText('National Insurance Co. Ltd.').first().waitFor();

    const parties = (await api<{ parties: Array<Record<string, unknown>> }>('GET', `/efiling/cases/${caseId}/particulars`)).body.parties;
    const ramesh = parties.find((x) => x.name === 'Ramesh Kumar')!;
    expect(ramesh).toMatchObject({
      isClient: true, relationType: 'S/o', relationName: 'Krishnan', gender: 'M', age: 52, dateOfBirth: '1974-05-01', occupation: 'Business',
      address: 'MC Road, Chengannur', district: 'Alappuzha', state: 'Kerala', pinCode: '689121', mobile: '9876543210', email: 'ramesh@example.com',
      nameLocal: 'രമേഷ് കുമാർ', addressLocal: 'എം.സി. റോഡ്',
      extra: {
        passportNo: 'P1234567', panNo: 'ABCDE1234F', faxNo: '0479-245000', alternateAddress: 'Kallissery, Chengannur',
        differentlyAbled: 'Y', caste: 'General', extraCount: '1', taluka: 'Chengannur', village: 'Puliyoor',
      },
    });
    expect(parties.find((x) => x.name === 'Anu Ramesh')).toMatchObject({ isMinor: true, guardianName: 'Lakshmi Ramesh', legalHeirOf: ramesh.id, age: 12, gender: 'F' });
    expect(parties.find((x) => x.name === 'National Insurance Co. Ltd.')).toMatchObject({
      isOrganization: true, orgRepresentative: 'Branch Manager, Chengannur', side: 'respondent', extra: { organisationType: 'Insurance Company' },
    });

    // Delete: remove the organisation.
    page.once('dialog', (d) => void d.accept());
    await page.locator('div.row', { hasText: 'National Insurance Co. Ltd.' }).getByRole('button', { name: 'Remove' }).click();
    await page.waitForTimeout(800);
    const after = (await api<{ parties: Array<Record<string, unknown>> }>('GET', `/efiling/cases/${caseId}/particulars`)).body.parties;
    expect(after.some((x) => x.name === 'National Insurance Co. Ltd.')).toBe(false);
  });

  it('saves dated facts, and removing one', async () => {
    const factsTab = page.locator('section', { has: page.getByRole('heading', { name: 'Fact Details' }) }).last();
    await factsTab.getByRole('button', { name: '+ Add More Fact' }).click();
    await factsTab.getByRole('button', { name: '+ Add More Fact' }).click();
    const rows = factsTab.locator('div.row[aria-label^="Fact "]');
    await fieldIn(rows.nth(0), 'Fact Date').fill('2025-04-01');
    await fieldIn(rows.nth(0), 'Fact Time').fill('10:00');
    await fieldIn(rows.nth(0), 'Fact').fill('Lease agreement signed.');
    await fieldIn(rows.nth(1), 'Fact Date').fill('2026-03-05');
    await fieldIn(rows.nth(1), 'Fact').fill('Rent defaulted.');
    expect(await fieldIn(rows.nth(1), 'Sr.No.').inputValue()).toBe('2');
    await factsTab.getByRole('button', { name: 'Save', exact: true }).click();
    const getFacts = async () => (await api<{ facts: Array<Record<string, unknown>> }>('GET', `/efiling/cases/${caseId}/particulars`)).body.facts;
    await pollFor(getFacts).toMatchObject([
      { factDate: '2025-04-01', factTime: '10:00', description: 'Lease agreement signed.' },
      { factDate: '2026-03-05', factTime: null, description: 'Rent defaulted.' },
    ]);
    await rows.nth(1).getByRole('button', { name: 'Remove' }).click();
    await factsTab.getByRole('button', { name: 'Save', exact: true }).click();
    await pollFor(async () => (await getFacts()).map((f) => f.description)).toEqual(['Lease agreement signed.']);
  });

  it('documents: add, rename, reorder, save, build the bundle, download it', async () => {
    const docSelect = page.locator('select').filter({ hasText: "Add a PDF from this matter's documents" });
    await docSelect.selectOption(docIds[0]!);
    await docSelect.selectOption(docIds[1]!);
    const labels = page.locator('section.card', { hasText: 'Documents and filing bundle' }).locator('input.input');
    await labels.nth(0).fill('Plaint (with verification)');
    await page.getByRole('button', { name: 'Move down' }).first().click();
    await page.getByRole('button', { name: 'Save order' }).click();
    // Wait for the save itself, not a fixed delay.
    await pollFor(async () => (await api<{ documents: Array<{ label: string }> }>('GET', `/efiling/filings/${filingId}`)).body.documents.map((d) => d.label), { timeout: 15_000 })
      .toEqual(['Vakalatnama', 'Plaint (with verification)']);
    await page.getByRole('button', { name: 'Save order' }).and(page.locator(':disabled')).waitFor();

    await page.getByRole('button', { name: 'Build bundle' }).click();
    await page.getByText(/Bundle: 5 pages/).waitFor();
    await page.getByText('Plaint (with verification): pages 3–5').waitFor();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download bundle/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/bundle\.pdf$/);
  });

  it('readiness check and "Mark ready"', async () => {
    await page.getByText('Ready for the portal?').waitFor();
    const r = (await api<{ ready: boolean; issues: Array<{ field: string; severity: string; message: string }> }>('GET', `/efiling/filings/${filingId}/readiness`)).body;
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    await page.getByRole('button', { name: 'Mark ready', exact: true }).click();
    await page.getByText('Ready to file', { exact: true }).waitFor();
  });

  it('"Entered on the portal" records the eFiling number', async () => {
    await page.getByRole('button', { name: 'Entered on the portal', exact: true }).click();
    await page.getByPlaceholder('e.g. KL02010045672026').fill('kl020100456722026');
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await page.getByText('On the portal', { exact: true }).first().waitFor();
    const f = (await api('GET', `/efiling/filings/${filingId}`)).body;
    expect(f).toMatchObject({ status: 'efiled', efilingNo: 'KL020100456722026', steps: { efile_case: 'done' } });
  });

  it('final submit is blocked until the portal steps are done and a GRN is recorded', async () => {
    await page.getByRole('button', { name: 'Final submitted', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await page.getByText(/Finish these on the portal first/).waitFor();
    await page.locator('section.card').first().getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  it('every portal step can be set from the checklist', async () => {
    const set = async (label: string, value: string) => {
      await page.getByLabel(`${label} status`).selectOption(value);
      await page.waitForTimeout(150); // deliberately quick: the server merges steps atomically
    };
    await set('Vakalat', 'done');
    await set('Upload pleadings', 'done');
    await set('Index the documents', 'done');
    await set('eSign', 'done');
    await set('Record oath', 'not_applicable');
    await page.waitForTimeout(1200);
    const f = (await api<{ steps: Record<string, string> }>('GET', `/efiling/filings/${filingId}`)).body;
    expect(f.steps).toMatchObject({ vakalat: 'done', upload: 'done', indexing: 'done', esign: 'done', oath: 'not_applicable' });
    // Required steps offer no "Not needed".
    expect(await page.getByLabel('Upload pleadings status').locator('option[value="not_applicable"]').count()).toBe(0);
  });

  it('payments: record with GRN, remove, record again', async () => {
    const pay = page.locator('section.card', { hasText: 'Court fee and payments' });
    await pay.getByLabel('For').selectOption('process_fee');
    await pay.getByLabel('Amount (₹)').fill('50');
    await pay.getByRole('button', { name: 'Record payment' }).click();
    await pay.getByText('Process fee: ₹50').waitFor();
    page.once('dialog', (d) => void d.accept());
    await pay.locator('div.row', { hasText: 'Process fee' }).getByRole('button', { name: 'Remove' }).click();
    await page.waitForTimeout(600);
    await pay.getByLabel('For').selectOption('court_fee');
    await pay.getByLabel('Amount (₹)').fill('4320');
    await pay.getByLabel('GRN').fill('kl26grn00012345');
    await pay.getByLabel('Paid on').fill('2026-10-21');
    await pay.getByRole('button', { name: 'Record payment' }).click();
    await pay.getByText(/GRN KL26GRN00012345/).waitFor();
    const f = (await api<{ payments: Array<Record<string, unknown>>; steps: Record<string, string> }>('GET', `/efiling/filings/${filingId}`)).body;
    expect(f.payments).toMatchObject([{ purpose: 'court_fee', amountInr: 4320, grn: 'KL26GRN00012345', paidOn: '2026-10-21', mode: 'epay' }]);
    expect(f.steps.court_fee).toBe('done');
  });

  it('final submit now succeeds', async () => {
    await page.getByRole('button', { name: 'Final submitted', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await pollFor(async () => (await api<{ status: string; steps: Record<string, string> }>('GET', `/efiling/filings/${filingId}`)).body, { timeout: 15_000 })
      .toMatchObject({ status: 'submitted', steps: { final_submit: 'done' } });
  });

  it('tracking: court filing number, "Check eCourts now", several matches -> pick one -> registered + matter linked', async () => {
    const tr = page.locator('section.card', { hasText: 'Connecting to eCourts' });
    await tr.getByLabel(/Court filing no/).fill('100095');
    await tr.getByLabel('Year').fill('2026');
    await tr.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(800);
    expect((await api('GET', `/efiling/filings/${filingId}`)).body).toMatchObject({ courtFilingNo: '100095', courtFilingYear: 2026 });

    h.jobs.length = 0;
    await page.getByRole('button', { name: 'Check eCourts now' }).first().click();
    await page.waitForTimeout(800);
    expect(h.jobs.map((j) => j.name)).toContain('efiling.track.manual');

    // Run the tracker for real (eCourts stubbed with two matches).
    h.candidates = [
      { cino: 'KLAL170000012026', case_no: '200001', pet_name: 'Ramesh Kumar', res_name: 'Suresh Babu' },
      { cino: 'KLAL170000022026', case_no: '200002', pet_name: 'Ramesh Kumar', res_name: 'Suresh Babu' },
    ];
    const { runEfilingTracking } = await import('../src/services/efiling-tracker.service');
    const summary = await runEfilingTracking({ slot: 'manual' });
    expect(summary.ambiguous).toBe(1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Which of these is your case?').waitFor();
    page.once('dialog', (d) => void d.accept());
    await page.locator('div.row', { hasText: 'KLAL170000022026' }).getByRole('button', { name: 'This one' }).click();
    await page.getByText('Registered', { exact: true }).first().waitFor();
    const f = (await api('GET', `/efiling/filings/${filingId}`)).body;
    expect(f).toMatchObject({ status: 'registered', cnr: 'KLAL170000022026' });
    const sql = h.tx as ReturnType<typeof postgres>;
    const [c] = await sql`select cnr, ecourts_link_status from cases where id = ${caseId}`;
    expect(c).toMatchObject({ cnr: 'KLAL170000022026', ecourts_link_status: 'pending' });
  });

  it('scrutiny path on a second filing: objections -> re-filed -> accepted -> registered with CNR; withdraw, reopen, delete', async () => {
    const { body: f2 } = await api<{ id: string }>('POST', '/efiling/filings', { caseId, kind: 'misc_document', title: 'E2E additional documents' });
    for (const [step, v] of [['upload', 'done'], ['indexing', 'not_applicable'], ['esign', 'done'], ['oath', 'not_applicable']] as const) {
      expect((await api('PATCH', `/efiling/filings/${f2.id}`, { steps: { [step]: v } })).status).toBe(200);
    }
    expect((await api('POST', `/efiling/filings/${f2.id}/transition`, { to: 'efiled' })).status).toBe(200);
    expect((await api('POST', `/efiling/filings/${f2.id}/transition`, { to: 'submitted' })).status).toBe(200);
    await page.goto(`${WEB}/app/efiling?filing=${f2.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Objections raised' }).click();
    await page.getByPlaceholder("Copy the registry's objections here").fill('Index page missing.');
    await page.getByRole('button', { name: 'Save objections' }).click();
    await page.getByText('Objections to cure', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: 'Re-filed after curing' }).click();
    await page.getByText('Re-filed', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Accepted by the court' }).click();
    await page.getByText('Accepted', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Registered (I have the CNR)' }).click();
    await page.getByLabel('CNR (16 characters)').fill('KLAL170000032026');
    await page.getByRole('button', { name: 'Save and connect to eCourts' }).click();
    await page.getByText('Registered', { exact: true }).first().waitFor();
    const done = (await api('GET', `/efiling/filings/${f2.id}`)).body;
    expect(done).toMatchObject({ status: 'registered', objections: 'Index page missing.', cnr: 'KLAL170000032026' });
    expect(((done as { events: unknown[] }).events).length).toBeGreaterThan(5);

    // Withdraw / reopen / delete on a third filing.
    const { body: f3 } = await api<{ id: string }>('POST', '/efiling/filings', { caseId, kind: 'deficit_court_fee' });
    await page.goto(`${WEB}/app/efiling?filing=${f3.id}`, { waitUntil: 'domcontentloaded' });
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await page.getByText('Withdrawn', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Reopen as draft' }).click();
    await page.getByText('Draft', { exact: true }).first().waitFor();
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: '+ New Case Filing' }).waitFor();
    expect((await api('GET', `/efiling/filings/${f3.id}`)).status).toBe(404);
  });

  it('IA flow: added on portal without a number, blocked until both OTP authentications', async () => {
    const { body: ia } = await api<{ id: string }>('POST', '/efiling/filings', { caseId, kind: 'ia', title: 'E2E IA interim injunction' });
    await page.goto(`${WEB}/app/efiling?filing=${ia.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Added on the portal' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await page.getByText('On the portal', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Authenticated & submitted' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await page.getByText(/Finish these on the portal first: .*Advocate authentication.*Litigant authentication/).waitFor();
    await page.locator('section.card').first().getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByLabel('Pay the IA fee status').selectOption('not_applicable');
    await page.getByLabel('Advocate authentication status').selectOption('done');
    await page.getByLabel('Litigant authentication status').selectOption('done');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Authenticated & submitted' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await page.getByText('Final submitted', { exact: true }).first().waitFor();
    expect((await api('GET', `/efiling/filings/${ia.id}`)).body).toMatchObject({ status: 'submitted', kind: 'ia' });
  });

  it('filings list shows every filing with status', async () => {
    await page.goto(`${WEB}/app/efiling?m=filings`, { waitUntil: 'domcontentloaded' });
    await page.getByText('E2E IA interim injunction').waitFor();
    await page.getByText('E2E additional documents').waitFor();
    const list = (await api<{ items: unknown[] }>('GET', `/efiling/filings?caseId=${caseId}`)).body.items;
    expect(list.length).toBe(3);
  });

  it('advocate profile: enrolment, Bar Council, unique code, district + High Court practice locations', async () => {
    await page.goto(`${WEB}/app/efiling?m=profile`, { waitUntil: 'domcontentloaded' });
    await field('Bar Council enrolment no.').fill('k/1234/2015');
    await field('Bar Council (state)').selectOption('4');
    await field('eFiling unique advocate code').fill('kl/ws0012/2022');
    await page.getByRole('button', { name: '+ Add location' }).click();
    const rows = page.locator('div.row').filter({ has: page.getByRole('button', { name: 'Remove' }) });
    await rows.nth(0).locator('select').nth(1).selectOption('4');
    await rows.nth(0).locator('select').nth(2).selectOption('6');
    await page.getByRole('button', { name: '+ Add location' }).click();
    await rows.nth(1).locator('select').nth(0).selectOption('HC');
    await rows.nth(1).locator('select').nth(1).selectOption('4');
    await rows.nth(1).getByPlaceholder('Bench, e.g. Principal Bench').fill('Principal Seat');
    await page.getByRole('button', { name: 'Save', exact: true }).first().click();
    await page.getByText('Saved.').waitFor();
    const prof = (await api('GET', '/efiling/profile')).body;
    expect(prof).toMatchObject({
      barEnrolmentNo: 'K/1234/2015', barCouncilStateCode: 4, efilingUniqueCode: 'KL/WS0012/2022',
      practiceLocations: expect.arrayContaining([
        expect.objectContaining({ courtTier: 'DC', stateCode: 4, districtCode: 6 }),
        expect.objectContaining({ courtTier: 'HC', stateCode: 4, bench: 'Principal Seat' }),
      ]),
    });
  });

  it('portal login tab loads the 30 portal states and user types', async () => {
    await page.goto(`${WEB}/app/efiling?m=portal`, { waitUntil: 'domcontentloaded' });
    const states = page.locator('select').filter({ hasText: 'Select state' });
    await states.waitFor();
    expect(await states.locator('option').count()).toBe(31); // placeholder + 30
    expect(await page.locator('select').filter({ hasText: 'Court Nominated Official' }).count()).toBe(1);
  });
});

// The eFiling 3.0 portal's own structure (Dashboard, Case Filing wizard,
// Vakalat, Pleadings, e-Payments, Applications, Objections) - each module
// exercised through the menu, the way an advocate would use it.
describe('eFiling laid out like the portal', () => {
  let wizardId = '';
  type Filing = { status: string; efilingNo: string | null; steps: Record<string, string>; payments: Array<{ mode: string | null }>; documents: unknown[] };
  const getFiling = async (id: string) => (await api<Filing>('GET', `/efiling/filings/${id}`)).body;

  it('Dashboard: tiles count filings by portal stage and open the matching table', async () => {
    await page.goto(`${WEB}/app/efiling`, { waitUntil: 'domcontentloaded' });
    const tile = (name: string) => page.locator('button.card', { hasText: name });
    await tile('Completed Pleadings').waitFor();
    await pollFor(async () => (await tile('Completed Pleadings').innerText()).split('\n')[1]).toBe('2'); // new case + documents filing, both registered
    expect((await tile('Completed IAs').innerText()).split('\n')[1]).toBe('1');
    expect((await tile('Objections').innerText()).split('\n')[1]).toBe('0');
    await shot('dashboard');
    await page.getByRole('button', { name: /Case Filing/ }).first().click();
    await shot('menu-case-filing');
    await page.keyboard.press('Escape');
    await tile('Completed IAs').click();
    await pollFor(async () => page.getByRole('button', { name: 'Open', exact: true }).count()).toBe(1);
  });

  it('Case Filing > New Case Filing: the 7-tab wizard from Initial Inputs to e-File', async () => {
    await page.goto(`${WEB}/app/efiling?m=new_case&case=${caseId}`, { waitUntil: 'domcontentloaded' });
    // Matter comes pre-selected from the case page's "eFiling" button.
    await pollFor(async () => fieldIn(page, 'Matter').inputValue()).toBe(caseId);
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await pollFor(() => new URL(page.url()).searchParams.get('filing') ?? '').toMatch(/[0-9a-f-]{36}/);
    wizardId = new URL(page.url()).searchParams.get('filing')!;
    await page.getByText('New case added').first().waitFor();

    // Initial Inputs: the portal's sections, plus who we appear for.
    for (const s of ['District/Establishment', 'Case Types', 'Party Details']) await sec(s).waitFor();
    await pollFor(async () => fieldIn(sec('Party Details'), 'Plaintiff').inputValue()).toBe('Ramesh Kumar');
    const sureshClient = page.locator('label', { hasText: 'Suresh Babu' }).locator('input[type="checkbox"]');
    await sureshClient.check();
    await pollFor(async () => (await api<{ parties: Array<{ name: string; isClient: boolean }> }>('GET', `/efiling/cases/${caseId}/particulars`)).body.parties.find((x) => x.name === 'Suresh Babu')?.isClient).toBe(true);
    await sureshClient.uncheck();
    await pollFor(async () => (await api<{ parties: Array<{ name: string; isClient: boolean }> }>('GET', `/efiling/cases/${caseId}/particulars`)).body.parties.find((x) => x.name === 'Suresh Babu')?.isClient).toBe(false);
    await shot('initial-inputs');

    // The portal's tabs, unnumbered: Legal Heir because the case has one,
    // MVC because the case type is M.A.C.T.
    const tabNames = (await page.getByRole('tab').allInnerTexts()).map((t) => t.replace(/[^A-Za-z -]/g, '').trim());
    expect(tabNames).toEqual(['Initial Inputs', 'Litigant', 'Legal Heir', 'Fact Details', 'Case Details', 'MVC', 'e-File']);

    await page.getByRole('tab', { name: 'Litigant', exact: true }).click();
    await page.getByText('Note: This tab is compulsary').waitFor();
    await page.getByRole('note', { name: 'Case summary' }).getByText('Munsiff Court, Chengannur').waitFor();
    await page.getByRole('button', { name: /View Previous Parties \(\d+\)/ }).click();
    await page.getByRole('cell', { name: 'Suresh Babu', exact: true }).first().waitFor();
    await shot('litigant');

    await page.getByRole('button', { name: 'Next', exact: true }).last().click(); // Legal Heir
    await page.getByText('*Note: Legal Heir details tab').waitFor();
    await page.getByRole('button', { name: '+ Add legal heir of Suresh Babu' }).click();
    const heir = page.locator('div.col', { has: page.getByRole('button', { name: 'Save', exact: true }) }).last();
    await fieldIn(heir, 'Legal Heir Name').fill('Heir One');
    await fieldIn(heir, 'Address').fill('Kallissery, Chengannur');
    await heir.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('· legal heir of Suresh Babu').waitFor();

    await page.getByRole('tab', { name: 'Fact Details', exact: true }).click();
    await pollFor(async () => fieldIn(page, 'Fact').inputValue()).toBe('Lease agreement signed.');
    await page.getByRole('button', { name: 'Next', exact: true }).last().click(); // Case Details
    await pollFor(async () => fieldIn(page, 'Prayer').inputValue()).toBe('Decree for Rs. 2,40,000 with interest');
    await shot('case-details');
    await page.getByRole('button', { name: 'Next', exact: true }).last().click(); // MVC
    await page.getByRole('heading', { name: 'Motor Vehicle Challan' }).waitFor();
    await pollFor(async () => fieldIn(page, 'Vehicle Regn. No.').inputValue()).toBe('KL-30-A-1234');
    await page.getByRole('button', { name: 'Next', exact: true }).last().click(); // e-File

    // e-File: the review, then "eFile Case" with the portal's own warning.
    await page.getByRole('button', { name: /Litigant/ }).first().waitFor();
    await page.getByPlaceholder('e.g. KL02010045672026').fill('KL020100999992026');
    let warning = '';
    page.once('dialog', (d) => { warning = d.message(); void d.accept(); });
    await page.getByRole('button', { name: 'eFile Case' }).click();
    await pollFor(async () => (await getFiling(wizardId)).status).toBe('efiled');
    expect(warning).toContain('Do you want to submit the case?');
    expect((await getFiling(wizardId)).efilingNo).toBe('KL020100999992026');
    await page.getByText('Case registration successfully KL020100999992026').waitFor();
    await shot('efile');
  });

  it('Vakalat: mark the offer accepted, and Print Vakalat links to the vakalatnama generator', async () => {
    await page.goto(`${WEB}/app/efiling?m=vakalat`, { waitUntil: 'domcontentloaded' });
    expect(await page.getByRole('link', { name: /Print Vakalat/ }).getAttribute('href')).toBe('/app/calculators?tab=vakalatnama');
    await page.locator('div.row', { hasText: 'KL020100999992026' }).locator('select').first().selectOption('done');
    await pollFor(async () => (await getFiling(wizardId)).steps.vakalat).toBe('done');
  });

  it('Pleadings: Pleading Upload -> bundle, Indexing page ranges, eSign signatories, Record Oath', async () => {
    await page.goto(`${WEB}/app/efiling?m=pleadings`, { waitUntil: 'domcontentloaded' });
    await fieldIn(page, 'Filing').selectOption(wizardId);
    const docSelect = page.locator('select').filter({ hasText: "Add a PDF from this matter's documents" });
    await docSelect.selectOption(docIds[0]!);
    await docSelect.selectOption(docIds[1]!);
    await page.getByRole('button', { name: 'Save order' }).click();
    await pollFor(async () => (await getFiling(wizardId)).documents.length).toBe(2);
    await page.getByRole('button', { name: 'Build bundle' }).click();
    await page.getByText(/Bundle: 5 pages/).waitFor();
    await page.getByLabel('Upload pleadings status').selectOption('done');

    await page.getByRole('tab', { name: 'Indexing', exact: true }).click();
    const rows = page.locator('table.tbl tbody tr');
    await pollFor(async () => rows.allInnerTexts()).toEqual(['1\tPlaint\t2 - 4', '2\tVakalatnama\t5 - 5']);
    await page.getByLabel('Index the documents status').selectOption('done');

    await page.getByRole('tab', { name: 'Pleading eSign', exact: true }).click();
    await page.getByRole('cell', { name: 'OTP to 9876543210' }).waitFor();
    await page.getByLabel('eSign status').selectOption('done');

    // Pleadings > Video Recording: the portal's "Oath Recording" screen.
    await page.goto(`${WEB}/app/efiling?m=oath&filing=${wizardId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Oath Recording' }).waitFor();
    await page.getByLabel('Record oath status').selectOption('not_applicable');
    await pollFor(async () => (await getFiling(wizardId)).steps).toMatchObject({ upload: 'done', indexing: 'done', esign: 'done', oath: 'not_applicable' });
  });

  it('e-Payments: Court Fee Wallet explained; a fee paid from the wallet is recorded as such', async () => {
    await page.goto(`${WEB}/app/efiling?m=wallet`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Court Fee Wallet' }).first().waitFor();
    await page.getByText(/per establishment/).first().waitFor();
    await page.goto(`${WEB}/app/efiling?m=payments`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'ePayments' }).first().waitFor();
    await fieldIn(page, 'Filing').selectOption(wizardId);
    const pay = page.locator('section.card', { hasText: 'Court fee and payments' });
    await fieldIn(pay, 'Amount (₹)').fill('4320');
    await fieldIn(pay, 'GRN').fill('KL26GRN00099999');
    await fieldIn(pay, 'Paid via').selectOption('wallet');
    await pay.getByRole('button', { name: 'Record payment' }).click();
    await pay.getByText(/court fee wallet/).waitFor();
    expect((await getFiling(wizardId)).payments).toMatchObject([{ mode: 'wallet' }]);
  });

  it('e-Payments: "Open ePay with this case" carries the court, party, amount and mobile; the fill bookmark is offered', async () => {
    const filing = await getFiling(wizardId) as unknown as { caseId: string; cnr: string | null };
    const { body: bundle } = await api<{ particulars: { stateCode: number | null; districtCode: number | null; estCode: string | null } }>(
      'GET', `/efiling/cases/${filing.caseId}/particulars`);
    await page.goto(`${WEB}/app/efiling?m=payments&filing=${wizardId}`, { waitUntil: 'domcontentloaded' });
    await fieldIn(page, 'Filing').selectOption(wizardId);
    const pay = page.locator('section.card', { hasText: 'Court fee and payments' });
    await fieldIn(pay, 'Amount (₹)').fill('1250');
    await fieldIn(pay, 'ePay OTP mobile').fill('9876543210');
    const link = pay.getByRole('link', { name: 'Open ePay with this case ↗' });
    const sent = async () => {
      const href = (await link.getAttribute('href')) ?? '';
      expect(href.startsWith('https://pay.ecourts.gov.in/epay/#lexdraft=')).toBe(true);
      return JSON.parse(decodeURIComponent(href.split('#lexdraft=')[1]!)) as Record<string, unknown>;
    };
    // The court comes from the particulars query, which may land after the typing.
    await pollFor(sent).toMatchObject({
      v: 1, amount: 1250, mobile: '9876543210', cnr: filing.cnr,
      state: bundle.particulars.stateCode, district: bundle.particulars.districtCode, est: bundle.particulars.estCode,
    });
    await pay.getByRole('button', { name: 'First time? Set up one-click fill' }).click();
    const bm = pay.getByRole('link', { name: 'LexDraft Fill' });
    expect((await bm.getAttribute('href'))?.startsWith('javascript:')).toBe(true);
  });

  it('Applications: new IA -> Applications -> Pay Fees -> Authentication -> Submitted Applications', async () => {
    await page.goto(`${WEB}/app/efiling?m=applications`, { waitUntil: 'domcontentloaded' });
    await fieldIn(page, 'New application in matter').selectOption(caseId);
    await fieldIn(page, 'Application').fill('E2E IA for appointment of commissioner');
    await page.getByRole('button', { name: '+ New application' }).click();
    await page.getByRole('tab', { name: 'Applications', exact: true }).waitFor();
    await pollFor(async () => fieldIn(page, 'Filing').inputValue()).toMatch(/[0-9a-f-]{36}/);
    const iaId = await fieldIn(page, 'Filing').inputValue();
    await page.getByLabel('Add the application status').selectOption('done');
    await page.getByRole('button', { name: 'Added on the portal' }).click();
    await pollFor(async () => (await getFiling(iaId)).status).toBe('efiled');

    await page.getByRole('tab', { name: 'Pay Fees', exact: true }).click();
    await page.getByLabel('Pay the IA fee status').selectOption('not_applicable');
    await page.getByRole('tab', { name: 'Authentication', exact: true }).click();
    await page.getByLabel('Advocate authentication status').selectOption('done');
    await page.getByLabel('Litigant authentication status').selectOption('done');
    await pollFor(async () => (await getFiling(iaId)).steps).toMatchObject({ ia_auth_advocate: 'done', ia_auth_litigant: 'done' });
    await page.getByRole('button', { name: 'Authenticated & submitted' }).click();
    await pollFor(async () => (await getFiling(iaId)).status).toBe('submitted');

    await page.getByRole('button', { name: 'Submitted Applications' }).click();
    await page.getByText('E2E IA for appointment of commissioner').waitFor();
  });

  it('Objections: listed with the registry\'s text; "Re-filed after curing" moves it on', async () => {
    const { body: f } = await api<{ id: string }>('POST', '/efiling/filings', { caseId, kind: 'misc_document', title: 'E2E documents with objections' });
    for (const s of ['upload', 'esign']) await api('PATCH', `/efiling/filings/${f.id}`, { steps: { [s]: 'done' } });
    for (const s of ['indexing', 'oath']) await api('PATCH', `/efiling/filings/${f.id}`, { steps: { [s]: 'not_applicable' } });
    await api('POST', `/efiling/filings/${f.id}/transition`, { to: 'efiled' });
    await api('POST', `/efiling/filings/${f.id}/transition`, { to: 'submitted' });
    await api('POST', `/efiling/filings/${f.id}/transition`, { to: 'objected', objections: 'Court fee deficit of Rs. 120.' });

    await page.goto(`${WEB}/app/efiling?m=objections`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Court fee deficit of Rs. 120.').waitFor();
    await page.getByRole('button', { name: 'Re-filed after curing' }).click();
    await pollFor(async () => (await getFiling(f.id)).status).toBe('refiled');
  });
});
