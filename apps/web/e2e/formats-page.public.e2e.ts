import { test, expect, type Page, type Route } from '@playwright/test';

// formats-page (owner 2026-11-18): the LAWE forms as a sidebar page; each form
// opens inside DifAi and downloads blank as PDF or Word. API mocked.

const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Riyaz', email: 'riyaz@firm.in', role: 'Managing Partner', firm: 'Riyaz & Associates', plan: 'Firm', isSuperadmin: false };
const FORMS = [
  { id: 'Court_of_Small_Causes/Copy_Application.pdf', title: 'Copy Application', group: 'Court of Small Causes', url: 'https://x', docLabel: 'Copy Application', preset: { forum: 'small_causes' } },
  { id: 'High_Court/Vakalat.pdf', title: 'Vakalatnama', group: 'High Court', url: 'https://x', docLabel: 'Vakalatnama', preset: {} },
];
const DOCX = Buffer.from('PK fake docx').toString('base64');
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function signedIn(page: Page, calls: { blank: unknown[]; pdf: number }, blankStatus = 200) {
  // Anything not mocked below must not reach a real API (a 401 would sign out).
  await page.route(/\/api\//, (r) => r.abort());
  await page.route(/\/api\/me(\/|$)/, (r) => json(r, USER));
  await page.route(/\/api\/me\/features$/, (r) => json(r, { features: ['drafting.ai', 'drafting.clauses', 'matter.view'], role: null, plan: 'Firm' }));
  await page.route(/\/api\/drafting\/engine\/library$/, (r) => json(r, { lawe: FORMS, laweSource: 'https://www.lawe.co.in/lawe-downloads.html' }));
  await page.route(/\/api\/drafting\/engine\/blank$/, (r) => { calls.blank.push(r.request().postDataJSON()); return blankStatus === 200 ? json(r, { docxBase64: DOCX, blocks: [], fileName: 'x (blank)' }) : json(r, { error: 'engine_unavailable' }, blankStatus); });
  await page.route(/\/api\/drafting\/engine\/docx-to-pdf$/, (r) => { calls.pdf++; return r.fulfill({ status: 200, contentType: 'application/pdf', body: PDF }); });
  await page.addInitScript((u) => localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: u, token: 'jwt' }, version: 0 })), USER);
}

test('AC1+AC2: sidebar Formats opens the page; forms grouped by LAWE section; search filters', async ({ page }) => {
  await signedIn(page, { blank: [], pdf: 0 });
  await page.goto('/app/dashboard');
  await page.getByRole('link', { name: 'Formats' }).first().click();
  await expect(page).toHaveURL(/\/app\/formats$/);
  await expect(page.getByRole('region', { name: 'Court of Small Causes' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'High Court' })).toBeVisible();
  await expect(page.getByText('2 formats')).toBeVisible();
  await page.getByLabel('Search formats').fill('vakal');
  await expect(page.getByRole('button', { name: 'View Vakalatnama' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'View Copy Application' })).toHaveCount(0);
});

test('AC3: View opens the blank form inside DifAi, with PDF and Word downloads', async ({ page }) => {
  const calls = { blank: [] as unknown[], pdf: 0 };
  await signedIn(page, calls);
  await page.goto('/app/formats');
  await page.getByRole('button', { name: 'View Copy Application' }).last().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Copy Application').first()).toBeVisible();
  await expect(dialog.locator('iframe[title="Copy Application (blank form)"]')).toHaveAttribute('src', /^blob:/);
  expect(calls.blank[0]).toEqual({ docLabel: 'Copy Application', preset: { forum: 'small_causes' } });
  const pdf = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PDF' }).click();
  expect((await pdf).suggestedFilename()).toBe('Copy Application (blank).pdf');
  const word = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download Word' }).click();
  expect((await word).suggestedFilename()).toBe('Copy Application (blank).docx');
});

test('AC4: PDF and Word download straight from the list', async ({ page }) => {
  const calls = { blank: [] as unknown[], pdf: 0 };
  await signedIn(page, calls);
  await page.goto('/app/formats');
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Vakalatnama as PDF' }).click();
  expect((await pdf).suggestedFilename()).toBe('Vakalatnama (blank).pdf');
  const word = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Vakalatnama as Word' }).click();
  expect((await word).suggestedFilename()).toBe('Vakalatnama (blank).docx');
  expect(calls.blank[1]).toEqual({ docLabel: 'Vakalatnama' }); // no empty preset sent
});

test('AC5: engine down -> a plain message, no viewer', async ({ page }) => {
  await signedIn(page, { blank: [], pdf: 0 }, 503);
  await page.goto('/app/formats');
  await page.getByRole('button', { name: 'View Vakalatnama' }).last().click();
  await expect(page.getByText('Could not prepare Vakalatnama. Try again in a moment.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
