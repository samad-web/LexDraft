import { test, expect, type Page, type Route } from '@playwright/test';

// pay-before-app (owner 2026-11-18): closing Razorpay never lands on the
// dashboard. Unpaid owners see "Finish your payment"; after paying they see
// "Confirming your payment…" until the app opens. API mocked.

const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Riyaz', email: 'riyaz@firm.in', role: 'Managing Partner', firm: 'Riyaz & Associates', isSuperadmin: false, needsOnboarding: true };
const BILLING = {
  paymentsEnabled: true,
  current: { planTier: 'Solo', planStatus: 'trial', freePlan: false, trialEndsAt: null, renewsAt: null, billingCycle: 'monthly', selectedPlan: 'law_firm', subscribed: false, seats: 1, munshiSeats: 0 },
};
const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function signedInUnpaid(page: Page, calls: Record<string, unknown>) {
  await page.route(/\/api\/me(\/|$)/, (r) => json(r, USER));
  await page.route(/\/api\/billing$/, (r) => json(r, BILLING));
  await page.route(/\/api\/billing\/checkout$/, (r) => { calls.checkout = r.request().postDataJSON(); return json(r, { checkoutUrl: '/pay-test' }); });
  await page.route(/\/pay-test$/, (r) => r.fulfill({ contentType: 'text/html', body: '<p>payment page</p>' }));
  await page.addInitScript((u) => localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: u, token: 'jwt' }, version: 0 })), USER);
}

test('closing Razorpay (dismiss URL) shows Finish payment, not the dashboard; Pay opens checkout', async ({ page }) => {
  const calls: Record<string, unknown> = {};
  await signedInUnpaid(page, calls);
  await page.goto('/app/billing?checkout=cancelled'); // where the Razorpay dismiss sends people
  await expect(page).toHaveURL(/\/onboarding\?checkout=cancelled/);
  await expect(page.getByRole('heading', { name: 'Finish your payment' })).toBeVisible();
  await expect(page.getByText('The payment was not completed.')).toBeVisible();
  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  await expect(page).toHaveURL(/\/pay-test$/);
  expect(calls.checkout).toEqual({ plan: 'law_firm', cycle: 'monthly', munshi: 0 });
});

test('the dashboard URL also leads back to Finish payment while unpaid', async ({ page }) => {
  await signedInUnpaid(page, {});
  await page.goto('/app/dashboard');
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: 'Finish your payment' })).toBeVisible();
  // the details can still be changed
  await page.getByRole('button', { name: 'Change plan or edit details' }).click();
  await expect(page.getByText(/Step 1 of 3/)).toBeVisible();
});

test('back from a successful payment: Confirming screen, no dashboard yet', async ({ page }) => {
  await signedInUnpaid(page, {});
  await page.goto('/app/billing?checkout=done');
  await expect(page).toHaveURL(/\/onboarding\?checkout=done/);
  await expect(page.getByRole('heading', { name: 'Confirming your payment…' })).toBeVisible();
});

test('test code: "Have a code?" on Finish payment sends the code with the checkout', async ({ page }) => {
  const calls: Record<string, unknown> = {};
  await signedInUnpaid(page, calls);
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Have a code?' }).click();
  await page.getByLabel('Code').fill('DIFAITEST');
  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  await expect(page).toHaveURL(/\/pay-test$/);
  expect(calls.checkout).toEqual({ plan: 'law_firm', cycle: 'monthly', munshi: 0, coupon: 'DIFAITEST' });
});
