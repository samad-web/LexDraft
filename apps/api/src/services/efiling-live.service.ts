import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../logger';
import { EcourtsHttpError } from '../lib/ecourts';
import { EFILING_USER_TYPE_RADIO_ID, type EfilingUserType } from '../lib/efiling/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;

// =============================================================================
// efiling-live.service
//
// Drives a real, logged-in-as-the-advocate browser session against the
// National e-Filing portal (filing.ecourts.gov.in) - the system behind the
// "File on eCourts" action in DifAi. Unlike ecourts.service.ts/
// ecourts-live.service.ts (which reach services.ecourts.gov.in for case
// data), this portal has no mobile-app API to mirror: filing is web-portal
// only, gated by advocate login + image CAPTCHA (or JanParichay SSO, not
// supported here).
//
// SCOPE, stated plainly: login (state + user-type + credentials + CAPTCHA)
// is implemented and verified against the real public login page. The
// post-login filing form itself - case-type pickers, the document upload
// control, final submit - is NOT implemented, because those screens only
// exist once authenticated and nobody on this project currently holds an
// e-filing advocate credential to inspect them against. Shipping guessed
// selectors for a flow that uploads a legal filing would silently fail (or
// worse, half-submit) against the real portal. openNewFiling/
// uploadFilingDocument throw EfilingNotCapturedError until a real advocate
// login is used to capture the real selectors (see docs/efiling-selector-
// capture-todo.md) - same methodology already used in this repo for the
// eCourts mobile API (docs/mitmproxy-step-by-step.md).
//
// Session model mirrors ecourts-live.service.ts exactly: one real browser
// page per advocate, held open server-side between steps (open login page ->
// fill credentials -> solve captcha -> land on dashboard), because the
// portal's own multi-step login relies on a session cookie + CSRF token
// carried across requests - there's no way to make this stateless.
// =============================================================================

const BASE = 'https://filing.ecourts.gov.in';
const LOGIN_URL = `${BASE}/pdedev/`;
// Kept alive by the eFiling screens while the advocate works in DifAi.
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
/** Advocates connected to the portal at once (EFILING_MAX_SESSIONS). */
const MAX_SESSIONS = Number(process.env['EFILING_MAX_SESSIONS']) || 20;

export class EfilingNotCapturedError extends EcourtsHttpError {
  constructor(step: string) {
    super(
      501,
      `The "${step}" step of eFiling isn't wired up yet - it needs a real advocate login to capture the real form fields first. Login and CAPTCHA already work; filing itself is next.`,
    );
    this.name = 'EfilingNotCapturedError';
  }
}

interface EfilingSession {
  id: string;
  userId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
  authenticated: boolean;
  /**
   * Held in memory ONLY while the login is in progress, so a wrong captcha
   * can be retried: the portal hashes the password field in place on submit
   * (sha256 with a per-attempt nonce), so a retry must refill it. Dropped the
   * moment the login succeeds or the session closes; never logged or stored.
   */
  pendingLogin?: { username: string; password: string };
  busy?: boolean;
}

const sessions = new Map<string, EfilingSession>();

