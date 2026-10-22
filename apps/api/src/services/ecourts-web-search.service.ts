import { chromium, type Browser, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import { EcourtsHttpError } from '../lib/ecourts';

// Page-context callbacks below run in the browser; this package has no DOM
// lib, so declare the globals they touch (same pattern as ecourts-live).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const window: any;

// =============================================================================
// ecourts-web-search.service
//
// Everything that exists ONLY on the eCourts website (services.ecourts.gov.in),
// not in the mobile API LexDraft uses everywhere else:
//
//   Case Status   case-type      all cases of a type + year
//                 advocate-bar   advocate by Bar Council registration
//                 advocate-name  advocate by name, with Pending/Disposed
//                 party-status   party name, with Pending/Disposed
//                 act            act + section (the mobile API's act search is
//                                rejected by eCourts itself)
//   Court Orders  orders-party / orders-case / orders-date / orders-court
//   Cause List    cause-list     civil or criminal list for one court + date
//   Process       process details (summons / warrants) - see the bottom
//
// Every one of these is gated by an image CAPTCHA (process details also by an
// OTP sent to the process recipient). The advocate solves them - LexDraft
// never reads or guesses them. A real browser runs the site's own pages and
// JavaScript, so requests are exactly what the site itself sends; this
// module does not imitate or regenerate the site's request headers/tokens and
// does not disguise the browser.
//
// Results are NOT passed through as eCourts HTML. The browser reads the
// rendered result tables in place and returns plain-text rows plus the CNR
// found in each row, so nothing from the third-party page is ever injected
// into LexDraft's UI, and every row can open in LexDraft's own CNR view.
//
// Field ids, tab ids, submit functions and AJAX endpoints come from the
// site's own searchByCaseStatus.js / searchByCourtOrder.js /
// searchByCauselist.js / processDetails.js (2026-10). The site renames
// controls now and then (e.g. its case-type select), so lookups prefer
// "the visible control of this kind" over a fixed id where that's possible.
// =============================================================================

const BASE = 'https://services.ecourts.gov.in/ecourtindia_v6';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const STEP_TIMEOUT_MS = 20_000;

export type WebSearchKind =
  | 'case-type' | 'advocate-bar' | 'advocate-name' | 'advocate-causelist' | 'party-status' | 'act'
  | 'orders-party' | 'orders-case' | 'orders-date' | 'orders-court'
  | 'cause-list';

interface KindConfig {
  page: 'casestatus/index' | 'courtorder/index' | 'cause_list/index';
  /** Element id of the tab to open, if the page has tabs. */
  tab?: string;
  /** CSS selector(s) of the captcha input; every match is filled. */
  captchaInput: string;
  submitFn: string;
  /** `?p=` path of the AJAX call submitFn makes. */
  endpoint: string;
  resultDiv: string;
  /** A select the advocate must choose from, populated only inside the
   *  session (court number / judge). Its options come back with the captcha. */
  choiceSelect?: string;
}

const CASE_STATUS = 'casestatus/index' as const;
const COURT_ORDER = 'courtorder/index' as const;

const KINDS: Record<WebSearchKind, KindConfig> = {
  'case-type': {
    page: CASE_STATUS, tab: 'casetype-tabMenu', captchaInput: '#ct_captcha_code',
    submitFn: 'submitCaseType', endpoint: 'casestatus/submit_case_type', resultDiv: '#res_case_type',
  },
  'advocate-bar': {
    page: CASE_STATUS, tab: 'advname-tabMenu', captchaInput: '#adv_captcha_code',
    submitFn: 'submit_adv_name', endpoint: 'casestatus/submitAdvName', resultDiv: '#res_adv_name',
  },
  'advocate-name': {
    page: CASE_STATUS, tab: 'advname-tabMenu', captchaInput: '#adv_captcha_code',
    submitFn: 'submit_adv_name', endpoint: 'casestatus/submitAdvName', resultDiv: '#res_adv_name',
  },
  // Advocate tab, third option "Advocate's Cause List" (radTodCaseList): an
  // advocate's cases listed in this court on one date, by Bar registration.
  'advocate-causelist': {
    page: CASE_STATUS, tab: 'advname-tabMenu', captchaInput: '#adv_captcha_code',
    submitFn: 'submit_adv_name', endpoint: 'casestatus/submitAdvName', resultDiv: '#res_adv_name',
  },
  'party-status': {
    page: CASE_STATUS, tab: 'partyname-tabMenu', captchaInput: '#fcaptcha_code',
    submitFn: 'submit_party_name', endpoint: 'casestatus/submitPartyName', resultDiv: '#res_party',
  },
  act: {
    page: CASE_STATUS, tab: 'act-tabMenu', captchaInput: '#act_captcha_code',
    submitFn: 'submitAct', endpoint: 'casestatus/submitAct', resultDiv: '#res_act',
  },
  'orders-party': {
    page: COURT_ORDER, tab: 'partyname-tabMenu', captchaInput: '#order_party_captcha_code',
    submitFn: 'submitPartyName', endpoint: 'courtorder/submitPartyName', resultDiv: '#co_party',
  },
  'orders-case': {
    page: COURT_ORDER, tab: 'casenumber-tabMenu', captchaInput: '#order_case_captcha_code',
    submitFn: 'submitCaseNo', endpoint: 'courtorder/submitCaseNo', resultDiv: '#cocase_no_res',
  },
  'orders-date': {
    page: COURT_ORDER, tab: 'orderdate-tabMenu', captchaInput: '#order_date_captcha_code',
    submitFn: 'submitOrderDate', endpoint: 'courtorder/submitOrderDate', resultDiv: '#coorderdt',
  },
  'orders-court': {
    page: COURT_ORDER, tab: 'courtnumber-tabMenu',
    // The site's JS reads #order_court_captcha_code; the form field is named
    // order_no_captcha_code. Fill both.
    captchaInput: '#order_court_captcha_code, [name="order_no_captcha_code"]',
    submitFn: 'submitCourtNumber', endpoint: 'courtorder/submitCourtNo', resultDiv: '#showList_courtno',
    choiceSelect: '#nnjudgecode1',
  },
  'cause-list': {
    page: 'cause_list/index',
    // searchByCauselist.js checks #fcaptcha_code but clears
    // #cause_list_captcha_code - fill whichever exist.
    captchaInput: '#cause_list_captcha_code, #fcaptcha_code',
    submitFn: 'submit_causelist', endpoint: 'cause_list/submitCauseList', resultDiv: '#res_cause_list',
    choiceSelect: '#CL_court_no',
  },
};

export interface WebSearchScope {
  stateCode: number;
  distCode: number;
  /** Court complex code as captured in ecourts_court_complexes (the website's
   *  complex dropdown value starts with `${complexCode}@`). */
  complexCode: string;
  /** Numeric court code; selects the establishment when the complex has
   *  several (`…@Y`). */
  courtCode: number;
}

export type CaseStatusFilter = 'Pending' | 'Disposed' | 'Both';
export type OrderTypeFilter = 'both' | 'finalorder' | 'interim';

export type WebSearchFields =
  | { kind: 'case-type'; caseTypeCode: string; caseTypeName?: string; year: number; status: Exclude<CaseStatusFilter, 'Both'> }
  | { kind: 'advocate-bar'; barState: string; barCode: string; barYear: string; status: CaseStatusFilter }
  | { kind: 'advocate-name'; advocateName: string; status: CaseStatusFilter }
  | { kind: 'advocate-causelist'; barState: string; barCode: string; barYear: string; date: string }
  | { kind: 'party-status'; partyName: string; year: number; status: CaseStatusFilter }
  | { kind: 'act'; actCode: string; actName?: string; section?: string; status: Exclude<CaseStatusFilter, 'Both'> }
  | { kind: 'orders-party'; partyName: string; year: number; orderType: OrderTypeFilter }
  | { kind: 'orders-case'; caseTypeCode: string; caseTypeName?: string; regNo: string; year: number; orderType: OrderTypeFilter }
  | { kind: 'orders-date'; fromDate: string; toDate: string; orderType: OrderTypeFilter }
  | { kind: 'orders-court'; orderType: OrderTypeFilter }
  | { kind: 'cause-list'; date: string; listType: 'civ' | 'cri' };

export interface WebSearchChoice {
  label: string;
  options: Array<{ value: string; label: string }>;
}

export interface WebSearchRow {
  cells: string[];
  /** CNR found in the row's markup (links / onclick handlers), if any. */
  cino: string | null;
}

export interface WebSearchResult {
  headers: string[];
  rows: WebSearchRow[];
  /** Plain-text summary of the result area (e.g. "No records found"). */
  text: string;
}

interface Session {
  id: string;
  userId: string;
  kind: WebSearchKind | 'process';
  fields: WebSearchFields | null;
  browser: Browser;
  page: Page;
  dialogs: string[];
  idleTimer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Session>();

function touch(s: Session): void {
  clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => void closeSession(s.id), IDLE_TIMEOUT_MS);
}

async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  clearTimeout(s.idleTimer);
  await s.browser.close().catch((err) => logger.warn({ err, id }, 'ecourts-web: browser close failed'));
}

