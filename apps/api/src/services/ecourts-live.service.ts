import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger';
import { EcourtsHttpError } from '../lib/ecourts';

// The callbacks passed to page.evaluate()/page.$$eval() below run inside the
// browser, where DOM globals exist; this package's tsconfig has no "dom"
// lib (API code has no business touching the DOM directly - these are the
// one exception, Playwright page-context callbacks), so declare the handful
// of types used here, matching the pattern in the capture scripts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const window: any;

// =============================================================================
// ecourts-live.service
//
// Drives a real, logged-in-as-the-advocate browser session against the
// PUBLIC eCourts website (services.ecourts.gov.in) to reach data that the
// fast, no-captcha mobile API (ecourts.service.ts) cannot: specifically the
// free-text "Business" narrative on the Daily Status page, which every
// search path on that site gates behind an image CAPTCHA.
//
// This is the ONE piece of this feature that requires a human: reading the
// CAPTCHA image and typing what they see. Everything else - navigating
// state/district/court-complex, filling the search form, reading the
// results, and the Daily Status fetch itself - is automated here so it
// happens inside DifAi, not on a separate eCourts tab.
//
// SCOPE: Case Number search only for now. This is the one search mode whose
// field ids (case_type/search_case_no/rgyear/case_captcha_code) and submit
// function (submitCaseNo) were confirmed live against the real site. Party/
// Advocate/Filing/FIR/Act use different field ids and possibly different
// results-table shapes that have NOT been verified the same way - the site's
// anti-bot throttling made repeated verification probes unreliable, so
// those modes are deliberately not wired up here rather than shipped on
// guessed selectors. Extend MODE_CONFIG below once each one is confirmed.
//
// Session model: one real browser page per advocate, held open server-side
// between steps (select scope -> search -> solve captcha -> view business),
// because eCourts' own site relies on that same multi-request session (CSRF
// token + session cookie) to carry state between those steps - there is no
// way to make this a single stateless request. Idle sessions are torn down
// automatically; nothing is held longer than necessary.
// =============================================================================

const BASE = 'https://services.ecourts.gov.in/ecourtindia_v6';
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // close the browser if the advocate walks away mid-flow

interface LiveSession {
  id: string;
  userId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, LiveSession>();

function touch(session: LiveSession): void {
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
    logger.warn({ err, sessionId }, 'ecourts-live: error closing browser on session teardown');
  }
}

function getSession(sessionId: string, userId: string): LiveSession {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) {
    throw new EcourtsHttpError(404, 'This eCourts session has expired - start a new one.');
  }
  touch(session);
  return session;
}

// ---------------------------------------------------------------------------
// CNR-direct lookup - the better fit for surfacing Business text inline on
// search results we already have (Party Name, Advocate, etc. from the fast
// mobile API all return a `cino` per case). This is a single page
// (home/index), no state/district/court-complex selection needed - the CNR
// already encodes the court. Confirmed live: #cino (input), fcaptcha_code
// (captcha field), funViewCinoHistory() (submit), #history_cnr (result div).
// ---------------------------------------------------------------------------

const CNR_BASE = `${BASE}/?p=home/index`;

