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
  if (!session.authenticated) throw new EcourtsHttpError(409, 'Log in to eFiling first.');
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
    session.authenticated = false;
    throw new EcourtsHttpError(401, 'Your eFiling session has ended on the portal. Log in again.');
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
  rows: Array<{ group: string } | { cells: string[] }>;
}

/** The portal's server-rendered HTML tables -> rows (parsed in the page). */
async function htmlTable(page: Page, html: string): Promise<PortalTableData> {
  return page.evaluate((h) => {
    const doc = new (globalThis as any).DOMParser().parseFromString(String(h), 'text/html');
    const table = doc.querySelector('table');
    const txt = (e: any) => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!table) return { headers: [], rows: [] };
    const headers = [...table.querySelectorAll('thead th')].map(txt);
    const rows = [...table.querySelectorAll('tbody tr')].map((tr: any) => {
      const cells = [...tr.children];
      if (cells.length === 1 && Number(cells[0].getAttribute('colspan') || 1) > 1) return { group: txt(cells[0]) };
      return { cells: cells.map((c: any) => {
        // Select boxes (e.g. "Select GRN") -> their option texts.
        const sel = c.querySelector('select');
        if (sel) return [...sel.options].map((o: any) => txt(o)).filter((t: string) => t && !/^select/i.test(t)).join(', ');
        return txt(c);
      }) };
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
async function clickTile(page: Page, tile: string): Promise<string | null> {
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
async function ensureDashboard(session: EfilingSession): Promise<void> {
  const { page } = session;
  if (await page.$('#efiling_activity, #draft_cases, #objections')) return;
  await page.goto(`${BASE}/pdedev/?p=dashboard`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  if (await page.$('#user_name')) {
    session.authenticated = false;
    throw new EcourtsHttpError(401, 'Your eFiling session has ended on the portal. Log in again.');
  }
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
async function readPortalCountsStep(sessionId: string, userId: string): Promise<Partial<Record<PortalListKey, number>>> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(409, 'Log in to eFiling first.');
  await ensureDashboard(session);
  const counts = (await snapshot(session.page).catch(() => null))?.counts ?? {};
  const out: Partial<Record<PortalListKey, number>> = {};
  for (const l of PORTAL_LISTS) if (counts[l.label] !== undefined) out[l.key] = counts[l.label]!;
  return out;
}

/** One dashboard list, as the portal shows it when that tile is clicked. */
async function readPortalListStep(sessionId: string, userId: string, key: PortalListKey): Promise<PortalList> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(409, 'Log in to eFiling first.');
  const l = PORTAL_LISTS.find((x) => x.key === key);
  if (!l) throw new EcourtsHttpError(400, 'Unknown eFiling list.');
  await ensureDashboard(session);
  const counts = (await snapshot(session.page).catch(() => null))?.counts ?? {};
  return readOneList(session.page, l, counts[l.label]);
}

/**
 * Every dashboard list at once (tests and small accounts). The screens use
 * readPortalCounts + readPortalList: one request per list stays well inside
 * the web server's time limit.
 */
async function readPortalListsStep(sessionId: string, userId: string): Promise<PortalList[]> {
  const session = getSession(sessionId, userId);
  if (!session.authenticated) throw new EcourtsHttpError(409, 'Log in to eFiling first.');
  const { page } = session;
  if (!(await page.$('#__csrf_magic'))) {
    await readPortalPageStep(sessionId, userId, 'dashboard').catch(() => {});
    if (!(await page.$('#__csrf_magic')) && (await page.$('#user_name'))) {
      session.authenticated = false;
      throw new EcourtsHttpError(401, 'Your eFiling session has ended on the portal. Log in again.');
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
    if (!session.authenticated) throw new EcourtsHttpError(409, 'Log in to eFiling first.');
    if (await session.page.$('#user_name')) {
      session.authenticated = false;
      throw new EcourtsHttpError(401, 'Your eFiling session has ended on the portal. Log in again.');
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
export async function readPortalCounts(sessionId: string, userId: string) {
  return exclusive(getSession(sessionId, userId), () => readPortalCountsStep(sessionId, userId));
}
export async function readPortalList(sessionId: string, userId: string, key: PortalListKey) {
  return exclusive(getSession(sessionId, userId), () => readPortalListStep(sessionId, userId, key));
}

/** Internals exposed for tests only. */
export const __testing = {
  portalPost,
  htmlTable,
  clickTile,
  setContextHook: (fn: typeof contextHook) => { contextHook = fn; },
  pageOf: (sessionId: string): Page | null => sessions.get(sessionId)?.page ?? null,
};
