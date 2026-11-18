import { test as base, expect, type Page, type Response, type Route } from '@playwright/test';
import { readSession, type E2ESession } from './env';

// API prefixes (after /api) whose calls spend AI tokens or reach a third-party
// portal (eCourts, eFiling, TN land records, Bar Councils, Dodo). A run must not
// trigger any of them, so writes are answered here with a 503 the UI has to
// handle, and so are reads that look like live lookups.
const AI_OR_EXTERNAL = [
  '/drafting', '/drafts', '/review', '/mock-arguments', '/title-reports', '/matter-intel',
  '/matter-chat', '/research', '/diary-assistant', '/laws', '/ecourts', '/efiling',
  '/land-records', '/me/bar-verification', '/billing', '/esign', '/survey/drafts',
];
const LIVE_LOOKUP = /\/(cnr|lookup|captcha|fetch|sync|refresh|search|ask|generate|compose|explain|login|otp)(\/|\?|$)/i;

export interface Guard {
  /** Uncaught page errors and 5xx API responses seen during the test. */
  problems: string[];
  /** Requests the guard answered with a stub. */
  stubbed: string[];
  /** Detach listeners and the route at the end of the test. */
  dispose: () => Promise<void>;
}

function apiPath(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname.replace(/^\/api/, '') + search;
}

export async function installGuard(page: Page): Promise<Guard> {
  const problems: string[] = [];
  const stubbed: string[] = [];
  const onError = (e: Error) => problems.push(`pageerror: ${e.message}`);
  const onResponse = (r: Response) => {
    if (r.url().includes('/api/') && r.status() >= 500 && !stubbed.includes(r.url())) {
      problems.push(`${r.status()} ${r.request().method()} ${apiPath(r.url())}`);
    }
  };
  const handler = async (route: Route) => {
    const req = route.request();
    const path = apiPath(req.url());
    const risky = AI_OR_EXTERNAL.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`));
    if (risky && (req.method() !== 'GET' || LIVE_LOOKUP.test(path))) {
      stubbed.push(req.url());
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Stubbed in E2E: AI / external call blocked', code: 'e2e_stub' }),
      });
    }
    return route.continue();
  };
  page.on('pageerror', onError);
  page.on('response', onResponse);
  await page.route('**/api/**', handler);
  return {
    problems,
    stubbed,
    dispose: async () => {
      page.off('pageerror', onError);
      page.off('response', onResponse);
      await page.unroute('**/api/**', handler);
    },
  };
}

type Fixtures = { guard: Guard; session: E2ESession };
export const test = base.extend<Fixtures>({
  // Auto: every test gets the stub guard and fails on page errors / 5xx.
  guard: [
    async ({ page }, use) => {
      // Skip the first-visit intro so it never blocks clicks.
      await page.addInitScript(() => {
        try {
          localStorage.setItem('difai-intro', JSON.stringify({ dismissed: true }));
        } catch {}
      });
      const guard = await installGuard(page);
      await use(guard);
      await guard.dispose();
      expect(guard.problems, guard.problems.join('\n')).toEqual([]);
    },
    { auto: true },
  ],
  session: async ({}, use) => use(readSession()),
});

export { expect };

/** Skip the current test unless the account has `feature`. */
export function needFeature(session: E2ESession, feature: string): void {
  test.skip(!session.features.includes(feature), `account lacks feature ${feature}`);
}

/** The app's main column, present on every signed-in screen. */
export const main = (page: Page) => page.locator('#main-content');

/** Waits for a screen to settle: main visible, no error boundary, no 404. */
export async function expectScreenOk(page: Page): Promise<void> {
  await expect(main(page)).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
  await expect(page.getByText('Page not found')).toHaveCount(0);
}

/** On a phone the sidebar sits behind the hamburger; open it if needed. */
export async function openNav(page: Page): Promise<void> {
  const burger = page.getByRole('button', { name: 'Open navigation menu' });
  if (await burger.isVisible()) {
    await burger.click();
    await expect(page.locator('aside.sidebar')).toHaveClass(/is-open/);
  }
}

export function dialog(page: Page) {
  return page.getByRole('dialog').last();
}
