import { test, expect, type Page } from '@playwright/test';

// Signed-out pages. No account and no API writes: forms are validated, never submitted.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem('difai-intro', JSON.stringify({ dismissed: true })); } catch {}
  });
});

const PAGES: Array<[path: string, heading: RegExp]> = [
  ['/privacy', /privacy/i],
  ['/delete-account', /delete/i],
  ['/signup', /Start using DifAi/i],
  ['/portal/login', /sign in/i],
  ['/admin', /admin sign in/i],
];

for (const [path, heading] of PAGES) {
  test(`public page ${path} renders its heading without errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('unknown route while signed out goes to sign in', async ({ page }) => {
  // Not a public path, so App.tsx treats it as a signed-in route.
  await page.goto('/no-such-page-e2e');
  await expect(page).toHaveURL(/\/auth/);
});

test('signed-out /app/* sends the visitor to /auth', async ({ page }) => {
  await page.goto('/app/cases');
  await expect(page).toHaveURL(/\/auth/);
});

test.describe('auth: sign in form', () => {
  test('Sign in is disabled until email and password are filled', async ({ page }) => {
    await page.goto('/auth');
    const submit = page.getByRole('button', { name: 'Sign in', exact: true });
    await expect(submit).toBeDisabled();
    await page.getByLabel('Email').fill('someone@example.com');
    await expect(submit).toBeDisabled();
    await page.getByLabel('Password', { exact: true }).fill('x');
    await expect(submit).toBeEnabled();
  });

  test('password eye toggles visibility', async ({ page }) => {
    await page.goto('/auth');
    const pw = page.getByLabel('Password', { exact: true });
    await pw.fill('secret');
    await expect(pw).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).first().click();
    await expect(pw).toHaveAttribute('type', 'text');
  });

  test('plan-inactive reason shows a banner on /auth', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/auth?reason=trial_expired');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('auth: sign up form validation', () => {
  test('short password and bad email show field errors without submitting', async ({ page }) => {
    let posted = false;
    await page.route('**/api/auth/**', (r) => { if (r.request().method() !== 'GET') posted = true; return r.abort(); });
    await page.goto('/auth?signup=1');
    const email = page.getByLabel('Email');
    await email.fill('not-an-email');
    await email.blur();
    const pw = page.locator('input[autocomplete="new-password"]');
    await pw.fill('short');
    await pw.blur();
    await expect(page.getByText('Use at least 8 characters')).toBeVisible();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(posted).toBe(false);
  });
});
