import type { Page } from 'playwright';
import { logger } from '../logger';
import { EcourtsHttpError } from '../lib/ecourts';
import type { FilingParticulars, FilingParty, CaseFact } from '../lib/efiling/types';
import { openPortalMenu, withPortalPage } from './efiling-live.service';
import { efilingParticularsService } from './efiling-particulars.service';
import { efilingFilingsService } from './efiling-filings.service';
import { efilingBundleService } from './efiling-bundle.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;

// =============================================================================
// efiling-portal-filing.service
//
// Files a prepared DifAi filing on the REAL portal (filing.ecourts.gov.in),
// over the advocate's own logged-in session, the way the advocate would:
// open Case Filing > New Case Filing, fill each tab's fields, and press the
// tab's own save button (the portal's insertNewPDE / insertPartyInformationTab
// / insertFactTab / insertCaseInfo / insertMVC functions - litigant.js, see
// docs/efiling-portal-reverse-engineering.md §2).
//
// The portal's form field NAMES are server-rendered and not public, so fields
// are found by their visible LABEL (and by the element ids its JS uses where
// known). Nothing is guessed silently: every tab reports what it filled, what
// it couldn't find, and what the portal said. The irreversible "eFile Case"
// is a separate call the advocate confirms in DifAi.
// =============================================================================

export interface TabReport {
  tab: 'initial' | 'litigant' | 'facts' | 'case_details' | 'mvc';
  label: string;
  status: 'done' | 'partial' | 'failed' | 'skipped';
  filled: string[];
  missing: string[];
  portal: string[];
}

export interface PortalFilingReport {
  /** The portal's temporary e-filing (PDE) number for this draft. */
  pdeNo: string | null;
  tabs: TabReport[];
}

interface FieldSpec {
  /** What the advocate would read next to the field. */
  label: RegExp;
  /** Human name for the report. */
  name: string;
  value: string | null | undefined;
  kind?: 'text' | 'select' | 'date' | 'check';
  /** Labels that must NOT match (e.g. a relative's name vs the party name). */
  not?: RegExp;
}

// ---- in-page helpers -------------------------------------------------------------

