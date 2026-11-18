import { test, expect, type Page, type Route } from '@playwright/test';

// build-docs/features/team-join.md AC6: the invite page offers Google or email;
// a signed-in invitee sees "Join"; sign-in comes back to the invite. API mocked.

const TOKEN = 'tok_teamjoin_abcdefghijklmnop';
const INVITE = { email: 'asha@firm.in', role: 'Associate', firm: 'Mehta Chambers', invitedBy: 'R. Mehta', expiresAt: '2030-01-01T00:00:00Z' };
const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Asha Rao', email: 'asha@firm.in', role: 'Associate', firm: 'Mehta Chambers', isSuperadmin: false };
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockInvite(page: Page, calls: Record<string, unknown>) {
  await page.route(new RegExp(`/invitations/by-token/${TOKEN}$`), (r) => json(r, INVITE));
  await page.route(/\/email\/start$/, (r) => { calls.start = r.request().postDataJSON(); return json(r, { signupToken: 's'.repeat(30), challengeId: '22222222-2222-4222-8222-222222222222', phone: '+91 98765 43210', resendAfterSeconds: 30 }); });
  await page.route(/\/email\/accept$/, (r) => { calls.accept = r.request().postDataJSON(); return json(r, { user: USER, token: 'jwt-new' }, 201); });
  await page.route(/\/join$/, (r) => { calls.join = true; return json(r, { user: USER, token: 'jwt-joined' }); });
  await page.route(/\/api\/me(\/|$)/, (r) => json(r, USER));
}

test('AC6a: join with email - email locked, WhatsApp code, then into the app', async ({ page }) => {
  const calls: Record<string, unknown> = {};
  await mockInvite(page, calls);
  await page.goto(`/invite/${TOKEN}`);
  await expect(page.getByRole('tab', { name: 'Join with Google' })).toBeVisible();
  await page.getByRole('tab', { name: 'Join with email' }).click();
  await expect(page.getByLabel('Email')).toHaveValue('asha@firm.in');
  await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '');
  await page.getByLabel('Your full name').fill('Asha Rao');
  await page.getByLabel('WhatsApp number').fill('9876543210');
  await page.locator('#invite-email-password').fill('Strong#Pass9');
  await page.getByRole('button', { name: 'Send code on WhatsApp' }).click();
  expect(calls.start).toEqual({ name: 'Asha Rao', phone: '9876543210' });
  await page.getByLabel('Verification code').fill('123456');
  const toApp = page.waitForURL(/\/app\/dashboard/);
  await page.getByRole('button', { name: 'Join Mehta Chambers' }).click();
  await toApp;
  expect(calls.accept).toMatchObject({ code: '123456', password: 'Strong#Pass9' });
});

test('AC6b: signed in as the invited email -> Join screen with export first', async ({ page }) => {
  const calls: Record<string, unknown> = {};
  await mockInvite(page, calls);
  await page.addInitScript((u) => localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: u, token: 'jwt-old' }, version: 0 })), USER);
  await page.goto(`/invite/${TOKEN}`);
  await expect(page.getByText(/stay in your old workspace/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download my data first' })).toBeVisible();
  const toApp = page.waitForURL(/\/app\/dashboard/);
  await page.getByRole('button', { name: 'Join Mehta Chambers' }).click();
  await toApp;
  expect(calls.join).toBe(true);
});

test('AC6c: signed in as someone else -> told to switch account, no join', async ({ page }) => {
  await mockInvite(page, {});
  await page.addInitScript((u) => localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: { ...u, email: 'other@x.in' }, token: 'jwt' }, version: 0 })), USER);
  await page.route(/\/api\/me(\/|$)/, (r) => json(r, { ...USER, email: 'other@x.in' }));
  await page.goto(`/invite/${TOKEN}`);
  await expect(page.getByRole('button', { name: 'Sign out and continue as asha@firm.in' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Join / })).toHaveCount(0);
});

test('AC6d: "Sign in to join" returns to the invite after sign-in; other next= paths are ignored', async ({ page }) => {
  await mockInvite(page, {});
  await page.route(/\/auth\/sign-in$/, (r) => json(r, { user: USER, token: 'jwt' }));
  await page.goto(`/invite/${TOKEN}`);
  await page.getByRole('button', { name: 'Sign in to join' }).click();
  await expect(page).toHaveURL(/\/auth\?next=/);
  await page.getByLabel('Email').fill('asha@firm.in');
  await page.getByLabel('Password', { exact: true }).fill('Strong#Pass9');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/invite/${TOKEN}$`));

  // a non-invite next is not followed
  await page.evaluate(() => localStorage.clear());
  await page.goto('/auth?next=https://evil.example');
  await page.getByLabel('Email').fill('asha@firm.in');
  await page.getByLabel('Password', { exact: true }).fill('Strong#Pass9');
  const toApp = page.waitForURL(/\/app\/dashboard/);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await toApp;
});
