import { test, expect, expectScreenOk, main, openNav } from './support/fixtures';
import { NAV_GROUPS, visibleNavGroups } from '../src/components/shell/nav-config';

// The signed-in shell: sidebar (driven by nav-config, so new items are tested
// automatically), section tabs, topbar, command palette, notifications,
// theme, account menu, skip link and the in-app 404.

// Collected before auth.setup runs, so list every item and skip at runtime
// the ones this account's plan/role doesn't show.
const items = NAV_GROUPS.flatMap((g) => g.items);
const visibleItem = (features: string[], id: string) =>
  visibleNavGroups(features).flatMap((g) => g.items).find((i) => i.id === id);

test.describe('sidebar', () => {
  test('shows every nav group the account can open', async ({ page, session }) => {
    await page.goto('/app/dashboard');
    await openNav(page);
    const nav = page.locator('aside.sidebar nav');
    for (const g of visibleNavGroups(session.features)) await expect(nav.getByText(g.title, { exact: true })).toBeVisible();
  });

  for (const navItem of items) {
    test(`nav item "${navItem.label}" opens its page and is marked active`, async ({ page, session }) => {
      const item = visibleItem(session.features, navItem.id);
      test.skip(!item, 'hidden for this plan/role');
      if (!item) return;
      await page.goto('/app/dashboard');
      await openNav(page);
      const sidebar = page.locator('aside.sidebar');
      await expect(sidebar).toBeVisible();
      // Items below the fold need an explicit scroll before auto-scrollIntoView
      // can reach them inside the sidebar's overflow-y:auto nav.
      const label = item.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const link = sidebar.getByRole('link', { name: new RegExp(`^${label}(\\s|$)`) }).first();
      await link.scrollIntoViewIfNeeded();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${item.to.replace(/[/]/g, '\\/')}(\\?|$|/)`));
      await expect(link).toHaveClass(/active/);
      await expectScreenOk(page);
    });
  }
});

test.describe('section tabs', () => {
  for (const navItem of items.filter((i) => (i.tabs?.length ?? 0) > 1)) {
    test(`"${navItem.label}" tab strip switches between its pages`, async ({ page, session }) => {
      const item = visibleItem(session.features, navItem.id);
      test.skip(!item || item.tabs!.length < 2, 'fewer than two tabs for this plan/role');
      if (!item) return;
      await page.goto(item.tabs![0]!.to);
      const strip = page.locator('.section-tabs');
      for (const tab of item.tabs!) {
        await strip.getByText(tab.label, { exact: true }).click();
        await expect(page).toHaveURL(new RegExp(tab.to.replace(/[/]/g, '\\/')));
        await expectScreenOk(page);
      }
    });
  }
});

test.describe('topbar', () => {
  test('command palette opens from the search button and closes on Escape', async ({ page }) => {
    await page.goto('/app/dashboard');
    await page.getByRole('button', { name: 'Open search and command palette' }).click();
    const input = page.getByPlaceholder(/Search matters, CNR/);
    await expect(input).toBeVisible();
    await input.fill('Tasks');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();
  });

  test('Ctrl+K opens the command palette and a page result navigates', async ({ page }) => {
    await page.goto('/app/dashboard');
    await expect(main(page)).toBeVisible();
    await page.keyboard.press('Control+k');
    const input = page.getByPlaceholder(/Search matters, CNR/);
    await expect(input).toBeVisible();
    await input.fill('Settings');
    // The palette always offers a "Search Indian law" row above command
    // matches (CmdK.tsx line 230), so Enter would open research, not
    // Settings. Pick the unambiguous "Open settings" action instead.
    await page.getByRole('option').filter({ hasText: /Open settings/i }).first().click();
    await expect(page).toHaveURL(/\/app\/settings/);
  });

  test('Android back event closes the command palette and keeps the page', async ({ page }) => {
    await page.goto('/app/tasks');
    await page.getByRole('button', { name: 'Open search and command palette' }).click();
    const input = page.getByPlaceholder(/Search matters, CNR/);
    await expect(input).toBeVisible();
    // What lib/native.ts fires for the hardware back button.
    const cancelled = await page.evaluate(() => !window.dispatchEvent(new Event('difai:back', { cancelable: true })));
    expect(cancelled, 'palette must claim the back press').toBe(true);
    await expect(input).toBeHidden();
    await expect(page).toHaveURL(/\/app\/tasks/);
  });

  test('notifications panel opens and closes', async ({ page }) => {
    await page.goto('/app/dashboard');
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await bell.click();
    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel).toBeVisible();
    // The panel renders a full-screen tap-to-close backdrop at z-index 40
    // (NotificationPanel.tsx), so a second bell click is intercepted by it.
    // Close via Escape, the keyboard route the panel also supports.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('theme toggle flips html[data-theme] and persists across reload', async ({ page }) => {
    await page.goto('/app/dashboard');
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await page.locator('.topbar-theme').getByRole('button').first().click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');
    const after = await html.getAttribute('data-theme');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', after ?? '');
    // Put the account's theme back.
    await page.locator('.topbar-theme').getByRole('button').first().click();
    await expect(html).toHaveAttribute('data-theme', before ?? '');
  });
});

test.describe('account menu', () => {
  test('opens Settings', async ({ page }) => {
    await page.goto('/app/dashboard');
    await openNav(page);
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.getByRole('menuitem', { name: /settings/i }).click();
    await expect(page).toHaveURL(/\/app\/settings/);
  });

  test('Sign out clears the session and returns to the landing page', async ({ page }) => {
    // Keep the shared saved token valid for the rest of the run.
    await page.route('**/api/auth/logout**', (r) => r.fulfill({ status: 200, body: '{}', contentType: 'application/json' }));
    await page.goto('/app/dashboard');
    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/$|\/auth/);
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('lexdraft-auth') ?? '{}')?.state?.token ?? null);
    expect(token).toBeNull();
  });
});

test('skip link exists and moves focus to main when activated', async ({ page }) => {
  await page.goto('/app/dashboard');
  await expect(main(page)).toBeVisible();
  // Rendered as the first element in <body>, so Tab from body lands here.
  // Focusing it directly tests the a11y contract (Enter -> focus main)
  // without fighting whatever element grabbed focus on dashboard mount.
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(main(page)).toBeFocused();
});

test('unknown /app route shows the in-app 404 with a way back', async ({ page }) => {
  await page.goto('/app/no-such-screen-e2e');
  await expect(page.getByText('Page not found')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Dashboard' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/);
});
