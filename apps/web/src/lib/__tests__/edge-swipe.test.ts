import { describe, expect, it } from 'vitest';
import { EDGE, isDrawerWidth, swipeDone, swipeStart } from '../edge-swipe';

// ios-sidebar-swipe acceptance criteria 1-4.
const at = (x: number, y = 400, extra: Partial<{ onHandle: boolean; inOverlay: boolean }> = {}) =>
  ({ x, y, onHandle: false, inOverlay: false, ...extra });
const phone = { open: false, drawerMode: true };

describe('AC1: swipe in from the left edge opens the menu', () => {
  it('starts only near the edge, on the handle, or on the icon rail', () => {
    expect(swipeStart(at(4), phone)?.mode).toBe('open');
    expect(swipeStart(at(EDGE), phone)?.mode).toBe('open');
    expect(swipeStart(at(EDGE + 1), phone)).toBeNull();
    expect(swipeStart(at(200, 400, { onHandle: true }), phone)?.mode).toBe('open');
  });
  it('a mostly sideways move of 40 px opens; a scroll down does not', () => {
    const s = swipeStart(at(5), phone)!;
    expect(swipeDone(s, 30, 405)).toBe(false);
    expect(swipeDone(s, 50, 410)).toBe(true);
    expect(swipeDone(s, 60, 520)).toBe(false); // vertical scroll
  });
});

describe('AC2: swipe the open menu back to close it', () => {
  it('from anywhere while open, leftwards', () => {
    const s = swipeStart(at(200), { open: true, drawerMode: true })!;
    expect(s.mode).toBe('close');
    expect(swipeDone(s, 150, 402)).toBe(true);
    expect(swipeDone(s, 260, 402)).toBe(false);
  });
});

describe('AC3/AC4: never where the touch belongs to something else', () => {
  it('not on the pen screen or dialogs, and not on a computer-width screen', () => {
    expect(swipeStart(at(4, 400, { inOverlay: true }), phone)).toBeNull();
    expect(swipeStart(at(4), { open: false, drawerMode: false })).toBeNull();
    expect(isDrawerWidth(390)).toBe(true); // iPhone
    expect(isDrawerWidth(834)).toBe(true); // iPad portrait
    expect(isDrawerWidth(1024)).toBe(false); // iPad landscape / computer: menu always shown
  });
});
