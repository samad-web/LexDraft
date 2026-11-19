import { test, expect, type Route } from '@playwright/test';

// web-push (owner 2026-11-19): Settings → Phone notifications. API mocked.
const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Anantha', email: 'a@firm.in', role: 'Managing Partner', firm: 'Anantha & Associates', plan: 'Firm', isSuperadmin: false };
const json = (r: Route, body: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(page: import('@playwright/test').Page, publicKey: string | null) {
  await page.route(/\/api\//, (r) => r.abort());
  await page.route(/\/api\/me(\/|$)/, (r) => json(r, USER));
  await page.route(/\/api\/me\/features$/, (r) => json(r, { features: ['matter.view'], role: null, plan: 'Firm' }));
  await page.route(/\/api\/notifications\/push\/key$/, (r) => json(r, { publicKey }));
  await page.addInitScript((u) => {
    localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: u, token: 'jwt' }, version: 0 }));
    localStorage.setItem(`difai-tour-done:${u.id}`, '2026-11-19');
  }, USER);
}

test('AC6: Settings offers "Turn on phone notifications"; the worker and manifest are served', async ({ page, request }) => {
  await setup(page, 'BPub-test-key');
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Phone notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on phone notifications' })).toBeEnabled();
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain("addEventListener('push'");
  const mf = await request.get('/manifest.webmanifest');
  expect(JSON.parse(await mf.text())).toMatchObject({ name: 'DifAi', start_url: '/app/dashboard' });
});

test('AC7: when push is not switched on for the server, a plain message, nothing asked', async ({ page }) => {
  await setup(page, null);
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Turn on phone notifications' }).click();
  await expect(page.getByText('Phone notifications aren’t switched on for DifAi yet').first()).toBeVisible();
});