/** A session scoped to CNR lookup doesn't need the state/district/complex flow at all. */
export async function startCnrSession(userId: string): Promise<{ sessionId: string }> {
  const existing = [...sessions.values()].find((s) => s.userId === userId);
  if (existing) await closeSession(existing.id);

  // --disable-dev-shm-usage: Chromium's default /dev/shm allocation is too
  // small in some host environments and causes intermittent renderer
  // crashes under repeated launch/close cycles (observed live: "Page
  // crashed" on roughly 1 in 4 fresh sessions) - this forces temp-file-backed
  // shared memory instead, trading a little speed for crash resistance.
  // CHROMIUM_PATH: set in the Docker image (Alpine's chromium); unset in dev,
  // where Playwright uses its own downloaded browser.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  const sessionId = randomUUID();
  const session: LiveSession = { id: sessionId, userId, browser, context, page, lastUsed: Date.now(), idleTimer: setTimeout(() => {}, 0) };
  sessions.set(sessionId, session);
  touch(session);

  // eCourts' anti-bot defenses can crash the page outright (observed live,
  // not just slow/blocked navigation) - without this, a crashed page leaves
  // its browser process orphaned in the OS process list forever, since
  // nothing else triggers closeSession for it. Chromium process leaks from
  // this exact gap have been observed eating hundreds of MB and visibly
  // slowing the whole dev machine.
  page.once('crash', () => { void closeSession(sessionId); });
  browser.once('disconnected', () => { sessions.delete(sessionId); });

  try {
    await page.goto(CNR_BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cino', { timeout: 20000 });
  } catch {
    await closeSession(sessionId);
    throw new EcourtsHttpError(502, 'Could not reach the eCourts website right now - it may be throttling automated access. Try again in a few minutes.');
  }

  return { sessionId };
}

/**
 * Fill the CNR and return a screenshot of the captcha image. The page can
 * crash between startCnrSession succeeding and this running (two separate
 * HTTP requests from the frontend) - observed live at roughly 1-in-4 fresh
 * sessions even with --disable-dev-shm-usage. One transparent retry on a
 * brand-new session absorbs that instead of surfacing a raw crash to the
 * advocate for something that reliably works on the next attempt.
 */
export async function openCnrLookup(sessionId: string, userId: string, cino: string): Promise<{ captchaImageBase64: string; sessionId: string }> {
  try {
    const { page } = getSession(sessionId, userId);
    const result = await screenshotCaptchaFor(page, cino);
    return { ...result, sessionId };
  } catch (err) {
    if (err instanceof EcourtsHttpError && err.status === 404) throw err; // session genuinely gone, not a crash to retry
    logger.warn({ err }, 'ecourts-live: openCnrLookup failed, retrying on a fresh session');
    const fresh = await startCnrSession(userId);
    const { page } = getSession(fresh.sessionId, userId);
    const result = await screenshotCaptchaFor(page, cino);
    return { ...result, sessionId: fresh.sessionId };
  }
}

async function screenshotCaptchaFor(page: Page, cino: string): Promise<{ captchaImageBase64: string }> {
  await page.fill('#cino', cino);
  return screenshotCaptcha(page);
}

/**
 * The captcha <img> can be replaced by the page's own JS (lazy-load /
 * auto-refresh) between locating it and screenshotting it, which detaches
 * whatever ElementHandle was captured first - observed live as "Node is
 * either not visible" / "Element is not attached to the DOM" errors. A
 * Locator re-resolves the element on every action instead of holding a
 * stale handle.
 *
 * 'visible' alone isn't enough: on a reload, the <img> is visible with its
 * OLD src for a moment while the new image loads, and a screenshot taken
 * right then captures a near-blank placeholder frame (observed live: a
 * 156-byte image vs ~2000+ bytes for a real captcha). Wait for the image to
 * actually finish loading (naturalWidth > 0) before capturing, and retry a
 * couple of times since a reload is inherently a brief transition.
 */
async function screenshotCaptcha(page: Page): Promise<{ captchaImageBase64: string }> {
  const captcha = page.locator('img[src*="securimage"]').first();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await captcha.waitFor({ state: 'visible', timeout: 10000 });
      // Poll naturalWidth via a plain selector + waitForFunction instead of
      // locator.evaluate() with an inline Promise/event-listener body - that
      // form hit a tsx/esbuild transpilation bug live ("__name is not
      // defined" thrown inside the injected page-context script). A short
      // polling wait sidesteps it entirely and is simple enough not to
      // retrigger it.
      await page.waitForFunction(
        () => {
          const img = document.querySelector('img[src*="securimage"]') as { complete?: boolean; naturalWidth?: number } | null;
          return Boolean(img?.complete && (img?.naturalWidth ?? 0) > 0);
        },
        { timeout: 8000 },
      );
      const buf = await captcha.screenshot({ timeout: 10000 });
      // A near-blank placeholder frame is a tiny PNG - real captchas with
      // visible distorted text run well over 1KB in practice.
      if (buf.length > 500) return { captchaImageBase64: buf.toString('base64') };
      lastErr = new Error(`captcha screenshot too small (${buf.length} bytes) - likely a placeholder frame`);
    } catch (err) {
      lastErr = err;
    }
    await page.waitForTimeout(400);
  }
  logger.warn({ err: lastErr }, 'ecourts-live: captcha screenshot failed after retries');
  throw new EcourtsHttpError(502, 'Could not load the captcha image from eCourts - try again.');
}

export async function refreshCnrCaptcha(sessionId: string, userId: string): Promise<{ captchaImageBase64: string }> {
  const { page } = getSession(sessionId, userId);
  const reloadLink = page.locator('a[onclick*="securimage"], #captcha_reload, .securimage_reload').first();
  if (await reloadLink.count()) await reloadLink.click().catch(() => {});
  await page.waitForTimeout(500);
  return screenshotCaptcha(page);
}

