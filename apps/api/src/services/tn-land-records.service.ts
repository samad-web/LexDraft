import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import { HttpError } from '../lib/errors';

// Page-context callbacks below run in the browser; this package has no DOM
// lib, so declare the globals they touch (same pattern as ecourts-web-search).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const window: any;

// =============================================================================
// tn-land-records.service
//
// Tamil Nadu Land Records eServices (eservices.tn.gov.in/eservicesnew, CLA /
// Survey & Settlement). Every service the site's home menu offers, in its
// order and with its labels:
//
//   patta          View Patta / Chitta / FMB - (Rural / Natham) mobile OTP AC01
//   a-register     View A-Register Extract - (Rural / Natham)  mobile OTP AC02
//   verify-patta   Verify Patta / Chitta - (Rural / Natham)    mobile OTP AC07
//   poramboke      Verify Government / Private (Poramboke)     CAPTCHA
//   fmb            FMB Sketch - (Rural / Natham)                mobile OTP AC03
//   order-copy     View Patta Order Copy                        mobile OTP AC06
//   tslr-extract   TSLR Extract                                 mobile OTP AC04
//   tslr-sketch    TSLR Sketch - Urban                          mobile OTP AC05
//   app-status     Application Status                           CAPTCHA
//   fline          F-Line Sketch / Statement                    CAPTCHA
//
// ("Integrated Land Record" is skipped: the site's own link carries rno=null
// and answers "INVALID ACCESS TO THE SITE!" - seen 2026-10-24.)
//
// Same rules as the eCourts website searches: a real browser opens the home
// page and follows the site's own menu link (each link carries a one-time
// token the site issues per visit), the site's own JavaScript loads every
// dropdown, and the advocate supplies the gate - the OTP the site texts to
// the mobile number the advocate enters, or the CAPTCHA they read. LexDraft
// never reads, guesses or replays either, and does not regenerate the
// site's tokens outside its own pages.
//
// Results come back as plain text (key/value pairs and table rows read off
// the rendered page) plus a PDF print of that page, so nothing from the
// third-party page is injected into LexDraft's UI. The PDF can be filed into
// a matter's documents or a title report's search trail.
//
// Field ids and functions come from the site's land/*.html, js/common.js,
// js/landform.js and js/captcha.js (2026-10-24).
// =============================================================================

const BASE = 'https://eservices.tn.gov.in/eservicesnew';
const IDLE_TIMEOUT_MS = 8 * 60 * 1000;
const STEP_TIMEOUT_MS = 20_000;

export type LandService =
  | 'patta' | 'a-register' | 'verify-patta' | 'poramboke' | 'fmb'
  | 'order-copy' | 'tslr-extract' | 'tslr-sketch' | 'app-status' | 'fline';

/** Which form the service page shows. */
type FormShape =
  | 'rural'        // District > Taluk (code/natham flag) > Village, Survey text -> Sub Division list
  | 'rural-plain'  // District > Taluk > Village, Survey + Sub Division as text (poramboke)
  | 'urban'        // District > Taluk > Town > Ward > Block > Survey list > Sub Division list
  | 'appid'        // Application Id
  | 'refno';       // Reference Number

interface ServiceConfig {
  /** The home-page menu link (path before `?`). */
  href: string;
  /** The site's menu label. */
  title: string;
  gate: 'otp' | 'captcha';
  /** otpgenerate / verify_otp action id. */
  action?: string;
  form: FormShape;
  /** Captcha input id, for CAPTCHA services. */
  captchaInput?: string;
  /** The result opens in a new window (FMB / TSLR sketch via Collabland). */
  popup?: boolean;
  /** OTP services whose Submit block, revealed after the OTP is confirmed,
   *  also holds a captcha (Order Copy: #captEntr, Verify Patta: #captcha). */
  captchaAfterOtp?: string;
}

export const LAND_SERVICES: Record<LandService, ServiceConfig> = {
  'patta':        { href: 'land/chittaCheckNewRural_en.html', title: 'View Patta / Chitta / FMB - (Rural / Natham)', gate: 'otp', action: 'AC01', form: 'rural' },
  'a-register':   { href: 'land/areg.html', title: 'View A-Register Extract - (Rural / Natham)', gate: 'otp', action: 'AC02', form: 'rural' },
  'verify-patta': { href: 'land/verify_chitta.html', title: 'Verify Patta / Chitta - (Rural / Natham)', gate: 'otp', action: 'AC07', form: 'refno', captchaAfterOtp: '#captcha' },
  'poramboke':    { href: 'land/poramboke.html', title: 'Verify Government / Private (Poramboke) Land', gate: 'captcha', form: 'rural-plain', captchaInput: '#captcha' },
  'fmb':          { href: 'land/chittaCheckNewRuralFMB_en.html', title: 'FMB Sketch - (Rural / Natham)', gate: 'otp', action: 'AC03', form: 'rural', popup: true },
  'order-copy':   { href: 'land/orderCopy.html', title: 'View Patta Order Copy', gate: 'otp', action: 'AC06', form: 'appid', captchaAfterOtp: '#captEntr' },
  'tslr-extract': { href: 'land/chittaCheckNewUrban_en.html', title: 'TSLR Extract', gate: 'otp', action: 'AC04', form: 'urban' },
  'tslr-sketch':  { href: 'land/chittaCheckNewUrbanFMB_en.html', title: 'TSLR Sketch - Urban', gate: 'otp', action: 'AC05', form: 'urban', popup: true },
  'app-status':   { href: 'login/Appstatus.html', title: 'Application Status', gate: 'captcha', form: 'appid', captchaInput: '#captEntr' },
  'fline':        { href: 'land/fline_en.html', title: 'F-Line Sketch / Statement', gate: 'captcha', form: 'appid', captchaInput: '#captEntr' },
};

/** A dropdown the advocate picks from; options come live from the site. */
export type LandListField = 'district' | 'taluk' | 'village' | 'ward' | 'block' | 'survey' | 'subdiv';

const SELECT_ID: Record<LandListField, string> = {
  district: '#districtCode', taluk: '#talukCode', village: '#villageCode',
  ward: '#wardNo', block: '#blockCode', survey: '#surveyNo', subdiv: '#subdivNo',
};

export interface LandOption { value: string; label: string }

/** Text fields the advocate fills before the OTP / CAPTCHA step. */
export interface LandFormFields {
  /** patta only: view by Patta Number ('pt') or Survey Number ('sur'). */
  viewBy?: 'pt' | 'sur';
  pattaNo?: string;
  /** Rural taluks that also keep Natham records (taluk flag Y). */
  landType?: 'R' | 'N';
  /** Rural survey number (text) - urban picks it from a list. */
  surveyNo?: string;
  /** Poramboke: sub division as text; others pick it from the list. */
  subdivNo?: string;
  applicationId?: string;
  refNo?: string;
}

