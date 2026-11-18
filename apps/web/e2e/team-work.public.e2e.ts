import { test, expect, type Page, type Route } from '@playwright/test';

// team-work (owner 2026-11-18): member cards show workload + Assign work; the
// task board filters by assignee. API mocked.
const ME = { id: '11111111-1111-4111-8111-111111111111', name: 'Anantha Krishnan', email: 'a@firm.in', role: 'Managing Partner', firm: 'Anantha & Associates', plan: 'Firm', isSuperadmin: false };
const ASHA = '22222222-2222-4222-8222-222222222222';
const json = (r: Route, body: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const task = (id: string, title: string, assigneeUserId: string, createdByUserId: string, assignee: string) =>
  ({ id, title, case: 'Rao v. Krishna Agencies', due: '2030-01-15', priority: 'high', assignee, comments: 0, column: 'pending', assigneeUserId, assigneeName: assignee === 'AR' ? 'Asha Rao' : 'Anantha Krishnan', createdByUserId });

async function setup(page: Page, calls: { tasks: unknown[]; lead: unknown[] }) {
  await page.route(/\/api\//, (r) => r.abort());
  await page.route(/\/api\/me(\/|$)/, (r) => json(r, ME));
  await page.route(/\/api\/me\/features$/, (r) => json(r, { features: ['matter.view', 'matter.create', 'admin.users', 'firm.members.view'], role: { id: 'r', name: 'Firm Admin', isSystem: true }, plan: 'Firm' }));
  await page.route(/\/api\/firm\/users$/, (r) => json(r, { items: [
    { id: ME.id, name: ME.name, email: ME.email, status: 'active', isSuperadmin: false, role: { id: 'r', name: 'Firm Admin', isSystem: true }, practiceGroup: null, lastSeenAt: null, createdAt: '2026-11-01' },
    { id: ASHA, name: 'Asha Rao', email: 'asha@firm.in', status: 'active', isSuperadmin: false, role: { id: 'r2', name: 'Associate', isSystem: true }, practiceGroup: null, lastSeenAt: null, createdAt: '2026-11-02' },
  ] }));
  await page.route(/\/api\/firm\/team$/, (r) => json(r, { items: [
    { userId: ME.id, name: ME.name, role: 'Firm Admin', leadCases: 2, hearingsThisWeek: 1, openTasks: 0, overdueTasks: 0 },
    { userId: ASHA, name: 'Asha Rao', role: 'Associate', leadCases: 3, hearingsThisWeek: 4, openTasks: 5, overdueTasks: 2 },
  ] }));
  await page.route(/\/api\/firm\/teammates$/, (r) => json(r, { items: [{ id: ME.id, name: ME.name, email: ME.email, role: 'Managing Partner' }, { id: ASHA, name: 'Asha Rao', email: 'asha@firm.in', role: 'Associate' }] }));
  await page.route(/\/api\/invitations(\?|$)/, (r) => json(r, { items: [] }));
  await page.route(/\/api\/cases(\?|$)/, (r) => json(r, { items: [{ id: '33333333-3333-4333-8333-333333333333', cnr: 'OS 12/2026', title: 'Rao v. Krishna Agencies', court: 'City Civil Court', stage: 'Arguments', client: 'Venkat Rao', status: 'Active', next: '2026-11-25', type: 'Civil' }] }));
  await page.route(/\/api\/cases\/[^/]+\/lead$/, (r) => { calls.lead.push(r.request().postDataJSON()); return json(r, { lead: { id: ASHA, name: 'Asha Rao', email: 'asha@firm.in', role: 'Associate' } }); });
  await page.route(/\/api\/tasks$/, (r) => {
    if (r.request().method() === 'POST') { calls.tasks.push(r.request().postDataJSON()); return json(r, task('t9', 'x', ASHA, ME.id, 'AR'), 201); }
    return json(r, { pending: [task('t1', 'Draft written statement', ASHA, ME.id, 'AR'), task('t2', 'Review client brief', ME.id, ASHA, 'AK')], progress: [], review: [], done: [] });
  });
  await page.addInitScript((u) => {
    localStorage.setItem('lexdraft-auth', JSON.stringify({ state: { user: u, token: 'jwt' }, version: 0 }));
    localStorage.setItem(`difai-tour-done:${u.id}`, '2026-11-18');
  }, ME);
}

test('AC7: member card shows workload; Assign task sends the member; Assign case sets the lead', async ({ page }) => {
  const calls = { tasks: [] as unknown[], lead: [] as unknown[] };
  await setup(page, calls);
  await page.goto('/app/members');
  const asha = page.getByRole('list', { name: "Asha Rao's workload" });
  await expect(asha).toContainText('3Lead cases');
  await expect(asha).toContainText('4Hearings this week');
  await expect(asha).toContainText('2 overdue');
  const card = page.locator('.fm-member', { hasText: 'Asha Rao' });
  await card.getByRole('button', { name: 'Assign task' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByPlaceholder('e.g. Prepare written statement draft').fill('File vakalatnama');
  await dlg.locator('input[placeholder="Case label"]').fill('Rao v. Krishna Agencies');
  await dlg.getByRole('button', { name: 'Add task' }).click();
  await expect.poll(() => calls.tasks.length).toBe(1);
  expect(calls.tasks[0]).toMatchObject({ title: 'File vakalatnama', assigneeUserId: ASHA });

  await card.getByRole('button', { name: 'Assign case' }).click();
  await page.getByRole('dialog').getByText('Choose a case').click();
  await page.getByRole('option', { name: /Rao v\. Krishna Agencies/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Assign case' }).click();
  await expect.poll(() => calls.lead.length).toBe(1);
  expect(calls.lead[0]).toEqual({ userId: ASHA });
});

test('AC8: task board filters: assigned to me / by me / one person', async ({ page }) => {
  await setup(page, { tasks: [], lead: [] });
  await page.goto('/app/tasks?mine=1');
  await expect(page.getByText('Review client brief')).toBeVisible();
  await expect(page.getByText('Draft written statement')).toHaveCount(0);
  await page.getByRole('button', { name: 'Assigned by me' }).click();
  await expect(page.getByText('Draft written statement')).toBeVisible();
  await expect(page.getByText('Review client brief')).toHaveCount(0);
  await page.getByRole('button', { name: 'All tasks' }).click();
  await expect(page.getByText('Review client brief')).toBeVisible();
  await expect(page.getByText('Draft written statement')).toBeVisible();
  await page.goto(`/app/tasks?assignee=${ASHA}`);
  await expect(page.getByText('Draft written statement')).toBeVisible();
  await expect(page.getByText('Review client brief')).toHaveCount(0);
});