let browserPromise: Promise<Browser> | null = null;
/** Tests only: serve fixture pages to each new advocate context. */
let contextHook: ((context: BrowserContext) => Promise<void>) | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // CHROMIUM_PATH: Alpine's chromium in the Docker image; unset in dev.
    browserPromise = chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
    }).then((b) => {
      b.once('disconnected', () => {
        browserPromise = null;
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

/** Start the shared browser at API boot so an advocate's eFiling login opens quickly. */
export async function warmEfilingBrowser(): Promise<void> {
  await getBrowser();
}

/** One portal step at a time per advocate: a second click while one runs
 *  would race the portal's rotating token and its captcha. */
/**
 * For reads the advocate triggers by clicking around (tiles, the dashboard):
 * wait for the step in progress instead of refusing, like the portal's own
 * page simply finishing one request before the next.
 */
async function queued<T>(session: EfilingSession, fn: () => Promise<T>, waitMs = 30_000): Promise<T> {
  const until = Date.now() + waitMs;
  while (session.busy && Date.now() < until) await new Promise((r) => setTimeout(r, 150));
  return exclusive(session, fn);
}

async function exclusive<T>(session: EfilingSession, fn: () => Promise<T>): Promise<T> {
  if (session.busy) throw new EcourtsHttpError(409, 'Still working on your last eFiling step - wait a moment.');
  session.busy = true;
  try {
    return await fn();
  } finally {
    session.busy = false;
  }
}

function touch(session: EfilingSession): void {
  session.lastUsed = Date.now();
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => void closeSession(session.id), IDLE_TIMEOUT_MS);
}

async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  clearTimeout(session.idleTimer);
  session.pendingLogin = undefined;
  // The portal allows one session per account: log out there too, or the
  // advocate is locked out of their own browser until the portal times out.
  if (session.authenticated) await portalLogout(session.page).catch(() => {});
  try {
    // The browser is shared: close only this advocate's context.
    await session.context.close();
  } catch (err) {
    logger.warn({ err, sessionId }, 'efiling-live: error closing browser on session teardown');
  }
}

/**
 * The portal signed this session out (usually: the same account was logged in
 * somewhere else, and the portal allows one session per account). 410, not
 * 401 - a 401 would sign the advocate out of DifAi itself.
 */
function portalSessionEnded(session: EfilingSession): EcourtsHttpError {
  session.authenticated = false;
  return new EcourtsHttpError(410, 'The eFiling portal has signed this session out (the same account was probably opened in another browser). Log in again.');
}

function getSession(sessionId: string, userId: string): EfilingSession {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    throw new EcourtsHttpError(404, 'This eFiling session has expired - start a new one.');
  }
  touch(session);
  return session;
}

/**
 * Open the login page and select state + user type. Confirmed live against
 * https://filing.ecourts.gov.in/ : #selState (state dropdown, value = numeric
 * state code), radio group rdoUser (ids per EFILING_USER_TYPE_RADIO_ID),
 * #user_name, #user_password, #fcaptcha_code_mobile, #verify_button1
 * (submit), #captcha_image (the login form's CAPTCHA <img>, Securimage-based
 * same as the public case-status site).
 */
export async function startEfilingSession(
  userId: string,
  stateValue: string,
  userType: EfilingUserType,
): Promise<{ sessionId: string }> {
  const existing = [...sessions.values()].find((s) => s.userId === userId);
  if (existing) await closeSession(existing.id);
  // Each connected advocate holds a browser context on this server; cap them
  // so one busy hour can't slow the server for everyone (idle ones close
  // after IDLE_TIMEOUT_MS).
  if (sessions.size >= MAX_SESSIONS) {
    throw new EcourtsHttpError(503, 'eFiling is busy right now - too many advocates connected at once. Try again in a few minutes.');
  }

  // One shared browser (started at API boot, like Land Records); each
  // advocate gets their own private context - separate cookies and session.
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // The `userAgent` option above only overrides the legacy UA string - it
    // does NOT touch Client Hints, which Chromium sends as separate request
    // headers regardless. Confirmed live as the actual cause of every real,
    // correctly-typed login failing through this service while the same
    // credentials succeeded in a normal browser: `sec-ch-ua` was leaking
    // `"HeadlessChrome";v="151"` on every request to filing.ecourts.gov.in
    // (captured directly off the verify_login POST), which the portal's own
    // anti-automation layer appears to silently reject behind the generic
    // "Invalid captcha" message rather than a distinguishable error -
    // `navigator.webdriver` spoofing alone does nothing to stop this, since
    // these are real network headers, not something JS-overridable after
    // the page loads.
    extraHTTPHeaders: {
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  // tsx/esbuild (dev) wraps named functions in a Node-only `__name` helper;
  // without this, functions run inside the portal page throw (same fix as
  // ecourts-web-search.service.ts).
  await context.addInitScript('window.__name = window.__name || function (f) { return f; };');
  if (contextHook) await contextHook(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  const sessionId = randomUUID();
  const session: EfilingSession = {
    id: sessionId,
    userId,
    browser,
    context,
    page,
    lastUsed: Date.now(),
    idleTimer: setTimeout(() => {}, 0),
    authenticated: false,
  };
  sessions.set(sessionId, session);
  touch(session);

  page.once('crash', () => { void closeSession(sessionId); });

  try {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#selState', { timeout: 20000 });
    await page.selectOption('#selState', stateValue);
    await page.check(`#${EFILING_USER_TYPE_RADIO_ID[userType]}`);
  } catch {
    await closeSession(sessionId);
    throw new EcourtsHttpError(502, 'Could not reach the eFiling portal right now. Try again in a few minutes.');
  }

  return { sessionId };
}

/**
 * Fill username/password and return the login CAPTCHA image. Mirrors
 * ecourts-live.service.ts's screenshotCaptcha pattern: wait for the <img> to
 * actually finish loading (naturalWidth > 0) before capturing, since a stale
 * placeholder frame can otherwise be screenshotted mid-reload.
 */
async function submitEfilingCredentialsStep(
  sessionId: string,
  userId: string,
  username: string,
  password: string,
): Promise<{ captchaImageBase64: string; sessionId: string }> {
  const session = getSession(sessionId, userId);
  const { page } = session;
  await page.fill('#user_name', username);
  await page.fill('#user_password', password);
  session.pendingLogin = { username, password };
  const captchaImageBase64 = await freshLoginCaptcha(page);
  return { captchaImageBase64, sessionId };
}

/**
 * Make the LOGIN captcha the one the portal will check, then screenshot it.
 *
 * The login page loads three Securimage captchas (login, forgot-password and
 * duplicate-login modals) from the same securimage_show.php with no
 * namespace, and Securimage keeps ONE code per session: the image served
 * last wins. Often that is a hidden modal's image, so the code shown to the
 * advocate was rejected as "Invalid captcha" even when typed exactly. After a
 * failure the portal's own JS loads two more images. So: let those settle,
 * load the login image once more ourselves, wait for it to arrive - it is
 * now the last one served - and only then show it.
 */
async function freshLoginCaptcha(page: Page, imageId = 'captcha_image'): Promise<string> {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const served = page
    .waitForResponse((r) => r.url().includes('/securimage/securimage_show.php'), { timeout: 10_000 })
    .catch(() => null);
  await page.evaluate((id) => {
    const img = document.getElementById(id);
    if (img) img.setAttribute('src', `/pdedev/securimage/securimage_show.php?${Math.random()}`);
  }, imageId);
  await served;
  await page.waitForFunction(
    (id) => {
      const img = document.getElementById(id) as { complete?: boolean; naturalWidth?: number } | null;
      return Boolean(img?.complete && (img?.naturalWidth ?? 0) > 0);
    },
    imageId,
    { timeout: 8000 },
  ).catch(() => {});
  await page.waitForTimeout(250);
  if (imageId !== 'captcha_image') {
    const buf = await page.locator(`#${imageId}`).first().screenshot({ timeout: 10_000 });
    return buf.toString('base64');
  }
  return screenshotLoginCaptcha(page);
}

async function screenshotLoginCaptcha(page: Page): Promise<string> {
  const captcha = page.locator('#captcha_image').first();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await captcha.waitFor({ state: 'visible', timeout: 10000 });
      await page.waitForFunction(
        () => {
          const img = document.getElementById('captcha_image') as { complete?: boolean; naturalWidth?: number } | null;
          return Boolean(img?.complete && (img?.naturalWidth ?? 0) > 0);
        },
        { timeout: 8000 },
      );
      const buf = await captcha.screenshot({ timeout: 10000 });
      if (buf.length > 500) return buf.toString('base64');
      lastErr = new Error(`captcha screenshot too small (${buf.length} bytes) - likely a placeholder frame`);
    } catch (err) {
      lastErr = err;
    }
    await page.waitForTimeout(400);
  }
  logger.warn({ err: lastErr }, 'efiling-live: login captcha screenshot failed after retries');
  throw new EcourtsHttpError(502, 'Could not load the captcha image from the eFiling portal - try again.');
}

/**
 * Click the portal's own refresh link, which swaps #captcha_image's src
 * in place (confirmed live - no page reload involved, unlike the CNR flow's
 * reload-on-wrong-captcha behaviour), then re-screenshot.
 */
async function refreshEfilingCaptchaStep(sessionId: string, userId: string): Promise<{ captchaImageBase64: string }> {
  const { page } = getSession(sessionId, userId);
  return { captchaImageBase64: await freshLoginCaptcha(page) };
}

export type EfilingLoginResult =
  | { status: 'authenticated' }
  | { retry: true; captchaImageBase64: string; reason: string }
  | { duplicateLogin: true; captchaImageBase64: string; reason: string };

/**
 * Submit the login CAPTCHA + credentials. Success is detected by waiting
 * for navigation away from the login page (the portal posts #frm_login and
 * redirects to the advocate's dashboard on success) rather than assuming a
 * specific dashboard selector, since the post-login DOM hasn't been
 * captured yet (see file header). On a wrong CAPTCHA the portal re-renders
 * the same login page with a fresh CAPTCHA and an inline error - this is
 * returned as a typed { retry: true } result, matching the CNR flow's
 * wrong-captcha handling, not thrown as an error. A VALID login while the
 * advocate is already logged in elsewhere is a third, distinct outcome -
 * see confirmDuplicateLogin below.
 */
async function submitEfilingLoginCaptchaStep(
  sessionId: string,
  userId: string,
  captchaCode: string,
): Promise<EfilingLoginResult> {
  const session = getSession(sessionId, userId);
  const { page } = session;

  try {
    await page.fill('#fcaptcha_code_mobile', captchaCode, { timeout: 8000 });
  } catch {
    throw new EcourtsHttpError(502, 'The eFiling portal is not responding to input right now. Try again.');
  }

  // Never log the verify_login request body: it carries the username and
  // sha256(sha256(password) + sha256(nonce)) WITH the nonce, which is enough
  // to brute-force the password offline.
  // Clear the previous attempt's error first: it stays on the page, and a
  // fixed wait used to read that STALE "Invalid captcha" before the portal
  // had answered the new attempt. Then wait for the portal's real answer.
  await page.evaluate(() => {
    const msg = document.getElementById('msg-danger4');
    if (msg) msg.innerHTML = '';
    document.querySelectorAll('.alert-danger4').forEach((el: any) => { el.style.display = 'none'; });
  }).catch(() => {});
  // The portal empties these on a failed attempt or a user-type change: make
  // sure they hold exactly what the advocate gave before pressing Login.
  if (session.pendingLogin) {
    const typed = await page.inputValue('#user_password').catch(() => '');
    if (typed !== session.pendingLogin.password) await page.fill('#user_password', session.pendingLogin.password).catch(() => {});
    const user = await page.inputValue('#user_name').catch(() => '');
    if (user !== session.pendingLogin.username) await page.fill('#user_name', session.pendingLogin.username).catch(() => {});
  }
  // Did the portal's own form checks let the login go out at all?
  let sent = false;
  const onRequest = (r: { url: () => string }) => { if (r.url().includes('login/verify_login')) sent = true; };
  page.on('request', onRequest);
  const answered = page
    .waitForResponse((r) => r.url().includes('login/verify_login'), { timeout: 60_000 })
    .catch(() => null);
  await page.click('#verify_button1');
  await page.waitForTimeout(3000);
  if (!sent) {
    // Stopped in the page by jQuery-Validate: show the portal's own message.
    page.off('request', onRequest);
    const fieldErrors = (await page.$$eval('label.error', (els) => els
      .filter((e: any) => e.offsetParent !== null && String(e.textContent ?? '').trim())
      .map((e: any) => String(e.textContent).trim())).catch(() => [])) as string[];
    const captchaImageBase64 = await freshLoginCaptcha(page).catch(() => '');
    const hint = fieldErrors.some((e) => /password/i.test(e))
      ? " - the password DifAi was given does not fit the portal's rule. Press Cancel, re-type your eFiling password (use Show to check it) and log in again."
      : '';
    return { retry: true, captchaImageBase64, reason: (fieldErrors.join(' · ') || 'The eFiling portal did not accept the form - check the username and password.') + hint };
  }
  const answer = await answered;
  page.off('request', onRequest);
  if (!answer) {
    // A slow portal can still log the advocate in after the wait: check.
    await page.waitForURL((u) => !/\/pdedev\/?(\?.*)?$/.test(u.toString()), { timeout: 20_000 }).catch(() => {});
    if (!(await page.locator('#frm_login').isVisible().catch(() => false))) {
      session.authenticated = true;
      session.pendingLogin = undefined;
      return { status: 'authenticated' };
    }
    if (session.pendingLogin) {
      await page.fill('#user_name', session.pendingLogin.username).catch(() => {});
      await page.fill('#user_password', session.pendingLogin.password).catch(() => {});
    }
    const captchaImageBase64 = await freshLoginCaptcha(page).catch(() => '');
    return { retry: true, captchaImageBase64, reason: 'The eFiling portal is slow right now and did not answer. Enter the new code and try again.' };
  }
  // Success navigates to the dashboard; failure re-renders the alert.
  await Promise.race([
    page.waitForURL((u) => !/\/pdedev\/?(\?.*)?$/.test(u.toString()), { timeout: 15_000 }),
    page.locator('#msg-danger4').filter({ hasText: /\S/ }).waitFor({ state: 'visible', timeout: 15_000 }),
  ]).catch(() => {});
  await page.waitForTimeout(300);

  const stillOnLogin = await page.locator('#frm_login').isVisible().catch(() => false);
  if (!stillOnLogin) {
    session.authenticated = true;
    session.pendingLogin = undefined;
    return { status: 'authenticated' };
  }

  // Wrong captcha / bad credentials - confirmed live: a server-side failure
  // (e.g. "Invalid captcha") renders as <div class="alert alert-danger
  // alert-dismissible alert-danger4">, NOT the per-field jQuery-Validate
  // ".error" labels (e.g. "#user_password-error") that fire on CLIENT-side
  // validation before the request is even sent (observed live: a password
  // not meeting the portal's complexity regex trips one of those instead).
  //
  // The page ships SEVEN near-identical empty/hidden alert-danger* divs
  // (pre-rendered placeholders for different form outcomes) alongside the
  // one actually visible/populated one - `.first()` on class alone grabs
  // whichever empty div comes first in DOM order and returns '' (confirmed
  // live). `:visible` is required, not just "pick any match".
  const alertEl = page.locator('.alert-danger4:visible, .alert-danger:visible:not(.alert-danger-cust)').first();
  const reason = (await alertEl.innerText().catch(() => '')).trim() || 'Login failed - check the CAPTCHA and try again.';

  // CORRECT credentials, but the advocate is already logged in elsewhere -
  // confirmed live: same credentials that succeed in a normal browser were
  // rejected through this automated session until this was handled, because
  // eCourts enforces one active session per advocate account server-side
  // (this is NOT a captcha problem - don't let it masquerade as one). The
  // portal's own JS shows a "User already login... CLICK HERE to logout
  // from other places" message containing a link that reveals a SECOND,
  // separate confirmation form (#frm_duplicate_login, inside the
  // #alert_invalid_pin modal) with its own password/captcha/submit button
  // (#user_pwd / #fcaptcha_code_mobile1 / #re_verify_button). Detect this
  // by the distinctive phrase rather than a specific DOM flag, since the
  // server communicates it only via this HTML string (no separate JSON
  // field we can rely on from the outside - `errorfield` was empty/unused
  // in this response shape when captured live).
  if (/already\s*login/i.test(reason)) {
    // Never silently fall through to an empty-captcha "success" here - a
    // swallowed failure at any of these three steps previously surfaced as
    // the STALE reason text from the original alert being shown again under
    // the duplicate-login step, with a broken/empty captcha image, which
    // read to the advocate as "still failing the same way" when the real
    // problem was the modal never opening. Each step now throws a specific,
    // honest error instead.
    const clickHere = page.getByText('CLICK HERE', { exact: false }).first();
    const clickHereCount = await clickHere.count().catch(() => 0);
    if (clickHereCount === 0) {
      logger.warn({ reason }, 'efiling-live: "already login" detected but no CLICK HERE link found in the alert');
      throw new EcourtsHttpError(502, "eCourts says you're already logged in elsewhere, but the confirmation link couldn't be found on the page. Try again, or log out of eFiling in your other browser tab first.");
    }
    // "CLICK HERE" runs the portal's open_logout_form(): it reloads the
    // pop-up's captcha, then calls login/duplicate_logout_data and, in that
    // call's callback, reloads the hidden Forgot-password captcha too - which
    // (Securimage keeps one code: last served wins) silently voided the code
    // shown in the pop-up. Let all of that finish before showing a captcha.
    const logoutData = page.waitForResponse((r) => r.url().includes('login/duplicate_logout_data'), { timeout: 15_000 }).catch(() => null);
    await clickHere.click();
    await logoutData;
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const modalOpened = await page.locator('#frm_duplicate_login').waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (!modalOpened) {
      logger.warn('efiling-live: clicked CLICK HERE but #frm_duplicate_login never became visible');
      throw new EcourtsHttpError(502, "Could not open eCourts' logout-confirmation screen. Try again in a moment.");
    }
    const captchaImageBase64 = await screenshotDuplicateLoginCaptcha(page).catch((err) => {
      logger.warn({ err }, 'efiling-live: duplicate-login modal opened but captcha screenshot failed');
      return '';
    });
    if (!captchaImageBase64) {
      throw new EcourtsHttpError(502, "eCourts' logout-confirmation screen opened but its captcha image didn't load. Try again.");
    }
    return { duplicateLogin: true, captchaImageBase64, reason };
  }

  // Wrong captcha: the portal has already spent that captcha code (Securimage
  // invalidates a code once checked) and hashed the password field in place.
  // Showing the same image again made every retry fail with "Invalid
  // captcha" however carefully it was typed - so refill the credentials and
  // load a fresh image before asking again.
  if (session.pendingLogin) {
    await page.fill('#user_name', session.pendingLogin.username).catch(() => {});
    await page.fill('#user_password', session.pendingLogin.password).catch(() => {});
  }
  await page.fill('#fcaptcha_code_mobile', '').catch(() => {});
  const captchaImageBase64 = await freshLoginCaptcha(page).catch(() => screenshotLoginCaptcha(page).catch(() => ''));
  return { retry: true, captchaImageBase64, reason };
}

async function screenshotDuplicateLoginCaptcha(page: Page): Promise<string> {
  const captcha = page.locator('#captcha_image1').first();
  await captcha.waitFor({ state: 'visible', timeout: 10000 });
  // Same Securimage race as the login captcha (see freshLoginCaptcha).
  const fresh = await freshLoginCaptcha(page, 'captcha_image1').catch(() => '');
  if (fresh.length > 500) return fresh;
  await page.waitForFunction(
    () => {
      const img = document.getElementById('captcha_image1') as { complete?: boolean; naturalWidth?: number } | null;
      return Boolean(img?.complete && (img?.naturalWidth ?? 0) > 0);
    },
    { timeout: 8000 },
  );
  const buf = await captcha.screenshot({ timeout: 10000 });
  return buf.toString('base64');
}

/**
 * Resolves the "already logged in elsewhere" prompt by submitting the
 * portal's second confirmation form (#frm_duplicate_login) - this logs out
 * the advocate's other active session and completes login here. Confirmed
 * live field ids: #user_pwd (password, re-collected - not re-read from
 * #user_password, a separate field in a separate form), #fcaptcha_code_mobile1
 * (this form's own captcha, image #captcha_image1), #re_verify_button
 * (submit). Success is detected the same way as submitEfilingLoginCaptcha -
 * waiting for #frm_login to no longer be the visible form.
 */
async function confirmDuplicateEfilingLoginStep(
  sessionId: string,
  userId: string,
  password: string,
  captchaCode: string,
): Promise<{ status: 'authenticated' } | { retry: true; captchaImageBase64: string; reason: string }> {
  const session = getSession(sessionId, userId);
  const { page } = session;

  // The advocate's password from the login step, if the client didn't resend it.
  const pwd = password || session.pendingLogin?.password || '';
  try {
    await page.fill('#user_pwd', pwd, { timeout: 8000 });
    await page.fill('#fcaptcha_code_mobile1', captchaCode, { timeout: 8000 });
  } catch {
    throw new EcourtsHttpError(502, 'The eFiling portal is not responding to input right now. Try again.');
  }

  const urlBeforeSubmit = page.url();
  // As for the login: clear the old message, then wait for the real answer.
  await page.evaluate(() => {
    const msg = document.getElementById('msg-danger5');
    if (msg) msg.innerHTML = '';
    document.querySelectorAll('.alert-danger5').forEach((el: any) => { el.style.display = 'none'; });
  }).catch(() => {});
  const answered = page
    .waitForResponse((r) => r.url().includes('login/verify_duplicate_login'), { timeout: 60_000 })
    .catch(() => null);
  await page.click('#re_verify_button');
  if (!(await answered)) {
    await page.waitForURL((u) => u.toString() !== urlBeforeSubmit, { timeout: 20_000 }).catch(() => {});
    if (page.url() !== urlBeforeSubmit) {
      session.authenticated = true;
      session.pendingLogin = undefined;
      return { status: 'authenticated' };
    }
    const captchaImageBase64 = await screenshotDuplicateLoginCaptcha(page).catch(() => '');
    return { retry: true, captchaImageBase64, reason: 'The eFiling portal is slow right now and did not answer. Enter the new code and try again.' };
  }
  await Promise.race([
    page.waitForURL((u) => u.toString() !== urlBeforeSubmit, { timeout: 15_000 }),
    page.locator('#msg-danger5').filter({ hasText: /\S/ }).waitFor({ state: 'visible', timeout: 15_000 }),
  ]).catch(() => {});
  await page.waitForTimeout(300);

  // #frm_login is NOT a valid success signal here (confirmed live): it's the
  // underlying login page sitting behind this modal and stays in the DOM -
  // and Playwright's isVisible() still reports it visible - the entire
  // time the modal is open, success or failure, because a Bootstrap modal
  // overlays the page rather than detaching it. Checking it unconditionally
  // evaluated true, meaning this function could never report success even
  // when the real portal logged the advocate in - it always fell through
  // to the failure branch and returned a stale/misleading reason. On real
  // success the portal's own JS does `window.location.href =
  // obj.redirect_path` - a genuine navigation away from this URL is the
  // only reliable signal.
  const navigatedAway = page.url() !== urlBeforeSubmit;
  if (navigatedAway) {
    session.authenticated = true;
    session.pendingLogin = undefined;
    return { status: 'authenticated' };
  }

  const reason = (await page
    .locator('.alert-danger5:visible')
    .first()
    .innerText()
    .catch(() => ''))
    .trim() || 'Could not confirm the logout - check the captcha and try again.';
  const captchaImageBase64 = await screenshotDuplicateLoginCaptcha(page).catch(() => '');
  return { retry: true, captchaImageBase64, reason };
}

// ---- connected session: status, reading the portal, logout -----------------

async function portalLogout(page: Page): Promise<void> {
  const href = (await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href]')].find((x: any) => /logout|log out|sign out/i.test(`${x.href} ${x.textContent}`));
    return a ? String((a as any).href) : null;
  }).catch(() => null)) as string | null;
  if (href && PORTAL_HREF.test(href)) {
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
  }
}