export interface LandResultSection {
  heading: string | null;
  headers: string[];
  rows: string[][];
}

export interface LandResult {
  /** The result page's own title line. */
  title: string;
  /** Label : value pairs found on the page (Patta Number, Owner, ...). */
  fields: Array<{ label: string; value: string }>;
  sections: LandResultSection[];
  /** Plain-text of the result area, for "no records" style answers. */
  text: string;
  /** A PDF of the result (page print, or the sketch the site opened). */
  hasPdf: boolean;
}

interface Session {
  id: string;
  userId: string;
  service: LandService;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  dialogs: string[];
  idleTimer: ReturnType<typeof setTimeout>;
  mobile: string | null;
  /** What the advocate searched, kept for the filing label. */
  summary: Record<string, string>;
  /** Dropdown values picked so far, in order - re-applied when the site
   *  posts back its form with them cleared (wrong captcha). */
  picks: Partial<Record<LandListField, string>>;
  /** A site step (OTP, captcha, submit) is in progress. */
  busy: boolean;
  /** The text fields last filled into the site form (re-asserted before sends). */
  formFields: LandFormFields | null;
  /** The OTP sent last was confirmed by the site (reset on every send). */
  otpVerified: boolean;
  result: LandResult | null;
  pdf: Buffer | null;
}

export class LandRecordsError extends HttpError {
  /** code: LAND_RECORDS, or a specific one the screen acts on -
   *  OTP_REJECTED (get a new OTP), CAPTCHA_REJECTED, BUSY. */
  constructor(status: number, message: string, code = 'LAND_RECORDS') {
    // Operator-authored messages - safe to show even for 5xx.
    super(status, message, { code, expose: true });
  }
}

/** Run one site step at a time per session - a second OTP / captcha / submit
 *  while one is running would race the site's token chain. */
async function exclusive<T>(s: Session, fn: () => Promise<T>): Promise<T> {
  if (s.busy) throw new LandRecordsError(409, 'Already working on this - wait a moment.', 'BUSY');
  s.busy = true;
  try {
    return await fn();
  } finally {
    s.busy = false;
  }
}

const sessions = new Map<string, Session>();
/** Per-advocate count of session opens - lets an older, replaced open bow out. */
const startGen = new Map<string, number>();
export const SUPERSEDED = 'Replaced by a newer Land Records search.';

function touch(s: Session): void {
  clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => void closeSession(s.id), IDLE_TIMEOUT_MS);
}

async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  clearTimeout(s.idleTimer);
  // The browser is shared; each session owns only its context.
  await s.context.close().catch((err) => logger.warn({ err, id }, 'tn-land: context close failed'));
}

function getSession(id: string, userId: string): Session {
  const s = sessions.get(id);
  if (!s || s.userId !== userId) throw new LandRecordsError(404, 'This Land Records session has expired - start again.');
  touch(s);
  return s;
}

export async function endLandSession(id: string, userId: string): Promise<void> {
  const s = sessions.get(id);
  if (s && s.userId === userId) await closeSession(id);
}

const clean = (v: string): string => v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** The site's last alert() text since `from`, if any. */
function lastDialog(s: Session, from: number): string | null {
  const msgs = s.dialogs.slice(from).map(clean).filter(Boolean);
  return msgs.length ? msgs[msgs.length - 1]! : null;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/** Set a control the way a user would, so the site's onchange handler (which
 *  loads the next dropdown) runs. Falls back to value + change event. */
async function setField(page: Page, selector: string, value: string): Promise<void> {
  const el = await page.$(selector);
  if (!el) throw new LandRecordsError(502, `The Land Records page layout has changed (missing ${selector}).`);
  const tag = await el.evaluate((e: { tagName: string }) => e.tagName.toLowerCase());
  // A hidden control would make fill/selectOption wait out their timeout
  // (5 s seen live on Patta's survey box) - go straight to the fallback.
  const visible = await el.isVisible().catch(() => false);
  if (visible) {
    try {
      if (tag === 'select') await page.selectOption(selector, value, { timeout: 5_000 });
      else {
        await page.fill(selector, value, { timeout: 5_000 });
        // Leave the box, as a person does: the browser fires the site's
        // onchange ONCE, now (survey -> getSubdivNo reloads the list). An
        // extra dispatched change + the native one on a later blur made the
        // site reload the list again AFTER a sub division was picked,
        // clearing it ("Please Enter Subdivision Number", seen live).
        await page.evaluate((sel) => document.querySelector(sel)?.blur(), selector);
      }
      return;
    } catch {
      /* not interactable after all - fall back below */
    }
  }
  await page.evaluate(({ selector, value }) => {
    const e = document.querySelector(selector);
    e.value = value;
    try {
      e.dispatchEvent(new window.Event('change', { bubbles: true }));
    } catch { /* page handler error */ }
  }, { selector, value });
}

async function readOptions(page: Page, selector: string): Promise<LandOption[]> {
  return page.evaluate((sel) => [...(document.querySelectorAll(`${sel} option`) as Iterable<{ value: string; textContent: string }>)]
    .filter((o) => o.value && o.value !== '00' && o.value !== '-1')
    .map((o) => ({ value: o.value, label: o.textContent.replace(/\s+/g, ' ').trim() }))
    .filter((o) => o.label && !/please select|--select/i.test(o.label)), selector);
}

/** Wait until a select has real options (the site fills them by AJAX). */
async function waitForOptions(page: Page, selector: string, what: string): Promise<LandOption[]> {
  try {
    await page.waitForFunction((sel) => [...(document.querySelectorAll(`${sel} option`) as Iterable<{ value: string; textContent: string }>)]
      .some((o) => o.value && o.value !== '00' && !/please select|--select/i.test(o.textContent)), selector, { timeout: STEP_TIMEOUT_MS });
  } catch {
    return [];
  }
  const opts = await readOptions(page, selector);
  if (opts.length === 0) logger.info({ what }, 'tn-land: empty list');
  return opts;
}

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel);
    return Boolean(e && e.offsetParent !== null && window.getComputedStyle(e).display !== 'none');
  }, selector);
}

/** The site's arithmetic CAPTCHA arrives as a data: URI on #captcha_name. */
async function captchaImage(page: Page): Promise<string> {
  try {
    const handle = await page.waitForFunction(() => {
      const img = document.getElementById('captcha_name');
      const src = img?.getAttribute('src') ?? '';
      return src.startsWith('data:image') && src.length > 200 ? src : false;
    }, undefined, { timeout: STEP_TIMEOUT_MS });
    return (await handle.jsonValue()) as string;
  } catch {
    // Not a data URI (older page variant) - screenshot the image instead.
    try {
      const buf = await page.locator('#captcha_name').screenshot({ timeout: 8_000 });
      return `data:image/png;base64,${buf.toString('base64')}`;
    } catch (err) {
      logger.warn({ err }, 'tn-land: captcha image unavailable');
      throw new LandRecordsError(502, 'Could not load the captcha from Land Records - try again.');
    }
  }
}

