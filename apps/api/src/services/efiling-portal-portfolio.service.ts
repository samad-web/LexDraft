import type { Page } from 'playwright';
import { EcourtsHttpError } from '../lib/ecourts';
import { portalPost, withPortalPage } from './efiling-live.service';
import {
  goPortalDashboard, openLiveScreen, stepLiveScreen,
  type LiveScreen, type LiveStep, type LiveStepResult, type ScreenDef,
} from './efiling-portal-vakalat.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;

// =============================================================================
// efiling-portal-portfolio.service
//
// The portal's PORTFOLIO menu except My Cases (efiling-live.service.ts reads
// that widget), live over the advocate's own logged-in portal session.
//
// From the portal's public scripts (docs/efiling-portal-reverse-engineering.md §9):
//   * Search Cases - js/portfolio/search_cases.js. Two ways in: CNR
//     (hideshow(1), #cnr_search, #cnr1 -> cnrsearch()) and Case Status
//     (hideshow(2)), with the court picked first (district court: #selState /
//     #selDistrict -> portfolio/getEstablishment/ -> #selEstSearchCases; High
//     Court: #sessionState1 -> #selBencheSearchCases). searchBy(...) shows one
//     of: caseNumber (#case_type, #search_case_no, #rgyear -> getCaseNumber/),
//     partyName (#party_name, #rgyear_partyname, Pending/Disposed ->
//     getByPartyName/), caseType (#case_type1, #rgyear_casetype ->
//     getByCaseType/), filingNumber (#search_filing_no, #year_filing ->
//     getFilingNumber/), firNumber (#police_station, #fir_no, #rgyear_fir ->
//     getByPoliceStation/), advocateName (by name / bar code / case list date
//     -> getByAdvocate/), act (#search_act -> getActType/, #act_type,
//     #under_section -> getByAct/), caveat (Anywhere / Starting With /
//     Subordinate Court / Quasi Judicial / High Court / Caveat No. ->
//     getByCaveat/). Results go to #case_status11; a case there ->
//     cnrsearch(this) -> listOfCasesWebService/ then getCaseHistory/ or
//     getFilingCaseHistory/ into #case_status111, with Add Case (#addCase ->
//     portfolio/addCase/) unless it is already saved (#savedCase), Back, and
//     the hearing dates (viewBusiness -> getViewBusiness/ -> #show_business).
//   * Import / Export / Delete my cases - js/portfolio/mycases_common_
//     functions.js and the modals every portal page carries
//     (#importCasesModal, #exportCasesConfirm, #deleteCasesModal).
//   * Planner (?p=Portfolio/calendar) - js/portfolio/calendar.js + case_history.js:
//     a FullCalendar month of My Cases (portfolio/getMyCasesData/) with case
//     counts and the advocate's events (portfolio/getAllPreviousEvents/); a
//     case (.case_history_link) -> portfolio/getCaseHistory/ in
//     #case_history with Add Note (portfolio/addNote/), events (editEvent/,
//     deleteEvent/), Remove (removecase/) and the hearing dates (viewBusiness).
//   The real menu, in order: Search Cases (?p=Portfolio/search_cases),
//   Planner (?p=Portfolio/calendar), Export Cases (onExportClick()), My Cases
//   (?p=Portfolio_new/my_cases), Import Cases (openImport()).
//
// Search Cases and Planner are driven on the portal page itself (the same
// live-screen engine as Vakalat): DifAi sets the fields and presses the
// buttons there and the portal's own script makes its own requests.
// Import / Export / Delete are the exact requests mycases_common_functions.js
// makes, sent over the same session and token chain (portalPost).
// =============================================================================

export type PortfolioView = 'search_cases' | 'planner';

export const PORTFOLIO_SCREENS: Record<PortfolioView, ScreenDef> = {
  search_cases: { menu: /portfolio/i, item: /search\s*cases?/i, label: 'Search Cases' },
  planner: { menu: /portfolio/i, item: /^\s*planner\s*$/i, label: 'Planner' },
};