const PORTAL_HREF = /^https:\/\/filing\.ecourts\.gov\.in\//;

export interface EfilingSessionStatus {
  sessionId: string;
  authenticated: boolean;
  /** Minutes until DifAi closes the session if nothing touches it. */
  idleMinutesLeft: number;
}

/** Keep-alive + status: the eFiling screens call this every couple of minutes. */
export function efilingSessionStatus(sessionId: string, userId: string): EfilingSessionStatus {
  const session = getSession(sessionId, userId);
  return { sessionId, authenticated: session.authenticated, idleMinutesLeft: Math.round(IDLE_TIMEOUT_MS / 60_000) };
}

export interface PortalField {
  tag: string; type: string; id: string; name: string; label: string; text: string;
  required: boolean; section: string; options?: string[];
}

export interface PortalSnapshot {
  url: string;
  title: string;
  headings: string[];
  /** Menu / link text -> URL, as the portal itself offers them. */
  links: Array<{ text: string; href: string }>;
  /** Dashboard tile counts found by label (best effort). */
  counts: Record<string, number>;
  fields: PortalField[];
}

const DASHBOARD_TILES = ['Draft Pleadings', 'Completed Pleadings', 'Draft IAs', 'Completed IAs', 'Objections', 'My Cases'];

/** Read the page the session is on: headings, links, tile counts, every visible control. Read-only. */
async function snapshot(page: Page): Promise<PortalSnapshot> {
  return page.evaluate((tiles: string[]) => {
    const vis = (e: any) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const txt = (e: any) => (e ? String(e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim() : '');
    const labelOf = (el: any): string => {
      if (el.id) {
        const l = document.querySelector(`label[for="${String(el.id).replace(/"/g, '\\"')}"]`);
        if (l) return txt(l);
      }
      const wrap = el.closest('label'); if (wrap) return txt(wrap).slice(0, 120);
      const td = el.closest('td'); if (td && td.previousElementSibling) return txt(td.previousElementSibling).slice(0, 120);
      const grp = el.closest('.form-group, .col-md-6, .col-sm-6, .col-md-4, .row');
      const l = grp && grp.querySelector('label'); if (l) return txt(l).slice(0, 120);
      return el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.title || '';
    };
    const sectionOf = (el: any): string => {
      let n = el;
      while (n && n !== document.body) {
        let s = n.previousElementSibling;
        while (s) {
          if (/^(H[1-6]|LEGEND)$/.test(s.tagName) || /header|heading|title/i.test(String(s.className || ''))) return txt(s).slice(0, 80);
          s = s.previousElementSibling;
        }
        n = n.parentElement;
      }
      return '';
    };
    const fields = [...document.querySelectorAll('input, select, textarea, button')]
      .filter((e: any) => vis(e) && e.type !== 'hidden')
      .map((e: any) => ({
        tag: String(e.tagName).toLowerCase(), type: e.type || '', id: e.id || '', name: e.getAttribute('name') || '',
        label: labelOf(e), text: e.tagName === 'BUTTON' ? txt(e).slice(0, 80) : '',
        required: !!e.required || /\*/.test(labelOf(e)), section: sectionOf(e),
        options: e.tagName === 'SELECT' ? [...e.options].slice(0, 80).map((o: any) => `${o.value}=${String(o.text).trim()}`) : undefined,
      }));
    const links = [...document.querySelectorAll('a[href]')]
      .map((a: any) => ({ text: txt(a).slice(0, 80), href: String(a.href) }))
      .filter((l) => l.text && /^https:\/\/filing\.ecourts\.gov\.in\//.test(l.href) && !/logout/i.test(l.href));
    const counts: Record<string, number> = {};
    for (const label of tiles) {
      // The tile itself: the SMALLEST element holding the label and a number
      // after it (tiles sit in pairs inside shared panels - a panel holds
      // both tiles' labels and numbers). "Draft Pleadings" must not match
      // "Completed Pleadings"'s text either.
      const holders = [...document.querySelectorAll('div, a, li, span, button')]
        .filter((e: any) => vis(e) && txt(e).includes(label) && txt(e).length < label.length + 40)
        .sort((x: any, y: any) => txt(x).length - txt(y).length);
      for (const h of holders) {
        const t = txt(h);
        const at = t.indexOf(label);
        if (at > 0 && /[A-Za-z]$/.test(t.slice(0, at).trim())) continue;
        const m = /^\D*?(\d+)/.exec(t.slice(at + label.length));
        if (m) { counts[label] = Number(m[1]); break; }
      }
    }
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,legend,.card-header,.panel-heading')].filter(vis).map(txt).filter(Boolean).slice(0, 40);
    return { url: String(document.location.href), title: document.title, headings, links: links.slice(0, 200), counts, fields };
  }, DASHBOARD_TILES) as Promise<PortalSnapshot>;
}

/**
 * Development only: keep what the portal showed so its screens can be mapped
 * (field ids, options, menus). Off in production; stays on this machine.
 */
async function keepCapture(page: Page, what: string, snap: PortalSnapshot): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') return;
  const dir = process.env['EFILING_CAPTURE_DIR'] || join(tmpdir(), 'difai-efiling-capture');
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(join(dir, `${stamp}-${what}.json`), JSON.stringify(snap, null, 1));
  await writeFile(join(dir, `${stamp}-${what}.html`), await page.content());
  logger.info({ dir, what, fields: snap.fields.length, links: snap.links.length }, 'efiling-live: portal page captured for mapping');
}

export type PortalPage = 'dashboard' | 'new_case';

async function findLink(page: Page, pattern: RegExp): Promise<string | null> {
  const hrefs = (await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((x: any) => ({ text: String(x.textContent || ''), href: String(x.href) })),
  ).catch(() => [])) as Array<{ text: string; href: string }>;
  // Skip menu headings (href="#"): only links that open a page.
  const hit = hrefs.find((l) => pattern.test(l.text.trim()) && PORTAL_HREF.test(l.href) && !/logout/i.test(l.href) && !/#$/.test(l.href));
  return hit?.href ?? null;
}

/**
 * Read one of the advocate's own portal pages over their logged-in session.
 * Navigation only - nothing is clicked, saved or submitted.
 */
async function readPortalPageStep(sessionId: string, userId: string, what: PortalPage): Promise<PortalSnapshot> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  const { page } = session;
  if (what === 'dashboard') {
    const home = await findLink(page, /dashboard|^\s*home\s*$/i);
    if (home) await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  } else {
    const href = await findLink(page, /new\s*case\s*filing/i);
    if (!href) throw new EcourtsHttpError(502, "Couldn't find New Case Filing in your portal menu.");
    await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  // Bounced back to the login form: the portal ended the session.
  if (await page.$('#user_name')) {
    throw portalSessionEnded(session);
  }
  const snap = await snapshot(page);
  await keepCapture(page, what, snap).catch((err) => logger.warn({ err }, 'efiling-live: capture failed'));
  return snap;
}

// ---- the portal's own request channel ----------------------------------------
//
// Reverse-engineered from the portal's public components.js (CMP:214-333):
// every logged-in action is `POST {#base_url}/?p=<controller>/<method>` with
// a form body + `ajax_req=true&__csrf_magic=<token>`. The token in hidden
// #__csrf_magic CHANGES after every request (new one in `nsteptoken`, or after
// `#####` in an error body), so calls in one session must run one at a time.
// Sending them from inside the advocate's logged-in page keeps the portal's
// own cookies and token chain, exactly as its own JS does.

export interface PortalReply {
  httpStatus: number;
  json: Record<string, unknown> | null;
  text: string;
}

const queues = new WeakMap<Page, Promise<unknown>>();

/** One portal request over the advocate's session (serialised per session). */
async function portalPost(page: Page, route: string, postdata = ''): Promise<PortalReply> {
  const prev = queues.get(page) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => page.evaluate(
    ({ route, postdata }) => new Promise<{ httpStatus: number; text: string }>((resolve) => {
      const baseEl = document.getElementById('base_url') as { value?: string } | null;
      const tokEl = document.getElementById('__csrf_magic') as { value?: string } | null;
      const base = (baseEl?.value || '/pdedev').replace(/\/$/, '');
      const body = `${postdata ? `${postdata}&` : ''}ajax_req=true&__csrf_magic=${encodeURIComponent(tokEl?.value ?? '')}`;
      const xhr = new (globalThis as any).XMLHttpRequest();
      xhr.open('POST', `${base}/?p=${route}`);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.onload = () => resolve({ httpStatus: xhr.status, text: String(xhr.responseText ?? '') });
      xhr.onerror = () => resolve({ httpStatus: 0, text: '' });
      xhr.send(body);
    }),
    { route, postdata },
  ));
  queues.set(page, run);
  const { httpStatus, text } = await run;
  let json: Record<string, unknown> | null = null;
  let token: string | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
    if (typeof json['nsteptoken'] === 'string') token = json['nsteptoken'];
  } catch {
    const i = text.lastIndexOf('#####');
    if (i >= 0) token = text.slice(i + 5).trim();
  }
  if (token) {
    await page.evaluate((t) => {
      const el = document.getElementById('__csrf_magic') as { value?: string } | null;
      if (el) el.value = t;
    }, token).catch(() => {});
  }
  return { httpStatus, json, text: json ? '' : text.slice(0, 500) };
}

export interface PortalTableData {
  headers: string[];
  /** Each row's cell text; a row spanning the table is a group heading. */
  rows: Array<{ group: string } | { cells: string[]; actions?: string[] }>;
}

