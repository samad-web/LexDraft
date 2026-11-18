import { test, expect, expectScreenOk, needFeature } from './support/fixtures';

// Tools, settings, AI screens (AI calls are stubbed by the guard) and the
// id-based routes not reached through CRUD.

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

test.describe('calculators', () => {
  for (const tab of ['Court fee', 'Stamp duty']) {
    test(`"${tab}" tab renders`, async ({ page }) => {
      await page.goto('/app/calculators');
      await page.getByRole('button', { name: tab, exact: true }).or(page.getByRole('tab', { name: tab, exact: true })).first().click();
      await expectScreenOk(page);
    });
  }
});

test('Sanhita: search by section number shows results or an empty state', async ({ page }) => {
  await page.goto('/app/sanhita');
  await page.getByPlaceholder('Search by section number or title…').fill('103');
  await expectScreenOk(page);
});

test.describe('settings', () => {
  for (const tab of ['Account', 'Letterhead', 'Privacy & Data']) {
    test(`"${tab}" tab renders`, async ({ page }) => {
      await page.goto('/app/settings');
      await page.getByRole('button', { name: tab, exact: true }).or(page.getByRole('tab', { name: tab, exact: true })).first().click();
      await expectScreenOk(page);
    });
  }
});

test.describe('AI screens never reach a model', () => {
  test('Contract Review: Analyze shows an error state when the AI call is blocked', async ({ page, guard, session }) => {
    needFeature(session, 'review.comment');
    await page.goto('/app/review');
    // Step 1 → 2 requires > 200 chars of source text (see ContractReviewView).
    const sample = ('E2E sample agreement. The tenant shall pay rent monthly on or before the 5th of every calendar month to the landlord. Either party may terminate this lease with thirty days written notice to the other party. ').repeat(2);
    await page.getByPlaceholder(/Paste the contract body here/).fill(sample);
    // Step 2: pick a perspective to reveal the Analyze CTA.
    await page.getByRole('button', { name: /^Represent/ }).first().click();
    const analyze = page.getByRole('button', { name: /Analyze contract/ });
    await expect(analyze).toBeVisible({ timeout: 10_000 });
    test.skip(await analyze.isDisabled(), 'Analyze needs more input on this plan');
    await analyze.click();
    await expect.poll(() => guard.stubbed.length).toBeGreaterThan(0);
    await expectScreenOk(page);
  });

  test('Draft screen loads its composer', async ({ page, session }) => {
    needFeature(session, 'drafting.ai');
    await page.goto('/app/draft');
    await expectScreenOk(page);
    await expect(page.locator('textarea, [contenteditable="true"]').first()).toBeVisible();
  });
});

test.describe('id routes handle a missing record without crashing', () => {
  for (const path of [
    `/app/matter-intel/${MISSING_ID}`,
    `/app/title-reports/${MISSING_ID}`,
    `/app/co-counsel/${MISSING_ID}`,
  ]) {
    test(path.replace(MISSING_ID, ':id'), async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('#main-content')).toBeVisible();
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    });
  }
});
