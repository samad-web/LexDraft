import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
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
// "File on eCourts" action in LexDraft. Unlike ecourts.service.ts/
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
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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
}

const sessions = new Map<string, EfilingSession>();

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
  try {
    await session.browser.close();
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

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
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
  browser.once('disconnected', () => { sessions.delete(sessionId); });

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
export async function submitEfilingCredentials(
  sessionId: string,
  userId: string,
  username: string,
  password: string,
): Promise<{ captchaImageBase64: string; sessionId: string }> {
  const { page } = getSession(sessionId, userId);
  await page.fill('#user_name', username);
  await page.fill('#user_password', password);
  const captchaImageBase64 = await screenshotLoginCaptcha(page);
  return { captchaImageBase64, sessionId };
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
export async function refreshEfilingCaptcha(sessionId: string, userId: string): Promise<{ captchaImageBase64: string }> {
  const { page } = getSession(sessionId, userId);
  // Confirmed live: the login form's refresh link is an <a title="Refresh
  // Image"> whose onclick directly sets #captcha_image's src with a cache
  // -busting random query string - no page reload, unlike the CNR flow.
  // There are three near-identical captcha widgets on this page (login,
  // forgot-password, duplicate-login modals: captcha_image/_image1/_image2)
  // - scope by the onclick text referencing getElementById('captcha_image')
  // specifically so this never clicks a sibling modal's reload by mistake.
  const prevSrc = await page.getAttribute('#captcha_image', 'src').catch(() => null);
  // A real pointer .click() on this <a> intermittently does nothing on the
  // very first attempt right after filling username/password (confirmed
  // live: src unchanged even after a full second's wait) - some interaction
  // with the page's own focus/layout handling right after form-fill, not a
  // timing issue our own waits can paper over. Invoking the handler's own
  // JS directly, the same approach already used for the CNR flow's
  // funViewCinoHistory() submit, sidesteps whatever is swallowing the click.
  await page.evaluate(() => {
    const link = document.querySelector('a[onclick*="getElementById(\'captcha_image\')"]') as { getAttribute: (k: string) => string | null } | null;
    const onclickAttr = link?.getAttribute('onclick');
    if (onclickAttr) new Function(onclickAttr)();
  });

  // The <img>'s `complete`/`naturalWidth` can both still read true/nonzero
  // for a brief window right after the src swap (the browser doesn't
  // synchronously reset them) - confirmed live: screenshotting on that
  // signal alone silently returns the OLD image, never actually refreshing
  // anything the advocate sees. Waiting for the `src` ATTRIBUTE itself to
  // change first forces a real new-image load to complete before the
  // existing naturalWidth check in screenshotLoginCaptcha is trusted.
  if (prevSrc !== null) {
    await page
      .waitForFunction(
        (prev) => document.getElementById('captcha_image')?.getAttribute('src') !== prev,
        prevSrc,
        { timeout: 5000 },
      )
      .catch(() => {});
  }
  await page.waitForTimeout(300);
  return { captchaImageBase64: await screenshotLoginCaptcha(page) };
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
export async function submitEfilingLoginCaptcha(
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
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
    page.click('#verify_button1'),
  ]);
  await page.waitForTimeout(1500);

  const stillOnLogin = await page.locator('#frm_login').isVisible().catch(() => false);
  if (!stillOnLogin) {
    session.authenticated = true;
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
    await clickHere.click();
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

  const captchaImageBase64 = await screenshotLoginCaptcha(page).catch(() => '');
  return { retry: true, captchaImageBase64, reason };
}

async function screenshotDuplicateLoginCaptcha(page: Page): Promise<string> {
  const captcha = page.locator('#captcha_image1').first();
  await captcha.waitFor({ state: 'visible', timeout: 10000 });
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
export async function confirmDuplicateEfilingLogin(
  sessionId: string,
  userId: string,
  password: string,
  captchaCode: string,
): Promise<{ status: 'authenticated' } | { retry: true; captchaImageBase64: string; reason: string }> {
  const session = getSession(sessionId, userId);
  const { page } = session;

  try {
    await page.fill('#user_pwd', password, { timeout: 8000 });
    await page.fill('#fcaptcha_code_mobile1', captchaCode, { timeout: 8000 });
  } catch {
    throw new EcourtsHttpError(502, 'The eFiling portal is not responding to input right now. Try again.');
  }

  const urlBeforeSubmit = page.url();
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
    page.click('#re_verify_button'),
  ]);
  await page.waitForTimeout(1500);

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

process.on('beforeExit', () => {
  for (const session of sessions.values()) void closeSession(session.id);
});