function getSession(id: string, userId: string): Session {
  const s = sessions.get(id);
  if (!s || s.userId !== userId) throw new EcourtsHttpError(404, 'This eCourts session has expired - start again.');
  touch(s);
  return s;
}

export async function endWebSearchSession(id: string, userId: string): Promise<void> {
  const s = sessions.get(id);
  if (s && s.userId === userId) await closeSession(id);
}

/** Open a fresh browser on an eCourts page. One live session per advocate. */
async function openSession(userId: string, kind: Session['kind'], fields: WebSearchFields | null, path: string): Promise<Session> {
  for (const s of [...sessions.values()]) if (s.userId === userId) await closeSession(s.id);

  // CHROMIUM_PATH: Alpine's chromium in the Docker image; unset in dev.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  const context = await browser.newContext();
  // tsx/esbuild (keepNames) can wrap named functions inside page.evaluate
  // callbacks in a `__name(fn, "name")` helper that exists only in Node. In
  // the page it threw "ReferenceError: __name is not defined" AFTER a correct
  // captcha (seen live 2026-10-20, surfaced as "Internal Server Error").
  // Defining a no-op in every page makes that class of bug impossible.
  await context.addInitScript('window.__name = window.__name || function (f) { return f; };');
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const session: Session = {
    id: randomUUID(), userId, kind, fields, browser, page, dialogs: [],
    idleTimer: setTimeout(() => {}, 0),
  };
  sessions.set(session.id, session);
  touch(session);
  page.once('crash', () => void closeSession(session.id));
  browser.once('disconnected', () => sessions.delete(session.id));
  // The site reports validation problems with alert()/confirm(); keep the
  // text so the advocate sees it instead of a silent hang.
  page.on('dialog', (d) => {
    session.dialogs.push(d.message());
    void d.dismiss().catch(() => {});
  });

  try {
    // Dropdown handlers (fillDistrict etc.) are defined by scripts that
    // finish after DOMContentLoaded - wait for `load` and for a handler
    // rather than networkidle (the site keeps background requests open).
    await page.goto(`${BASE}/?p=${path}`, { waitUntil: 'load', timeout: 45_000 });
    await page.waitForFunction(() => typeof window.ajaxCall === 'function', undefined, { timeout: STEP_TIMEOUT_MS });
    await page.evaluate(() => {
      document.querySelectorAll('.modal.show .btn-close, .modal.show [data-bs-dismiss="modal"]').forEach((b: { click: () => void }) => b.click());
    });
  } catch (err) {
    logger.warn({ err, kind }, 'ecourts-web: page load failed');
    await closeSession(session.id);
    throw new EcourtsHttpError(502, 'Could not reach the eCourts website right now. It may be limiting traffic; try again in a few minutes.');
  }
  return session;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/**
 * Set a field the way a user would - Playwright's selectOption / fill fire
 * real input+change events, so the site's own handlers (which load the next
 * dropdown) run normally. Fields the site renders hidden or read-only (chosen
 * widgets, date pickers) fall back to setting the value and dispatching
 * change; a handler error inside the page is the site's problem, not a
 * failure of ours, so it's swallowed there.
 */
async function setField(page: Page, selector: string, value: string): Promise<void> {
  const exists = await page.$(selector);
  if (!exists) throw new EcourtsHttpError(502, `The eCourts page layout has changed (missing ${selector}).`);
  const tag = await exists.evaluate((el: { tagName: string }) => el.tagName.toLowerCase());
  try {
    if (tag === 'select') await page.selectOption(selector, value, { timeout: 5_000 });
    else await page.fill(selector, value, { timeout: 5_000 });
    return;
  } catch {
    /* hidden / read-only - fall back below */
  }
  await page.evaluate(({ selector, value }) => {
    const el = document.querySelector(selector);
    el.value = value;
    try {
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
      el.dispatchEvent(new window.Event('change', { bubbles: true }));
      const $ = window.jQuery;
      if ($) $(el).trigger('chosen:updated');
    } catch { /* page handler error */ }
  }, { selector, value });
}

/** Fill every element matching a selector list (e.g. a captcha field the
 *  site's JS and form disagree on the id of). */
async function setAll(page: Page, selectorList: string, value: string): Promise<void> {
  const n = await page.evaluate(({ selectorList, value }) => {
    const els = [...(document.querySelectorAll(selectorList) as Iterable<{ value: string }>)];
    for (const el of els) el.value = value;
    return els.length;
  }, { selectorList, value });
  if (n === 0) throw new EcourtsHttpError(502, 'The eCourts page layout has changed (captcha field missing).');
}

async function clickById(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => document.getElementById(id)?.click(), id);
}