/**
 * Submit the CAPTCHA for the CNR lookup. On success, returns the site's own
 * rendered case-history HTML (the Daily Status-style layout with Business /
 * Next Purpose / Next Hearing Date) - the frontend renders it directly
 * (sanitised) rather than this service attempting brittle text-scraping
 * across what may be inconsistent markup between case types.
 */
export async function submitCnrCaptcha(
  sessionId: string,
  userId: string,
  captchaCode: string,
  cino: string,
): Promise<{ historyHtml: string } | { retry: true; captchaImageBase64: string; reason: string }> {
  const { page } = getSession(sessionId, userId);
  // A capped, explicit wait rather than the default 30s timeout: if eCourts'
  // own anti-bot layer is interfering with the page (observed live: the
  // captcha field intermittently stops being fillable), fail fast with a
  // clear error instead of hanging the request for half a minute.
  try {
    await page.fill('#fcaptcha_code', captchaCode, { timeout: 8000 });
  } catch {
    throw new EcourtsHttpError(502, 'eCourts is not responding to input right now - this can happen under their automated-access protection. Try again.');
  }
  await page.evaluate(() => {
    const w = window as unknown as { funViewCinoHistory?: () => void };
    if (typeof w.funViewCinoHistory === 'function') w.funViewCinoHistory();
  });
  await page.waitForTimeout(2500);

  // A wrong captcha shows a `#validateError` modal ("Invalid Captcha...")
  // and - confirmed live by inspecting style.display directly - the page's
  // own JS sets `#cnr_div` (the entire search box, including the captcha
  // image) to `display: none` at the same time. Closing the modal does NOT
  // undo that; the real eCourts site effectively treats a wrong captcha as
  // "start over," not "retry in place." The only reliable recovery is to
  // reload the page and re-fill the CNR, matching what openCnrLookup does
  // on first load. `.alert-danger` (tried earlier) matches a different,
  // usually-empty element on this page - its real class is
  // `alert-danger-cust` - which is why the error reason came back as "×"
  // (the modal's close button) before this fix.
  //
  // The CNR must come from the `cino` PARAMETER, not a DOM read of #cino at
  // this point - confirmed live as a real bug: by the time the error modal
  // is visible, `#cino` is often already empty/hidden along with the rest
  // of `#cnr_div`, so reading it here returned '' and silently skipped the
  // re-fill. That meant a SECOND wrong-captcha attempt (after one retry
  // cycle) failed with "Enter 16 digit CNR number" instead of a captcha
  // error - the search had quietly lost its CNR a retry earlier.
  // The UI renders this markup, so neutralise it here first: drop anything
  // executable or embeddable and every inline handler / javascript: link.
  // (It used to be passed through verbatim from the third-party page.)
  const historyHtml = await page.evaluate(() => {
    const src = document.getElementById('history_cnr');
    if (!src) return '';
    const root = src.cloneNode(true);
    root.querySelectorAll('script, style, iframe, object, embed, link, meta, form, input, button, select, textarea')
      .forEach((n: { remove: () => void }) => n.remove());
    root.querySelectorAll('*').forEach((el: { attributes: Iterable<{ name: string; value: string }>; removeAttribute: (n: string) => void }) => {
      for (const a of [...el.attributes]) {
        const name = a.name.toLowerCase();
        if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(a.value))) {
          el.removeAttribute(a.name);
        }
      }
    });
    return root.innerHTML as string;
  });
  if (historyHtml.trim()) return { historyHtml };

  const errorModal = page.locator('#validateError');
  if (await errorModal.isVisible().catch(() => false)) {
    const reason = (await errorModal.innerText().catch(() => '')).trim() || 'Invalid captcha';
    await page.goto(CNR_BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForSelector('#cino', { timeout: 15000 }).catch(() => {});
    await page.fill('#cino', cino).catch(() => {});
    const { captchaImageBase64 } = await screenshotCaptcha(page).catch(() => ({ captchaImageBase64: '' }));
    return { retry: true, captchaImageBase64, reason };
  }

  throw new EcourtsHttpError(502, 'eCourts did not return case details for this CNR - the session may have expired. Try again.');
}

export async function endSession(sessionId: string, userId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (session && session.userId === userId) await closeSession(sessionId);
}

// Process-level safety net - don't leak browser processes if the server
// restarts or this module is hot-reloaded.
process.on('beforeExit', () => {
  for (const session of sessions.values()) void closeSession(session.id);
});
