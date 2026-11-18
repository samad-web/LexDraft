import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Drives the installed (Play Store) DifAi app with tools built into Android:
// `uiautomator dump` reads the screen, `input` taps/types. Nothing is
// installed on the phone (Play Protect blocks Playwright's own driver APK on
// Android 16, and a release WebView can't be attached to - by design).

export const APP_PKG = 'in.sirahdigital.difai';

const ADB = process.env.ADB
  ?? [join(process.env.LOCALAPPDATA ?? '', '..', '..', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
      join(homedir(), 'Android', 'Sdk', 'platform-tools', 'adb.exe')].find(existsSync)
  ?? 'adb';

export function adb(...args: string[]): string {
  return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
}

export interface UiNode {
  text: string;
  desc: string;
  clazz: string;
  clickable: boolean;
  x: number;
  y: number;
  top: number;
  bottom: number;
}

export interface Selector {
  text?: string | RegExp;
  desc?: string | RegExp;
  /** Short class name, e.g. 'Button', 'EditText'. */
  clazz?: string;
  /** Which match, in screen order (default 0). */
  index?: number;
  /** Only nodes whose centre is at or below this y (e.g. skip the topbar). */
  minY?: number;
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function dump(): UiNode[] {
  // A failed dump (screen never idle) leaves the previous file: delete it first,
  // so a stale screen is never read as the current one.
  let xml = '';
  for (let i = 0; i < 3 && !xml.includes('<hierarchy'); i++) {
    adb('shell', 'rm', '-f', '/sdcard/difai-ui.xml');
    adb('shell', 'uiautomator', 'dump', '/sdcard/difai-ui.xml');
    try { xml = adb('exec-out', 'cat', '/sdcard/difai-ui.xml'); } catch { xml = ''; }
  }
  if (!xml.includes('<hierarchy')) throw new Error('uiautomator could not read the screen (3 tries)');
  const nodes: UiNode[] = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = Object.fromEntries([...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(a.bounds ?? '');
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number) as [number, number, number, number];
    nodes.push({
      text: decode(a.text ?? ''),
      desc: decode(a['content-desc'] ?? ''),
      clazz: (a.class ?? '').split('.').pop() ?? '',
      clickable: a.clickable === 'true',
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      top: y1,
      bottom: y2,
    });
  }
  return nodes;
}

const matches = (v: string, want?: string | RegExp) =>
  want === undefined || (typeof want === 'string' ? v === want : want.test(v));

export function find(sel: Selector, nodes = dump()): UiNode | undefined {
  const hits = nodes.filter((n) =>
    matches(n.text, sel.text) && matches(n.desc, sel.desc) && (!sel.clazz || n.clazz === sel.clazz)
    && n.y >= (sel.minY ?? 0) && n.bottom > n.top);
  return hits[sel.index ?? 0];
}

const describe = (s: Selector) => JSON.stringify(s, (_k, v) => (v instanceof RegExp ? String(v) : v));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(sel: Selector, timeout = 20_000): Promise<UiNode> {
  const end = Date.now() + timeout;
  for (;;) {
    const n = find(sel);
    if (n) return n;
    if (Date.now() > end) throw new Error(`not on screen within ${timeout} ms: ${describe(sel)}`);
    await sleep(700);
  }
}

export async function waitGone(sel: Selector, timeout = 15_000): Promise<void> {
  const end = Date.now() + timeout;
  while (find(sel)) {
    if (Date.now() > end) throw new Error(`still on screen after ${timeout} ms: ${describe(sel)}`);
    await sleep(700);
  }
}

export const isShown = (sel: Selector) => !!find(sel);

export function keyboardShown(): boolean {
  return /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'));
}

let screenH = 0;
export function screenHeight(): number {
  if (!screenH) screenH = Number(/x(\d+)/.exec(adb('shell', 'wm', 'size'))?.[1] ?? 1600);
  return screenH;
}

/** Bottom edge of the tappable area: above the sidebar's account panel when
 *  the sidebar is open, else above the app's bottom dock. Bounds in the tree
 *  include parts hidden under those overlays, so taps must stay above them. */
function safeBottom(nodes: UiNode[]): number {
  const panel = nodes.find((n) => n.text === 'AI DOCUMENTS' && n.bottom > n.top);
  if (panel) return panel.top - 60;
  // A form's pinned footer: [submit] stacked above [Cancel].
  const cancel = nodes.find((n) => n.clazz === 'Button' && n.text === 'Cancel' && n.bottom > n.top);
  if (cancel) {
    const submit = nodes.find((n) => n.clazz === 'Button' && n !== cancel && Math.abs(n.x - cancel.x) < 20
      && n.top < cancel.top && n.top > cancel.top - 160);
    return (submit ?? cancel).top - 20;
  }
  const dock = nodes.find((n) => n.clazz === 'Button' && n.desc === 'Home' && n.bottom > n.top);
  return (dock ? dock.top : screenHeight() * 0.85) - 30;
}

function swipe(x: number, fromY: number, toY: number): void {
  adb('shell', 'input', 'swipe', String(x), String(fromY), String(x), String(toY), '400');
}

/** Taps where `sel` is, no scrolling: for pinned controls (form footer, dock). */
export async function tapPinned(sel: Selector, timeout?: number): Promise<UiNode> {
  const n = await waitFor(sel, timeout);
  adb('shell', 'input', 'tap', String(n.x), String(n.y));
  await sleep(700);
  return n;
}

/** Waits for `sel`, scrolls it into the visible area, taps its centre. */
export async function tap(sel: Selector, timeout = 8_000): Promise<UiNode> {
  // Wait for it to load; if it never shows, it may be below/above the fold.
  await waitFor(sel, timeout).catch(() => undefined);
  let misses = 0;
  for (let i = 0; i < 16; i++) {
    const nodes = dump();
    const n = find(sel, nodes);
    const bottom = safeBottom(nodes);
    if (!n) {
      if (++misses > 12) break;
      // Swiping with the keyboard up would type on it: wait instead.
      if (keyboardShown()) { if (misses > 3) break; await sleep(1000); continue; }
      const x = nodes.some((m) => m.text === 'AI DOCUMENTS' && m.bottom > m.top) ? 260 : 360;
      if (misses <= 6) swipe(x, bottom - 40, bottom - 540); // scroll down
      else swipe(x, 400, 900); // then back up
      await sleep(900);
      continue;
    }
    if (n.y > bottom) swipe(n.x, bottom - 40, Math.max(bottom - 40 - Math.min(n.y - bottom + 200, 500), 300));
    else if (n.y < 170) swipe(n.x, 400, 400 + Math.min(170 - n.y + 150, 500));
    else {
      adb('shell', 'input', 'tap', String(n.x), String(n.y));
      await sleep(700);
      return n;
    }
    await sleep(900);
  }
  throw new Error(`could not scroll into view: ${describe(sel)}`);
}

/** Types into the focused field. Quoted for the device shell; spaces as %s. */
export function type(text: string): void {
  const escaped = text.replace(/%/g, '\\%').replace(/ /g, '%s').replace(/'/g, `'\\''`);
  adb('shell', `input text '${escaped}'`);
}

export const key = (name: 'BACK' | 'HOME' | 'ENTER' | 'TAB' | 'ESCAPE') => adb('shell', 'input', 'keyevent', `KEYCODE_${name}`);

/** Scrolls the page until `sel` is on screen. */
export async function scrollTo(sel: Selector, maxSwipes = 8): Promise<UiNode> {
  for (let i = 0; i <= maxSwipes; i++) {
    const n = find(sel);
    if (n) return n;
    // Slow drag, no fling: a fast swipe coasts past short lists between dumps.
    adb('shell', 'input', 'swipe', '360', '1100', '360', '600', '900');
    await sleep(600);
  }
  throw new Error(`not found after scrolling: ${describe(sel)}`);
}

export function launchApp(): void {
  adb('shell', 'monkey', '-p', APP_PKG, '-c', 'android.intent.category.LAUNCHER', '1');
}

export function screenshot(path: string): void {
  writeFileSync(path, execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
}

/** All visible text + descriptions, for assertions and failure messages. */
export const screenText = (nodes = dump()) => nodes.flatMap((n) => [n.text, n.desc]).filter(Boolean);