/** Wait until a select has an option matching (value or prefix); return it. */
async function waitForOption(page: Page, selector: string, match: { value?: string; prefix?: string }, what: string): Promise<string> {
  try {
    const handle = await page.waitForFunction(({ selector, match }) => {
      const opts = [...(document.querySelectorAll(`${selector} option`) as Iterable<{ value: string }>)];
      const hit = opts.find((o) => (match.value !== undefined && o.value === match.value)
        || (match.prefix !== undefined && o.value.startsWith(match.prefix)));
      return hit ? hit.value : false;
    }, { selector, match }, { timeout: STEP_TIMEOUT_MS });
    return (await handle.jsonValue()) as string;
  } catch {
    throw new EcourtsHttpError(404, `${what} is not available on the eCourts website for this court.`);
  }
}

/** Id of the first VISIBLE select whose id starts with `prefix`. */
async function visibleSelectId(page: Page, prefix: string): Promise<string | null> {
  return page.evaluate((prefix) => {
    const s = [...(document.querySelectorAll(`select[id^="${prefix}"]`) as Iterable<{ id: string; offsetParent: unknown }>)]
      .find((el) => el.offsetParent !== null);
    return s ? s.id : null;
  }, prefix);
}

/**
 * Pick an option by our code (exact, or `code^…` / `code~…` / `code-…`
 * prefix, since website values aren't guaranteed to equal mobile-API codes)
 * or, failing that, by the option label containing `name`.
 */
