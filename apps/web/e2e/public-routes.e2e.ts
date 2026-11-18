import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke-test every PUBLIC route of the web app (no sign-in required).
 * Each route must: respond 200, render its headline, and raise no uncaught
 * page errors or React-fatal console errors.
 *
 * Authed routes under /app/*, /admin/* and /portal/* (post-login) are
 * skipped — they need the API + a seeded user. See the `describe.skip`
 * block at the bottom for the hook to enable them later.
 */

type RouteCase = {
  path: string;
  heading: RegExp;
  /** Extra per-route assertion. */
  extra?: (page: Page) => Promise<void>;
};

const PUBLIC_ROUTES: RouteCase[] = [
  {
    path: '/',
    heading: /Practice management built for Indian advocates/i,
    extra: async (page) => {
      await expect(page).toHaveTitle(/DifAi.*Indian advocates/i);
      await expect(
        page.getByRole('button', { name: /create your free account/i }),
      ).toBeVisible();
    },
  },
  { path: '/auth', heading: /Sign in/i },
  { path: '/auth?signup=1', heading: /Create account|Create your DifAi account|Free trial|Sign in/i },
  { path: '/signup?intent=demo', heading: /How would you like the demo/i },
  { path: '/signup?intent=trial', heading: /Start using DifAi|Free trial/i },
  { path: '/signup?intent=paid', heading: /Create your DifAi account|Create account/i },
  { path: '/privacy', heading: /Privacy policy/i },
  { path: '/delete-account', heading: /Delete your DifAi account/i },
  { path: '/portal/login', heading: /Sign in/i },
];

/** Console errors we tolerate (devtools noise, 3rd-party, expected network). */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\/api\//i,                              // backend may not be seeded in the test env
  /Failed to load resource/i,              // 404 on optional assets
  /favicon/i,
  /GSI_LOGGER|origin is not allowed/i,     // Google Sign-In not configured for localhost
];

test.describe('DifAi public UI — smoke', () => {
  test.beforeEach(async ({ context }) => {
    // First-visit chooser modal blocks hero interactions.
    await context.addInitScript(() => {
      try {
        localStorage.setItem('difai-intro', JSON.stringify({ dismissed: true }));
      } catch {}
    });
  });

  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} renders without errors`, async ({ page }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (IGNORED_CONSOLE.some((rx) => rx.test(text))) return;
        consoleErrors.push(text);
      });

      const res = await page.goto(route.path);
      expect(res, `no response for ${route.path}`).not.toBeNull();
      expect(res!.status(), `status for ${route.path}`).toBeLessThan(400);

      await expect(
        page.getByRole('heading', { name: route.heading }).first(),
      ).toBeVisible({ timeout: 10_000 });

      if (route.extra) await route.extra(page);

      expect(pageErrors, `page errors on ${route.path}:\n${pageErrors.join('\n')}`).toHaveLength(0);
      expect(consoleErrors, `console errors on ${route.path}:\n${consoleErrors.join('\n')}`).toHaveLength(0);
    });
  }

  test('unknown route redirects to a safe entry point', async ({ page }) => {
    // The outer auth gate sends unknown paths to /auth for unauthed visitors;
    // either /auth or the landing is acceptable — never a 404.
    await page.goto('/this-does-not-exist');
    await expect(page).toHaveURL(/\/(auth)?$|\/auth(\?|$)/);
  });

  test('authed route /app redirects an unauthenticated visitor to sign in', async ({ page }) => {
    await page.goto('/app/dashboard');
    await expect(page).toHaveURL(/\/auth/);
  });

  test('landing → auth → signup intent flow is navigable', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /create your free account/i }).click();
    await expect(page).toHaveURL(/\/auth\?signup=1/);
  });
});

/**
 * Authed-flow smoke. Unlock when the API + a seeded test user are up:
 *   1. Remove `.skip`.
 *   2. Set TEST_USER_EMAIL / TEST_USER_PASSWORD env vars.
 *   3. Point the webServer in playwright.config.ts at the full stack
 *      (API + web) and ensure VITE_API_URL is reachable.
 * Per project policy "no test accounts" (MEMORY.md), do not auto-create one;
 * reuse your own dev advocate account.
 */
test.describe.skip('DifAi authed UI — smoke (needs API + user)', () => {
  test('dashboard loads after sign-in', async ({ page }) => {
    await page.goto('/auth');
    await page.getByLabel(/email/i).fill(process.env.TEST_USER_EMAIL ?? '');
    await page.getByLabel(/password/i).fill(process.env.TEST_USER_PASSWORD ?? '');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app\//);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  });
});