// ---------------------------------------------------------------------------
// Session start + dropdown steps
// ---------------------------------------------------------------------------

export interface LandSessionStart {
  sessionId: string;
  service: LandService;
  title: string;
  gate: 'otp' | 'captcha';
  form: FormShape;
  districts: LandOption[];
  captchaImage?: string;
}

// ---------------------------------------------------------------------------
// Speed (measured 2026-10-24: ~12 s to open a service, of which ~2 s browser
// launch and ~7 s the home page pulling its icons / stylesheets one by one,
// although the site answers in ~0.5 s):
//   - one shared browser; each session is its own context (cookies apart)
//   - the home page is only the step that hands out the menu link, so it
//     loads without images / fonts / stylesheets / other hosts; service pages
//     load in full (their styling is what the result PDF prints)
//   - one home page is kept loaded and ready while Land Records is in use, so
//     opening a service is a single click on the site's own link
// ---------------------------------------------------------------------------

const WARM_MAX_AGE_MS = 4 * 60 * 1000;     // a ready home page older than this is reloaded
const ACTIVE_WINDOW_MS = 20 * 60 * 1000;   // keep a page ready this long after the last use
const HOME_SKIP = new Set(['image', 'font', 'media', 'stylesheet']);

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // CHROMIUM_PATH: Alpine's chromium in the Docker image; unset in dev.
    browserPromise = chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      args: ['--disable-dev-shm-usage'],
    }).then((b) => {
      b.once('disconnected', () => {
        browserPromise = null;
        warm = null;
        for (const s of sessions.values()) if (s.browser === b) sessions.delete(s.id);
      });
      return b;
    }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

interface HomePage {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** alert() texts - handed to the session that takes this page. */
  dialogs: string[];
  loadedAt: number;
}

let warm: Promise<HomePage | null> | null = null;
let lastUse = 0;
let warmTimer: ReturnType<typeof setTimeout> | null = null;

/** A fresh context on the site's home page, menu links present. */
async function openHome(): Promise<HomePage> {
  const browser = await getBrowser();
  const context = await browser.newContext({ acceptDownloads: true });
  try {
    // See ecourts-web-search: tsx can wrap page callbacks in `__name`.
    await context.addInitScript('window.__name = window.__name || function (f) { return f; };');
    await context.route('**/*', (route) => {
      const req = route.request();
      let onHome = false;
      try { onHome = /\/eservicesnew\/(index\.html)?(\?|$)/.test(req.frame().url()); } catch { /* no frame */ }
      if (onHome && req.resourceType() !== 'document'
          && (HOME_SKIP.has(req.resourceType()) || !new URL(req.url()).hostname.endsWith('tn.gov.in'))) {
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const home: HomePage = { browser, context, page, dialogs: [], loadedAt: 0 };
    // The site talks through alert(); keep the text for the advocate.
    page.on('dialog', (d) => {
      home.dialogs.push(d.message());
      void d.accept().catch(() => {});
    });
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.locator('a[href^="land/"]').first().waitFor({ state: 'attached', timeout: STEP_TIMEOUT_MS });
    home.loadedAt = Date.now();
    return home;
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

function scheduleWarm(): void {
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => void refreshWarm(), WARM_MAX_AGE_MS);
  warmTimer.unref?.();
}

/** Keep one ready home page while Land Records is in use; let it all go after. */
async function refreshWarm(): Promise<void> {
  const old = warm;
  warm = null;
  if (old) void old.then((h) => h?.context.close().catch(() => {}));
  // Idle: drop the ready page but keep the browser itself running - starting
  // it again costs several seconds (first tab ~6 s on Windows).
  if (Date.now() - lastUse > ACTIVE_WINDOW_MS) return;
  warm = openHome().catch((err) => {
    logger.info({ err: String(err) }, 'tn-land: could not pre-load the home page');
    return null;
  });
  scheduleWarm();
}

/** At API start: launch the shared browser and open (then close) one tab, so
 *  neither slow first-time cost lands on an advocate. */
export async function warmLandBrowser(): Promise<void> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    await context.newPage();
  } finally {
    await context.close().catch(() => {});
  }
}

/** Called when the Land Records screen opens, so the first service is quick. */
export function prepareLandRecords(): void {
  lastUse = Date.now();
  if (!warm) void refreshWarm();
}

/** The ready home page if there is a fresh one, else load one now. */
async function takeHome(): Promise<HomePage> {
  lastUse = Date.now();
  // Claim the ready page BEFORE awaiting it - two opens arriving together
  // must never share one page (the replaced one closes it).
  const claimed = warm;
  warm = null;
  // Prepare the next one straight away.
  void refreshWarm();
  const ready = claimed ? await claimed : null;
  if (ready && Date.now() - ready.loadedAt < WARM_MAX_AGE_MS && !ready.page.isClosed()) return ready;
  if (ready) void ready.context.close().catch(() => {});
  return openHome();
}

/**
 * Follow the service's menu link on the site's home page, as an advocate
 * would. One live session per advocate.
 */
export async function startLandSession(userId: string, service: LandService): Promise<LandSessionStart> {
  const cfg = LAND_SERVICES[service];
  // One live session per advocate: a newer open replaces this one, and this
  // request then ends quietly (409) instead of reporting the site as down.
  const gen = (startGen.get(userId) ?? 0) + 1;
  startGen.set(userId, gen);
  const superseded = () => startGen.get(userId) !== gen;
  for (const s of [...sessions.values()]) if (s.userId === userId) await closeSession(s.id);

  let home: HomePage;
  try {
    home = await takeHome();
    if (superseded()) {
      void home.context.close().catch(() => {});
      throw new LandRecordsError(409, SUPERSEDED);
    }
  } catch (err) {
    if (err instanceof LandRecordsError) throw err;
    logger.warn({ err, service }, 'tn-land: home page load failed');
    throw new LandRecordsError(502, 'Could not reach Land Records (eservices.tn.gov.in) right now. Try again in a few minutes.');
  }
  const { browser, context, page } = home;
  const session: Session = {
    id: randomUUID(), userId, service, browser, context, page, dialogs: home.dialogs,
    idleTimer: setTimeout(() => {}, 0), mobile: null, summary: {}, picks: {}, busy: false, otpVerified: false, formFields: null, result: null, pdf: null,
  };
  sessions.set(session.id, session);
  touch(session);
  page.once('crash', () => void closeSession(session.id));

  try {
    const link = page.locator(`a[href^="${cfg.href}"]`).first();
    if (await link.count() === 0) throw new LandRecordsError(502, 'The Land Records home page no longer lists this service.');
    // Menu links open in the same tab; drop any target so the session keeps one page.
    await link.evaluate((a: { removeAttribute: (n: string) => void }) => a.removeAttribute('target'));
    await Promise.all([
      page.waitForURL((u) => u.pathname.endsWith(cfg.href.split('/').pop()!), { timeout: 45_000, waitUntil: 'domcontentloaded' }),
      link.evaluate((a: { click: () => void }) => a.click()),
    ]);
    // Service pages load in full from here on.
    await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    // The site's handlers come from scripts that may still be loading.
    if (cfg.gate === 'otp') {
      await page.waitForFunction(() => typeof window.otpgenerate === 'function', undefined, { timeout: STEP_TIMEOUT_MS })
        .catch(() => { throw new LandRecordsError(502, 'The Land Records page did not finish loading - try again.'); });
    }
    const invalid = await page.evaluate(() => /INVALID ACCESS TO THE SITE/i.test(document.body?.innerText ?? ''));
    if (invalid) throw new LandRecordsError(502, 'Land Records refused the visit. Try again in a minute.');

    const districts = cfg.form === 'appid' || cfg.form === 'refno'
      ? []
      : await waitForOptions(page, SELECT_ID.district, 'district');
    if (cfg.form !== 'appid' && cfg.form !== 'refno' && districts.length === 0) {
      throw new LandRecordsError(502, 'Land Records did not load its district list - try again.');
    }
    const out: LandSessionStart = { sessionId: session.id, service, title: cfg.title, gate: cfg.gate, form: cfg.form, districts };
    if (cfg.gate === 'captcha') out.captchaImage = await captchaImage(page);
    return out;
  } catch (err) {
    await closeSession(session.id);
    if (superseded()) throw new LandRecordsError(409, SUPERSEDED);
    if (err instanceof LandRecordsError) throw err;
    logger.warn({ err, service }, 'tn-land: page load failed');
    throw new LandRecordsError(502, 'Could not reach Land Records (eservices.tn.gov.in) right now. Try again in a few minutes.');
  }
}

/** Which list follows each pick, per form shape. */
function nextList(form: FormShape, field: LandListField): LandListField | null {
  if (form === 'urban') {
    const order: LandListField[] = ['district', 'taluk', 'village', 'ward', 'block', 'survey', 'subdiv'];
    const i = order.indexOf(field);
    return i >= 0 && i < order.length - 1 ? order[i + 1]! : null;
  }
  if (field === 'district') return 'taluk';
  if (field === 'taluk') return 'village';
  return null;
}

export interface LandSelectResult {
  next: LandListField | null;
  options: LandOption[];
  /** Rural taluk that also keeps Natham records - ask Rural / Natham. */
  askLandType?: boolean;
  message?: string;
}

/** Pick a value in one of the site's dropdowns and return the next list. */
export async function selectLandField(sessionId: string, userId: string, field: LandListField, value: string): Promise<LandSelectResult> {
  const s = getSession(sessionId, userId);
  const cfg = LAND_SERVICES[s.service];
  const from = s.dialogs.length;
  const next = nextList(cfg.form, field);
  // Clear the next list first so we wait for the fresh one, not the old one.
  if (next) {
    await s.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el && el.tagName === 'SELECT') el.innerHTML = '';
    }, SELECT_ID[next]);
  }
  await setField(s.page, SELECT_ID[field], value);
  const order: LandListField[] = ['district', 'taluk', 'village', 'ward', 'block', 'survey', 'subdiv'];
  for (const later of order.slice(order.indexOf(field) + 1)) delete s.picks[later];
  s.picks[field] = value;
  const options = next ? await waitForOptions(s.page, SELECT_ID[next], next) : [];
  const out: LandSelectResult = { next, options };
  if (cfg.form === 'rural' && field === 'taluk') out.askLandType = value.split('/')[1] === 'Y';
  const msg = lastDialog(s, from);
  if (msg) out.message = msg;
  return out;
}