async function selectByCodeOrName(page: Page, selector: string, code: string, name: string | undefined, what: string): Promise<void> {
  try {
    await page.waitForFunction((selector) => document.querySelectorAll(`${selector} option`).length > 1, selector, { timeout: STEP_TIMEOUT_MS });
  } catch {
    throw new EcourtsHttpError(502, `eCourts did not load the ${what} list for this court - try again.`);
  }
  // NB: no named function consts inside page callbacks - tsx/esbuild wraps
  // them in a `__name` helper that doesn't exist in the page (seen live).
  const wanted = name ? name.toUpperCase().replace(/\s+/g, ' ').trim().split(' - ')[0]! : '';
  const value = await page.evaluate(({ selector, code, wanted }) => {
    const opts = [...(document.querySelectorAll(`${selector} option`) as Iterable<{ value: string; textContent: string }>)];
    const hit = opts.find((o) => o.value === code)
      ?? opts.find((o) => /^\d+[\^~-]/.test(o.value) && o.value.split(/[\^~-]/)[0] === code)
      ?? (wanted ? opts.find((o) => o.textContent.toUpperCase().replace(/\s+/g, ' ').trim().includes(wanted)) : undefined);
    return hit?.value ?? null;
  }, { selector, code, wanted });
  if (!value) throw new EcourtsHttpError(404, `That ${what} is not listed for this court on the eCourts website.`);
  await setField(page, selector, value);
}

async function selectCaseType(page: Page, preferred: string, code: string, name?: string): Promise<void> {
  // The site renders one case-type select per tab and has renamed them
  // (2026-10-20: the case-type tab's visible one was #case_type_2 while
  // #case_type_1 stayed hidden and empty). Use the visible one.
  const id = await visibleSelectId(page, 'case_type');
  await selectByCodeOrName(page, id ? `#${id}` : preferred, code, name, 'case type');
}

async function captchaScreenshot(page: Page): Promise<string> {
  const img = page.locator('img[src*="securimage"]:visible').first();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await img.waitFor({ state: 'visible', timeout: 10_000 });
      await page.waitForFunction(() => {
        const imgs = [...(document.querySelectorAll('img[src*="securimage"]') as Iterable<{ complete: boolean; naturalWidth: number; offsetParent: unknown }>)];
        return imgs.some((i) => i.offsetParent !== null && i.complete && i.naturalWidth > 0);
      }, undefined, { timeout: 8_000 });
      const buf = await img.screenshot({ timeout: 10_000 });
      if (buf.length > 500) return buf.toString('base64');
      lastErr = new Error(`captcha screenshot too small (${buf.length} bytes)`);
    } catch (err) {
      lastErr = err;
    }
    await page.waitForTimeout(400);
  }
  logger.warn({ err: lastErr }, 'ecourts-web: captcha screenshot failed');
  throw new EcourtsHttpError(502, 'Could not load the captcha from eCourts - try again.');
}

const STATUS_RADIO: Record<'party' | 'adv' | 'act' | 'ct', Partial<Record<CaseStatusFilter, string>>> = {
  party: { Pending: 'radP', Disposed: 'radD', Both: 'radB' },
  adv: { Pending: 'radPAdvt', Disposed: 'radDAdvt', Both: 'radBAdvt' },
  act: { Pending: 'radPAct', Disposed: 'radDAct' },
  ct: { Pending: 'radPCT', Disposed: 'radDCT' },
};

const ORDER_RADIO: Record<'party' | 'court' | 'date', Record<OrderTypeFilter, string>> = {
  party: { both: 'radBoth', finalorder: 'radfinalorder', interim: 'radinterim' },
  court: { both: 'radBoth2', finalorder: 'radfinalorder2', interim: 'radinterim2' },
  date: { both: 'radBothorderdt', finalorder: 'radfinalorderorderdt', interim: 'radinterimorderdt' },
};

