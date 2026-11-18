import { test, expect, type Route } from '@playwright/test';

// coming-soon (owner 2026-11-18): the five features open a "Coming soon" page. API mocked.
const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Riyaz', email: 'riyaz@firm.in', role: 'Managing Partner', firm: 'Riyaz & Associates', plan: 'Firm', isSuperadmin: false };
const json = (r: Route, body: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

for (const [path, name] of [['efiling', 'eFiling'], ['clauses', 'Clause Bank'], ['matter-intel', 'Matter Intelligence'], ['title-reports', 'Title Reports'], ['mock-arguments', 'Mock Arguments']] as const) {
  test(`AC3: /app/${path} says ${name} is coming soon`, async ({ page }) => {
    await page.route(/\/api\//, (r) => r.abort());
    await page.route(/\/api\/me(\/|$)/, (r) => json(r, USER));
    await page.route(/\/api\/me\/features$/, (r) => json(r, { features: ['matter.view', 'drafting.clauses', 'matter.intelligence', 'title_report.use', 'mock_arguments.use'], role: null, plan: 'Firm' }));
    await page.addInitScript((u) => {
      localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: u, token: 'jwt' }, version: 0 }));
      localStorage.setItem(`difai-tour-done:${u.id}`, '2026-11-18');
    }, USER);
    await page.goto(`/app/${path}`);
    await expect(page.getByText(`${name} is coming soon`)).toBeVisible();
  });
}
