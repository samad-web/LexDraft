import { test as setup, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { API_URL, AUTH_DIR, AUTH_FILE, DIRTY_FILE, SESSION_FILE, assertLocal, credentials } from './support/env';

setup('sign in with the local account and save the session', async ({ page, request }) => {
  assertLocal(API_URL, 'E2E_API_URL');
  const health = await request.get(`${API_URL}/api/health`).catch(() => null);
  expect(health?.ok(), `local API not reachable at ${API_URL} — start it with pnpm dev`).toBe(true);

  const { email, password } = credentials();
  await page.addInitScript(() => {
    try { localStorage.setItem('difai-intro', JSON.stringify({ dismissed: true })); } catch {}
  });
  await page.goto('/auth');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page, 'sign-in failed, MFA is on, or onboarding is unfinished').toHaveURL(/\/app\/dashboard/, { timeout: 20_000 });

  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('lexdraft-auth') ?? '{}')?.state?.token as string);
  const headers = { Authorization: `Bearer ${token}` };
  const me = await (await request.get(`${API_URL}/api/me`, { headers })).json();
  const feats = await (await request.get(`${API_URL}/api/me/features`, { headers })).json();

  // Mark the first-login product tour as already seen so its modal can't
  // intercept clicks in downstream tests (ProductTour reads
  // `difai-tour-done:${user.id}` from localStorage).
  const userId = (me as { id?: string })?.id;
  if (userId) {
    await page.evaluate((id) => {
      try { localStorage.setItem(`difai-tour-done:${id}`, new Date().toISOString()); } catch {}
    }, userId);
  }

  mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
  writeFileSync(DIRTY_FILE, new Date().toISOString());
  writeFileSync(SESSION_FILE, JSON.stringify({ features: feats.features ?? [], isSuperadmin: !!me.isSuperadmin }, null, 2));
});