async function fillKindFields(page: Page, f: WebSearchFields): Promise<void> {
  switch (f.kind) {
    case 'case-type':
      await selectCaseType(page, '#case_type_1', f.caseTypeCode, f.caseTypeName);
      await setField(page, '#search_year', String(f.year));
      await clickById(page, STATUS_RADIO.ct[f.status]!);
      return;
    case 'advocate-bar':
      await clickById(page, 'radAdvtBarCode');
      await page.waitForTimeout(300);
      await setField(page, '#adv_bar_state', f.barState);
      await setField(page, '#adv_bar_code', f.barCode);
      await setField(page, '#adv_bar_year', f.barYear);
      await clickById(page, STATUS_RADIO.adv[f.status]!);
      return;
    case 'advocate-name':
      await clickById(page, 'radAdvtName');
      await page.waitForTimeout(300);
      await setField(page, '#advocate_name', f.advocateName);
      await clickById(page, STATUS_RADIO.adv[f.status]!);
      return;
    case 'advocate-causelist':
      await clickById(page, 'radTodCaseList');
      await page.waitForTimeout(300);
      await setField(page, '#adv_bar_state', f.barState);
      await setField(page, '#adv_bar_code', f.barCode);
      await setField(page, '#adv_bar_year', f.barYear);
      // dd-mm-yyyy; the site's picker allows 7 days back to 1 month ahead.
      await setField(page, '#caselist_date', f.date);
      return;
    case 'party-status':
      await setField(page, '#petres_name', f.partyName);
      await setField(page, '#rgyearP', String(f.year));
      await clickById(page, STATUS_RADIO.party[f.status]!);
      return;
    case 'act': {
      // The act list loads only after typing a filter and pressing the
      // site's search button (fillActType). Filter by the act's first words.
      const filter = (f.actName ?? '').split(/\s+/).slice(0, 2).join(' ');
      if (filter) {
        await setField(page, '#search_act', filter);
        await page.evaluate(() => document.getElementById('fillActTypebtn')?.click());
      }
      await selectByCodeOrName(page, '#actcode', f.actCode, f.actName, 'act');
      if (f.section) await setField(page, '#under_sec', f.section);
      await clickById(page, STATUS_RADIO.act[f.status]!);
      return;
    }
    case 'orders-party':
      await setField(page, '#partynameOrder', f.partyName);
      await setField(page, '#rgyearOrder', String(f.year));
      await clickById(page, ORDER_RADIO.party[f.orderType]);
      return;
    case 'orders-case':
      await selectCaseType(page, '#case_type', f.caseTypeCode, f.caseTypeName);
      await setField(page, '#search_case_no', f.regNo);
      await setField(page, '#rgyearCaseOrder', String(f.year));
      await clickById(page, ORDER_RADIO.party[f.orderType]);
      return;
    case 'orders-date':
      // The site validates dd-mm-yyyy.
      await setField(page, '#from_date', f.fromDate);
      await setField(page, '#to_date', f.toDate);
      await clickById(page, ORDER_RADIO.date[f.orderType]);
      return;
    case 'orders-court':
      await clickById(page, ORDER_RADIO.court[f.orderType]);
      return;
    case 'cause-list':
      // dd-mm-yyyy; the site allows today back to ~1 month ahead.
      await setField(page, '#causelist_date', f.date);
      return;
  }
}

/** Options of a session-only select (court numbers / judges). */
async function readChoice(page: Page, selector: string, label: string): Promise<WebSearchChoice> {
  try {
    await page.waitForFunction((sel) => document.querySelectorAll(`${sel} option`).length > 1, selector, { timeout: STEP_TIMEOUT_MS });
  } catch {
    throw new EcourtsHttpError(404, 'eCourts lists no courts for this selection.');
  }
  const options = await page.evaluate((sel) => [...(document.querySelectorAll(`${sel} option`) as Iterable<{ value: string; textContent: string; disabled: boolean }>)]
    .filter((o) => o.value && o.value !== '0' && !o.disabled)
    .map((o) => ({ value: o.value, label: o.textContent.replace(/\s+/g, ' ').trim() })), selector);
  return { label, options };
}

// ---------------------------------------------------------------------------
// Court-scoped search flow
// ---------------------------------------------------------------------------

/**
 * Open the right eCourts page, select the court, open the search tab, fill
 * the fields, and return the CAPTCHA image for the advocate to read - plus,
 * for court-number orders and cause lists, the court/judge options to pick.
 */