export async function openPortfolioScreen(sessionId: string, userId: string, view: PortfolioView): Promise<LiveScreen> {
  return withPortalPage(sessionId, userId, (page) => openLiveScreen(page, view, PORTFOLIO_SCREENS[view]));
}

export async function stepPortfolioScreen(sessionId: string, userId: string, view: PortfolioView, step: LiveStep): Promise<LiveStepResult> {
  return withPortalPage(sessionId, userId, (page) => stepLiveScreen(page, view, PORTFOLIO_SCREENS[view], step));
}

// ---- Import / Export / Delete my cases (mycases_common_functions.js) ----------------------

export type CourtType = 'D' | 'H';

/** The file names the portal writes and insists on (createMyCasesToExport / checkImportFile). */
export const MY_CASES_FILE: Record<CourtType, string> = { D: 'myCases.txt', H: 'hcMyCases.txt' };

/** A page of the advocate's portal with its request channel (#__csrf_magic). */
async function onPortalPage(page: Page): Promise<void> {
  if (!(await page.$('#__csrf_magic'))) await goPortalDashboard(page);
  if (!(await page.$('#__csrf_magic'))) throw new EcourtsHttpError(502, "The eFiling portal page didn't load - it may be slow right now. Try again.");
}

/** What the portal keeps in the browser for these requests. */
async function pageSettings(page: Page): Promise<{ selectedCourt: string; appVersion: string; language: string; bilingual: number }> {
  return page.evaluate(() => {
    const w = globalThis as any;
    const ss = (k: string) => { try { return w.sessionStorage.getItem(k); } catch { return null; } };
    const ls = (k: string) => { try { return w.localStorage.getItem(k); } catch { return null; } };
    // search_cases.js / dashboard.js: #sessionSelCourtType 2 -> 'D', else 'H'.
    const typeEl = document.getElementById('sessionSelCourtType') as any;
    const fromType = typeEl ? (String(typeEl.value) === '2' ? 'D' : 'H') : null;
    const langEl = document.getElementById('sessionlangid') as any;
    return {
      selectedCourt: ss('SELECTED_COURT') ?? fromType ?? 'D',
      // JS string concatenation of an unset value.
      appVersion: ss('CURRENT_APP_VERSION') ?? 'undefined',
      language: ls('LANGUAGE_FLAG') || 'english',
      bilingual: langEl && String(langEl.value) === '1' ? 1 : 0,
    };
  });
}

const errOf = (json: Record<string, unknown> | null) => (json && typeof json['errormsg'] === 'string' && json['errormsg'] ? String(json['errormsg']) : '');

export interface ExportResult {
  court: CourtType;
  fileName: string;
  /** The file's text, exactly as the portal's Download link holds it. */
  content: string;
  count: number;
  /** "No Cases to Export" when there is nothing, as the portal says. */
  message: string | null;
}

/**
 * Export my cases: portfolio/getMyCasesData/ (configuration = the session's
 * SELECTED_COURT) -> createJsonArrayToExport() for District (mycases_dc) or
 * High Court (mycases_hc): a JSON array of JSON strings with the portal's
 * keys in the portal's order, saved as myCases.txt / hcMyCases.txt.
 */
export async function exportMyCases(sessionId: string, userId: string, court: CourtType): Promise<ExportResult> {
  return withPortalPage(sessionId, userId, async (page) => {
    await onPortalPage(page);
    const { selectedCourt } = await pageSettings(page);
    const r = await portalPost(page, 'portfolio/getMyCasesData/', `configuration=${selectedCourt}`);
    if (!r.json) throw new EcourtsHttpError(502, "The eFiling portal didn't send your cases. Try again.");
    const err = errOf(r.json);
    if (err) throw new EcourtsHttpError(502, err);
    const list = r.json[court === 'D' ? 'mycases_dc' : 'mycases_hc'];
    const cases = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
    const content = JSON.stringify(cases.map((o) => JSON.stringify(exportRecord(o))));
    return { court, fileName: MY_CASES_FILE[court], content, count: cases.length, message: cases.length ? null : 'No Cases to Export' };
  });
}

