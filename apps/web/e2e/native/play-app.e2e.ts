import { test, expect } from '@playwright/test';
import { NAV_GROUPS } from '../../src/components/shell/nav-config';
import * as d from './adb';
import { confirmIfAsked, ensureReady, expectNoError, expectScreen, fill, goNav, hideKeyboard, home, inSidebar, listed, openNav, tapRowAction, titleFor } from './app';

// Full UI pass over the DifAi app installed from the Play Store, on a USB phone.
// The app loads the LIVE site, so:
//  - AI actions (Draft / Analyze / Argue / Ask) are never pressed, only opened;
//  - only tasks and diary entries are created, each deleted in the same test
//    (cases only soft-delete; clients/invoices/expenses can't be deleted);
//  - an afterAll sweep deletes any E2E-* task/diary row a failed test left.

const uid = () => `E2E-${Date.now().toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await ensureReady();
});

// Safety net: delete any E2E-* task or diary entry still on live. Each part
// runs even if the other fails; a failure is reported, never swallowed.
async function sweepTasks(): Promise<void> {
  await home();
  await goNav('Tasks');
  await expectScreen('Tasks');
  for (let i = 0; i < 10 && (await listed(/E2E-/)); i++) {
    await d.tap({ clazz: 'Button', text: /E2E-/ });
    await d.tapPinned({ clazz: 'Button', text: /Delete task/ });
    await d.tapPinned({ clazz: 'Button', text: 'Yes, delete' });
    await sleep(1500);
  }
  if (await listed(/E2E-/)) throw new Error('E2E task still on live after sweep');
}

async function sweepDiary(): Promise<void> {
  await home();
  await d.tapPinned({ clazz: 'Button', desc: 'Hearings' });
  await d.tap({ text: 'Court Diary' });
  for (let i = 0; i < 10 && (await listed(/E2E-/)); i++) {
    if (!(await tapRowAction(/E2E-/, 'Delete diary entry'))) break;
    await confirmIfAsked();
    await sleep(1500);
  }
  if (await listed(/E2E-/)) throw new Error('E2E diary entry still on live after sweep');
}

test.afterAll(async () => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  for (const sweep of [sweepDiary, sweepTasks]) {
    await sweep().catch((e: Error) => errors.push(e.message));
  }
  if (errors.length) throw new Error(`live cleanup incomplete: ${errors.join('; ')}`);
});

test.beforeEach(async () => {
  await home();
  await expectScreen('Dashboard');
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    const path = info.outputPath('phone.png');
    d.screenshot(path);
    await info.attach('phone', { path, contentType: 'image/png' });
  }
});

// --- Bottom dock --------------------------------------------------------------

for (const [label, title] of [['Hearings', 'Hearings'], ['Draft', 'Draft'], ['Cases', 'Cases'], ['Home', 'Dashboard']] as const) {
  test(`dock: ${label} opens ${title}`, async () => {
    await d.tapPinned({ clazz: 'Button', desc: label });
    await expectScreen(title);
  });
}

test('dock: More opens the menu', async () => {
  await d.tapPinned({ clazz: 'Button', desc: 'More' });
  await sleep(1000);
  expect(d.find({ desc: 'Close navigation menu' }) ?? d.find({ text: /settings/i })).toBeTruthy();
  if (d.isShown({ desc: 'Close navigation menu' })) await d.tapPinned({ desc: 'Close navigation menu' });
  else d.key('BACK');
});

// --- Every sidebar screen ----------------------------------------------------

const items = NAV_GROUPS.flatMap((g) => g.items);

for (const item of items) {
  test(`sidebar: ${item.label}`, async () => {
    await openNav();
    test.skip(!inSidebar(item.label), 'not in this account\'s sidebar');
    await goNav(item.label);
    await expectScreen(titleFor(item.to) ?? item.label);
    // Tabbed sections (Hearings, Documents, Contract Review): open each tab.
    for (const tab of item.tabs ?? []) {
      // minY: the first tab often repeats the topbar title.
      if (!d.isShown({ text: tab.label, minY: 170 })) continue;
      await d.tap({ text: tab.label, minY: 170 });
      await expectScreen(titleFor(tab.to) ?? item.label);
    }
  });
}

// --- Topbar ----------------------------------------------------------------------

test('topbar: search opens the command palette and jumps to Settings', async () => {
  await d.tapPinned({ clazz: 'Button', desc: 'Search' });
  await d.waitFor({ clazz: 'EditText' });
  d.type('Settings');
  await sleep(1200);
  await hideKeyboard();
  // The result row reads "Settings FIRM"; the input itself also says "Settings".
  await d.tap({ clazz: 'View', text: /^Settings\b/, minY: 400 });
  await expectScreen('Settings');
});

test('topbar: notifications panel opens and closes', async () => {
  await d.tapPinned({ clazz: 'Button', desc: /^Notifications/ });
  await d.waitFor({ text: 'NOTIFICATIONS' }); // CSS uppercase is what the tree reports
  expectNoError();
  d.key('BACK'); // closes the panel, stays on the page
  await d.waitGone({ text: 'NOTIFICATIONS' });
  await expectScreen('Dashboard');
});

test('topbar: hardware Back closes the search palette, not the page behind it', async () => {
  await goNav('Tasks');
  await expectScreen('Tasks');
  await d.tapPinned({ clazz: 'Button', desc: 'Search' });
  await d.waitFor({ text: 'ESC' });
  await hideKeyboard();
  if (d.isShown({ text: 'ESC' })) d.key('BACK');
  await d.waitGone({ text: 'ESC' });
  await expectScreen('Tasks');
});

test('topbar: theme toggle switches and switches back', async () => {
  const first = await d.tapPinned({ clazz: 'Button', desc: /^Switch to (dark|light) theme$/ });
  const other = first.desc.includes('dark') ? 'Switch to light theme' : 'Switch to dark theme';
  await d.waitFor({ desc: other });
  await d.tapPinned({ desc: other });
  await d.waitFor({ desc: first.desc });
});

// --- Native behaviour -------------------------------------------------------------

test('hardware Back steps back one screen at a time', async () => {
  await d.tapPinned({ clazz: 'Button', desc: 'Cases' });
  await expectScreen('Cases');
  await goNav('Tasks');
  await expectScreen('Tasks');
  d.key('BACK');
  await expectScreen('Cases');
  d.key('BACK');
  await expectScreen('Dashboard');
});

test('reopening from the background keeps the screen (under 60 s, no lock)', async () => {
  await goNav('Tasks');
  await expectScreen('Tasks');
  d.key('HOME');
  await sleep(2000);
  d.launchApp();
  await expectScreen('Tasks');
});

// --- Read-only detail screens ------------------------------------------------------

test('cases: open the first matter', async () => {
  await d.tapPinned({ clazz: 'Button', desc: 'Cases' });
  await expectScreen('Cases');
  const row = d.dump().find((n) => n.clickable && n.clazz === 'View' && n.y > 300 && / v\. | vs\.? /i.test(n.desc + n.text));
  test.skip(!row, 'no matters listed');
  await d.tap({ desc: row!.desc, text: row!.text });
  await d.waitFor({ desc: 'Go back' });
  await sleep(1500);
  expectNoError();
});

test('calculators: court fee and stamp duty tabs', async () => {
  await goNav('Court Fee & Stamp');
  await expectScreen('Court Fee & Stamp');
  for (const tab of ['Court fee', 'Stamp duty']) {
    await d.tap({ text: tab });
    await sleep(1000);
    expectNoError();
  }
});

test('settings: every tab', async () => {
  await goNav('Settings');
  await expectScreen('Settings');
  for (const tab of ['Account', 'Letterhead', 'Privacy & Data']) {
    await d.tap({ text: tab });
    await sleep(1000);
    expectNoError();
  }
});

// --- Writes on live (tasks + diary only, each removed) --------------------------------

test('tasks: empty form is not saved', async () => {
  await goNav('Tasks');
  await expectScreen('Tasks');
  await d.tap({ clazz: 'Button', text: 'New task' });
  await d.waitFor({ text: 'Add a task' });
  await hideKeyboard();
  await d.tapPinned({ clazz: 'Button', text: 'Add task' });
  await sleep(1500);
  expect(d.isShown({ text: 'Add a task' }), 'form closed: an empty task was accepted').toBe(true);
  await d.tapPinned({ clazz: 'Button', text: 'Cancel' });
});

test('tasks: add a task, open it, delete it', async () => {
  const title = uid();
  await goNav('Tasks');
  await expectScreen('Tasks');
  await d.tap({ clazz: 'Button', text: 'New task' });
  await d.waitFor({ text: 'Add a task' });
  await fill('TITLE', title);
  await fill('MATTER', 'E2E matter');
  await hideKeyboard();
  await d.tapPinned({ clazz: 'Button', text: 'Add task' });
  await d.waitGone({ text: 'Add a task' });

  await d.tap({ clazz: 'Button', text: new RegExp(title) });
  await d.tapPinned({ clazz: 'Button', text: /Delete task/ });
  await d.waitFor({ text: 'Delete this task? This cannot be undone.' });
  await d.tapPinned({ clazz: 'Button', text: 'Yes, delete' });
  await sleep(2000);
  expect(d.isShown({ text: new RegExp(title) }), 'task still listed after delete').toBe(false);
});

test('diary: log, edit and delete an entry', async () => {
  test.setTimeout(300_000); // each screen read takes ~3 s on the phone
  const matter = uid();
  await d.tapPinned({ clazz: 'Button', desc: 'Hearings' });
  await expectScreen('Hearings');
  await d.tap({ text: 'Court Diary' });
  await d.tap({ clazz: 'Button', text: 'New entry' });
  await d.waitFor({ text: 'Log to court diary' });
  // DETAIL first: MATTER's suggestion list opens over the DETAIL label.
  await fill('DETAIL', 'created by e2e');
  await fill('MATTER', matter);
  await hideKeyboard();
  await d.tapPinned({ clazz: 'Button', text: 'Add entry' });
  await d.waitGone({ text: 'Log to court diary' });
  expect(await listed(matter), 'new entry listed').toBe(true);

  // Edit/Delete only via THIS entry's own buttons.
  expect(await tapRowAction(matter, 'Edit diary entry'), 'edit button for the new entry').toBe(true);
  await d.waitFor({ text: 'Edit court diary entry' });
  await fill('DETAIL', 'edited by e2e');
  await hideKeyboard();
  await d.tapPinned({ clazz: 'Button', text: 'Save changes' });
  await d.waitGone({ text: 'Edit court diary entry' });
  expect(await listed('edited by e2e'), 'edited detail shown').toBe(true);

  expect(await tapRowAction(matter, 'Delete diary entry'), 'delete button for the new entry').toBe(true);
  await confirmIfAsked();
  await sleep(2000);
  expect(await listed(matter), 'diary entry still listed after delete').toBe(false);
});