export async function startWebSearch(
  userId: string,
  scope: WebSearchScope,
  fields: WebSearchFields,
): Promise<{ sessionId: string; captchaImageBase64: string; choice?: WebSearchChoice }> {
  const cfg = KINDS[fields.kind];
  const session = await openSession(userId, fields.kind, fields, cfg.page);
  const { page } = session;

  try {
    await page.waitForSelector('#sess_state_code', { state: 'attached', timeout: STEP_TIMEOUT_MS });
    await setField(page, '#sess_state_code', String(scope.stateCode));
    await waitForOption(page, '#sess_dist_code', { value: String(scope.distCode) }, 'This district');
    await setField(page, '#sess_dist_code', String(scope.distCode));
    const complexValue = await waitForOption(page, '#court_complex_code', { prefix: `${scope.complexCode}@` }, 'This court complex');
    await setField(page, '#court_complex_code', complexValue);

    // `complex@court_codes@Y` = several establishments; pick the court's.
    if (complexValue.split('@')[2] === 'Y') {
      const est = await page.waitForFunction((code) => {
        const opts = [...(document.querySelectorAll('#court_est_code option') as Iterable<{ value: string }>)].filter((o) => o.value && o.value !== '0');
        if (opts.length === 0) return false;
        const hit = opts.find((o) => o.value === code || o.value.split(/[^0-9]/)[0] === code);
        return hit ? hit.value : 'NO_MATCH';
      }, String(scope.courtCode), { timeout: STEP_TIMEOUT_MS }).then((h) => h.jsonValue() as Promise<string>);
      if (est === 'NO_MATCH') {
        throw new EcourtsHttpError(404, 'The selected court is not listed as an establishment in this complex on the eCourts website.');
      }
      await setField(page, '#court_est_code', est);
    }

    await page.waitForTimeout(500);
    if (cfg.tab) {
      await clickById(page, cfg.tab);
      await page.waitForTimeout(800);
    }
    await fillKindFields(page, fields);
    const choice = cfg.choiceSelect
      ? await readChoice(page, cfg.choiceSelect, fields.kind === 'cause-list' ? 'Court' : 'Court number / judge')
      : undefined;
    const captchaImageBase64 = await captchaScreenshot(page);
    return { sessionId: session.id, captchaImageBase64, ...(choice ? { choice } : {}) };
  } catch (err) {
    await closeSession(session.id);
    if (err instanceof EcourtsHttpError) throw err;
    logger.warn({ err, kind: fields.kind }, 'ecourts-web: could not prepare search');
    throw new EcourtsHttpError(502, 'eCourts did not respond while preparing the search - try again.');
  }
}

async function refreshCaptchaForKind(s: Session): Promise<void> {
  if (s.kind === 'process') {
    await s.page.evaluate(() => { if (typeof window.refreshCaptcha === 'function') window.refreshCaptcha(); });
  } else {
    // Re-opening the tab makes the site fetch a fresh captcha (getCaptcha).
    const tab = KINDS[s.kind].tab;
    if (tab) await clickById(s.page, tab);
    else await s.page.evaluate(() => { if (typeof window.refreshCaptcha === 'function') window.refreshCaptcha(); });
  }
  await s.page.waitForTimeout(800);
}

export async function refreshWebSearchCaptcha(sessionId: string, userId: string): Promise<{ captchaImageBase64: string }> {
  const s = getSession(sessionId, userId);
  await refreshCaptchaForKind(s);
  return { captchaImageBase64: await captchaScreenshot(s.page) };
}

export type WebSearchSubmitResult =
  | { status: 'ok'; result: WebSearchResult }
  | { status: 'retry'; reason: string; captchaImageBase64: string };

/** The site answered, but rejected the CAPTCHA the advocate typed. */
class CaptchaRejectedError extends Error {}

/** Run `fn` (a window function, with optional args) and wait for the AJAX
 *  call it makes. Returns the parsed JSON body, or throws with the site's own
 *  validation message when it refused to send anything. */
async function callSiteFunction(s: Session, fn: string, args: unknown[], endpoint: string): Promise<Record<string, unknown>> {
  s.dialogs.length = 0;
  await s.page.evaluate(() => {
    // Collect the site's validation messages (errorAlert shows a modal).
    window.__lexAlerts = [];
    const orig = window.errorAlert;
    window.errorAlert = (m: unknown) => {
      window.__lexAlerts.push(String(m));
      try { if (typeof orig === 'function') orig(m); } catch { /* ignore */ }
    };
  });
  const response = s.page.waitForResponse((r) => r.url().includes(`?p=${endpoint}`), { timeout: 25_000 }).catch(() => null);
  await s.page.evaluate(({ fn, args }) => {
    const f = window[fn];
    if (typeof f === 'function') setTimeout(() => f(...args), 0);
  }, { fn, args });
  const res = await response;
  if (!res) {
    const alerts = await s.page.evaluate(() => (window.__lexAlerts ?? []) as string[]).catch(() => [] as string[]);
    const reason = [...alerts, ...s.dialogs].map((m) => m.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)[0];
    throw new EcourtsHttpError(reason ? 400 : 504, reason ? `eCourts: ${reason}` : 'eCourts did not answer - try again.');
  }
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(await res.text());
  } catch {
    /* non-JSON - callers fall back to the DOM */
  }
  if (typeof body.errormsg === 'string' && body.errormsg) {
    const siteMsg = body.errormsg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    logger.info({ endpoint, siteMsg: siteMsg.slice(0, 200), status: body.status }, 'ecourts-web: site returned errormsg');
    // A wrong captcha comes back here (not as status 0) - surface it as such
    // so the caller can hand out a fresh captcha instead of failing the search.
    if (/captcha/i.test(siteMsg)) throw new CaptchaRejectedError(siteMsg);
    throw new EcourtsHttpError(502, siteMsg ? `eCourts: ${siteMsg.slice(0, 200)}` : 'eCourts rejected the request. Start again.');
  }
  return body;
}