/** Rural: type the survey number; the site loads its sub divisions. */
export async function loadSubdivisions(sessionId: string, userId: string, surveyNo: string, landType?: 'R' | 'N'): Promise<LandSelectResult> {
  const s = getSession(sessionId, userId);
  const cfg = LAND_SERVICES[s.service];
  if (cfg.form !== 'rural') throw new LandRecordsError(400, 'This service takes the sub division as text.');
  const from = s.dialogs.length;
  if (landType) await applyLandType(s, landType);
  await s.page.evaluate(() => {
    const el = document.getElementById('subdivNo');
    if (el) el.innerHTML = '<option value="">Please Select ...</option>';
  });
  // Patta shows the survey box only after 'View Patta/Chitta using: Survey Number'.
  if (s.service === 'patta') {
    await s.page.evaluate(() => {
      const r = document.querySelector('input[name="viewOpt"][value="sur"]');
      if (r && !r.checked) r.click();
    });
  }
  await setField(s.page, '#surveyNo', surveyNo.trim());
  const options = await waitForOptions(s.page, SELECT_ID.subdiv, 'subdiv');
  const msg = lastDialog(s, from);
  return { next: null, options, ...(msg ? { message: msg } : {}) };
}

async function applyLandType(s: Session, landType: 'R' | 'N'): Promise<void> {
  // FMB uses a single "Natham" checkbox; the others a Rural / Natham radio pair.
  await s.page.evaluate((lt) => {
    const boxes = [...(document.querySelectorAll('input[name="landtype"]') as Iterable<{ type: string; value: string; checked: boolean; click: () => void }>)];
    for (const b of boxes) {
      if (b.type === 'checkbox') {
        if ((lt === 'N') !== b.checked) b.click();
      } else if (b.value === lt && !b.checked) b.click();
    }
  }, landType);
}

/** After a post-back the site's form comes back with its lists reset; pick
 *  the advocate's values again, waiting for each list the site reloads. */
async function reapplyPicks(s: Session): Promise<void> {
  if (!s.picks.district) return;
  const current = await s.page.evaluate(() => document.getElementById('districtCode')?.value ?? '').catch(() => '');
  if (current === s.picks.district) return;
  await waitForOptions(s.page, SELECT_ID.district, 'district');
  for (const field of ['district', 'taluk', 'village', 'ward', 'block', 'survey', 'subdiv'] as LandListField[]) {
    const value = s.picks[field];
    if (!value) break;
    await waitForValue(s.page, SELECT_ID[field], value);
    await setField(s.page, SELECT_ID[field], value);
  }
}

async function waitForValue(page: Page, selector: string, value: string): Promise<void> {
  await page.waitForFunction(({ selector, value }) => [...(document.querySelectorAll(selector + ' option') as Iterable<{ value: string }>)].some((o) => o.value === value),
    { selector, value }, { timeout: STEP_TIMEOUT_MS }).catch(() => { throw new LandRecordsError(502, 'Land Records did not reload its lists - start again.'); });
}