/** createJsonArrayToExport(): one case as the portal writes it (undefined keys drop out, as in JSON.stringify). */
export function exportRecord(o: Record<string, unknown>): Record<string, unknown> {
  const j: Record<string, unknown> = {};
  j['cino'] = o['cino'];
  j['type_name'] = o['type_name'];
  j['case_no'] = o['case_no'];
  j['reg_year'] = o['reg_year'];
  j['reg_no'] = o['reg_no'];
  j['petparty_name'] = o['pet_name'];
  j['resparty_name'] = o['res_name'];
  j['fil_year'] = o['fil_year'];
  j['fil_no'] = o['fil_no'];
  j['establishment_name'] = o['establishment_name'];
  j['establishment_code'] = o['establishment_code'];
  j['state_code'] = o['state_code'];
  j['district_code'] = o['district_code'];
  j['state_name'] = o['state_name'];
  j['district_name'] = o['district_name'];
  j['date_next_list'] = o['date_next_list'] === '5000-01-01' ? 'Date Not Given' : o['date_next_list'];
  j['date_of_decision'] = o['date_of_decision'];
  j['date_last_list'] = o['date_last_list'];
  j['updated'] = true;
  j['court_no_desg_name'] = o['desg_name'];
  j['ltype_name'] = o['ltype_name'];
  j['lpetparty_name'] = o['lpet_name'];
  j['lresparty_name'] = o['lres_name'];
  j['lestablishment_name'] = o['lestablishment_name'];
  j['lstate_name'] = o['lstate_name'];
  j['ldistrict_name'] = o['ldistrict_name'];
  j['lcourt_no_desg_name'] = o['ldesgname'];
  j['updated'] = '';
  return JSON.parse(JSON.stringify(j)) as Record<string, unknown>;
}

export interface ImportResult {
  /** Cases the file held. */
  inFile: number;
  /** Cases the portal added (insertIntoMyCases/ answered with them). */
  added: number;
  /** What the portal said ("Unable to add 2 cases" ...). */
  messages: string[];
}

/** checkImportFile(): the right file for the court, and JSON - before anything is sent. */
export function checkImportFile(court: CourtType, fileName: string, content: string): string[] {
  if (court === 'D' && fileName !== MY_CASES_FILE.D) throw new EcourtsHttpError(400, 'Please select file myCases.txt');
  if (court === 'H' && fileName !== MY_CASES_FILE.H) throw new EcourtsHttpError(400, 'Please select file hcMyCases.txt');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new EcourtsHttpError(400, 'Incorrect file format');
  }
  // onImportClick() reads each entry with JSON.parse: the exported shape.
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) throw new EcourtsHttpError(400, 'Incorrect file format');
  for (const s of parsed as string[]) {
    try {
      const c = JSON.parse(s) as { cino?: unknown };
      if (!c || typeof c.cino !== 'string' || !c.cino) throw new Error('no cino');
    } catch {
      throw new EcourtsHttpError(400, 'Incorrect file format');
    }
  }
  return parsed as string[];
}

/**
 * Import cases (onImportClick -> updateImportedCases -> insertIntoMycases):
 * portfolio/refreshMyCases/ for the file's CNRs, each case rebuilt from the
 * portal's fresh record, then portfolio/insertIntoMyCases/ with the court.
 */