/** Read the rendered results as plain text - never eCourts HTML. */
async function readResults(page: Page, selector: string): Promise<WebSearchResult> {
  await page.waitForTimeout(600);
  const result = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    let headers: string[] = [];
    const rows: Array<{ cells: string[]; cino: string | null }> = [];
    for (const table of [...(root.querySelectorAll('table') as Iterable<{ querySelectorAll: (s: string) => Iterable<unknown> }>)]) {
      const th = [...(table.querySelectorAll('th') as Iterable<{ innerText?: string }>)].map((x) => (x.innerText ?? '').replace(/\s+/g, ' ').trim());
      if (headers.length === 0 && th.some(Boolean)) headers = th;
      for (const tr of [...(table.querySelectorAll('tr') as Iterable<{ querySelector: (s: string) => unknown; querySelectorAll: (s: string) => Iterable<{ innerText?: string }>; innerHTML?: string }>)]) {
        if (tr.querySelector('th')) continue;
        const cells = [...tr.querySelectorAll('td')].map((td) => (td.innerText ?? '').replace(/\s+/g, ' ').trim());
        if (!cells.some(Boolean)) continue;
        const m = /[A-Z]{4}[A-Z0-9]{12}/.exec(tr.innerHTML ?? '');
        rows.push({ cells, cino: m ? m[0] : null });
      }
    }
    return { headers, rows, text: (root.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 600) };
  }, selector);
  return result ?? { headers: [], rows: [], text: '' };
}

/**
 * Type the advocate's CAPTCHA answer (and the court/judge they picked, where
 * the search needs one), run the site's own search, and read the results.
 */
export async function submitWebSearch(
  sessionId: string,
  userId: string,
  captchaCode: string,
  choice?: string,
): Promise<WebSearchSubmitResult> {
  const s = getSession(sessionId, userId);
  if (s.kind === 'process') throw new EcourtsHttpError(400, 'Use the process-details steps for this session.');
  const cfg = KINDS[s.kind];

  if (cfg.choiceSelect) {
    if (!choice) throw new EcourtsHttpError(400, 'Pick the court first.');
    await setField(s.page, cfg.choiceSelect, choice);
  }
  await setAll(s.page, cfg.captchaInput, captchaCode.trim());

  const args = s.fields?.kind === 'cause-list' ? [s.fields.listType] : [];
  let body: Record<string, unknown>;
  try {
    body = await callSiteFunction(s, cfg.submitFn, args, cfg.endpoint);
  } catch (err) {
    if (!(err instanceof CaptchaRejectedError)) throw err;
    await refreshCaptchaForKind(s);
    return { status: 'retry', reason: 'Incorrect captcha - try the new one.', captchaImageBase64: await captchaScreenshot(s.page) };
  }
  if (String(body.status) === '0') {
    await s.page.waitForTimeout(800);
    return { status: 'retry', reason: 'Incorrect captcha - try the new one.', captchaImageBase64: await captchaScreenshot(s.page) };
  }
  return { status: 'ok', result: await readResults(s.page, cfg.resultDiv) };
}

// ---------------------------------------------------------------------------
// Process details (summons / warrants / notices)
//
// processDetails.js flow: process ID + email + CAPTCHA -> showProcess lists
// the process; authendicateData reveals the RECIPIENT's masked email/mobile;
// sendOtp sends a code there; verify_otp returns the document path. The OTP
// goes to whoever the process was issued to - LexDraft only relays what the
// advocate types. The document is fetched inside the same browser session
// and returned as PDF bytes.
// ---------------------------------------------------------------------------

export async function startProcessDetails(userId: string, processId: string, email: string): Promise<{ sessionId: string; captchaImageBase64: string }> {
  const s = await openSession(userId, 'process', null, 'processDetails/processData');
  try {
    await setField(s.page, '#fprocess_id', processId.trim());
    if (await s.page.$('#femail_id')) await setField(s.page, '#femail_id', email.trim());
    return { sessionId: s.id, captchaImageBase64: await captchaScreenshot(s.page) };
  } catch (err) {
    await closeSession(s.id);
    if (err instanceof EcourtsHttpError) throw err;
    throw new EcourtsHttpError(502, 'eCourts did not respond while opening process details - try again.');
  }
}

