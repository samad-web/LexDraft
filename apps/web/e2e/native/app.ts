import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_TITLES } from '../../src/components/shell/nav-config';
import * as d from './adb';

// DifAi-specific steps on top of adb.ts, for the Play Store app on the phone.

const envFile = join(import.meta.dirname, '..', '..', '.env.e2e');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Texts that mean a screen failed to render. */
const ERROR_TEXTS = ['Something went wrong', 'Page not found', 'DifAi - offline'];

export function expectNoError(): void {
  const shown = d.screenText();
  const hit = ERROR_TEXTS.find((t) => shown.includes(t));
  if (hit) throw new Error(`screen shows "${hit}"`);
}

/** Topbar title for an /app path, from the app's own ROUTE_TITLES. */
export function titleFor(path: string): string | undefined {
  return ROUTE_TITLES[path.replace(/^\/app\//, '').split(/[/?]/)[0]!]?.title;
}

/** Waits until the topbar (y < 170) shows `title`, then checks for error screens. */
export async function expectScreen(title: string): Promise<void> {
  const end = Date.now() + 20_000;
  for (;;) {
    const top = d.dump().filter((n) => n.clazz === 'TextView' && n.y < 170 && n.bottom > n.top).map((n) => n.text);
    if (top.includes(title)) break;
    if (Date.now() > end) throw new Error(`topbar shows ${JSON.stringify(top)}, expected "${title}"`);
    await sleep(700);
  }
  await sleep(1200); // let the screen's data load
  expectNoError();
}

export const keyboardShown = d.keyboardShown;

/** Hides the keyboard without BACK closing a form when it's already hidden. */
export async function hideKeyboard(): Promise<void> {
  if (keyboardShown()) {
    d.key('BACK');
    await sleep(600);
  }
}

/** Launches the app; signs in with .env.e2e if signed out; skips the tour. */
export async function ensureReady(): Promise<void> {
  d.launchApp();
  await sleep(2500);
  await closeOverlays();
  const ready = () => d.isShown({ clazz: 'Button', desc: 'Home' });
  const signIn = () => d.isShown({ clazz: 'Button', text: /^sign in$/i });
  const end = Date.now() + 40_000;
  while (!ready() && !signIn()) {
    if (d.isShown({ text: 'Skip tour' })) await d.tap({ text: 'Skip tour' });
    if (Date.now() > end) throw new Error('app neither signed in nor on the sign-in screen (app lock? finish it on the phone)');
    await sleep(1000);
  }
  if (!ready()) {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    if (!email || !password) throw new Error('app is signed out: set E2E_EMAIL/E2E_PASSWORD in apps/web/.env.e2e');
    // Welcome screen has a "Sign in" button before the form.
    if (!d.isShown({ clazz: 'EditText' })) await d.tap({ clazz: 'Button', text: /^sign in$/i });
    await d.tap({ clazz: 'EditText', index: 0 });
    d.type(email);
    await d.tap({ clazz: 'EditText', index: 1 });
    d.type(password);
    await hideKeyboard();
    await d.tapPinned({ clazz: 'Button', text: /^sign in$/i });
  }
  const end2 = Date.now() + 30_000;
  while (!ready()) {
    if (d.isShown({ text: 'Skip tour' })) await d.tap({ text: 'Skip tour' });
    if (d.isShown({ text: 'No DifAi account uses this email.' })) throw new Error('sign-in rejected: no account with E2E_EMAIL');
    if (Date.now() > end2) throw new Error('did not reach the app after sign-in');
    await sleep(1000);
  }
  if (d.isShown({ text: 'Skip tour' })) await d.tap({ text: 'Skip tour' });
}

export async function openNav(): Promise<void> {
  if (d.isShown({ desc: 'Close navigation menu' })) return;
  await d.tapPinned({ desc: 'Open navigation menu' });
  await d.waitFor({ desc: 'Close navigation menu' });
  await sleep(800); // slide-in animation; taps during it miss
}

/** Sidebar item by label; AI items read "<label> AI". */
export const navItem = (label: string): d.Selector => ({
  desc: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}( AI)?$`),
  clazz: 'View',
});

/** Is the item in the sidebar at all (also when scrolled out of view)? */
export function inSidebar(label: string): boolean {
  const re = navItem(label).desc as RegExp;
  return d.dump().some((n) => n.clazz === 'View' && re.test(n.desc));
}

export async function goNav(label: string): Promise<void> {
  await openNav();
  await d.tap(navItem(label));
  await d.waitGone({ desc: 'Close navigation menu' }).catch(() => undefined);
}

/** Focuses a form field by tapping its label (labels wrap their inputs), then types. */
export async function fill(label: string, value: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await d.tap({ clazz: 'TextView', text: label });
    // Keys sent while the keyboard is still opening are dropped.
    for (let i = 0; i < 10 && !keyboardShown(); i++) await sleep(300);
    await sleep(300);
    // Fields can be pre-filled (MATTER suggests a case, Edit forms): select all, delete.
    d.adb('shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A');
    d.adb('shell', 'input', 'keyevent', 'KEYCODE_DEL');
    d.type(value);
    await sleep(500);
    if (d.isShown({ clazz: 'EditText', text: value })) return;
  }
  throw new Error(`"${value}" did not land in ${label} (tap covered by a dropdown?)`);
}

/** Closes whatever covers the app: keyboard, sidebar, search palette, a form.
 *  Never presses Back: on the dashboard that leaves the app, and reopening
 *  shows the app lock. */
export async function closeOverlays(): Promise<void> {
  await hideKeyboard();
  if (d.isShown({ desc: 'Close navigation menu' })) await d.tapPinned({ desc: 'Close navigation menu' });
  // Search palette: tap outside it (Back doesn't close it on builds before the CmdK fix).
  const esc = d.find({ text: 'ESC' });
  if (esc) {
    // Tap the dimmed backdrop just above the palette (its height varies, the top doesn't move much).
    d.adb('shell', 'input', 'tap', '360', String(Math.max(90, Math.round((64 + esc.top - 60) / 2))));
    await sleep(800);
    if (d.isShown({ text: 'ESC' })) throw new Error('search palette did not close');
  }
  if (d.isShown({ clazz: 'Button', text: 'Cancel' })) await d.tapPinned({ clazz: 'Button', text: 'Cancel' });
  // A side drawer (task detail): its × button.
  if (d.isShown({ clazz: 'Button', desc: 'Close' })) await d.tapPinned({ clazz: 'Button', desc: 'Close' });
}

/** Is a row with `text` anywhere in the (scrolled) list? */
export async function listed(text: string | RegExp): Promise<boolean> {
  for (let i = 0; i < 4; i++) d.adb('shell', 'input', 'swipe', '360', '500', '360', '1300', '300'); // back to the top
  await sleep(900);
  return d.scrollTo({ text }, 8).then(() => true, () => false);
}

/**
 * Taps the `desc` button (e.g. "Delete diary entry") that belongs to the row
 * showing `text`: scrolls to the row, centres it, then picks the first such
 * button at or below the row's top. Never touches another row's button.
 */
export async function tapRowAction(text: string | RegExp, desc: string): Promise<boolean> {
  let row = await d.scrollTo({ text }, 8).catch(() => undefined);
  if (!row) return false;
  if (row.y > d.screenHeight() * 0.5) {
    d.adb('shell', 'input', 'swipe', '360', String(row.y), '360', String(Math.round(d.screenHeight() * 0.3)), '900');
  }
  // Wait until the list stops coasting, so the button positions are current.
  let nodes = d.dump();
  for (let i = 0, lastY = -1; i < 6; i++) {
    row = d.find({ text }, nodes);
    if (row && row.y === lastY) break;
    lastY = row?.y ?? -1;
    await sleep(700);
    nodes = d.dump();
  }
  const btn = row && nodes
    .filter((n) => n.desc === desc && n.bottom > n.top && n.top >= row!.top - 10)
    .sort((a, b) => a.top - b.top)[0];
  if (!btn) {
    console.warn('tapRowAction: no button', desc, 'row', JSON.stringify(row), 'candidates',
      JSON.stringify(nodes.filter((n) => n.desc === desc).map((n) => [n.top, n.bottom])));
    return false;
  }
  d.adb('shell', 'input', 'tap', String(btn.x), String(btn.y));
  await sleep(800);
  return true;
}

const CONFIRM = { clazz: 'Button', text: /^(Delete|Yes, delete|Confirm)$/ } as const;
export async function confirmIfAsked(): Promise<void> {
  if (d.isShown(CONFIRM)) await d.tapPinned(CONFIRM);
}

/** Back to the dashboard via the dock. */
export async function home(): Promise<void> {
  await closeOverlays();
  if (!d.isShown({ clazz: 'Button', desc: 'Home' })) {
    d.launchApp(); // brings it back to the front if something left it
    await sleep(2000);
  }
  await d.tapPinned({ clazz: 'Button', desc: 'Home' });
}