export async function importMyCases(sessionId: string, userId: string, court: CourtType, fileName: string, content: string, confirmed: boolean): Promise<ImportResult> {
  if (!confirmed) throw new EcourtsHttpError(400, 'Importing adds these cases to My Cases on your eFiling portal account - confirm it first.');
  const imported = checkImportFile(court, fileName, content);
  return withPortalPage(sessionId, userId, async (page) => {
    await onPortalPage(page);
    const s = await pageSettings(page);
    const cnrNumbers = imported.map((x) => String((JSON.parse(x) as { cino: string }).cino)).join(',');
    const refresh = await portalPost(page, 'portfolio/refreshMyCases/',
      `cnr_numbers=${cnrNumbers}&action_code=list&version_number=${s.appVersion}&language_flag=${s.language}&bilingual_flag=${s.bilingual}&selected_court=${court}`);
    const messages: string[] = [];
    const e1 = errOf(refresh.json);
    if (e1) messages.push(e1);
    const today = refresh.json?.['todaysCiNos'];
    // The portal's callback only continues when the refresh sent todaysCiNos.
    if (!today) {
      if (!messages.length) messages.push("The eFiling portal didn't refresh these cases, so nothing was imported.");
      return { inFile: imported.length, added: 0, messages };
    }
    const arr = [...imported];
    for (const val of Object.values(today as Record<string, unknown>) as Array<Record<string, unknown> | null>) {
      if (!val) continue;
      const cino = String(val['cino'] ?? '');
      // Array.prototype.containsSubStringOrHasSubstringOf
      const index = arr.findIndex((x) => x.indexOf(cino) !== -1 || cino.indexOf(x) !== -1);
      if (index === -1) continue;
      const obj = JSON.parse(arr[index]!) as Record<string, unknown>;
      const j: Record<string, unknown> = {
        type_name: val['type_name'], state_code: val['state_code'], district_code: val['district_code'],
        establishment_name: val['court_name'], establishment_code: val['est_code'], state_name: val['state_name'], district_name: val['district_name'],
        case_no: val['case_no'], reg_year: val['reg_year'], reg_no: val['reg_no'], fil_year: val['fil_year'], fil_no: val['fil_no'],
        date_next_list: val['date_next_list'] === '5000-01-01' ? 'Date Not Given' : val['date_next_list'],
        date_last_list: val['date_last_list'], date_of_decision: val['date_of_decision'], updated: '',
        desgname: `${String(val['courtno'])}-${String(val['desgname'])}`, ltype_name: val['ltype_name'],
        pet_name: obj['petparty_name'] ? obj['petparty_name'] : obj['pet_name'],
        res_name: obj['resparty_name'] ? obj['resparty_name'] : obj['res_name'],
        lpet_name: val['lpet_name'], lres_name: val['lres_name'], lestablishment_name: val['lcourt_name'], lstate_name: val['lstate_name'], ldistrict_name: val['ldistrict_name'],
        ldesgname: `${String(val['courtno'])}-${String(val['ldesgname'])}`, purpose_name: val['purpose_name'], lpurpose_name: val['lpurpose_name'],
        purpose_cd: val['purpose_next'], registration_date: val['dt_regis'], ci_cri: val['ci_cri'], cino: val['cino'],
      };
      arr[index] = JSON.stringify(j);
    }
    const insert = await portalPost(page, 'portfolio/insertIntoMyCases/', `casesImported=${encodeURIComponent(JSON.stringify(arr))}&configuration=${court}`);
    const e2 = errOf(insert.json);
    if (e2) messages.push(e2);
    let added = 0;
    try {
      const parsed = insert.json ?? (JSON.parse(insert.text) as unknown);
      added = Array.isArray(parsed) ? parsed.length : Number((parsed as { length?: unknown })?.length ?? 0) || 0;
    } catch { added = 0; }
    const notAdded = arr.length - added;
    if (notAdded > 0) messages.push(`Unable to add ${notAdded} cases`);
    return { inFile: imported.length, added, messages };
  });
}

/** Delete my cases (onDeleteMycasesClick): portfolio/deleteMyCases/ -> option 'success'. */
export async function deleteMyCases(sessionId: string, userId: string, confirmed: boolean): Promise<{ ok: boolean; message: string | null }> {
  if (!confirmed) throw new EcourtsHttpError(400, 'Deleting removes every case from My Cases on your eFiling portal account - confirm it first.');
  return withPortalPage(sessionId, userId, async (page) => {
    await onPortalPage(page);
    const r = await portalPost(page, 'portfolio/deleteMyCases/', '');
    const err = errOf(r.json);
    if (r.json?.['option'] === 'success') return { ok: true, message: null };
    return { ok: false, message: err || "The eFiling portal didn't delete your cases." };
  });
}