/** Fill the advocate's text fields into the site's form. */
async function fillForm(s: Session, f: LandFormFields): Promise<void> {
  s.formFields = { ...f };
  await reapplyPicks(s);
  const cfg = LAND_SERVICES[s.service];
  const { page } = s;
  if (cfg.form === 'appid') {
    if (!f.applicationId) throw new LandRecordsError(400, 'Enter the Application Id.');
    await setField(page, '#applicationid', f.applicationId.trim());
    s.summary['Application Id'] = f.applicationId.trim();
    return;
  }
  if (cfg.form === 'refno') {
    if (!f.refNo) throw new LandRecordsError(400, 'Enter the Reference Number.');
    await setField(page, '#refNo', f.refNo.trim());
    s.summary['Reference Number'] = f.refNo.trim();
    return;
  }
  if (cfg.form === 'rural-plain') {
    if (!f.surveyNo || !f.subdivNo) throw new LandRecordsError(400, 'Enter the Survey Number and Sub Division Number.');
    await setField(page, '#surveyNo', f.surveyNo.trim());
    await setField(page, '#subdivNo', f.subdivNo.trim());
    s.summary['Survey Number'] = `${f.surveyNo.trim()}/${f.subdivNo.trim()}`;
    return;
  }
  if (cfg.form === 'rural') {
    if (f.landType) await applyLandType(s, f.landType);
    if (s.service === 'patta') {
      const by = f.viewBy ?? 'sur';
      await page.evaluate((v) => {
        const r = document.querySelector(`input[name="viewOpt"][value="${v}"]`);
        if (r && !r.checked) r.click();
      }, by);
      if (by === 'pt') {
        if (!f.pattaNo) throw new LandRecordsError(400, 'Enter the Patta Number.');
        await setField(page, '#pattaNo', f.pattaNo.trim());
        s.summary['Patta Number'] = f.pattaNo.trim();
        return;
      }
    }
    // Survey + sub division were picked through loadSubdivisions; set the
    // sub division last in case the survey change reset it.
    if (f.subdivNo) {
      // A posted-back form (after a rejected OTP) lost its sub division list:
      // type the survey number again so the site reloads it.
      const listed = await page.evaluate((v) => [...(document.querySelectorAll('#subdivNo option') as Iterable<{ value: string }>)].some((o) => o.value === v), f.subdivNo);
      if (!listed && f.surveyNo) {
        await setField(page, '#surveyNo', f.surveyNo.trim());
        await waitForValue(page, SELECT_ID.subdiv, f.subdivNo);
      }
      await setField(page, '#subdivNo', f.subdivNo);
    }
    if (f.surveyNo) s.summary['Survey Number'] = `${f.surveyNo.trim()}${f.subdivNo && f.subdivNo !== '-' ? `/${f.subdivNo}` : ''}`;
    return;
  }
  // urban: every value was picked from the site's lists.
  const surveyPicked = await page.evaluate(() => document.getElementById('subdivNo')?.value ?? '');
  if (!surveyPicked && f.subdivNo) await setField(page, '#subdivNo', f.subdivNo);
}

/**
 * Right before a send (Get OTP, final Submit): let any list the site is still
 * reloading arrive, then make sure its survey / sub division boxes still hold
 * the advocate's values - the site's own validate() reads them, and a late
 * getSubdivNo reload clears the sub division.
 */
async function reassertForm(s: Session): Promise<void> {
  const f = s.formFields;
  const cfg = LAND_SERVICES[s.service];
  if (!f || (cfg.form !== 'rural' && cfg.form !== 'rural-plain')) return;
  if (s.service === 'patta' && f.viewBy === 'pt') return;
  await s.page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
  const now = await s.page.evaluate(() => ({
    survey: document.getElementById('surveyNo')?.value ?? '',
    subdiv: document.getElementById('subdivNo')?.value ?? '',
  }));
  if (f.surveyNo && now.survey.trim().toUpperCase() !== f.surveyNo.trim().toUpperCase()) {
    await setField(s.page, '#surveyNo', f.surveyNo.trim());
    if (cfg.form === 'rural' && f.subdivNo) await waitForValue(s.page, SELECT_ID.subdiv, f.subdivNo);
  }
  if (f.subdivNo && now.subdiv !== f.subdivNo) {
    // Selecting a sub division fires nothing on the site - safe to set.
    await setField(s.page, cfg.form === 'rural' ? SELECT_ID.subdiv : '#subdivNo', f.subdivNo);
    logger.info({ service: s.service }, 'tn-land: sub division restored before send');
  }
}