/** The portal's server-rendered HTML tables -> rows (parsed in the page). */
async function htmlTable(page: Page, html: string): Promise<PortalTableData> {
  return page.evaluate((h) => {
    const doc = new (globalThis as any).DOMParser().parseFromString(String(h), 'text/html');
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const ownRows = (t: any) => [...(t.tBodies?.length ? [...t.tBodies].flatMap((b: any) => [...b.rows]) : [...t.rows])]
      .filter((r: any) => !r.parentElement?.matches?.('thead'));
    // The list itself: the portal's #example1, else the outermost table with
    // the most rows. Rows of the pop-ups hidden inside each row (View
    // Documents etc.) and the search bar's layout table are not the list.
    const outer = [...doc.querySelectorAll('table')].filter((t: any) => !t.parentElement?.closest('table'));
    const table = doc.querySelector('table#example1')
      ?? outer.sort((a: any, b: any) => (b.querySelectorAll('thead th').length > 0 ? 1 : 0) - (a.querySelectorAll('thead th').length > 0 ? 1 : 0) || ownRows(b).length - ownRows(a).length)[0];
    if (!table) return { headers: [], rows: [] };
    // A cell's visible text: no nested tables, hidden pop-ups, scripts.
    const visible = (c: any) => {
      const k = c.cloneNode(true);
      for (const e of [...k.querySelectorAll('table, script, style, .modal, .popup, [style*="display:none"], [style*="display: none"]')]) e.remove();
      return k;
    };
    // A cell's lines as the portal shows them (case no / CNR / e-filing no ...).
    const lines = (k: any) => {
      for (const br of [...k.querySelectorAll('br')]) br.replaceWith('\n');
      for (const b of [...k.querySelectorAll('div, p, li, tr')]) b.append('\n');
      return String(k.textContent ?? '').split('\n').map((x: string) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    };
    const head = table.tHead?.rows?.length ? table.tHead.rows[table.tHead.rows.length - 1] : null;
    const headers = head ? [...head.cells].map(txt) : [];
    const rows = ownRows(table).map((tr: any) => {
      const cells = [...tr.cells];
      if (cells.length === 1 && Number(cells[0].getAttribute('colspan') || 1) > 1) return { group: txt(visible(cells[0])) };
      const actions: string[] = [];
      for (const c of cells) {
        for (const b of [...visible(c).querySelectorAll('button, a, input[type=button]')] as any[]) {
          const label = txt(b) || String(b.value ?? '').trim();
          const clickable = b.tagName !== 'A' || b.getAttribute('onclick') || /^(#|javascript:)/i.test(b.getAttribute('href') ?? '#');
          if (label && clickable && label.length < 40 && !actions.includes(label)) actions.push(label);
        }
      }
      return {
        cells: cells.map((c: any) => {
          // Select boxes (e.g. "Select GRN") -> their option texts.
          const shown = visible(c);
          const sel = shown.querySelector('select');
          if (sel) return [...sel.options].map((o: any) => txt(o)).filter((t: string) => t && !/^select/i.test(t)).join(', ');
          return lines(shown);
        }),
        ...(actions.length ? { actions } : {}),
      };
    }).filter((r: any) => ('group' in r ? r.group : r.cells.some(Boolean)));
    return { headers, rows };
  }, html) as Promise<PortalTableData>;
}

export type PortalListKey = 'draft_cases' | 'filed_cases' | 'draft_pleadings' | 'completed_pleadings' | 'draft_ias' | 'completed_ias' | 'objections' | 'my_cases';

// tile = the dashboard element the advocate clicks (dashboard.js binds
// $('#<tile>').on('click', ...)); its list opens in #db_screen / #history_body.
const PORTAL_LISTS: ReadonlyArray<{ key: PortalListKey; label: string; tile: string; route: string; postdata: string; field: string }> = [
  { key: 'draft_cases', label: 'Draft Cases', tile: 'draft_cases', route: 'advocate_case_registration/getUnRegisteredPDE', postdata: 'hide_show_action=1', field: 'pde_list' },
  { key: 'filed_cases', label: 'eFiled Cases', tile: 'filed_cases', route: 'advocate_case_registration/getSubmittedPDE', postdata: '', field: 'submitted_pde_list' },
  { key: 'draft_pleadings', label: 'Draft Pleadings', tile: 'efiling_activity', route: 'dashboard/fetchActivities', postdata: '', field: 'submitted_pde_list' },
  { key: 'completed_pleadings', label: 'Completed Pleadings', tile: 'completed_pleading', route: 'dashboard/fetchCompletedActivities', postdata: '', field: 'submitted_pde_list' },
  { key: 'draft_ias', label: 'Draft IAs', tile: 'draft_ia', route: 'dashboard/fetchDraftIA', postdata: '', field: 'submitted_pde_list' },
  { key: 'completed_ias', label: 'Completed IAs', tile: 'completed_ia', route: 'dashboard/fetchCompletedIA', postdata: '', field: 'submitted_pde_list' },
  { key: 'objections', label: 'Objections', tile: 'objections', route: 'dashboard/fetchObjections', postdata: '', field: 'table' },
  // My Cases loads the portal's portfolio page (HTML) into the same pop-up.
  { key: 'my_cases', label: 'My Cases', tile: 'my_cases', route: 'Portfolio_new/my_cases', postdata: 'header_view=N', field: '' },
];

/**
 * Click a dashboard tile the way the advocate would and read the list the
 * portal's own JS puts in #history_body. null when the tile isn't on this page.
 */
async function clickTile(page: Page, tile: string, keepOpen = false): Promise<string | null> {
  const present = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const body = document.getElementById('history_body');
    if (!el || !body) return false;
    body.innerHTML = '';
    return true;
  }, tile).catch(() => false);
  if (!present) return null;
  await page.evaluate((id) => (document.getElementById(id) as any).click(), tile);
  const filled = await page.waitForFunction(
    () => String((document.getElementById('history_body') as any)?.innerHTML ?? '').trim().length > 0,
    undefined,
    { timeout: 20_000 },
  ).then(() => true).catch(() => false);
  const html = filled ? await page.evaluate(() => String((document.getElementById('history_body') as any).innerHTML)) : '';
  if (keepOpen) return html;
  // Close the list again, as the advocate would.
  await page.evaluate(() => {
    const $ = (globalThis as any).jQuery;
    if ($) $('#db_screen').modal?.('hide');
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  return html;
}

export interface PortalList extends PortalTableData {
  key: PortalListKey;
  label: string;
  total: number | null;
  error: string | null;
}

/** Make sure the session is on the portal's logged-in dashboard. */
async function ensureDashboard(session: EfilingSession, fresh = false): Promise<void> {
  const { page } = session;
  if (!fresh && await page.$('#efiling_activity, #draft_cases, #objections')) return;
  await page.goto(`${BASE}/pdedev/?p=dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  const landed = await page.waitForSelector('#efiling_activity, #draft_cases, #objections, #user_name', { timeout: 15_000 }).catch(() => null);
  // Bounced to the login form (or anywhere that isn't the dashboard while
  // the address says login): the portal ended the session.
  if (await page.$('#user_name') || (!landed && /login|logout|session/i.test(page.url()))) {
    throw portalSessionEnded(session);
  }
  if (!landed) throw new EcourtsHttpError(502, "The eFiling portal didn't open your dashboard - it may be slow right now. Try Refresh.");
}

/** One of the portal's lists: click its tile (or make the same request). */
async function readOneList(page: Page, l: (typeof PORTAL_LISTS)[number], tileCount: number | undefined): Promise<PortalList> {
  try {
    const fromTile = await clickTile(page, l.tile);
    if (fromTile !== null) {
      const table = fromTile ? await htmlTable(page, fromTile) : { headers: [], rows: [] };
      return { key: l.key, label: l.label, total: tileCount ?? table.rows.filter((r) => 'cells' in r).length, ...table, error: fromTile ? null : 'The portal did not show this list.' };
    }
    // Tile not on this page: make the same request its click would.
    const reply = await portalPost(page, l.route, l.postdata);
    if (!reply.json) {
      return { key: l.key, label: l.label, total: null, headers: [], rows: [], error: reply.httpStatus === 200 ? 'The portal sent an unexpected answer.' : `The portal answered ${reply.httpStatus}.` };
    }
    const html = typeof reply.json[l.field] === 'string' ? (reply.json[l.field] as string) : '';
    const err = typeof reply.json['errormsg'] === 'string' ? (reply.json['errormsg'] as string) : null;
    const table = html ? await htmlTable(page, html) : { headers: [], rows: [] };
    const total = Number(reply.json['total_record']);
    return { key: l.key, label: l.label, total: Number.isFinite(total) ? total : table.rows.filter((r) => 'cells' in r).length, ...table, error: err };
  } catch (e) {
    return { key: l.key, label: l.label, total: null, headers: [], rows: [], error: (e as Error).message };
  }
}

/**
 * The numbers on the portal's own dashboard tiles (Draft / Completed
 * Pleadings, Draft / Completed IAs, Objections, My Cases) - one quick read of
 * the page, so DifAi's dashboard shows them at once. Lists load per tile.
 */
export interface PortalDashboardView {
  counts: Partial<Record<PortalListKey, number>>;
  /** The portal's Calendar: the month it shows and the case count badge per day. */
  calendar: { month: number | null; year: number | null; days: Record<string, number> };
  /** "Cases Listed Today - dd-mm-yyyy" as the portal shows it. */
  today: { title: string; table: PortalTableData | null; text: string };
}

/** Today in India as dd-mm-yyyy, like the portal's headings. */
function istDate(): string {
  const d = new Date(Date.now() + 330 * 60_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
}

/** The portal dashboard's Calendar badges and "Cases Listed Today" box, as rendered. */
async function readCalendarAndToday(page: Page): Promise<Omit<PortalDashboardView, 'counts'>> {
  const raw = await page.evaluate(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const cal = document.querySelector('.ui-datepicker-calendar') as any;
    const days: Record<string, number> = {};
    if (cal) {
      for (const td of [...cal.querySelectorAll('td')] as any[]) {
        if (td.classList.contains('ui-datepicker-other-month')) continue;
        const a = td.querySelector('a, span.ui-state-default');
        // The day is the link's own text; a badge may sit inside or beside it.
        const own = a ? [...a.childNodes].filter((n: any) => n.nodeType === 3).map((n: any) => String(n.textContent).trim()).join('') : '';
        const day = Number(td.getAttribute('data-date')) || Number(own.replace(/\D/g, '')) || Number(txt(a).replace(/\D/g, ''));
        // A badge is any leaf with just a number that isn't the day itself.
        const badge = [...td.querySelectorAll('*')].find((el: any) => el !== a && !el.children.length && /^\d+$/.test(txt(el)));
        if (day && badge) days[String(day)] = Number(txt(badge));
      }
    }
    const month = (document.querySelector('.ui-datepicker-month') as any);
    const year = (document.querySelector('.ui-datepicker-year') as any);
    const monthVal = month ? Number(month.value ?? NaN) : NaN;
    const yearVal = year ? Number(year.value ?? txt(year)) : NaN;
    // "Cases Listed Today - dd-mm-yyyy" heading and the box under it.
    // The innermost element naming it (later in document order = deeper).
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span,label,b,strong')]
      .filter((e: any) => /cases listed/i.test(txt(e)) && txt(e).length < 60).pop() as any;
    let box: any = document.querySelector('.activeCasestbl');
    if (!box && heading) box = heading.nextElementSibling ?? heading.parentElement?.nextElementSibling;
    const table = box?.querySelector('table');
    return {
      days,
      month: Number.isFinite(monthVal) ? monthVal + 1 : null,
      year: Number.isFinite(yearVal) ? yearVal : null,
      title: heading ? txt(heading) : '',
      tableHtml: table ? String(table.outerHTML) : '',
      text: box && !table ? txt(box).slice(0, 300) : '',
    };
  }).catch(() => ({ days: {}, month: null, year: null, title: '', tableHtml: '', text: '' }));
  const table = raw.tableHtml ? await htmlTable(page, raw.tableHtml) : null;
  return { calendar: { month: raw.month, year: raw.year, days: raw.days }, today: { title: /\d{2}-\d{2}-\d{4}/.test(raw.title) ? raw.title : `Cases Listed Today - ${istDate()}`, table, text: raw.text } };
}

async function readPortalCountsStep(sessionId: string, userId: string): Promise<PortalDashboardView> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  await ensureDashboard(session, true);
  // The portal draws its calendar badges a moment after load.
  await session.page.waitForSelector('.ui-datepicker-calendar', { timeout: 5000 }).catch(() => {});
  const counts = (await snapshot(session.page).catch(() => null))?.counts ?? {};
  const out: Partial<Record<PortalListKey, number>> = {};
  for (const l of PORTAL_LISTS) if (counts[l.label] !== undefined) out[l.key] = counts[l.label]!;
  return { counts: out, ...(await readCalendarAndToday(session.page)) };
}

/** One dashboard list, as the portal shows it when that tile is clicked. */
async function readPortalListStep(sessionId: string, userId: string, key: PortalListKey): Promise<PortalList> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  const l = PORTAL_LISTS.find((x) => x.key === key);
  if (!l) throw new EcourtsHttpError(400, 'Unknown eFiling list.');
  await ensureDashboard(session);
  const counts = (await snapshot(session.page).catch(() => null))?.counts ?? {};
  const list = await readOneList(session.page, l, counts[l.label]);
  // Nothing came back: the portal may have signed this session out while the
  // old dashboard stayed on screen. Reload it - that tells us (410) - and try once more.
  if (list.error && !list.rows.length) {
    await ensureDashboard(session, true);
    return readOneList(session.page, l, counts[l.label]);
  }
  return list;
}

/**
 * Every dashboard list at once (tests and small accounts). The screens use
 * readPortalCounts + readPortalList: one request per list stays well inside
 * the web server's time limit.
 */
async function readPortalListsStep(sessionId: string, userId: string): Promise<PortalList[]> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  const { page } = session;
  if (!(await page.$('#__csrf_magic'))) {
    await readPortalPageStep(sessionId, userId, 'dashboard').catch(() => {});
    if (!(await page.$('#__csrf_magic')) && (await page.$('#user_name'))) {
      throw portalSessionEnded(session);
    }
  }
  const tileCounts = (await snapshot(page).catch(() => null))?.counts ?? {};
  const out: PortalList[] = [];
  for (const l of PORTAL_LISTS) out.push(await readOneList(page, l, tileCounts[l.label]));
  if (process.env['NODE_ENV'] !== 'production') {
    const dir = process.env['EFILING_CAPTURE_DIR'] || join(tmpdir(), 'difai-efiling-capture');
    await mkdir(dir, { recursive: true }).catch(() => {});
    await writeFile(join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-lists.json`), JSON.stringify(out, null, 1)).catch(() => {});
  }
  return out;
}

/**
 * NOT YET IMPLEMENTED - see file header. Will take a storage.pdf_key-sourced
 * document buffer and drive the actual filing form once its real selectors
 * are captured from a logged-in session.
 */
export async function openNewFiling(sessionId: string, userId: string): Promise<never> {
  getSession(sessionId, userId);
  throw new EfilingNotCapturedError('open new filing');
}

/** NOT YET IMPLEMENTED - see file header. */
export async function uploadFilingDocument(sessionId: string, userId: string): Promise<never> {
  getSession(sessionId, userId);
  throw new EfilingNotCapturedError('upload filing document');
}

export async function endEfilingSession(sessionId: string, userId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (session && session.userId === userId) await closeSession(sessionId);
}

/**
 * Log every connected advocate out of the portal (server shutdown, restart,
 * deploy). Without this a restart left their portal session open, and the
 * portal - one session per account - then answered "User already login" on
 * their next login, in DifAi and in their own browser.
 */
