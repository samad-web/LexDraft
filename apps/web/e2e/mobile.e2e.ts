import { test, expect, expectScreenOk } from './support/fixtures';

// Phone-width shell (Pixel 7 viewport): bottom dock, slide-in sidebar, no
// horizontal overflow.

test('bottom dock navigates between its items', async ({ page }) => {
  // Dock entries are <button>s driven by react-router `navigate`, not <a>s
  // (see MobileNav.tsx). Map aria-label -> expected URL, then click each.
  const EXPECTED: Record<string, RegExp | null> = {
    Home:     /\/app\/dashboard/,
    Hearings: /\/app\/(causelist|calendar|diary)/,
    Draft:    /\/app\/draft/,
    Cases:    /\/app\/cases/,
    More:     null, // opens the drawer, doesn't navigate
  };
  await page.goto('/app/dashboard');
  const dock = page.getByRole('navigation', { name: 'Primary mobile' });
  await expect(dock).toBeVisible();
  const items = dock.getByRole('button');
  const n = await items.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 0; i < n; i++) {
    const item = items.nth(i);
    const label = (await item.getAttribute('aria-label')) ?? '';
    const rx = EXPECTED[label];
    await item.click();
    if (rx) {
      await expect(page).toHaveURL(rx);
      await expectScreenOk(page);
    } else {
      // "More" toggles the sidebar drawer open; close it before the next loop.
      await page.getByRole('button', { name: 'Close navigation menu' }).click().catch(() => {});
    }
  }
});

test('hamburger opens the sidebar and the close button hides it', async ({ page }) => {
  await page.goto('/app/dashboard');
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.locator('aside.sidebar')).toHaveClass(/is-open/);
  await page.getByRole('button', { name: 'Close navigation menu' }).click();
  await expect(page.locator('aside.sidebar')).not.toHaveClass(/is-open/);
});

for (const path of ['/app/dashboard', '/app/cases', '/app/tasks', '/app/calendar', '/app/settings']) {
  test(`${path} has no horizontal overflow at phone width`, async ({ page }) => {
    await page.goto(path);
    await expectScreenOk(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
