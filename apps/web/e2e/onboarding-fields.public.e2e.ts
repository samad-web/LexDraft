import { test, expect, type Route } from '@playwright/test';

// onboarding-fields (2026-11-18, owner): no logo upload on "Your practice";
// with a non-Bar ID (Aadhaar/PAN) the enrolment number is optional. API mocked.

const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Riyaz', email: 'riyaz@firm.in', role: 'Solo Advocate', firm: 'Riyaz (Solo)', isSuperadmin: false, needsOnboarding: true };
const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test('no logo upload; enrolment optional with Aadhaar, still shown', async ({ page }) => {
  await page.route(/\/api\/me(\/|$)/, (r) => json(r, USER));
  await page.route(/\/api\/billing(\/|$)/, (r) => json(r, { paymentsEnabled: true }));
  await page.addInitScript((u) => localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: u, token: 'jwt' }, version: 0 })), USER);
  await page.goto('/onboarding');

  // Step 1: plan (default pick) -> Continue
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 2: your practice - no logo upload
  await expect(page.locator('#onb-firm')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload logo' })).toHaveCount(0);
  await expect(page.getByText('PNG, JPG or SVG')).toHaveCount(0);
  await expect(page.getByText('Name and practice areas')).toBeVisible();
  await page.locator('#onb-firm').fill('Riyaz & Associates');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Step 3: Aadhaar -> enrolment field shown as optional and not blocking
  await page.locator('#onb-doctype').selectOption('aadhaar');
  await expect(page.getByText('Enrolment number (optional)')).toBeVisible();
  await expect(page.getByText('Enter your enrolment number')).toHaveCount(0);
});