export type ProcessCaptchaResult =
  | { status: 'ok'; result: WebSearchResult; recipient: { email: string | null; mobile: string | null } }
  | { status: 'retry'; reason: string; captchaImageBase64: string };

export async function submitProcessCaptcha(sessionId: string, userId: string, captchaCode: string): Promise<ProcessCaptchaResult> {
  const s = getSession(sessionId, userId);
  if (s.kind !== 'process') throw new EcourtsHttpError(400, 'Not a process-details session.');
  await setAll(s.page, '#fcaptcha_code', captchaCode.trim());
  const body = await callSiteFunction(s, 'showProcess', [], 'processDetails/showProcess');
  if (String(body.status) === '0') {
    await s.page.waitForTimeout(800);
    return { status: 'retry', reason: 'Incorrect captcha - try the new one.', captchaImageBase64: await captchaScreenshot(s.page) };
  }
  await s.page.waitForTimeout(800);
  // The site follows showProcess with authendicateData(pid), which prints the
  // recipient's masked contact details into #resemail / #resmobile.
  const pid = await s.page.evaluate(() => document.getElementById('hdn_process_id')?.value ?? '');
  if (pid) {
    await callSiteFunction(s, 'authendicateData', [pid], 'processDetails/authendicateData').catch(() => ({}));
    await s.page.waitForTimeout(500);
  }
  const recipient = await s.page.evaluate(() => ({
    email: (document.getElementById('resemail')?.innerText ?? '').replace(/^\s*Email\s*:\s*/i, '').trim() || null,
    mobile: (document.getElementById('resmobile')?.innerText ?? '').replace(/^\s*Mobile\s*:\s*/i, '').trim() || null,
  }));
  const result = await readResults(s.page, 'body .modal.show, #modal_process_data, #process_data, body');
  return { status: 'ok', result: { ...result, text: result.text.slice(0, 300) }, recipient };
}

/** Ask eCourts to send the OTP to the process recipient. */
export async function sendProcessOtp(sessionId: string, userId: string, who: { name: string; mobile: string; email: string }): Promise<{ message: string }> {
  const s = getSession(sessionId, userId);
  if (s.kind !== 'process') throw new EcourtsHttpError(400, 'Not a process-details session.');
  for (const [id, v] of [['#user_name', who.name], ['#user_mobile', who.mobile], ['#user_email', who.email]] as const) {
    if (await s.page.$(id)) await setField(s.page, id, v);
  }
  const body = await callSiteFunction(s, 'sendOtp', [], 'processDetails/sendotp');
  if (String(body.status) !== '1' || body.sent !== 'Y') {
    throw new EcourtsHttpError(400, 'eCourts could not send the verification code. Check the details match the process recipient.');
  }
  const msg = typeof body.otp_msg === 'string' ? body.otp_msg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return { message: msg || 'Verification code sent to the process recipient.' };
}

/** Verify the OTP and return the process document as PDF bytes. */
export async function verifyProcessOtp(sessionId: string, userId: string, otp: string): Promise<{ pdfBase64: string; filename: string }> {
  const s = getSession(sessionId, userId);
  if (s.kind !== 'process') throw new EcourtsHttpError(400, 'Not a process-details session.');
  await setField(s.page, '#user_otp', otp.trim());
  const body = await callSiteFunction(s, 'verify_otp', [], 'processDetails/verify_otp');
  if (String(body.status) !== '1' || typeof body.order !== 'string' || !body.order) {
    throw new EcourtsHttpError(400, 'The verification code was not accepted - check it and try again.');
  }
  // Fetch through the session (same cookies) and only accept a real PDF.
  const url = new URL(body.order, `${BASE}/`).toString();
  if (!url.startsWith(`${BASE}/`)) throw new EcourtsHttpError(502, 'eCourts returned an unexpected document location.');
  const res = await s.page.request.get(url, { timeout: 30_000 });
  let bytes = Buffer.from(await res.body());
  const start = bytes.indexOf('%PDF-');
  if (!res.ok() || start < 0) throw new EcourtsHttpError(502, 'eCourts did not return the process document.');
  bytes = bytes.subarray(start);
  await closeSession(s.id);
  const filename = (url.split('/').pop() ?? 'process.pdf').replace(/[^\w.-]/g, '_');
  return { pdfBase64: bytes.toString('base64'), filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf` };
}

process.on('beforeExit', () => {
  for (const s of sessions.values()) void closeSession(s.id);
});

/** Visible for tests: the page-context code paths, run against a fixture page. */
export const __testing = { readResults, setField, setAll };