export async function closeAllEfilingSessions(timeoutMs = 8000): Promise<void> {
  const all = [...sessions.keys()].map((id) => closeSession(id).catch(() => {}));
  await Promise.race([Promise.all(all), new Promise((r) => setTimeout(r, timeoutMs))]);
}

process.on('beforeExit', () => {
  void closeAllEfilingSessions();
});

// ---- working on a logged-in portal page --------------------------------------

/**
 * Run `fn` on the advocate's logged-in portal page, one step at a time. Used
 * by efiling-portal-filing.service.ts to drive the portal's own screens.
 */
export async function withPortalPage<T>(sessionId: string, userId: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const session = getSession(sessionId, userId);
  return exclusive(session, async () => {
    if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
    if (await session.page.$('#user_name')) {
      throw portalSessionEnded(session);
    }
    return fn(session.page);
  });
}

/** Open a page from the portal's own menu by its link text (navigation only). */
export async function openPortalMenu(page: Page, linkText: RegExp): Promise<boolean> {
  const href = await findLink(page, linkText);
  if (!href) return false;
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  return true;
}

// ---- public steps: one at a time per advocate ------------------------------

export async function submitEfilingCredentials(sessionId: string, userId: string, username: string, password: string) {
  return exclusive(getSession(sessionId, userId), () => submitEfilingCredentialsStep(sessionId, userId, username, password));
}

export async function refreshEfilingCaptcha(sessionId: string, userId: string) {
  return exclusive(getSession(sessionId, userId), () => refreshEfilingCaptchaStep(sessionId, userId));
}

export async function submitEfilingLoginCaptcha(sessionId: string, userId: string, captchaCode: string) {
  return exclusive(getSession(sessionId, userId), () => submitEfilingLoginCaptchaStep(sessionId, userId, captchaCode));
}

export async function confirmDuplicateEfilingLogin(sessionId: string, userId: string, password: string, captchaCode: string) {
  return exclusive(getSession(sessionId, userId), () => confirmDuplicateEfilingLoginStep(sessionId, userId, password, captchaCode));
}

export async function readPortalPage(sessionId: string, userId: string, what: PortalPage) {
  return exclusive(getSession(sessionId, userId), () => readPortalPageStep(sessionId, userId, what));
}

export async function readPortalLists(sessionId: string, userId: string) {
  return exclusive(getSession(sessionId, userId), () => readPortalListsStep(sessionId, userId));
}
export interface PortalRowView {
  /** The heading lines of what opened (case number, court, parties). */
  title: string[];
  /** One per tab (Document, Application, Court Fee, Oath), or just one. */
  sections: Array<{ name: string; table: PortalTableData | null; text: string }>;
}

/**
 * A button in one row of a dashboard list (View Documents, View Status ...):
 * open the tile, click that same button in that same row on the portal, and
 * read what it opens - tab by tab when it has tabs. Done as a person would,
 * so it doesn't depend on the portal's internal function names.
 */
async function openPortalRowActionStep(sessionId: string, userId: string, key: PortalListKey, match: string[], action: string, opts: { keepOpen?: boolean; onlyTab?: string } = {}): Promise<PortalRowView> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  const l = PORTAL_LISTS.find((x) => x.key === key);
  if (!l) throw new EcourtsHttpError(400, 'Unknown eFiling list.');
  const deadline = Date.now() + 50_000;
  const { page } = session;
  await closePortalPopups(page);
  await ensureDashboard(session);
  let opened = await clickTile(page, l.tile, true);
  if (!opened) {
    await ensureDashboard(session, true);
    opened = await clickTile(page, l.tile, true);
  }
  if (!opened) throw new EcourtsHttpError(502, `The portal did not open ${l.label}. Try again.`);

  // Find the row and the button; remember every table's state, then click.
  const clicked = await page.evaluate(({ match, action }) => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    // Same text as the list parser gave DifAi, whitespace-insensitive.
    const visibleTxt = (c: any) => {
      const k = c.cloneNode(true);
      for (const e of [...k.querySelectorAll('table, script, style, .modal, .popup, [style*="display:none"], [style*="display: none"]')]) e.remove();
      for (const br of [...k.querySelectorAll('br')]) br.replaceWith(' ');
      for (const b of [...k.querySelectorAll('div, p, li, tr')]) b.append(' ');
      return txt(k);
    };
    const body = document.getElementById('history_body') as any;
    const want = match.map((m: string) => String(m).replace(/\s+/g, ' ').trim());
    // The list itself is never what a row button opens.
    for (const t of [...body.querySelectorAll('table')] as any[]) {
      if (!t.parentElement?.closest('table')) t.setAttribute('data-difai-list', '1');
    }
    const tr = ([...body.querySelectorAll('tr')] as any[]).find((r) => {
      const cells = [...r.children].map(visibleTxt);
      return want.every((w: string, i: number) => cells[i] === w);
    });
    if (!tr) return 'row';
    const btn = ([...tr.querySelectorAll('button, a, input[type=button]')] as any[])
      .find((b) => (txt(b) || String(b.value ?? '').trim()) === action && !b.closest('.popup, [style*="display:none"]'));
    if (!btn) return 'button';
    for (const t of [...document.querySelectorAll('table')] as any[]) {
      t.setAttribute('data-difai-before', `${t.getClientRects().length ? 1 : 0}:${txt(t).length}`);
    }
    btn.click();
    return 'ok';
  }, { match, action });
  if (clicked === 'row') throw new EcourtsHttpError(409, 'That row is no longer in this list on the portal - Refresh and try again.');
  if (clicked === 'button') throw new EcourtsHttpError(409, `The portal has no "${action}" in that row now.`);

  // Wait for a table that appeared or changed, and let it finish filling.
  const found = await page.waitForFunction(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const changed = ([...document.querySelectorAll('table:not([data-difai-list])')] as any[]).filter((x) => x.getClientRects().length
      && x.getAttribute('data-difai-before') !== `1:${txt(x).length}`
      && [...x.querySelectorAll('tbody tr')].some((r: any) => r.children.length > 1 || txt(r)));
    // A pop-up inside a row changes the list around it too: take the innermost.
    const t = changed.find((x) => !changed.some((y) => y !== x && x.contains(y)));
    if (!t) return false;
    t.setAttribute('data-difai-opened', '1');
    return true;
  }, undefined, { timeout: Math.max(5_000, Math.min(20_000, deadline - Date.now())), polling: 250 }).then(() => true).catch(() => false);
  if (!found) {
    await closePortalPopups(page);
    throw new EcourtsHttpError(502, `The portal did not show anything for "${action}". It may be slow - try again.`);
  }
  await settle(page, '[data-difai-opened]');

  const shape = await page.evaluate(() => {
    const table = document.querySelector('[data-difai-opened]') as any;
    table.removeAttribute('data-difai-opened');
    let container = table.parentElement;
    for (let c = table.parentElement; c && c !== document.body; c = c.parentElement) {
      if (c.matches('td, th, [data-difai-list]') || c.querySelector('[data-difai-list]')) break;
      container = c;
      if (c.matches('.modal-content, .popup, [id^=dv_], [id^=ap_]')) break;
    }
    container.setAttribute('data-difai-container', '1');
    // Heading lines: the text before the tabs / the first table.
    const stop = container.querySelector('.nav-tabs, [role=tablist], .dataTables_wrapper, table');
    let title: string[] = [];
    if (stop) {
      const range = document.createRange();
      range.setStart(container, 0);
      range.setEndBefore(stop);
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;left:-99999px;top:0';
      d.appendChild(range.cloneContents());
      document.body.appendChild(d);
      title = String(d.innerText).split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length < 200 && /[A-Za-z0-9]/.test(s) && !/^close$/i.test(s));
      d.remove();
    }
    const tabs = [...container.querySelectorAll('.nav-tabs a, .nav-tabs button, [role=tab], [data-toggle=tab], [data-bs-toggle=tab]')] as any[];
    const seen = new Set<string>();
    const names: string[] = [];
    tabs.forEach((t, i) => {
      t.setAttribute('data-difai-tab', String(i));
      const n = String(t.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (n && !seen.has(n)) { seen.add(n); names.push(n); }
    });
    return { title: title.slice(0, 6), tabs: names };
  });

  const sections: PortalRowView['sections'] = [];
  if (!shape.tabs.length) {
    sections.push({ name: action, ...(await readOpened(page, '[data-difai-container]')) });
  } else {
    for (const name of shape.tabs) {
      if (opts.onlyTab && name !== opts.onlyTab) continue;
      if (Date.now() > deadline) { sections.push({ name, table: null, text: 'Not read - the portal is slow. Open it again.' }); continue; }
      const pane = await page.evaluate((name) => {
        const tab = ([...document.querySelectorAll('[data-difai-container] [data-difai-tab]')] as any[])
          .find((t) => String(t.textContent ?? '').replace(/\s+/g, ' ').trim() === name);
        if (!tab) return null;
        const id = (tab.getAttribute('href') ?? '').replace(/^[^#]*#?/, '') || (tab.getAttribute('data-target') ?? tab.getAttribute('data-bs-target') ?? '').replace(/^#/, '') || tab.getAttribute('aria-controls') || '';
        for (const p of document.querySelectorAll('[data-difai-pane]')) p.removeAttribute('data-difai-pane');
        tab.click();
        const el = id ? document.getElementById(id) : null;
        if (el) el.setAttribute('data-difai-pane', '1');
        return el ? 'pane' : 'container';
      }, name);
      const where = pane === 'pane' ? '[data-difai-pane]' : '[data-difai-container]';
      await page.waitForFunction((sel) => {
        const p = document.querySelector(sel) as any;
        return !!p && String(p.textContent ?? '').trim().length > 0;
      }, where, { timeout: Math.max(1_000, Math.min(6_000, deadline - Date.now())), polling: 250 }).catch(() => {});
      await settle(page, where);
      sections.push({ name, ...(await readOpened(page, where)) });
    }
  }
  if (!opts.keepOpen) await closePortalPopups(page);
  return { title: shape.title, sections };
}

/** Wait until what's inside `sel` stops changing (the portal fills it by ajax). */
async function settle(page: Page, sel: string): Promise<void> {
  let last = -1;
  for (let i = 0; i < 12; i++) {
    const n = await page.evaluate((s) => String((document.querySelector(s) as any)?.textContent ?? '').length, sel).catch(() => 0);
    if (n === last && n > 0) return;
    last = n;
    await page.waitForTimeout(300);
  }
}

/** The biggest visible table inside `sel`, or its text when there is none. */
async function readOpened(page: Page, sel: string): Promise<{ table: PortalTableData | null; text: string }> {
  const got = await page.evaluate((s) => {
    const root = document.querySelector(s) as any;
    if (!root) return { html: '', text: '' };
    // Outermost tables within what opened (it may itself sit inside a list row).
    const tables = ([...root.querySelectorAll('table')] as any[]).filter((t) => {
      const up = t.parentElement?.closest('table');
      return t.getClientRects().length && !(up && root.contains(up));
    });
    const body = tables.sort((a, b) => b.querySelectorAll('tbody tr').length - a.querySelectorAll('tbody tr').length)[0];
    if (!body) return { html: '', text: String(root.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) };
    // DataTables with scrolling draws the header in a separate table.
    let html = String(body.outerHTML);
    if (!body.querySelector('thead th')) {
      const head = body.closest('.dataTables_wrapper')?.querySelector('.dataTables_scrollHead thead');
      if (head) html = html.replace(/<table([^>]*)>/i, `<table$1>${head.outerHTML}`);
    }
    return { html, text: '' };
  }, sel);
  return { table: got.html ? await htmlTable(page, got.html) : null, text: got.text };
}

/** Close whatever the last step opened, as the advocate would. */
async function closePortalPopups(page: Page): Promise<void> {
  await page.evaluate(() => {
    const $ = (globalThis as any).jQuery;
    if ($) $('.modal').modal?.('hide');
    for (const e of [...document.querySelectorAll('[data-difai-container],[data-difai-pane],[data-difai-tab],[data-difai-list],[data-difai-had]')]) {
      for (const a of ['data-difai-container', 'data-difai-pane', 'data-difai-tab', 'data-difai-list', 'data-difai-had']) e.removeAttribute(a);
    }
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

export async function readPortalCounts(sessionId: string, userId: string) {
  return queued(getSession(sessionId, userId), () => readPortalCountsStep(sessionId, userId));
}
export interface PortalFile {
  name: string;
  contentType: string;
  body: Buffer;
}

/**
 * A link that opens a document on the portal (Acknowledgement in a list row,
 * COMPLAINT / VAKALAT ... under View Documents or View Status): click it there
 * as the advocate would, catch the PDF the portal then shows (its viewer
 * frame, a new tab or a download) and fetch it over the advocate's session.
 */
async function openPortalFileStep(sessionId: string, userId: string, key: PortalListKey, o: {
  match: string[]; action?: string; tab?: string; docRow?: string[]; link: string;
}): Promise<PortalFile> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  const l = PORTAL_LISTS.find((x) => x.key === key);
  if (!l) throw new EcourtsHttpError(400, 'Unknown eFiling list.');
  const { page } = session;
  let scope = '#history_body';
  let row = o.match;
  if (o.action) {
    await openPortalRowActionStep(sessionId, userId, key, o.match, o.action, { keepOpen: true, onlyTab: o.tab });
    scope = (await page.$('[data-difai-pane]')) ? '[data-difai-pane]' : '[data-difai-container]';
    row = o.docRow ?? [];
  } else {
    await closePortalPopups(page);
    await ensureDashboard(session);
    let opened = await clickTile(page, l.tile, true);
    if (!opened) { await ensureDashboard(session, true); opened = await clickTile(page, l.tile, true); }
    if (!opened) throw new EcourtsHttpError(502, `The portal did not open ${l.label}. Try again.`);
  }

  // Everything already showing a document, so the new one can be told apart.
  await page.evaluate(() => {
    for (const e of [...document.querySelectorAll('iframe, object, embed')] as any[]) e.setAttribute('data-difai-had', String(e.getAttribute('src') ?? e.getAttribute('data') ?? ''));
  });
  const popup = page.context().waitForEvent('page', { timeout: 25_000 }).catch(() => null);
  const download = page.waitForEvent('download', { timeout: 25_000 }).catch(() => null);
  const clicked = await page.evaluate(({ scope, row, link }) => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const cellTxt = (c: any) => {
      const k = c.cloneNode(true);
      for (const e of [...k.querySelectorAll('table, script, style, .modal, .popup, [style*="display:none"], [style*="display: none"]')]) e.remove();
      for (const br of [...k.querySelectorAll('br')]) br.replaceWith(' ');
      for (const b of [...k.querySelectorAll('div, p, li, tr')]) b.append(' ');
      return txt(k);
    };
    const root = document.querySelector(scope) as any;
    if (!root) return 'row';
    const want = row.map((m: string) => String(m).replace(/\s+/g, ' ').trim());
    const tr = ([...root.querySelectorAll('tr')] as any[]).find((r) => r.getClientRects().length && want.every((w: string, i: number) => cellTxt(r.children[i] ?? {}) === w));
    if (!tr) return 'row';
    const a = ([...tr.querySelectorAll('a, button, input[type=button]')] as any[])
      .find((b) => (txt(b) || String(b.value ?? '').trim()) === link && b.getClientRects().length > 0);
    if (!a) return 'link';
    a.removeAttribute('target');
    a.click();
    return 'ok';
  }, { scope, row, link: o.link });
  if (clicked === 'row') throw new EcourtsHttpError(409, 'That entry is no longer there on the portal - Refresh and try again.');
  if (clicked === 'link') throw new EcourtsHttpError(409, `The portal has no "${o.link}" link there now.`);

  // The portal's viewer frame gets the file's address; or a tab / download.
  const framed = page.waitForFunction(() => {
    const e = ([...document.querySelectorAll('iframe, object, embed')] as any[]).find((x) => {
      const u = String(x.getAttribute('src') ?? x.getAttribute('data') ?? '');
      return u && u !== 'about:blank' && u !== x.getAttribute('data-difai-had');
    });
    return e ? String(e.getAttribute('src') ?? e.getAttribute('data')) : false;
  }, undefined, { timeout: 25_000, polling: 250 }).then((h) => h.jsonValue() as Promise<string>).catch(() => null);
  const got = await Promise.race([
    framed.then((u) => (u ? { url: u } : null)),
    popup.then(async (p) => {
      if (!p) return null;
      await p.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
      const u = p.url();
      await p.close().catch(() => {});
      return u && u !== 'about:blank' ? { url: u } : null;
    }),
    download.then(async (d) => (d ? { download: d } : null)),
    new Promise<null>((r) => setTimeout(() => r(null), 26_000)),
  ]);
  try {
    if (!got) throw new EcourtsHttpError(502, `The portal did not open "${o.link}". It may be slow - try again.`);
    if ('download' in got && got.download) {
      const path = await got.download.path();
      if (!path) throw new EcourtsHttpError(502, 'The portal download did not finish.');
      const { readFile } = await import('node:fs/promises');
      return { name: got.download.suggestedFilename() || `${o.link}.pdf`, contentType: 'application/pdf', body: await readFile(path) };
    }
    let url = (got as { url: string }).url;
    // A PDF.js viewer page: the document is its ?file=.
    const viewer = /[?&]file=([^&#]+)/.exec(url);
    if (/viewer\.html/i.test(url) && viewer) url = decodeURIComponent(viewer[1]!);
    if (url.startsWith('data:')) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
      if (!m) throw new EcourtsHttpError(502, 'The portal sent a document DifAi could not read.');
      return { name: `${o.link}.pdf`, contentType: m[1] || 'application/pdf', body: m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!)) };
    }
    const abs = url.startsWith('blob:') ? url : new URL(url, page.url()).toString();
    if (!abs.startsWith('blob:') && new URL(abs).hostname !== new URL(page.url()).hostname) {
      throw new EcourtsHttpError(502, 'The portal pointed the document somewhere else; DifAi did not follow it.');
    }
    // Fetched from the portal page itself, as its own viewer does.
    const got2 = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { status: r.status, type: r.headers.get('content-type') ?? '', b64: btoa(s) };
    }, abs);
    if (got2.status >= 400) throw new EcourtsHttpError(502, `The portal answered ${got2.status} for this document.`);
    return { name: `${o.link}.pdf`, contentType: got2.type.split(';')[0] || 'application/pdf', body: Buffer.from(got2.b64, 'base64') };
  } finally {
    await closePortalPopups(page);
  }
}

