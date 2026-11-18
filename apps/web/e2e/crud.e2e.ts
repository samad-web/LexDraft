import type { Locator, Page, Route } from '@playwright/test';
import { test, expect, expectScreenOk, dialog, needFeature } from './support/fixtures';
import { uniqueName } from './support/env';

// Create / read / update / delete round-trips on the local DB. Every row is
// named E2E-*; global-teardown removes whatever a test didn't delete itself.

/** Modal field by its uppercase label ("MATTER" must not match "MATTER TITLE"). */
function field(scope: Locator, label: string): Locator {
  return scope.getByLabel(new RegExp(`^${label}(?!\\s+[A-Z]{2,})`)).first();
}

async function submit(page: Page): Promise<void> {
  await dialog(page).locator('button[type="submit"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Opens a "New …" form, submits it empty with POSTs to `api` aborted, and
 *  checks the form stayed open and sent nothing. Never creates a row. */
async function expectEmptyFormBlocked(page: Page, path: string, button: string, api: string): Promise<void> {
  const posted: string[] = [];
  const pattern = `**/api${api}**`;
  const block = (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posted.push(route.request().url());
    return route.abort();
  };
  await page.route(pattern, block);
  try {
    await page.goto(path);
    await page.getByRole('button', { name: button }).first().click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await d.locator('button[type="submit"]').click().catch(() => {});
    await expect(d).toBeVisible();
    expect(posted, `empty form was submitted to ${api}`).toEqual([]);
    await page.keyboard.press('Escape');
  } finally {
    await page.unroute(pattern, block);
  }
}

test.describe('cases', () => {
  test('New case form opens from the Cases page and cancels cleanly', async ({ page, session }) => {
    needFeature(session, 'matter.create');
    // The New-case modal says "All fields are optional" (NewCaseModal.tsx), so
    // empty-form-blocked doesn't apply here. We assert the modal opens and
    // Cancel closes it without submitting anything to /api/cases.
    const posted: string[] = [];
    await page.route('**/api/cases**', (route) => {
      if (route.request().method() === 'POST') posted.push(route.request().url());
      return route.fallback();
    });
    await page.goto('/app/cases');
    await page.getByRole('button', { name: 'New case' }).first().click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Cancel' }).click();
    await expect(d).toBeHidden();
    expect(posted, 'Cancel must not POST to /api/cases').toEqual([]);
  });

  test('open an existing case and every detail tab (read-only)', async ({ page, session }) => {
    needFeature(session, 'matter.view');
    await page.goto('/app/cases');
    await expectScreenOk(page);
    const rows = page.locator('.cs-row[role="link"]');
    test.skip((await rows.count()) === 0, 'account has no cases');
    await rows.first().click();
    await expect(page).toHaveURL(/\/app\/cases\/[0-9a-f-]{36}/);
    await expectScreenOk(page);
    const tabs = page.getByRole('tablist', { name: 'Matter sections' }).getByRole('tab');
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      await expectScreenOk(page);
    }
  });

  test('create a case, find it by search, open it, then delete it', async ({ page, session }) => {
    needFeature(session, 'matter.create');
    const title = uniqueName('Case');
    await page.goto('/app/cases');
    await page.getByRole('button', { name: 'New case' }).first().click();
    const d = dialog(page);
    await field(d, 'MATTER TITLE').fill(title);
    await field(d, 'CLIENT').fill(uniqueName('CaseClient'));
    await field(d, 'COURT LEVEL').fill('District Court, Chennai');
    await submit(page);

    await page.goto('/app/cases');
    await page.getByPlaceholder('Search title, CNR or client…').fill(title);
    const row = page.getByRole('link').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(page).toHaveURL(/\/app\/cases\/[0-9a-f-]{36}/);
    await expect(page.getByText(title).first()).toBeVisible();

    // Soft delete from the list (recoverable 30 days; local teardown hard-deletes).
    await page.goto('/app/cases');
    await page.getByPlaceholder('Search title, CNR or client…').fill(title);
    await page.getByRole('button', { name: `Delete ${title}` }).click();
    await expect(page.getByText(`Deleted "${title}"`)).toBeVisible();
    await expect(page.getByRole('link').filter({ hasText: title })).toHaveCount(0);
  });
});

test.describe('clients', () => {
  test.beforeEach(({ session }) => needFeature(session, 'client.view'));

  test('empty Add client form is not submitted', async ({ page }) => {
    await expectEmptyFormBlocked(page, '/app/clients', 'Add client', '/clients');
  });

  test('add a client, search it, open the edit form and its detail page', async ({ page }) => {
    const name = uniqueName('Client');
    await page.goto('/app/clients');
    await page.getByRole('button', { name: 'Add client' }).first().click();
    await field(dialog(page), 'CLIENT NAME').fill(name);
    await submit(page);

    await page.getByPlaceholder('Search by client name…').fill(name);
    await expect(page.getByText(name).first()).toBeVisible();

    await page.getByRole('button', { name: `Edit ${name}` }).click();
    await expect(field(dialog(page), 'CLIENT NAME')).toHaveValue(name);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByText(name).first().click();
    await expect(page).toHaveURL(/\/app\/clients\/[0-9a-f-]{36}/);
    await expectScreenOk(page);
  });

  test('open an existing client detail page (read-only)', async ({ page }) => {
    await page.goto('/app/clients');
    await expectScreenOk(page);
    const edit = page.getByRole('button', { name: /^Edit / });
    test.skip((await edit.count()) === 0, 'account has no clients');
    const name = (await edit.first().getAttribute('aria-label'))!.replace(/^Edit /, '');
    await page.getByText(name, { exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/clients\/[0-9a-f-]{36}/);
    await expectScreenOk(page);
  });
});

test.describe('tasks', () => {
  test.beforeEach(({ session }) => needFeature(session, 'matter.create'));

  test('empty New task form is not submitted', async ({ page }) => {
    await expectEmptyFormBlocked(page, '/app/tasks', 'New task', '/tasks');
  });

  test('add a task, open it, delete it with the two-step confirm', async ({ page }) => {
    const title = uniqueName('Task');
    await page.goto('/app/tasks');
    await page.getByRole('button', { name: 'New task' }).first().click();
    const d = dialog(page);
    await field(d, 'TITLE').fill(title);
    await field(d, 'MATTER').fill(uniqueName('TaskMatter'));
    await submit(page);

    const card = page.locator('.ct-tcard', { hasText: title });
    await expect(card).toBeVisible();
    await card.click();
    await page.getByRole('button', { name: 'Delete task' }).click();
    await expect(page.getByText('Delete this task? This cannot be undone.')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(card).toHaveCount(0);
  });
});

test.describe('invoices', () => {
  test.beforeEach(({ session }) => needFeature(session, 'billing.view'));

  test('empty New invoice form is not submitted', async ({ page }) => {
    await expectEmptyFormBlocked(page, '/app/invoices', 'New invoice', '/invoices');
  });

  test('issue an invoice and find it by search', async ({ page }) => {
    const client = uniqueName('Billed');
    await page.goto('/app/invoices');
    await page.getByRole('button', { name: 'New invoice' }).first().click();
    const d = dialog(page);
    await field(d, 'CLIENT').fill(client);
    await field(d, 'AMOUNT').fill('1000');
    await submit(page);

    await page.getByPlaceholder('Search by invoice number or client…').fill(client);
    await expect(page.getByText(client).first()).toBeVisible();
  });

  test('status filters switch without errors', async ({ page }) => {
    await page.goto('/app/invoices');
    const filters = page.getByRole('group', { name: 'Filter by status' }).getByRole('button')
      .or(page.getByRole('tablist', { name: 'Filter by status' }).getByRole('tab'));
    for (let i = 0; i < (await filters.count()); i++) {
      await filters.nth(i).click();
      await expectScreenOk(page);
    }
  });
});

test.describe('expenses', () => {
  test.beforeEach(({ session }) => needFeature(session, 'billing.view'));

  test('empty Log expense form is not submitted', async ({ page }) => {
    await expectEmptyFormBlocked(page, '/app/expenses', 'Log expense', '/expenses');
  });

  test('log an expense and find it by search', async ({ page }) => {
    const description = uniqueName('Expense');
    await page.goto('/app/expenses');
    await page.getByRole('button', { name: 'Log expense' }).first().click();
    const d = dialog(page);
    await field(d, 'DESCRIPTION').fill(description);
    await field(d, 'AMOUNT').fill('250');
    await submit(page);

    await page.getByPlaceholder(/Search by description/).fill(description);
    await expect(page.getByText(description).first()).toBeVisible();
  });
});

test.describe('court diary', () => {
  test.beforeEach(({ session }) => needFeature(session, 'matter.view'));

  test('log, edit and delete a diary entry', async ({ page }) => {
    const matter = uniqueName('Diary');
    await page.goto('/app/diary');
    await page.getByRole('button', { name: 'New entry' }).first().click();
    let d = dialog(page);
    await field(d, 'MATTER').fill(matter);
    await field(d, 'DETAIL').fill('created by e2e');
    await submit(page);

    // Scope every action to this entry's row so a real entry is never touched.
    const row = page.locator('.ct-erow', { hasText: matter });
    await expect(row).toHaveCount(1);

    await row.getByRole('button', { name: 'Edit diary entry' }).click();
    d = dialog(page);
    await expect(d.getByText('Edit court diary entry')).toBeVisible();
    await field(d, 'DETAIL').fill('edited by e2e');
    await submit(page);
    await expect(row.getByText('edited by e2e')).toBeVisible();

    await row.getByRole('button', { name: 'Delete diary entry' }).click();
    // Delete goes through ConfirmDialog ("Delete diary entry?" modal); wait
    // for it, then click its destructive confirm button.
    const confirmDlg = page.getByRole('dialog', { name: /Delete diary entry/i });
    await expect(confirmDlg).toBeVisible();
    await confirmDlg.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0);
  });
});
