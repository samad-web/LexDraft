import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, expectScreenOk } from './support/fixtures';
import { WEB_DIR } from './support/env';

// Every static /app/* route in App.tsx: loads, no error boundary, no 404,
// no uncaught page error, no 5xx (checked by the guard fixture).
// Plan-gated screens pass when they show their upgrade card instead.

const appSource = readFileSync(join(WEB_DIR, 'src', 'App.tsx'), 'utf8');
const declared = [...new Set([...appSource.matchAll(/path="(\/app\/[^"]*)"/g)].map((m) => m[1]!))];

// Routes that only redirect, or that need a real id and are covered by the
// detail tests in crud.e2e.ts / tools.e2e.ts.
const REDIRECTS = ['/app/stamp'];
const WITH_PARAMS = declared.filter((p) => p.includes(':'));
const SMOKE = declared.filter((p) => !p.includes(':') && !REDIRECTS.includes(p));

test('every /app route in App.tsx is covered by this suite (AC1)', () => {
  expect(SMOKE.length).toBeGreaterThanOrEqual(35);
  // Param routes must be listed here once a detail test covers them.
  expect(WITH_PARAMS.sort()).toEqual([
    '/app/cases/:id',
    '/app/clients/:id',
    '/app/co-counsel/:caseId',
    '/app/matter-intel/:caseId',
    '/app/title-reports/:id',
  ]);
});

for (const path of SMOKE) {
  test(`route ${path} renders`, async ({ page }) => {
    await page.goto(path);
    await expectScreenOk(page);
  });
}

test('/app/stamp redirects to the stamp-duty calculator', async ({ page }) => {
  await page.goto('/app/stamp');
  await expect(page).toHaveURL(/\/app\/calculators\?tab=stamp-duty/);
  await expectScreenOk(page);
});

test('/app redirects to the dashboard', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/dashboard/);
});