export async function openPortalFile(sessionId: string, userId: string, key: PortalListKey, o: { match: string[]; action?: string; tab?: string; docRow?: string[]; link: string }) {
  return queued(getSession(sessionId, userId), () => openPortalFileStep(sessionId, userId, key, o));
}
export async function openPortalRowAction(sessionId: string, userId: string, key: PortalListKey, match: string[], action: string) {
  return queued(getSession(sessionId, userId), () => openPortalRowActionStep(sessionId, userId, key, match, action));
}
export async function readPortalList(sessionId: string, userId: string, key: PortalListKey) {
  return queued(getSession(sessionId, userId), () => readPortalListStep(sessionId, userId, key));
}

// ---- My Cases (the portal's portfolio widget) --------------------------------
//
// Not a list: the My Cases tile (dashboard.js openMyCases) loads
// Portfolio_new/my_cases into #history_body, and that page's own script
// (js/portfolio/my_cases.js) fetches portfolio/getMyCasesData/ ->
// { mycases_dc, mycases_hc }, keeps them in the globals CNR_Numbers_ef /
// CNR_Numbers_HC_ef (JSON) and draws them itself (populateDistrictAcordion)
// into #ditrictsAccordion ("District Court Cases") / #hcAccordion ("High Court
// Cases"): Date wise (#datewise) or District wise (#districtwise), Pending /
// Disposed / Both (.pendingDisposed), then establishment panels holding the
// case tables. Who the advocate represents comes from
// portfolio/getRepresentingForCinos/ (global allCNRRepresentative). A case
// number (.show_case_history_link / .show_filing_case_history_link) opens
// portfolio/getCaseHistory/ or getFilingCaseHistory/ in #case_history; a
// hearing date there (viewBusiness) opens the Daily Status in #show_business.
// DifAi reads the same records the widget draws from and groups them with the
// same rules, so every toggle shows what the portal would.

export interface MyCase {
  cino: string;
  /** 'd' district court (#ditrictsAccordion), 'h' High Court (#hcAccordion). */
  court: 'd' | 'h';
  /** type/reg_no/reg_year, or type/fil_no/fil_year for a filing ("(F)"). */
  caseNo: string;
  filing: boolean;
  /** "Civil" / "Criminal" badge. */
  ciCri: string;
  /** Court number - designation, under the case number. */
  courtNoDesg: string;
  pdeNo: string;
  underObjection: boolean;
  /** Stage badge: purpose code - purpose. */
  purpose: string;
  stateCode: string;
  stateName: string;
  districtCode: string;
  districtName: string;
  establishmentCode: string;
  establishmentName: string;
  petName: string;
  resName: string;
  /** yyyy-mm-dd; null = "Date Not Given" (the portal's 5000-01-01). */
  nextDate: string | null;
  lastDate: string | null;
  decisionDate: string | null;
  registrationDate: string | null;
  /** "( 2 year(s) 3 month(s))" for a pending case, as the portal works it out. */
  age: string;
  /** Representing: Petitioner / Respondant (the portal's spelling) and the names. */
  representing: { as: string; names: string[] };
  /** "Unable to Check" / "Case Deleted" / "Case not Found" when the portal says so. */
  notice: string;
}

export interface MyCasesEstablishment { name: string; district: string; cases: number[] }
export interface MyCasesGroup {
  /** "Chennai,Tamil Nadu" (District wise) or "23-10-2026" / "Disposed Cases" ... (Date wise). */
  title: string;
  count: number;
  /** Date wise: the month heading the portal puts before this date ("October 2026"). */
  divider?: string;
  establishments: MyCasesEstablishment[];
}
export type MyCasesFilter = 'Pending' | 'Disposed' | 'Both';
export type MyCasesView = Record<'d' | 'h', MyCasesGroup[]>;

export interface PortalMyCases {
  /** The badge beside Date wise / District wise. */
  count: number;
  /** "23-10-2026 20:06:41" from "[Last refreshed on ...]". */
  lastRefreshed: string;
  cases: MyCase[];
  /** Every toggle the widget has, grouped as populateDistrictAcordion groups. */
  views: Record<'district' | 'date', Record<MyCasesFilter, MyCasesView>>;
  /** The portal's "no cases" text, when it shows that instead. */
  message: string | null;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** yyyy-mm-dd -> dd-mm-yyyy, as the widget writes dates. */
const dmy = (iso: string) => iso.split('-').reverse().join('-');

/** Group like a plain JS object would: integer-like keys ascending first, then in insertion order. */
function groupBy<T>(items: T[], key: (t: T) => string): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(it);
  }
  const ints = [...m.keys()].filter((k) => /^(0|[1-9]\d*)$/.test(k)).sort((a, b) => Number(a) - Number(b));
  return [...ints, ...[...m.keys()].filter((k) => !ints.includes(k))].map((k) => [k, m.get(k)!]);
}

/**
 * populateDistrictAcordion (my_cases.js) for one court list: District wise =
 * state -> district panels sorted by their title; Date wise = next date
 * panels (a case heard today also under today, disposed today also under
 * today) with "Disposed Cases", "Date Not Given", "Undated Cases" (next date
 * already past) on top and a month heading before each new month. Each panel
 * holds one table per establishment. `today` is dd-mm-yyyy.
 */
