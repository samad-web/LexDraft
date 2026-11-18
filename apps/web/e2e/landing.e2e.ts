import { test, expect } from '@playwright/test';

test.describe('DifAi web UI', () => {
  // The landing page opens a first-visit intro modal that intercepts clicks.
  // Mark it dismissed before any page script runs so the hero is interactable.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('difai-intro', JSON.stringify({ dismissed: true }));
      } catch {}
    });
  });

  test('landing page loads with correct title and hero', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/DifAi.*Indian advocates/i);
    await expect(
      page.getByRole('heading', { level: 1, name: /Practice management built for Indian advocates/i }),
    ).toBeVisible();
  });

  test('free-signup CTA routes to /auth?signup=1', async ({ page }) => {
    await page.goto('/');
    const cta = page.getByRole('button', { name: /create your free account/i });
    await cta.click();
    await expect(page).toHaveURL(/\/auth\?signup=1/);
  });

  test('auth route renders without a page error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const res = await page.goto('/auth');
    expect(res?.ok()).toBe(true);
    await page.waitForLoadState('networkidle').catch(() => {});
    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