/** Location labels as the site shows them, for the filed document's name. */
async function readLocation(s: Session): Promise<void> {
  const loc = await s.page.evaluate(() => {
    const pick = (id: string) => {
      const el = document.getElementById(id);
      if (!el || el.tagName !== 'SELECT' || el.selectedIndex < 0) return '';
      return (el.options[el.selectedIndex]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    return { District: pick('districtCode'), Taluk: pick('talukCode'), Village: pick('villageCode'), Ward: pick('wardNo'), Block: pick('blockCode') };
  });
  for (const [k, v] of Object.entries(loc)) if (v && !/select/i.test(v)) s.summary[k] = v;
}

// ---------------------------------------------------------------------------
// OTP services
// ---------------------------------------------------------------------------

const MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Fill the form and ask the site to text an OTP to the advocate's mobile
 * (the site's own otpgenerate, which also validates the form first).
 */
export async function sendLandOtp(sessionId: string, userId: string, mobile: string, fields: LandFormFields): Promise<{ message: string }> {
  const s = getSession(sessionId, userId);
  const cfg = LAND_SERVICES[s.service];
  if (cfg.gate !== 'otp' || !cfg.action) throw new LandRecordsError(400, 'This service uses a captcha, not an OTP.');
  if (!MOBILE_RE.test(mobile)) throw new LandRecordsError(400, 'Enter a 10-digit mobile number.');
  return exclusive(s, async () => {
    await fillForm(s, fields);
    await readLocation(s);
    await reassertForm(s);
    // The site disables these after a confirmed OTP; a resend starts afresh.
    await s.page.evaluate(() => {
      for (const id of ['mobileno', 'otpno', 'sendtpid']) { const el = document.getElementById(id); if (el) el.disabled = false; }
    });
    await setField(s.page, '#mobileno', mobile);
    s.mobile = mobile;
    s.otpVerified = false;
    const from = s.dialogs.length;
    const response = s.page.waitForResponse((r) => /ajax\.html\?page=otp/i.test(r.url()), { timeout: 25_000 }).catch(() => null);
    // Click the site's own "Get OTP" (its onclick runs otpgenerate with the
    // form's values); fall back to the same call if the button is hidden.
    await s.page.evaluate(({ mobile, action }) => {
      const b = document.getElementById('sendtpid');
      if (b && b.offsetParent !== null) setTimeout(() => b.click(), 0);
      else if (typeof window.otpgenerate === 'function') setTimeout(() => window.otpgenerate(mobile, action, 'en'), 0);
    }, { mobile, action: cfg.action });
    const res = await response;
    await s.page.waitForTimeout(800);
    const shown = await isVisible(s.page, '#otpcodeview');
    const msg = lastDialog(s, from);
    if (!shown) {
      if (msg) throw new LandRecordsError(400, `Land Records: ${msg}`);
      throw new LandRecordsError(res ? 400 : 504, res ? 'Land Records did not send the OTP. Check the details and try again.' : 'Land Records did not answer - try again.');
    }
    const sms = await s.page.evaluate(() => (document.getElementById('smsmsg')?.innerText ?? '').replace(/\s+/g, ' ').trim());
    return { message: sms || `OTP sent to XXXXXX${mobile.slice(6)}.` };
  });
}

/** Confirm the OTP, submit the form, and read the result. */
export type LandOtpVerify =
  | { status: 'ok'; result: LandResult }
  /** Order Copy / Verify Patta: the OTP is confirmed and the site now asks
   *  for its captcha too - finish with submitLandCaptcha. */
  | { status: 'captcha'; captchaImage: string };

/** The site's state after its own verify_otp succeeded: Submit block shown
 *  and the hidden otpno_ver / mobileno_ver filled (what the server reads). */
async function otpConfirmed(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sub = document.getElementById('sub_id');
    const shown = Boolean(sub && window.getComputedStyle(sub).display !== 'none');
    const ver = document.getElementById('otpno_ver')?.value ?? '';
    return shown && /^\d{6}$/.test(ver);
  });
}

/**
 * Confirm the OTP exactly as a person does on the site: type it into the
 * OTP box and click the site's own "Confirm OTP" button (verify_otp, which
 * rotates the page token and fills otpno_ver / mobileno_ver). Then submit -
 * or, where the site asks for a captcha after the OTP, return that captcha.
 */
export async function verifyLandOtp(sessionId: string, userId: string, otp: string): Promise<LandOtpVerify> {
  const s = getSession(sessionId, userId);
  const cfg = LAND_SERVICES[s.service];
  if (cfg.gate !== 'otp' || !cfg.action || !s.mobile) throw new LandRecordsError(400, 'Send the OTP first.');
  if (!/^\d{6}$/.test(otp.trim())) throw new LandRecordsError(400, 'The OTP is 6 digits.');
  return exclusive(s, async () => {
    // Never confirm twice: a second verify_otp spends the token/OTP the
    // first one already used, and the site then answers "Invalid otp".
    if (!(s.otpVerified && await otpConfirmed(s.page))) {
      await setField(s.page, '#otpno', otp.trim());
      const from = s.dialogs.length;
      const clicked = await s.page.evaluate(() => {
        const b = document.getElementById('otpval');
        if (b && window.getComputedStyle(b).display !== 'none' && !b.disabled) { b.click(); return true; }
        return false;
      });
      if (!clicked) {
        // Button hidden (site variant): call the same handler it would.
        await s.page.evaluate(({ mobile, otp, action }) => window.verify_otp?.(mobile, otp, 'en', action), { mobile: s.mobile, otp: otp.trim(), action: cfg.action });
      }
      // Done when the site shows its Submit block with otpno_ver filled; or
      // stop at once when it alerts anything but "verified" (wrong OTP, ...).
      const confirmed = s.page.waitForFunction(() => {
        const sub = document.getElementById('sub_id');
        return Boolean(sub && window.getComputedStyle(sub).display !== 'none')
          && /^\d{6}$/.test(document.getElementById('otpno_ver')?.value ?? '');
      }, undefined, { timeout: STEP_TIMEOUT_MS }).then(() => true, () => false);
      const refused = (async () => {
        for (let i = 0; i < STEP_TIMEOUT_MS / 100; i++) {
          const msg = lastDialog(s, from);
          if (msg && !/verified/i.test(msg)) return true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return false;
      })();
      const ok = await Promise.race([confirmed, refused.then((r) => (r ? false : new Promise<boolean>(() => {})))]);
      if (!ok) {
        const msg = lastDialog(s, from);
        throw new LandRecordsError(400, msg ? `Land Records: ${msg}` : 'The OTP was not accepted - check it and try again.', 'OTP_REJECTED');
      }
      s.otpVerified = true;
      logger.info({ service: s.service }, 'tn-land: OTP confirmed by the site');
    }
    if (cfg.captchaAfterOtp) return { status: 'captcha', captchaImage: await captchaImage(s.page) };
    return { status: 'ok', result: await submitAndRead(s) };
  });
}

// ---------------------------------------------------------------------------
// CAPTCHA services
// ---------------------------------------------------------------------------

export async function refreshLandCaptcha(sessionId: string, userId: string): Promise<{ captchaImage: string }> {
  const s = getSession(sessionId, userId);
  await s.page.evaluate(() => {
    const img = document.getElementById('captcha_name');
    if (img) img.setAttribute('src', '');
    if (typeof window.loadcpatcha === 'function') window.loadcpatcha();
  });
  return { captchaImage: await captchaImage(s.page) };
}

export type LandCaptchaSubmit =
  | { status: 'ok'; result: LandResult }
  | { status: 'retry'; reason: string; captchaImage: string };

export async function submitLandCaptcha(sessionId: string, userId: string, captcha: string, fields: LandFormFields): Promise<LandCaptchaSubmit> {
  const s = getSession(sessionId, userId);
  const cfg = LAND_SERVICES[s.service];
  // Captcha-only services, or the captcha the site shows after the OTP.
  const input = cfg.gate === 'captcha' ? cfg.captchaInput : cfg.captchaAfterOtp;
  if (!input) throw new LandRecordsError(400, 'This service uses an OTP, not a captcha.');
  if (cfg.gate === 'otp' && !(s.otpVerified && await otpConfirmed(s.page))) throw new LandRecordsError(400, 'Confirm the OTP first.', 'OTP_REJECTED');
  return exclusive(s, async () => {
    // OTP pages keep the form exactly as it was confirmed - never re-fill it.
    if (cfg.gate === 'captcha') {
      await fillForm(s, fields);
      await readLocation(s);
    }
    await setField(s.page, input, captcha.trim());
    try {
      return { status: 'ok', result: await submitAndRead(s) };
    } catch (err) {
      // The site posted its form back with a captcha complaint: hand out the new one.
      if (err instanceof LandRecordsError && err.code === 'CAPTCHA_REJECTED') {
        // After an OTP the site's posted-back form has lost the confirmed OTP.
        if (cfg.gate === 'otp') {
          s.mobile = null;
          throw new LandRecordsError(400, `${err.message}. The site reset the form - get a new OTP and try again.`, 'OTP_REJECTED');
        }
        return { status: 'retry', reason: 'Incorrect authentication value - try the new one.', captchaImage: await captchaImage(s.page) };
      }
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Submit + read
// ---------------------------------------------------------------------------

/** Click the site's own Submit (runs its validate()), then read what comes back. */
async function submitAndRead(s: Session): Promise<LandResult> {
  const cfg = LAND_SERVICES[s.service];
  const { page } = s;
  const from = s.dialogs.length;
  const popup = cfg.popup ? s.context.waitForEvent('page', { timeout: 40_000 }).catch(() => null) : null;
  const download = page.waitForEvent('download', { timeout: 40_000 }).catch(() => null);
  // Any new document in the main frame counts - the site posts back to the
  // same URL on a second try, so "URL changed" is not enough.
  const nav = page.waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame(), timeout: 40_000 })
    .then(async () => {
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
      return true;
    }, () => false);

  await reassertForm(s);
  // Click what a person clicks: the visible control in the site's Submit
  // block - a real submit button, or FMB / TSLR sketch's
  // `onclick="return validate_fmb('en')"` / validate_tslr button (AJAX, then
  // the sketch opens in a new window; there is no form post on those pages).
  const clicked = await page.evaluate(() => {
    const visible = (el: { offsetParent: unknown } | null) => Boolean(el && el.offsetParent !== null);
    const inSub = [...(document.querySelectorAll('#sub_id input[type="submit"], #sub_id input[type="button"], #sub_id button') as Iterable<{ offsetParent: unknown; click: () => void }>)].find(visible);
    const btn = inSub ?? [...(document.querySelectorAll('form input[type="submit"], form button[type="submit"]') as Iterable<{ offsetParent: unknown; click: () => void }>)].find(visible);
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) throw new LandRecordsError(502, 'The Land Records page has no Submit button where expected - start again.');
  // The site reports problems with alert() (e.g. on the sketch pages).
  const alerted = (async () => {
    for (let i = 0; i < 400; i++) {
      if (s.dialogs.length > from) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  })();

  if (cfg.popup) {
    // FMB / TSLR sketch: the site asks Collabland for a token and opens the
    // sketch in a new window - keep that window's document.
    const opened = await Promise.race([
      popup,
      nav.then((moved) => (moved ? null : new Promise<null>(() => {}))),
      alerted.then((a) => (a ? null : new Promise<null>(() => {}))),
    ]);
    if (opened) return readPopup(s, opened);
    const msg = lastDialog(s, from);
    if (msg) throw new LandRecordsError(400, `Land Records: ${msg}`, /otp/i.test(msg) ? 'OTP_REJECTED' : 'LAND_RECORDS');
  }
  const navigated = await Promise.race([nav, download.then(() => false), alerted.then((a) => (a ? false : new Promise<boolean>(() => {})))]);
  const dl = navigated ? null : await Promise.race([download, page.waitForTimeout(1500).then(() => null)]);
  if (dl) {
    const path = await dl.path();
    const { readFile } = await import('node:fs/promises');
    const bytes = path ? await readFile(path) : null;
    if (!bytes || bytes.indexOf('%PDF-') < 0) throw new LandRecordsError(502, 'Land Records returned an unexpected file.');
    s.pdf = bytes.subarray(bytes.indexOf('%PDF-'));
    s.result = { title: cfg.title, fields: [], sections: [], text: 'The document was downloaded from Land Records.', hasPdf: true };
    return s.result;
  }
  if (!navigated) {
    const msg = lastDialog(s, from);
    throw new LandRecordsError(400, msg ? `Land Records: ${msg}` : 'Land Records did not answer - try again.');
  }
  // When the site rejects the request it posts its own form back with a
  // message (its `.fadeout` slot, or inline text): "Invalid otp",
  // "Incorrect Value(enter the same as shown)", ... That page is never a
  // result - report its message instead (seen live 2026-10-24: "Invalid otp"
  // was shown to an advocate as if it were the chitta).
  const postedBack = await page.evaluate(() => {
    const isForm = Boolean(document.querySelector('#sendtpid, #otpno, #captEntr, #captcha, #applicationid'))
      && Boolean(document.querySelector('form input[type="submit"], #sub_id'));
    if (!isForm) return null;
    const slot = [...(document.querySelectorAll('.fadeout, font[color="red"], .normal_text_red, .errormsg') as Iterable<{ innerText?: string }>)]
      .map((e) => (e.innerText ?? '').replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 200 && !/fields are mandatory/i.test(t));
    const body = (document.body?.innerText ?? '').replace(/\s+/g, ' ');
    const known = /Invalid otp[^.]*|Incorrect Value\s*\(enter the same as shown\)|Invalid (?:captcha|authentication value)|No (?:record|data)s? found[^.]*/i.exec(body);
    return known?.[0] ?? slot[0] ?? 'The request was not accepted';
  }).catch(() => null);
  if (postedBack) {
    logger.info({ service: s.service, message: postedBack.slice(0, 120) }, 'tn-land: site posted its form back');
    const code = /otp/i.test(postedBack) ? 'OTP_REJECTED'
      : /incorrect value|authentication|captcha/i.test(postedBack) ? 'CAPTCHA_REJECTED' : 'LAND_RECORDS';
    if (code === 'OTP_REJECTED') s.mobile = null;
    throw new LandRecordsError(400, `Land Records: ${postedBack}`, code);
  }
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
  return readResultPage(s);
}

/** The slice of a DOM element the result reader touches (no dom lib here). */
interface PageEl {
  innerText?: string;
  querySelector: (s: string) => PageEl | null;
  querySelectorAll: (s: string) => Iterable<PageEl>;
  previousElementSibling: PageEl | null;
}

/** Read the rendered result as plain text and print it to PDF. */
async function readResultPage(s: Session): Promise<LandResult> {
  const { page } = s;
  const read = await page.evaluate(() => {
    const txt = (el: { innerText?: string } | null) => (el?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('section') ?? document.body;
    const fields: Array<{ label: string; value: string }> = [];
    const sections: Array<{ heading: string | null; headers: string[]; rows: string[][] }> = [];
    for (const table of [...(root.querySelectorAll('table') as Iterable<PageEl>)]) {
      // Only innermost tables - layout tables wrap the data ones.
      if (table.querySelector('table')) continue;
      const trs = [...table.querySelectorAll('tr')];
      const grid = trs.map((tr) => [...tr.querySelectorAll('th, td')].map((c) => txt(c)));
      const nonEmpty = grid.filter((r) => r.some(Boolean));
      if (nonEmpty.length === 0) continue;
      // Two-cell "Label : value" rows read as fields.
      if (nonEmpty.every((r) => r.filter(Boolean).length <= 2) && nonEmpty.length <= 30
          && nonEmpty.some((r) => r.length === 2 && r[0] && r[1])) {
        for (const r of nonEmpty) {
          const [label, value] = r.filter(Boolean);
          if (label && value) fields.push({ label: label.replace(/\s*:\s*$/, ''), value: value.replace(/^\s*:\s*/, '') });
        }
        continue;
      }
      const thRow = trs.findIndex((tr) => tr.querySelector('th'));
      const headerIdx = thRow >= 0 ? thRow : 0;
      const headers = grid[headerIdx] ?? [];
      const rows = grid.slice(headerIdx + 1).filter((r) => r.some(Boolean));
      let heading: string | null = null;
      let prev = table.previousElementSibling;
      while (prev && !heading) {
        const t = txt(prev);
        if (t && t.length < 160) heading = t;
        prev = prev.previousElementSibling;
      }
      sections.push({ heading, headers, rows });
    }
    const titleEl = root.querySelector('h1, h2, h3, .head, .container-fluid span');
    return { title: txt(titleEl), fields, sections, text: txt(root).slice(0, 1500) };
  });
  const invalid = /INVALID ACCESS TO THE SITE/i.test(read.text);
  if (invalid) throw new LandRecordsError(502, 'Land Records ended the session - start again.');
  try {
    s.pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
  } catch (err) {
    logger.warn({ err }, 'tn-land: pdf print failed');
    s.pdf = null;
  }
  s.result = {
    title: read.title || LAND_SERVICES[s.service].title,
    fields: read.fields,
    sections: read.sections,
    text: read.text,
    hasPdf: Boolean(s.pdf),
  };
  return s.result;
}

async function readPopup(s: Session, popup: Page): Promise<LandResult> {
  const cfg = LAND_SERVICES[s.service];
  let bytes: Buffer | null = null;
  try {
    // The window may have finished loading before we looked, so ask it what
    // it holds rather than waiting for its response.
    await popup.waitForLoadState('domcontentloaded', { timeout: 30_000 });
    const type = await popup.evaluate(() => document.contentType ?? '').catch(() => '');
    if (/pdf/i.test(type)) {
      // A PDF viewer page: fetch the document itself in the same session.
      const res = await s.context.request.get(popup.url(), { timeout: 30_000 });
      if (res.ok()) bytes = Buffer.from(await res.body());
    }
    if (!bytes) {
      await popup.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});
      // Collabland draws the sketch with script; give it a moment.
      await popup.waitForTimeout(800);
      bytes = await popup.pdf({ format: 'A4', printBackground: true });
    }
  } catch (err) {
    logger.warn({ err }, 'tn-land: sketch window failed');
  }
  await popup.close().catch(() => {});
  if (!bytes || bytes.indexOf('%PDF-') < 0) throw new LandRecordsError(502, 'The sketch did not open from Land Records - try again.');
  s.pdf = bytes.subarray(bytes.indexOf('%PDF-'));
  s.result = { title: cfg.title, fields: [], sections: [], text: 'Sketch received from Land Records (Collabland).', hasPdf: true };
  return s.result;
}

// ---------------------------------------------------------------------------
// The result's PDF, for download / filing
// ---------------------------------------------------------------------------

export function landSessionPdf(sessionId: string, userId: string): { pdf: Buffer; filename: string; label: string; summary: Record<string, string>; service: LandService; result: LandResult } {
  const s = getSession(sessionId, userId);
  if (!s.pdf || !s.result) throw new LandRecordsError(404, 'There is no Land Records result to save yet.');
  const cfg = LAND_SERVICES[s.service];
  const where = [s.summary.Village, s.summary.Taluk, s.summary.District].filter(Boolean).join(', ');
  const key = s.summary['Survey Number'] ? `S.No. ${s.summary['Survey Number']}`
    : s.summary['Patta Number'] ? `Patta ${s.summary['Patta Number']}`
    : s.summary['Application Id'] ?? s.summary['Reference Number'] ?? '';
  const label = [cfg.title.replace(/\s*-\s*\(.*\)$/, ''), key, where].filter(Boolean).join(' - ');
  const filename = `${label.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'land-record'}.pdf`;
  return { pdf: s.pdf, filename, label, summary: { ...s.summary }, service: s.service, result: s.result };
}

/** The service a live session is running (null once it has expired). */
export function landSessionService(sessionId: string, userId: string): LandService | null {
  const s = sessions.get(sessionId);
  return s && s.userId === userId ? s.service : null;
}

process.on('beforeExit', () => {
  for (const s of sessions.values()) void closeSession(s.id);
  if (warmTimer) clearTimeout(warmTimer);
  void browserPromise?.then((b) => b.close()).catch(() => {});
});

/** Visible for tests. */
export const __testing = {
  nextList,
  /** Read a result page that is already open in `page` (fixture tests). */
  readResultFromPage: (page: Page, service: LandService = 'patta') => readResultPage({
    id: 'fixture', userId: 'fixture', service, page, dialogs: [], summary: {}, picks: {}, busy: false, otpVerified: false, formFields: null, result: null, pdf: null, mobile: null,
    browser: null as unknown as Browser, context: null as unknown as BrowserContext, idleTimer: setTimeout(() => {}, 0),
  }),
  /** Register an already-open page as a session at the OTP step (flow tests
   *  against fixture pages that behave like the site's). */
  adoptPage: (page: Page, context: BrowserContext, service: LandService, userId: string, mobile = '9876543210'): string => {
    const id = randomUUID();
    const s: Session = {
      id, userId, service, browser: null as unknown as Browser, context, page, dialogs: [],
      idleTimer: setTimeout(() => {}, 0), mobile, summary: {}, picks: {}, busy: false, otpVerified: false, formFields: null, result: null, pdf: null,
    };
    page.on('dialog', (d) => { s.dialogs.push(d.message()); void d.accept().catch(() => {}); });
    sessions.set(id, s);
    return id;
  },
  /** Fill the site form as Get OTP would (no OTP sent) and read the site's
   *  own boxes after any late list reload (live check of the form state). */
  fillAndRead: async (sessionId: string, userId: string, fields: LandFormFields) => {
    const s = getSession(sessionId, userId);
    await fillForm(s, fields);
    await reassertForm(s);
    await s.page.waitForTimeout(1500);
    return s.page.evaluate(() => ({
      survey: document.getElementById('surveyNo')?.value ?? '',
      subdiv: document.getElementById('subdivNo')?.value ?? '',
    }));
  },
  /** Give a live session a result + PDF without the OTP (e2e: filing flow). */
  setSessionResult: (sessionId: string, result: LandResult, pdf: Buffer, summary: Record<string, string>) => {
    const s = sessions.get(sessionId);
    if (!s) throw new Error('no such session');
    s.result = result;
    s.pdf = pdf;
    Object.assign(s.summary, summary);
  },
};