function groupMyCases(cases: MyCase[], court: 'd' | 'h', datewise: boolean, filter: MyCasesFilter, today: string): MyCasesGroup[] {
  const idx = cases.map((c, i) => [c, i] as const).filter(([c]) => c.court === court);
  const ests = (list: ReadonlyArray<readonly [MyCase, number]>): MyCasesEstablishment[] =>
    groupBy([...list], ([c]) => c.establishmentCode).map(([, l]) => ({ name: l[0]![0].establishmentName, district: l[0]![0].districtName, cases: l.map(([, i]) => i) }));
  if (!datewise) {
    const shown = idx.filter(([c]) => (filter === 'Disposed' ? c.decisionDate !== null : filter === 'Pending' ? c.decisionDate === null : true));
    const groups: MyCasesGroup[] = [];
    for (const [, inState] of groupBy(shown, ([c]) => c.stateCode)) {
      for (const [, l] of groupBy(inState, ([c]) => c.districtCode)) {
        const first = l[0]![0];
        groups.push({ title: `${first.districtName ? `${first.districtName},` : ''}${first.stateName}`, count: l.length, establishments: ests(l) });
      }
    }
    // The widget sorts its panels by their heading text.
    return groups.sort((a, b) => {
      const x = `${a.title}  (${a.count})`;
      const y = `${b.title}  (${b.count})`;
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  const DISPOSED = 'Disposed Cases';
  const NO_DATE = 'Date Not Given';
  const UNDATED = 'Undated Cases';
  const [td, tm, ty] = today.split('-').map(Number) as [number, number, number];
  const todayTime = new Date(ty, tm - 1, td).getTime();
  const by = new Map<string, Array<readonly [MyCase, number]>>();
  const put = (k: string, e: readonly [MyCase, number]) => { if (!by.has(k)) by.set(k, []); by.get(k)!.push(e); };
  for (const e of idx) {
    const c = e[0];
    if (c.decisionDate !== null) {
      if (filter === 'Pending') continue;
      put(DISPOSED, e);
      if (dmy(c.decisionDate) === today) put(today, e);
    } else if (c.nextDate === null) {
      if (filter !== 'Disposed') put(NO_DATE, e);
    } else if (filter !== 'Disposed') {
      const [y, m, d] = c.nextDate.split('-').map(Number) as [number, number, number];
      if (new Date(y, m - 1, d).getTime() < todayTime) put(UNDATED, e);
      else if (c.lastDate && dmy(c.lastDate) === today) {
        put(today, e);
        if (dmy(c.nextDate) !== today) put(dmy(c.nextDate), e);
      } else put(dmy(c.nextDate), e);
    }
  }
  const time = (k: string) => { const [d, m, y] = k.split('-').map(Number) as [number, number, number]; return new Date(y, m - 1, d).getTime(); };
  const dated = [...by.keys()].filter((k) => /^\d{2}-\d{2}-\d{4}$/.test(k)).sort((a, b) => time(a) - time(b));
  const out: MyCasesGroup[] = [];
  for (const k of [DISPOSED, NO_DATE, UNDATED]) {
    const l = by.get(k);
    if (l) out.push({ title: k, count: l.length, establishments: ests(l) });
  }
  let prev = '';
  for (const k of dated) {
    const l = by.get(k)!;
    const month = k.slice(3);
    const g: MyCasesGroup = { title: k, count: l.length, establishments: ests(l) };
    if (month !== prev) {
      g.divider = `${MONTH_NAMES[Number(k.slice(3, 5)) - 1]} ${k.slice(6)}`;
      prev = month;
    }
    out.push(g);
  }
  return out;
}

function myCasesViews(cases: MyCase[], today: string): PortalMyCases['views'] {
  const view = (datewise: boolean, f: MyCasesFilter): MyCasesView => ({ d: groupMyCases(cases, 'd', datewise, f, today), h: groupMyCases(cases, 'h', datewise, f, today) });
  const all = (datewise: boolean) => ({ Pending: view(datewise, 'Pending'), Disposed: view(datewise, 'Disposed'), Both: view(datewise, 'Both') });
  return { district: all(false), date: all(true) };
}

/** "( n year(s) m month(s))" since registration, worked out as my_cases.js does (its month index included). */
function caseAge(registrationDate: string | null, decisionDate: string | null, today: string): string {
  if (!registrationDate || decisionDate !== null) return '';
  const [ry, rm, rd] = registrationDate.split('-').map(Number) as [number, number, number];
  const [td, tm, ty] = today.split('-').map(Number) as [number, number, number];
  // my_cases.js: new Date(y, m, d) - the month as written, not m - 1.
  const day = Math.floor((new Date(ty, tm - 1, td).getTime() - new Date(ry, rm, rd).getTime()) / 86_400_000);
  const years = Math.floor(day / 365);
  const months = Math.round((day % 365) / 31);
  let diff = years > 0 ? `( ${years} year(s)` : '';
  if (months > 0) diff += `${years <= 0 ? '( ' : ' '}${months} month(s)`;
  return diff ? `${diff})` : '';
}

/** One record of getMyCasesData (mycases_dc / mycases_hc) -> a DifAi row. */
function toMyCase(o: Record<string, unknown>, court: 'd' | 'h', rep: Array<Record<string, unknown>>, today: string): MyCase {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const date = (v: unknown) => {
    const t = s(v).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
  };
  const type = s(o['type_name']);
  const filing = !s(o['case_no']).trim();
  const next = s(o['date_next_list']);
  const ciCri = s(o['ci_cri']).toLowerCase();
  const names: string[] = [];
  let as = '';
  for (const r of rep) {
    const n = s(r['litigant_name']).trim();
    if (!n) continue;
    if (String(r['litigant_type']) === '1') { names.push(n); as = 'Petitioner'; } else if (String(r['litigant_type']) === '2') { names.push(n); as = 'Respondant'; }
  }
  const updated = o['updated'];
  const registrationDate = date(o['registration_date']);
  const decisionDate = date(o['date_of_decision']);
  return {
    cino: s(o['cino']),
    court,
    caseNo: filing ? `${type}/${s(o['fil_no'])}/${s(o['fil_year'])}` : `${type}/${s(o['reg_no'])}/${s(o['reg_year'])}`,
    filing,
    ciCri: ciCri === 'civil' ? 'Civil' : ciCri === 'criminal' ? 'Criminal' : '',
    courtNoDesg: s(o['desgname']),
    pdeNo: s(o['pde_no']).trim(),
    underObjection: o['under_obj'] === 'Y',
    purpose: o['purpose_cd'] && o['purpose_name'] ? `${s(o['purpose_cd'])}-${s(o['purpose_name'])}` : '',
    stateCode: s(o['state_code']),
    stateName: s(o['state_name']),
    districtCode: s(o['district_code']),
    districtName: s(o['district_name']),
    establishmentCode: s(o['establishment_code']),
    establishmentName: s(o['establishment_name']),
    petName: s(o['pet_name']),
    resName: s(o['res_name']),
    nextDate: next === '5000-01-01' || next === 'Date Not Given' ? null : date(next),
    lastDate: date(o['date_last_list']),
    decisionDate,
    registrationDate,
    age: caseAge(registrationDate, decisionDate, today),
    representing: { as, names },
    notice: updated === false || updated === 'false' ? 'Unable to Check' : updated === 'falseDeleted' ? 'Case Deleted' : updated === 'falseRNF' ? 'Case not Found' : '',
  };
}

/** Open the My Cases tile and wait for its script to have fetched the cases. */
async function openMyCasesWidget(session: EfilingSession): Promise<void> {
  const { page } = session;
  await closePortalPopups(page);
  await ensureDashboard(session);
  let opened = await clickTile(page, 'my_cases', true);
  if (!opened) {
    await ensureDashboard(session, true);
    opened = await clickTile(page, 'my_cases', true);
  }
  if (!opened) throw new EcourtsHttpError(502, 'The portal did not open My Cases. Try again.');
  // getData() fills CNR_Numbers_ef / CNR_Numbers_HC_ef; or the widget says it has none.
  await page.waitForFunction(() => {
    const w = globalThis as any;
    const none = document.getElementById('nocasestxt') as any;
    return typeof w.CNR_Numbers_ef === 'string' || typeof w.CNR_Numbers_HC_ef === 'string'
      || !!document.querySelector('#history_body .show_case_history_link, #history_body .show_filing_case_history_link')
      || !!(none && none.getClientRects().length);
  }, undefined, { timeout: 20_000, polling: 250 }).catch(() => {});
  // Representing (getRepresentingForCinos -> allCNRRepresentative) arrives a moment later.
  await page.waitForFunction(() => {
    const w = globalThis as any;
    const r = w.allCNRRepresentative;
    return typeof w.CNR_Numbers_ef !== 'string' || (!!r && typeof r === 'object' && Object.keys(r).length > 0);
  }, undefined, { timeout: 3_000, polling: 200 }).catch(() => {});
  await settle(page, '#history_body');
}

async function readMyCasesStep(sessionId: string, userId: string): Promise<PortalMyCases> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  const { page } = session;
  await openMyCasesWidget(session);
  const raw = await page.evaluate(() => {
    const w = globalThis as any;
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const list = (v: any): any[] | null => {
      try {
        const a = typeof v === 'string' ? JSON.parse(v) : v;
        // updateResetFlag() stores some entries back as JSON strings.
        return Array.isArray(a) ? a.map((x) => (typeof x === 'string' ? JSON.parse(x) : x)).filter((x) => x && typeof x === 'object') : null;
      } catch { return null; }
    };
    const body = document.getElementById('history_body') as any;
    const all = txt(body);
    const refreshed = /Last\s+refreshed\s+on\s*:?\s*([0-9]{2}-[0-9]{2}-[0-9]{4}(?:\s+[0-9:]+)?)/i.exec(all);
    const badge = Number(txt(document.getElementById('mycases_span_id')));
    const none = document.getElementById('nocasestxt') as any;
    const rep: Record<string, any[]> = {};
    const r = w.allCNRRepresentative;
    if (r && typeof r === 'object') for (const k of Object.keys(r)) if (Array.isArray(r[k])) rep[k] = r[k];
    const dc = list(w.CNR_Numbers_ef) ?? list(w.cnrNumbersArray);
    const hc = list(w.CNR_Numbers_HC_ef) ?? list(w.hccnrNumbersArray);
    // Fallback: what the widget drew (case links carry cino / hcdc / state_code / case_no).
    const drawn: any[] = [];
    if (!dc && !hc) {
      for (const a of [...body.querySelectorAll('.show_case_history_link, .show_filing_case_history_link')] as any[]) {
        const tr = a.closest('tr');
        const cells = tr ? [...tr.children].map((c: any) => c) : [];
        const panel = a.closest('.panel-group-main1');
        const head = txt(panel?.querySelector('.panel-title-a-main')).replace(/\s*\(\d+\)\s*$/, '');
        const estA = a.closest('.card-body.context')?.closest('.collapse')?.previousElementSibling?.querySelector('a, h4') ?? null;
        const est = txt(estA).replace(/\(\s*\d+\s*\)(,.*)?$/, '').trim();
        const cal = cells[2]?.querySelector('time');
        const day = txt(cal?.querySelector('.day'));
        const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(txt(cal?.querySelector('.month')));
        const yr = txt(cal?.querySelector('.year'));
        const iso = /^\d+$/.test(day) && mon >= 0 && /^\d{4}$/.test(yr) ? `${yr}-${String(mon + 1).padStart(2, '0')}-${day.padStart(2, '0')}` : null;
        const disposed = /disposed/i.test(txt(cells[3]));
        const parties = String(cells[4]?.innerText ?? txt(cells[4])).split(/\n|\bVs\b/i).map((x: string) => x.trim()).filter(Boolean);
        const [district, state] = head.includes(',') ? head.split(',') : ['', head];
        const no = String(a.getAttribute('case_no') ?? txt(a)).trim();
        const parts = no.split('/');
        drawn.push({
          court: a.getAttribute('hcdc') === 'H' || a.closest('#hcAccordion') ? 'h' : 'd',
          o: {
            cino: a.getAttribute('cino'), hc_dc: a.getAttribute('hcdc'), state_code: a.getAttribute('state_code') ?? state, state_name: state, district_code: district, district_name: district,
            establishment_code: est, establishment_name: est, type_name: parts.slice(0, -2).join('/'), reg_no: parts[parts.length - 2], reg_year: parts[parts.length - 1],
            fil_no: parts[parts.length - 2], fil_year: parts[parts.length - 1], case_no: a.classList.contains('show_filing_case_history_link') ? '' : no,
            pet_name: parties[0] ?? '', res_name: parties[1] ?? '', date_next_list: disposed ? null : iso ?? '5000-01-01', date_of_decision: disposed ? iso ?? '0000-00-00' : null,
          },
        });
      }
    }
    return {
      dc, hc, rep, drawn,
      refreshed: refreshed ? refreshed[1]!.trim() : '',
      badge: Number.isFinite(badge) && txt(document.getElementById('mycases_span_id')) !== '' ? badge : null,
      none: none && none.getClientRects().length ? txt(none) : '',
    };
  });
  await closePortalPopups(page);
  const today = istDate();
  const cases: MyCase[] = [];
  const seen = new Set<string>();
  const add = (o: Record<string, unknown>, court: 'd' | 'h') => {
    const c = toMyCase(o, court, raw.rep[String(o['cino'] ?? '')] ?? [], today);
    // Date wise draws a case twice (today and its next date): once is enough here.
    if (!c.cino || seen.has(`${court}:${c.cino}`)) return;
    seen.add(`${court}:${c.cino}`);
    cases.push(c);
  };
  for (const o of raw.dc ?? []) add(o, 'd');
  for (const o of raw.hc ?? []) add(o, 'h');
  for (const d of raw.drawn) add(d.o, d.court);
  return {
    count: raw.badge ?? cases.length,
    lastRefreshed: raw.refreshed,
    cases,
    views: myCasesViews(cases, today),
    message: cases.length ? null : raw.none || null,
  };
}

/** What the portal shows inside a box, in order: headings, text lines (with their links) and tables. */
export interface PortalBlock {
  kind: 'heading' | 'text' | 'table';
  text?: string;
  lines?: string[];
  links?: string[];
  table?: PortalTableData;
}

async function readBlocks(page: Page, sel: string): Promise<PortalBlock[]> {
  const raw = await page.evaluate((s) => {
    const root = document.querySelector(s) as any;
    if (!root) return [];
    const out: Array<{ kind: string; text?: string; lines?: string[]; links?: string[]; html?: string }> = [];
    const BLOCK = 'div,p,ul,ol,li,section,article,h1,h2,h3,h4,h5,h6,table,form,fieldset,center,header,footer,dl,dt,dd,hr';
    const skip = (e: any) => e.matches('script,style,noscript,select,input,textarea,.modal:not(.show)')
      || (globalThis as any).getComputedStyle(e).display === 'none';
    const clickable = (b: any) => b.tagName !== 'A' || b.getAttribute('onclick') || /^(#|javascript:)/i.test(b.getAttribute('href') ?? '#');
    let buf: any = null;
    const flush = () => {
      if (!buf) return;
      const lines = String(buf.innerText ?? buf.textContent ?? '').split('\n').map((x: string) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const links = [...buf.querySelectorAll('a, button')].filter(clickable).map((b: any) => String(b.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((t: string) => t && t.length < 60);
      if (lines.length) out.push({ kind: 'text', lines, links });
      buf.remove();
      buf = null;
    };
    const inline = (n: any) => {
      if (!buf) {
        buf = document.createElement('div');
        buf.style.cssText = 'position:absolute;left:-99999px;top:0';
        document.body.appendChild(buf);
      }
      buf.appendChild(n.cloneNode(true));
    };
    const walk = (el: any) => {
      for (const n of [...el.childNodes] as any[]) {
        if (n.nodeType === 3) { if (String(n.textContent).trim()) inline(n); continue; }
        if (n.nodeType !== 1 || skip(n)) continue;
        if (n.tagName === 'TABLE') { flush(); out.push({ kind: 'table', html: String(n.outerHTML) }); continue; }
        if (/^H[1-6]$/.test(n.tagName)) { flush(); const t = String(n.textContent ?? '').replace(/\s+/g, ' ').trim(); if (t) out.push({ kind: 'heading', text: t }); continue; }
        if (n.tagName === 'BR') { inline(n); continue; }
        if (!n.matches(BLOCK)) { if (n.querySelector(BLOCK)) { flush(); walk(n); flush(); } else inline(n); continue; }
        flush();
        if (n.querySelector(BLOCK)) walk(n);
        else inline(n);
        flush();
      }
    };
    walk(root);
    flush();
    return out;
  }, sel);
  const blocks: PortalBlock[] = [];
  for (const b of raw) {
    if (b.kind === 'table') {
      const table = await htmlTable(page, b.html ?? '');
      if (table.headers.length || table.rows.length) blocks.push({ kind: 'table', table });
    } else if (b.kind === 'heading') blocks.push({ kind: 'heading', text: b.text ?? '' });
    else blocks.push({ kind: 'text', lines: b.lines ?? [], links: b.links ?? [] });
  }
  return blocks;
}

export interface MyCaseHistoryView {
  /** "Case History" or, for a hearing date, "Daily Status". */
  name: string;
  blocks: PortalBlock[];
}

/**
 * A case number in My Cases: click that case's link in the widget, as the
 * advocate would (the portal then loads getCaseHistory / getFilingCaseHistory
 * into #case_history), and read it. With `link`, also click the nth link of
 * that text inside the history (a Business on Date -> viewBusiness) and read
 * the Daily Status it opens in #show_business.
 */
async function openMyCaseHistoryStep(sessionId: string, userId: string, cino: string, court: 'd' | 'h', link?: { text: string; nth: number }): Promise<MyCaseHistoryView> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  const { page } = session;
  try {
    await openMyCasesWidget(session);
    const clicked = await page.evaluate(({ cino, court }) => {
      const links = ([...document.querySelectorAll('#history_body .show_case_history_link, #history_body .show_filing_case_history_link')] as any[])
        .filter((a) => a.getAttribute('cino') === cino);
      const a = links.find((x) => (x.closest('#hcAccordion') ? 'h' : 'd') === court) ?? links[0];
      if (!a) return false;
      const box = document.getElementById('case_history') as any;
      if (box) box.innerHTML = '';
      a.click();
      return true;
    }, { cino, court });
    if (!clicked) throw new EcourtsHttpError(409, 'That case is no longer in My Cases on the portal - Refresh and try again.');
    const shown = await page.waitForFunction(() => String((document.getElementById('case_history') as any)?.textContent ?? '').trim().length > 0, undefined, { timeout: 25_000, polling: 250 }).then(() => true).catch(() => false);
    if (!shown) throw new EcourtsHttpError(502, 'The portal did not show this case history. It may be slow - try again.');
    await settle(page, '#case_history');
    if (!link) return { name: 'Case History', blocks: await readBlocks(page, '#case_history') };

    const hit = await page.evaluate(({ text, nth }) => {
      const same = ([...document.querySelectorAll('#case_history a, #case_history button')] as any[])
        .filter((b) => String(b.textContent ?? '').replace(/\s+/g, ' ').trim() === text);
      const b = same[nth];
      if (!b) return false;
      for (const id of ['show_business', 'show_business1']) { const e = document.getElementById(id) as any; if (e) e.innerHTML = ''; }
      b.removeAttribute('target');
      b.click();
      return true;
    }, link);
    if (!hit) throw new EcourtsHttpError(409, `The portal has no "${link.text}" in this case history now.`);
    const where = await page.waitForFunction(() => {
      for (const id of ['show_business', 'show_business1']) {
        if (String((document.getElementById(id) as any)?.textContent ?? '').trim()) return `#${id}`;
      }
      return false;
    }, undefined, { timeout: 25_000, polling: 250 }).then((h) => h.jsonValue() as Promise<string>).catch(() => null);
    if (!where) throw new EcourtsHttpError(502, `The portal did not show anything for "${link.text}". It may be slow - try again.`);
    await settle(page, where);
    return { name: 'Daily Status', blocks: await readBlocks(page, where) };
  } finally {
    await closePortalPopups(page);
  }
}

export async function readMyCases(sessionId: string, userId: string) {
  return queued(getSession(sessionId, userId), () => readMyCasesStep(sessionId, userId));
}
export async function openMyCaseHistory(sessionId: string, userId: string, cino: string, court: 'd' | 'h', link?: { text: string; nth: number }) {
  return queued(getSession(sessionId, userId), () => openMyCaseHistoryStep(sessionId, userId, cino, court, link));
}

/** Internals exposed for tests only. */
// =============================================================================
// Portal map (local setup tool): walk the portal's menus over the advocate's
// own session and record each page's STRUCTURE - headings, tabs, field labels,
// dropdown choices, buttons, table columns, scripts - so DifAi's screens can
// be built exactly like the portal's. Only menu pages are opened; no button is
// pressed, nothing is typed, no table contents or field values are kept.
// =============================================================================

export interface PortalPageMap {
  menu: string;
  item: string;
  url: string;
  title: string;
  headings: string[];
  tabs: string[];
  fields: Array<{ label: string; id: string; name: string; tag: string; type: string; options?: string[] }>;
  buttons: Array<{ text: string; id: string; onclick: string }>;
  tables: Array<{ id: string; headers: string[]; rows: number }>;
  links: Array<{ text: string; onclick: string }>;
  scripts: string[];
  error?: string;
}

export interface PortalMap {
  takenAt: string;
  dir: string;
  menus: Array<{ menu: string; items: Array<{ text: string; href: string; onclick: string }> }>;
  pages: PortalPageMap[];
}

// Never opened while mapping: anything that ends, removes or changes something.
const MAP_SKIP = /log\s*out|sign\s*out|exit|delete|remove|discard|withdraw|cancel/i;

async function readPageStructure(page: Page): Promise<Omit<PortalPageMap, 'menu' | 'item' | 'url'>> {
  return page.evaluate(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const shown = (e: any) => !!e && e.getClientRects().length > 0;
    const fnName = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const content = (document.querySelector('main, .content-wrapper, #content, .container-fluid, .container') ?? document.body) as any;
    const labelFor = (el: any): string => {
      if (el.id) {
        const l = document.querySelector(`label[for="${(globalThis as any).CSS.escape(el.id)}"]`);
        if (l) return txt(l);
      }
      const wrap = el.closest('label');
      if (wrap) return txt(wrap);
      // The nearest text before the field (portal forms often use a cell or div).
      let p: any = el.parentElement;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        const prev = p.previousElementSibling;
        if (prev && txt(prev) && txt(prev).length < 80) return txt(prev);
      }
      return el.getAttribute('placeholder') ?? el.getAttribute('aria-label') ?? '';
    };
    const fields = ([...content.querySelectorAll('input, select, textarea')] as any[])
      .filter((el) => el.type !== 'hidden' && shown(el))
      .slice(0, 150)
      .map((el) => ({
        label: labelFor(el).slice(0, 120),
        id: el.id ?? '',
        name: el.getAttribute('name') ?? '',
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') ?? '',
        // Choices only (no value typed or chosen is kept).
        ...(el.tagName === 'SELECT' ? { options: [...el.options].slice(0, 40).map((o: any) => txt(o)).filter(Boolean) } : {}),
      }));
    const buttons = ([...content.querySelectorAll('button, input[type=button], input[type=submit], a.btn')] as any[])
      .filter(shown).slice(0, 80)
      .map((b) => ({ text: (txt(b) || String(b.value ?? '')).slice(0, 80), id: b.id ?? '', onclick: fnName(b.getAttribute('onclick')) }));
    const tables = ([...content.querySelectorAll('table')] as any[]).filter((t) => !t.parentElement?.closest('table')).slice(0, 30)
      .map((t) => ({ id: t.id ?? '', headers: [...t.querySelectorAll('thead th')].map(txt).slice(0, 30), rows: t.querySelectorAll('tbody tr').length }));
    const tabs = ([...content.querySelectorAll('.nav-tabs a, .nav-tabs button, [role=tab], .nav-pills a')] as any[]).map(txt).filter(Boolean).slice(0, 40);
    const headings = ([...content.querySelectorAll('h1, h2, h3, h4, h5, legend, .card-header, .panel-heading, .box-title')] as any[])
      .filter(shown).map(txt).filter((t) => t && t.length < 120).slice(0, 60);
    const links = ([...content.querySelectorAll('a[onclick]')] as any[]).filter(shown).slice(0, 60)
      .map((a) => ({ text: txt(a).slice(0, 80), onclick: fnName(a.getAttribute('onclick')) }));
    const scripts = ([...document.querySelectorAll('script[src]')] as any[]).map((s) => String(s.src));
    return { title: document.title, headings, tabs, fields, buttons, tables, links, scripts };
  });
}

async function mapPortalStep(sessionId: string, userId: string): Promise<PortalMap> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(410, 'Log in to eFiling first.');
  const { page } = session;
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = join(tmpdir(), 'difai-portal-map', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(join(dir, 'js'), { recursive: true });
  await closePortalPopups(page);
  await ensureDashboard(session, true);

  // The menu bar: each dropdown and its items, as the portal draws them.
  const menus = await page.evaluate(() => {
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const out: Array<{ menu: string; items: Array<{ text: string; href: string; onclick: string }> }> = [];
    for (const dd of [...document.querySelectorAll('.dropdown, .nav-item.dropdown, li.dropdown')] as any[]) {
      const toggle = dd.querySelector('.dropdown-toggle, [data-toggle=dropdown], [data-bs-toggle=dropdown]') ?? dd.querySelector('a');
      const items = ([...dd.querySelectorAll('.dropdown-menu a, .dropdown-menu button')] as any[])
        .map((a) => ({ text: txt(a), href: String(a.getAttribute('href') ?? ''), onclick: String(a.getAttribute('onclick') ?? '').slice(0, 160) }))
        .filter((a) => a.text);
      if (toggle && items.length) out.push({ menu: txt(toggle), items });
    }
    return out;
  });

  const pages: PortalPageMap[] = [];
  const scripts = new Set<string>();
  const base = new URL(page.url());
  for (const m of menus) {
    for (const it of m.items) {
      if (MAP_SKIP.test(it.text) || MAP_SKIP.test(it.href)) continue;
      try {
        await ensureDashboard(session, true);
        const href = it.href && !/^(#|javascript:)/i.test(it.href) ? new URL(it.href, page.url()).toString() : '';
        if (href && new URL(href).hostname === base.hostname) {
          await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        } else {
          // A menu item that opens its page by script: click it like a person.
          await page.evaluate(({ menu, text }) => {
            const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
            for (const dd of [...document.querySelectorAll('.dropdown, .nav-item.dropdown, li.dropdown')] as any[]) {
              const toggle = dd.querySelector('.dropdown-toggle, [data-toggle=dropdown], [data-bs-toggle=dropdown]') ?? dd.querySelector('a');
              if (txt(toggle) !== menu) continue;
              const a = ([...dd.querySelectorAll('.dropdown-menu a, .dropdown-menu button')] as any[]).find((x) => txt(x) === text);
              if (a) { a.click(); return; }
            }
          }, { menu: m.menu, text: it.text });
        }
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(800);
        if (await page.$('#user_name')) throw portalSessionEnded(session);
        const s = await readPageStructure(page);
        for (const src of s.scripts) scripts.add(src);
        pages.push({ menu: m.menu, item: it.text, url: page.url(), ...s });
      } catch (e) {
        if (e instanceof EcourtsHttpError && e.status === 410) throw e;
        pages.push({ menu: m.menu, item: it.text, url: page.url(), title: '', headings: [], tabs: [], fields: [], buttons: [], tables: [], links: [], scripts: [], error: (e as Error).message });
      }
    }
  }
  // The pages' own scripts (public code), for the exact requests they make.
  for (const src of scripts) {
    try {
      const u = new URL(src);
      if (u.hostname !== base.hostname || !/\.js$/i.test(u.pathname)) continue;
      const body = await page.evaluate(async (x) => (await fetch(x, { credentials: 'include' })).text(), src);
      await writeFile(join(dir, 'js', u.pathname.replace(/^\/+/, '').replace(/[\\/]/g, '_')), body);
    } catch { /* one script missing is fine */ }
  }
  await ensureDashboard(session, true);
  const map: PortalMap = { takenAt: new Date().toISOString(), dir, menus, pages };
  await writeFile(join(dir, 'portal-map.json'), JSON.stringify(map, null, 2));
  return map;
}

/** Map the portal's menus and pages (structure only) - a local setup tool. */
export async function mapPortal(sessionId: string, userId: string) {
  return queued(getSession(sessionId, userId), () => mapPortalStep(sessionId, userId), 60_000);
}

export const __testing = {
  portalPost,
  htmlTable,
  clickTile,
  groupMyCases,
  setContextHook: (fn: typeof contextHook) => { contextHook = fn; },
  pageOf: (sessionId: string): Page | null => sessions.get(sessionId)?.page ?? null,
};
