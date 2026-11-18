import { test, expect, type Page, type Route } from '@playwright/test';

// build-docs/features/google-signup-prefill.md: after "Sign up with Google",
// the same Create-account form shows name + email from Google; the person
// types only the WhatsApp number and a password. Google's script and every
// API call are faked here: no account is created anywhere.

const FAKE_GSI = `window.google = { accounts: { id: {
  initialize(o) { window.__gsiCb = o.callback; },
  renderButton(el) { const b = document.createElement('button'); b.type = 'button';
    b.textContent = 'Fake Google'; b.onclick = () => window.__gsiCb({ credential: 'fake' }); el.appendChild(b); },
  prompt() {}, disableAutoSelect() {}, cancel() {},
} } };`;

const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function fakeGoogleAndApi(page: Page, calls: Record<string, unknown>) {
  await page.route('https://accounts.google.com/gsi/client*', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GSI }));
  await page.route(/\/auth\/google$/, (r) => json(r, {
    status: 'signup_required', signupRequired: true, signupToken: 'tok-1',
    profile: { name: 'Asha Menon', email: 'asha@example.com' },
  }));
  await page.route(/\/auth\/signup\/otp\/send$/, (r) => { calls.send = r.request().postDataJSON(); return json(r, {
    challengeId: 'ch-1', expiresAt: new Date(Date.now() + 6e5).toISOString(), resendAfterSeconds: 30, phone: '+91 98765 43210' }); });
  await page.route(/\/auth\/signup\/otp\/verify$/, (r) => { calls.verify = r.request().postDataJSON(); return json(r, { signupToken: 'tok-2', phone: '+919876543210' }); });
  await page.route(/\/auth\/google\/sign-up$/, (r) => { calls.signUp = r.request().postDataJSON(); return r.fulfill({ status: 500, body: '{"error":"stop here"}' }); });
}

test('AC1-AC4: Google sign-up fills name + email, asks only WhatsApp + password', async ({ page }) => {
  const calls: Record<string, unknown> = {};
  await fakeGoogleAndApi(page, calls);
  await page.goto('/auth?signup=1');
  await page.getByRole('button', { name: 'Fake Google' }).click();

  // AC1: name + email filled from Google; email locked.
  await expect(page.getByLabel('Your name')).toHaveValue('Asha Menon');
  const email = page.getByLabel('Email');
  await expect(email).toHaveValue('asha@example.com');
  await expect(email).toHaveAttribute('readonly', '');
  // AC2: the Google strip is gone; a way back is offered.
  await expect(page.getByText('Or sign up with')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use a different account' })).toBeVisible();

  // AC3: only WhatsApp + password typed; START sends the code for the Google token.
  await page.getByLabel('WhatsApp number (India, +91)').fill('9876543210');
  await page.getByLabel('Password', { exact: true }).fill('Strong#Pass9');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByLabel('Verification code')).toBeVisible();
  expect(calls.send).toEqual({ signupToken: 'tok-1', phone: '+919876543210' });

  // AC4: code -> verify -> Google sign-up with the verified token, password and name.
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect.poll(() => calls.signUp).toBeTruthy();
  expect(calls.verify).toEqual({ signupToken: 'tok-1', challengeId: 'ch-1', code: '123456' });
  expect(calls.signUp).toMatchObject({ signupToken: 'tok-2', password: 'Strong#Pass9', name: 'Asha Menon', acceptTerms: true });
});

test('AC5: "Use a different account" clears the Google details', async ({ page }) => {
  await fakeGoogleAndApi(page, {});
  await page.goto('/auth?signup=1');
  await page.getByRole('button', { name: 'Fake Google' }).click();
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByLabel('Email')).not.toHaveAttribute('readonly', '');
  await expect(page.getByText('Or sign up with')).toBeVisible();
});
