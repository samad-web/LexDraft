import { test, expect, type Route } from '@playwright/test';

// build-docs/features/forgot-password-whatsapp.md AC6: Forgot password? ->
// work email -> code + new password -> success -> back to sign in.
// The API is mocked: no account is touched.

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('AC6: forgot password resets through the WhatsApp code', async ({ page }) => {
  const calls: Record<string, unknown> = {};
  await page.route(/\/auth\/password\/forgot$/, (r) => { calls.forgot = r.request().postDataJSON(); return json(r, { challengeId: 'ch-1', resendAfterSeconds: 30 }); });
  await page.route(/\/auth\/password\/reset$/, (r) => { calls.reset = r.request().postDataJSON(); return json(r, { ok: true }); });

  await page.goto('/auth');
  await page.getByLabel('Email').fill('asha@example.com');
  await page.getByRole('button', { name: 'Forgot password?' }).click();

  // Step 1: the typed email is carried over.
  await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible();
  await expect(page.getByLabel('Work email')).toHaveValue('asha@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  expect(calls.forgot).toEqual({ email: 'asha@example.com' });

  // Step 2: neutral wording (never says whether the account exists).
  await expect(page.getByText(/If asha@example\.com has a DifAi account/)).toBeVisible();
  await page.getByLabel('Verification code').fill('123456');
  await page.getByLabel('New password').fill('weak');
  await page.getByLabel('New password').blur();
  await expect(page.getByText(/Use 8\+ characters/)).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  expect(calls.reset).toBeUndefined(); // weak password never sent

  await page.getByLabel('New password').fill('Strong#Pass9');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByText('Your password is changed.')).toBeVisible();
  expect(calls.reset).toEqual({ challengeId: 'ch-1', code: '123456', password: 'Strong#Pass9' });

  // Back to sign in with the email kept.
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Email')).toHaveValue('asha@example.com');
});

test('AC4 (web): a wrong code shows the server message', async ({ page }) => {
  await page.route(/\/auth\/password\/forgot$/, (r) => json(r, { challengeId: 'ch-1', resendAfterSeconds: 30 }));
  await page.route(/\/auth\/password\/reset$/, (r) => json(r, { error: 'Incorrect code. 4 attempts left.', message: 'Incorrect code. 4 attempts left.' }, 401));
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await page.getByLabel('Work email').fill('asha@example.com');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Verification code').fill('000000');
  await page.getByLabel('New password').fill('Strong#Pass9');
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(page.getByText(/Incorrect code/)).toBeVisible();
});