/** Record what the portal tells the advocate (its alert boxes and dialogs). */
async function listenToPortal(page: Page, opts: { acceptConfirm?: boolean } = {}): Promise<() => Promise<string[]>> {
  const dialogs: string[] = [];
  const onDialog = (d: { message: () => string; type: () => string; accept: () => Promise<void>; dismiss: () => Promise<void> }) => {
    dialogs.push(d.message());
    // Plain alerts are acknowledged. A confirm() is declined - except on
    // "eFile Case", after the advocate confirmed it in DifAi.
    void (d.type() === 'confirm' && !opts.acceptConfirm ? d.dismiss() : d.accept()).catch(() => {});
  };
  page.on('dialog', onDialog);
  await page.evaluate(() => {
    const w = globalThis as any;
    w.__difaiMsgs = [];
    for (const fn of ['errorAlert', 'successAlert']) {
      const orig = w[fn];
      if (typeof orig === 'function' && !orig.__difai) {
        const wrapped = function (this: unknown, msg: unknown) {
          w.__difaiMsgs.push(String(msg ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          return orig.apply(this, arguments as any);
        };
        (wrapped as any).__difai = true;
        w[fn] = wrapped;
      }
    }
  }).catch(() => {});
  return async () => {
    page.off('dialog', onDialog);
    const fromPage = (await page.evaluate(() => (globalThis as any).__difaiMsgs ?? []).catch(() => [])) as string[];
    return [...fromPage, ...dialogs].filter(Boolean);
  };
}

const isoToPortalDate = (v: string | null | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : (v ?? null);
};

/**
 * Fill one field inside `scope` found by its label. Selects pick the option
 * whose value or text matches; jQuery change handlers (cascades) are fired
 * the way a real change would.
 */
async function fillField(page: Page, scope: string, f: FieldSpec): Promise<boolean> {
  if (f.value == null || f.value === '') return true;
  const value = f.kind === 'date' ? isoToPortalDate(f.value) : f.value;
  return page.evaluate(({ scope, label, labelFlags, not, notFlags, value, kind }) => {
    const root = document.querySelector(scope) ?? document.body;
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').replace(/\*/g, '').trim();
    const labelOf = (el: any): string => {
      if (el.id) {
        const l = document.querySelector(`label[for="${String(el.id).replace(/"/g, '\\"')}"]`);
        if (l) return txt(l);
      }
      const wrap = el.closest('label'); if (wrap) return txt(wrap);
      const td = el.closest('td'); if (td?.previousElementSibling) return txt(td.previousElementSibling);
      const grp = el.closest('.form-group, .col-md-6, .col-sm-6, .col-md-4, .col-md-3, .col-sm-4, .row');
      const l = grp?.querySelector('label'); if (l) return txt(l);
      return String(el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.title || '');
    };
    const re = new RegExp(label, labelFlags);
    const notRe = not ? new RegExp(not, notFlags) : null;
    const vis = (e: any) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) || e.tagName === 'SELECT';
    // Choice buttons (radios) are picked by pickRadio; checkboxes only when asked.
    const controls = [...root.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=radio]), select, textarea')]
      .filter((e: any) => vis(e) && !e.disabled && !e.readOnly && (e.type !== 'checkbox' || kind === 'check'));
    const el: any = controls.find((e: any) => { const l = labelOf(e); return re.test(l) && !(notRe && notRe.test(l)); });
    if (!el) return false;
    const $ = (globalThis as any).jQuery;
    const fire = () => {
      if ($) $(el).trigger('change').trigger('chosen:updated');
      else el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (el.tagName === 'SELECT') {
      const want = String(value).toLowerCase();
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const opts = [...el.options] as any[];
      const opt = opts.find((o) => o.value === value || String(o.value).split('~').includes(String(value)))
        ?? opts.find((o) => o.text.trim().toLowerCase() === want)
        ?? opts.find((o) => norm(o.text) && norm(o.text) === norm(String(value)))
        ?? opts.find((o) => o.value && norm(o.text).includes(norm(String(value))));
      if (!opt) return false;
      el.value = opt.value;
      fire();
      return true;
    }
    if (el.type === 'checkbox' || el.type === 'radio' || kind === 'check') {
      const on = value === 'Y' || value === 'true' || value === '1';
      if (el.checked !== on) el.click();
      return true;
    }
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    fire();
    return true;
  }, {
    scope,
    label: f.label.source, labelFlags: f.label.flags,
    not: f.not?.source ?? null, notFlags: f.not?.flags ?? '',
    value: String(value), kind: f.kind ?? 'text',
  }).catch(() => false);
}

/** Click the radio whose own label matches (Civil / Criminal, Male / Female ...). */
async function pickRadio(page: Page, scope: string, label: RegExp): Promise<boolean> {
  return page.evaluate(({ scope, src, flags }) => {
    const root = document.querySelector(scope) ?? document.body;
    const re = new RegExp(src, flags);
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const radios = [...root.querySelectorAll('input[type=radio]')] as any[];
    const hit = radios.find((r) => {
      const l = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
      const own = txt(l) || txt(r.closest('label')) || txt(r.nextSibling) || String(r.value);
      return re.test(own);
    });
    if (!hit) return false;
    hit.click();
    const $ = (globalThis as any).jQuery;
    if ($) $(hit).trigger('change');
    return true;
  }, { scope, src: label.source, flags: label.flags }).catch(() => false);
}

/** Wait until a select the portal fills by AJAX has real options. */
async function waitForOptions(page: Page, selector: string, timeout = 15_000): Promise<boolean> {
  return page.waitForFunction(
    (sel) => { const s = document.querySelector(sel) as any; return !!s && s.options && [...s.options].filter((o: any) => o.value).length > 0; },
    selector,
    { timeout },
  ).then(() => true).catch(() => false);
}

/** Press a tab's save the way its button does: the portal's own function. */
async function callPortal(page: Page, fn: string, route: string, timeout = 30_000): Promise<Record<string, unknown> | null> {
  const answered = page.waitForResponse((r) => r.url().includes(route), { timeout }).catch(() => null);
  const called = await page.evaluate((name) => {
    const f = (globalThis as any)[name];
    if (typeof f !== 'function') return false;
    f();
    return true;
  }, fn).catch(() => false);
  if (!called) return null;
  const res = await answered;
  if (!res) return null;
  const json = await res.json().catch(() => null) as Record<string, unknown> | null;
  await page.waitForTimeout(500);
  return json ?? {};
}

async function openTab(page: Page, id: string): Promise<boolean> {
  const ok = await page.evaluate((tab) => {
    const el = document.getElementById(tab) as any;
    if (!el) return false;
    el.classList?.remove('disabled');
    el.click();
    return true;
  }, id).catch(() => false);
  await page.waitForTimeout(600);
  return ok;
}

async function fillAll(page: Page, scope: string, fields: FieldSpec[], report: TabReport): Promise<void> {
  for (const f of fields) {
    if (f.value == null || f.value === '') continue;
    if (await fillField(page, scope, f)) report.filled.push(f.name);
    else report.missing.push(f.name);
  }
}

const finish = (r: TabReport, saved: boolean): TabReport => {
  r.status = !saved ? 'failed' : r.missing.length ? 'partial' : 'done';
  return r;
};

// ---- the tabs ---------------------------------------------------------------------------

const PETITIONER_NAME = /(plaintiff|appellant|petitioner|complainant|applicant)/i;

function mainParty(parties: FilingParty[], side: 'petitioner' | 'respondent'): FilingParty | null {
  return parties.find((p) => p.side === side && p.isClient && !p.legalHeirOf)
    ?? parties.find((p) => p.side === side && !p.legalHeirOf)
    ?? null;
}

async function initialInputs(page: Page, p: FilingParticulars, parties: FilingParty[]): Promise<{ report: TabReport; pdeNo: string | null; mvc: boolean }> {
  const r: TabReport = { tab: 'initial', label: 'Initial Inputs', status: 'failed', filled: [], missing: [], portal: [] };
  const done = await listenToPortal(page);
  if (p.courtTier === 'HC') {
    r.missing.push('High Court filing (DifAi fills District Court filings so far - fill this one on the portal)');
    r.status = 'skipped';
    r.portal = await done();
    return { report: r, pdeNo: null, mvc: false };
  }
  // District -> Establishment (cascade), as the portal's own selects do.
  if (await fillField(page, '#frmInitialInput1', { label: /district/i, name: 'District', value: p.districtCode != null ? String(p.districtCode) : null, kind: 'select' })) {
    r.filled.push('District');
    await waitForOptions(page, '#selEstablishment');
    const est = p.estCode ?? p.establishmentName;
    if (await fillField(page, '#frmInitialInput1', { label: /establishment/i, name: 'Establishment', value: est, kind: 'select' })
      || await fillField(page, '#frmInitialInput1', { label: /establishment/i, name: 'Establishment', value: p.establishmentName, kind: 'select' })) r.filled.push('Establishment');
    else r.missing.push('Establishment');
  } else r.missing.push('District');

  // Case Types: Civil / Criminal -> Relief Sought (main case type) -> Case Type.
  if (await pickRadio(page, 'body', p.hcSide === 'criminal' ? /criminal/i : /civil/i)) r.filled.push(p.hcSide === 'criminal' ? 'Criminal' : 'Civil');
  else r.missing.push('Civil / Criminal');
  await waitForOptions(page, '#selMainCaseType');
  const relief = p.extra?.['reliefSought'];
  if (relief) {
    if (await fillField(page, 'body', { label: /relief|main case type/i, name: 'Relief Sought', value: relief, kind: 'select' })) {
      r.filled.push('Relief Sought');
      await waitForOptions(page, '#selCaseType');
    } else r.missing.push('Relief Sought');
  }
  if (await fillField(page, 'body', { label: /case\s*type/i, not: /civil|criminal/i, name: 'Case Type', value: p.caseTypeName ?? p.caseTypeCode, kind: 'select' })) r.filled.push('Case Type');
  else r.missing.push('Case Type');

  // Party Details: the main filing party and their mobile.
  const main = mainParty(parties, 'petitioner');
  await fillAll(page, '#frmInitialInput2', [
    { label: PETITIONER_NAME, not: /mobile|father|mother|husband/i, name: 'Plaintiff', value: main?.name },
    { label: /mobile/i, name: 'Mobile Number', value: main?.mobile },
  ], r);

  const res = await callPortal(page, 'insertNewPDE', 'insertNewPDE');
  const pdeNo = (await page.inputValue('#adv_pde_no').catch(() => '')) || (typeof res?.['pde_no'] === 'string' ? res['pde_no'] : '') || null;
  r.portal = await done();
  return { report: finish(r, Boolean(pdeNo)), pdeNo, mvc: res?.['macp'] === 'Y' };
}

function partyFields(x: FilingParty): FieldSpec[] {
  return [
    { label: /organi[sz]ation details/i, name: 'Organisation Details', value: x.isOrganization ? 'Y' : null, kind: 'check' },
    { label: /father|mother|husband|relation.*name/i, name: 'Relation name', value: x.relationName },
    { label: /relation/i, not: /name/i, name: 'Relation', value: x.relationType, kind: 'select' },
    { label: /(party|petitioner|respondent|plaintiff|defendant|complainant|accused|appellant|organi[sz]ation).*/i, not: /father|mother|husband|relation|mobile|type|details|count|email/i, name: 'Party Name', value: x.name },
    { label: /^\s*age/i, name: 'Age', value: x.age != null ? String(x.age) : null },
    { label: /birth/i, name: 'Date of Birth', value: x.dateOfBirth, kind: 'date' },
    { label: /email/i, name: 'Email', value: x.email },
    { label: /mobile/i, name: 'Mobile No.', value: x.mobile },
    { label: /occupation/i, name: 'Occupation', value: x.occupation },
    { label: /address/i, not: /alternate|other/i, name: 'Address', value: x.address },
    { label: /pin/i, name: 'Pin Code', value: x.pinCode },
    { label: /^\s*state/i, name: 'State', value: x.state, kind: 'select' },
    { label: /^\s*district/i, name: 'District', value: x.district, kind: 'select' },
    { label: /caste/i, name: 'Caste', value: x.extra?.['caste'] ?? null, kind: 'select' },
  ].map((f) => ({ ...f, value: f.value ?? null }) as FieldSpec);
}

async function litigants(page: Page, parties: FilingParty[]): Promise<TabReport> {
  const r: TabReport = { tab: 'litigant', label: 'Litigant', status: 'failed', filled: [], missing: [], portal: [] };
  const done = await listenToPortal(page);
  await openTab(page, 'litigant_tab');
  const list = parties.filter((x) => !x.legalHeirOf);
  let saved = 0;
  for (const x of list) {
    // Main petitioner was created on Initial Inputs; open it to complete it.
    const isMain = x === mainParty(parties, 'petitioner');
    if (isMain) {
      const opened = await page.evaluate((name) => {
        const els = [...document.querySelectorAll('[onclick*="editPDECaseParty"]')] as any[];
        const hit = els.find((e) => String(e.textContent ?? '').toLowerCase().includes(String(name).toLowerCase())) ?? els[0];
        if (!hit) return false;
        hit.click();
        return true;
      }, x.name).catch(() => false);
      if (opened) await page.waitForResponse((res) => res.url().includes('fetchPartyData'), { timeout: 15_000 }).catch(() => null);
      else { r.missing.push(`${x.name}: open the main party on the portal to complete it`); continue; }
    } else {
      await pickRadio(page, '#frmAdvParty', x.side === 'petitioner' ? /petitioner|plaintiff|appellant|complainant|applicant/i : /respondent|defendant|accused|opposite/i);
    }
    const before = r.missing.length;
    const gender = x.gender === 'M' ? /^\s*male/i : x.gender === 'F' ? /female/i : x.gender === 'T' ? /other|trans/i : null;
    if (gender && !(await pickRadio(page, '#frmAdvParty', gender))) r.missing.push(`${x.name}: Gender`);
    for (const f of partyFields(x)) {
      if (f.value == null || f.value === '') continue;
      if (await fillField(page, '#frmAdvParty', f)) r.filled.push(`${x.name}: ${f.name}`);
      else r.missing.push(`${x.name}: ${f.name}`);
    }
    const res = await callPortal(page, 'insertPartyInformationTab', 'insertPartyInformationTab');
    if (res && !res['errormsg']) saved += 1;
    else r.missing.push(`${x.name}: the portal did not save this party`);
    if (r.missing.length > before) logger.info({ party: x.id }, 'efiling-portal: some party fields not found');
  }
  r.portal = await done();
  return finish(r, saved > 0 || list.length === 0);
}

async function factDetails(page: Page, facts: CaseFact[]): Promise<TabReport> {
  const r: TabReport = { tab: 'facts', label: 'Fact Details', status: 'skipped', filled: [], missing: [], portal: [] };
  if (facts.length === 0) return r;
  const done = await listenToPortal(page);
  await openTab(page, 'fact_tab');
  for (let i = 0; i < facts.length; i += 1) {
    const rows = await page.$$eval('#frmAdvFact .csFact', (els) => els.length).catch(() => 0);
    if (rows <= i) {
      await page.evaluate(() => { const f = (globalThis as any).add_more_fact; if (typeof f === 'function') f(); }).catch(() => {});
      await page.waitForFunction((n) => document.querySelectorAll('#frmAdvFact .csFact').length > n, i, { timeout: 10_000 }).catch(() => {});
    }
    const f = facts[i]!;
    const ok = await page.evaluate(({ i, date, time, text }) => {
      const pick = (cls: string) => document.querySelectorAll(`#frmAdvFact .${cls}`)[i] as any;
      const set = (el: any, v: string | null) => {
        if (!el || v == null) return;
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      if (!pick('csFact')) return false;
      set(pick('csFactDate'), date);
      set(pick('csFactTime'), time);
      set(pick('csFact'), text);
      return true;
    }, { i, date: isoToPortalDate(f.factDate), time: f.factTime, text: f.description }).catch(() => false);
    if (ok) r.filled.push(`Fact ${i + 1}`);
    else r.missing.push(`Fact ${i + 1}`);
  }
  const res = await callPortal(page, 'insertFactTab', 'insertFact');
  r.portal = await done();
  return finish(r, Boolean(res) && !res?.['errormsg']);
}

async function caseDetails(page: Page, p: FilingParticulars): Promise<{ report: TabReport; mvc: boolean }> {
  const r: TabReport = { tab: 'case_details', label: 'Case Details', status: 'failed', filled: [], missing: [], portal: [] };
  const done = await listenToPortal(page);
  await openTab(page, 'case_detail_tab');
  await page.waitForResponse((res) => res.url().includes('getCaseActSection'), { timeout: 10_000 }).catch(() => null);
  await fillAll(page, '#frmAdvCaseDetail', [
    { label: /cause of action/i, not: /date/i, name: 'Cause of Action', value: p.causeOfAction },
    { label: /date.*cause|cause.*date/i, name: 'Date of Cause of Action', value: p.causeOfActionDate, kind: 'date' },
    { label: /important|subject|reason/i, name: 'Important Information or Subject or Reason', value: p.subject },
    { label: /valuation/i, name: 'Valuation', value: p.valuationInr != null ? String(p.valuationInr) : null },
  ], r);
  // Prayer has a known id on the portal (#frelief_offense).
  if (p.prayer) {
    const ok = await page.evaluate((v) => {
      const el = document.getElementById('frelief_offense') as any;
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, p.prayer).catch(() => false);
    if (ok || await fillField(page, '#frmAdvCaseDetail', { label: /prayer|relief/i, name: 'Prayer', value: p.prayer })) r.filled.push('Prayer');
    else r.missing.push('Prayer');
  }
  // Acts: the portal's act box is an autocomplete; type the act and take its match.
  for (const [i, a] of (p.acts ?? []).entries()) {
    const ok = await page.evaluate(({ i, act, section }) => {
      const box = document.getElementById('act_section') ?? document.querySelector('#frmAdvCaseDetail');
      const inputs = [...(box?.querySelectorAll('input[type=text]') ?? [])] as any[];
      const actIn = inputs.filter((e) => /act/i.test(`${e.id} ${e.name} ${e.placeholder}`) && !/section/i.test(`${e.id} ${e.name} ${e.placeholder}`))[i];
      const secIn = inputs.filter((e) => /section/i.test(`${e.id} ${e.name} ${e.placeholder}`))[i];
      if (!actIn) return false;
      actIn.value = act; actIn.dispatchEvent(new Event('input', { bubbles: true }));
      const $ = (globalThis as any).jQuery;
      if ($ && $(actIn).autocomplete) $(actIn).autocomplete('search', act);
      if (secIn) { secIn.value = section; secIn.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    }, { i, act: a.act, section: a.section }).catch(() => false);
    if (ok) {
      // Take the portal's own suggestion so it records the act code.
      const item = page.locator('ul.ui-autocomplete li.ui-menu-item').first();
      if (await item.isVisible({ timeout: 4000 }).catch(() => false)) await item.click().catch(() => {});
      r.filled.push(`Act${i + 1}: ${a.act} ${a.section}`);
    } else r.missing.push(`Act${i + 1}: ${a.act}`);
  }
  const res = await callPortal(page, 'insertCaseInfo', 'insertCaseInfo');
  r.portal = await done();
  return { report: finish(r, Boolean(res) && !res?.['errormsg']), mvc: res?.['macp'] === 'Y' };
}

async function mvcTab(page: Page, p: FilingParticulars): Promise<TabReport> {
  const r: TabReport = { tab: 'mvc', label: 'MVC', status: 'failed', filled: [], missing: [], portal: [] };
  const m = p.mact ?? {};
  const done = await listenToPortal(page);
  await openTab(page, 'mvc_tab');
  const injury = m.injuryType ? new RegExp(`^\\s*${m.injuryType}`, 'i') : null;
  if (injury && !(await pickRadio(page, '#frmAdvMVC', injury))) r.missing.push('Type of Injury');
  await fillAll(page, '#frmAdvMVC', [
    { label: /item/i, name: 'Item Number', value: m.itemNo },
    { label: /police station/i, not: /other/i, name: 'Police Station', value: m.policeStation, kind: 'select' },
    { label: /fir type/i, name: 'FIR Type', value: m.firType, kind: 'select' },
    { label: /fir n/i, name: 'FIR Number', value: m.firNo },
    { label: /^\s*year/i, name: 'Year', value: m.firYear != null ? String(m.firYear) : null },
    { label: /date of accident/i, name: 'Date of Accident', value: m.accidentDate, kind: 'date' },
    { label: /time of accident/i, name: 'Time of Accident', value: m.accidentTime },
    { label: /place of accident/i, name: 'Place of Accident', value: m.accidentPlace },
    { label: /^\s*name/i, name: 'Name (injured/deceased)', value: m.injuredName },
    { label: /compensation/i, name: 'Compensation Claimed', value: m.compensationClaimedInr != null ? String(m.compensationClaimedInr) : null },
    { label: /insurance/i, name: 'Insurance Company', value: m.insurer },
    { label: /vehicle type/i, name: 'Vehicle Type', value: m.vehicleType },
    { label: /regn|registration/i, name: 'Vehicle Regn. No.', value: m.vehicleRegNo },
    { label: /driving/i, name: 'Driving License', value: m.drivingLicenceNo },
    { label: /issuing/i, name: 'Issuing Authority', value: m.licenceIssuingAuthority },
  ], r);
  const res = await callPortal(page, 'insertMVC', 'insertMVC');
  r.portal = await done();
  return finish(r, Boolean(res) && !res?.['errormsg']);
}

// ---- public -----------------------------------------------------------------------------

/**
 * Fill New Case Filing tabs 1-6 on the real portal for a prepared filing and
 * save each one there, stopping before "eFile Case". The portal's temporary
 * e-filing number is recorded on the filing.
 */
export async function fillNewCaseOnPortal(sessionId: string, userId: string, firmId: string, filingId: string): Promise<PortalFilingReport> {
  const filing = await efilingFilingsService.get(filingId, firmId);
  if (filing.kind !== 'new_case') throw new EcourtsHttpError(400, 'Only a new case filing is filled on the portal this way.');
  if (!['draft', 'ready'].includes(filing.status)) throw new EcourtsHttpError(409, 'This filing is already on the portal.');
  const bundle = await efilingParticularsService.get(filing.caseId, firmId);
  if (!bundle.particulars) throw new EcourtsHttpError(400, 'Fill Initial Inputs in DifAi first.');
  const p = bundle.particulars;

  return withPortalPage(sessionId, userId, async (page) => {
    if (!(await openPortalMenu(page, /new\s*case\s*filing/i))) {
      throw new EcourtsHttpError(502, "Couldn't open Case Filing > New Case Filing on your portal account.");
    }
    if (!(await page.$('#frmInitialInput1, #frmInitialInput2'))) {
      throw new EcourtsHttpError(502, 'The New Case Filing screen on the portal is not what DifAi expects - nothing was filled.');
    }
    const tabs: TabReport[] = [];
    const first = await initialInputs(page, p, bundle.parties);
    tabs.push(first.report);
    if (!first.pdeNo) return { pdeNo: null, tabs };

    tabs.push(await litigants(page, bundle.parties));
    tabs.push(await factDetails(page, bundle.facts));
    const cd = await caseDetails(page, p);
    tabs.push(cd.report);
    if (first.mvc || cd.mvc) tabs.push(await mvcTab(page, p));

    await efilingFilingsService.update(filingId, firmId, userId, { efilingNo: first.pdeNo }).catch((err) => {
      logger.warn({ err, filingId }, 'efiling-portal: could not record the temporary e-filing number');
    });
    return { pdeNo: first.pdeNo, tabs };
  });
}

/**
 * The irreversible step: "eFile Case" on the portal (submitEfileData), only
 * after the advocate confirmed it in DifAi. Accepts the portal's own
 * "Do you want to submit the case?" confirm.
 */
export async function efileCaseOnPortal(sessionId: string, userId: string, firmId: string, filingId: string, confirmed: boolean): Promise<{ ok: boolean; pdeNo: string | null; portal: string[]; errorTabs: string[] }> {
  if (!confirmed) throw new EcourtsHttpError(400, 'Confirm "eFile Case" first - it cannot be undone.');
  const filing = await efilingFilingsService.get(filingId, firmId);
  return withPortalPage(sessionId, userId, async (page) => {
    const pdeNo = (await page.inputValue('#adv_pde_no').catch(() => '')) || filing.efilingNo || null;
    if (!pdeNo || !(await page.$('#eFile_tab'))) {
      throw new EcourtsHttpError(409, 'Open this case on the portal first (fill the tabs from DifAi), then eFile it.');
    }
    // The portal asks "Do you want to submit the case? Once submitted, case
    // details can not be modfied." - the advocate already said yes in DifAi.
    const done = await listenToPortal(page, { acceptConfirm: true });
    await openTab(page, 'eFile_tab');
    const res = await callPortal(page, 'submitEfileData', 'submitEfileData', 60_000);
    const portal = await done();
    const errorTabs = res && res['errorcode'] === 2 && res['error_tab'] && typeof res['error_tab'] === 'object' ? Object.keys(res['error_tab'] as object) : [];
    const ok = Boolean(res) && !res?.['errormsg'] && res?.['errorcode'] !== 1 && res?.['errorcode'] !== 2;
    if (ok) {
      await efilingFilingsService.transition(filingId, firmId, userId, { to: 'efiled', efilingNo: pdeNo }).catch((err) => {
        logger.warn({ err, filingId }, 'efiling-portal: eFiled on the portal but could not update the filing');
      });
    }
    return { ok, pdeNo, portal, errorTabs };
  });
}

// ---- Pleadings > Pleading Upload ------------------------------------------------------

export interface PleadingUploadReport {
  ok: boolean;
  pdeNo: string;
  title: string;
  pleadingNumber: string | null;
  portal: string[];
}

/** The portal accepts document titles of letters, digits, spaces and "_" only. */
const pleadingTitle = (raw: string): string =>
  raw.replace(/[^A-Za-z0-9 _]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Pleading';

/**
 * Upload the filing's bundle PDF as a pleading on the portal, the way the
 * advocate does on Pleadings > Pleading Upload (upload_pleading.js): pick the
 * eFiled case, give the document a title, choose the file, press Add, tick our
 * party, press Submit. Needs the case eFiled (its e-filing number) and a built
 * bundle.
 */
export async function uploadPleadingOnPortal(sessionId: string, userId: string, firmId: string, filingId: string): Promise<PleadingUploadReport> {
  const filing = await efilingFilingsService.get(filingId, firmId);
  const pdeNo = filing.efilingNo;
  if (!pdeNo) throw new EcourtsHttpError(409, 'eFile the case on the portal first - pleadings are uploaded against its e-filing number.');
  const pdf = await efilingBundleService.download(filingId, firmId).catch(() => null);
  if (!pdf) throw new EcourtsHttpError(409, 'Build the filing bundle first (Pleadings > Pleading Upload in DifAi).');
  const title = pleadingTitle(filing.title);

  return withPortalPage(sessionId, userId, async (page) => {
    if (!(await openPortalMenu(page, /pleading\s*upload|^\s*pleadings\s*$/i)) || !(await page.$('#frm_doc'))) {
      throw new EcourtsHttpError(502, "Couldn't open Pleadings > Pleading Upload on your portal account.");
    }
    const done = await listenToPortal(page);
    // Case source: an eFiled case, then its e-filing number.
    await page.evaluate(() => { const r = document.getElementById('eFiled') as any; if (r && !r.checked) r.click(); }).catch(() => {});
    await waitForOptions(page, '#sel_pde_no');
    const picked = await page.evaluate((no) => {
      const sel = document.getElementById('sel_pde_no') as any;
      if (!sel) return false;
      const want = String(no).toUpperCase();
      const opt = [...sel.options].find((o: any) => String(o.value).toUpperCase() === want || String(o.text).toUpperCase().includes(want));
      if (!opt) return false;
      sel.value = (opt as any).value;
      const $ = (globalThis as any).jQuery;
      if ($) $(sel).trigger('change').trigger('chosen:updated'); else sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, pdeNo).catch(() => false);
    if (!picked) {
      return { ok: false, pdeNo, title, pleadingNumber: null, portal: [...(await done()), `Case ${pdeNo} is not in your portal's eFiled cases list.`] };
    }
    await page.waitForTimeout(800);
    await page.fill('#file_name', title);
    await page.setInputFiles('#doc_file_name', { name: pdf.filename.endsWith('.pdf') ? pdf.filename : `${pdf.filename}.pdf`, mimeType: 'application/pdf', buffer: pdf.body });
    const added = page.waitForResponse((r) => r.url().includes('upload_pleading/addFile'), { timeout: 120_000 }).catch(() => null);
    await page.click('#add_btn');
    const addRes = await added;
    const addJson = addRes ? (await addRes.json().catch(() => null)) as Record<string, unknown> | null : null;
    if (!addJson || addJson['errormsg']) {
      return { ok: false, pdeNo, title, pleadingNumber: null, portal: await done() };
    }
    // Who the pleading is for: our side's parties (all ticked, as the advocate would for their client).
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('input[name="chk_pet_list[]"]') as any) if (!el.checked) el.click();
    }).catch(() => {});
    const res = await callPortal(page, 'submitData', 'upload_pleading/addData', 120_000);
    const portal = await done();
    const ok = Boolean(res) && !res?.['errormsg'];
    const pleadingNumber = typeof addJson['pleading_number'] === 'string' ? addJson['pleading_number'] : null;
    if (ok) {
      await efilingFilingsService.update(filingId, firmId, userId, { steps: { upload: 'done' } }).catch((err) => {
        logger.warn({ err, filingId }, 'efiling-portal: uploaded but could not mark the step');
      });
    }
    return { ok, pdeNo, title, pleadingNumber, portal };
  });
}

// ---- Dashboard > Draft Pleadings > Submit (final submission to the court) ----------

/**
 * The final submission, as on the portal: Dashboard > Draft Pleadings, choose
 * the court-fee GRN in this case's row and press its Submit (dashboard.js
 * submit_pleading). Irreversible - only with the advocate's confirmation and
 * never without a GRN recorded in DifAi.
 */
export async function submitPleadingOnPortal(sessionId: string, userId: string, firmId: string, filingId: string, confirmed: boolean): Promise<{ ok: boolean; grn: string; portal: string[] }> {
  if (!confirmed) throw new EcourtsHttpError(400, 'Confirm the final submission first - it cannot be undone.');
  const filing = await efilingFilingsService.get(filingId, firmId);
  const pdeNo = filing.efilingNo;
  if (!pdeNo) throw new EcourtsHttpError(409, 'eFile the case on the portal first.');
  const grn = (filing.payments ?? []).find((x) => x.grn && (x.purpose === 'court_fee' || x.purpose === 'deficit_court_fee'))?.grn
    ?? (filing.payments ?? []).find((x) => x.grn)?.grn;
  if (!grn) throw new EcourtsHttpError(409, 'Record the court-fee GRN in DifAi (ePayments) first - DifAi does not submit without court fee.');

  return withPortalPage(sessionId, userId, async (page) => {
    if (!(await page.$('#efiling_activity'))) await openPortalMenu(page, /dashboard|^\s*home\s*$/i);
    const done = await listenToPortal(page);
    const list = await page.evaluate(() => {
      const body = document.getElementById('history_body') as any;
      const tile = document.getElementById('efiling_activity') as any;
      if (!body || !tile) return false;
      body.innerHTML = '';
      tile.click();
      return true;
    }).catch(() => false);
    if (!list) throw new EcourtsHttpError(502, "Couldn't open Draft Pleadings on your portal dashboard.");
    await page.waitForFunction(() => String((document.getElementById('history_body') as any)?.innerHTML ?? '').trim().length > 0, undefined, { timeout: 20_000 }).catch(() => {});
    // This case's row: its Submit button carries the e-filing number.
    const row = await page.evaluate(({ no, grn }) => {
      const btn = [...document.querySelectorAll('#history_body [onclick*="submit_pleading"]')].find((b: any) => String(b.getAttribute('onclick')).toUpperCase().includes(String(no).toUpperCase())) as any;
      if (!btn) return { found: false, grnSet: false };
      const uid = /submit_pleading\(\s*['"]?([^'",)]+)/.exec(String(btn.getAttribute('onclick')))?.[1] ?? '';
      const sel = document.getElementById(uid) as any;
      if (!sel || !sel.options) return { found: true, grnSet: false };
      const opt = [...sel.options].find((o: any) => String(o.value).toUpperCase().includes(String(grn).toUpperCase()) || String(o.text).toUpperCase().includes(String(grn).toUpperCase())) as any;
      if (!opt) return { found: true, grnSet: false };
      sel.value = opt.value;
      const $ = (globalThis as any).jQuery;
      if ($) $(sel).trigger('change').trigger('chosen:updated');
      btn.setAttribute('data-difai-submit', '1');
      return { found: true, grnSet: true };
    }, { no: pdeNo, grn }).catch(() => ({ found: false, grnSet: false }));
    if (!row.found) return { ok: false, grn, portal: [...(await done()), `Case ${pdeNo} is not in your Draft Pleadings on the portal.`] };
    if (!row.grnSet) return { ok: false, grn, portal: [...(await done()), `GRN ${grn} is not offered for this case on the portal yet - check the payment there.`] };
    const answered = page.waitForResponse((r) => /submit_pleading/i.test(r.url()), { timeout: 60_000 }).catch(() => null);
    await page.click('[data-difai-submit="1"]');
    const res = await answered;
    const json = res ? (await res.json().catch(() => null)) as Record<string, unknown> | null : null;
    await page.waitForTimeout(500);
    const portal = await done();
    const ok = Boolean(json) && !json?.['errormsg'] && json?.['status'] !== false;
    if (ok) {
      await efilingFilingsService.update(filingId, firmId, userId, { steps: { final_submit: 'done' } }).catch(() => {});
      await efilingFilingsService.transition(filingId, firmId, userId, { to: 'submitted' }).catch((err) => {
        logger.warn({ err, filingId }, 'efiling-portal: submitted on the portal; DifAi status not updated');
      });
    }
    return { ok, grn, portal };
  });
}
