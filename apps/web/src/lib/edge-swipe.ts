// ios-sidebar-swipe: open the menu by swiping in from the left edge (and close it
// by swiping it back), like an iPhone / iPad app. Pure decisions, kept apart
// from the DOM so they can be tested.

/** A swipe may start this close to the left edge (CSS px). Safari's own
 *  "back" swipe owns the very edge in a Safari tab; from the Home Screen there
 *  is no such gesture, so the whole strip works there. */
export const EDGE = 28;
const OPEN_DX = 40;

export type SwipeStart = { x: number; y: number; mode: 'open' | 'close' } | null;

/** Where a touch must start to count: the left edge strip (or the menu
 *  handle / icon rail) to open; anywhere on the open menu to close. Never on a
 *  full-screen tool (the pen screen, dialogs) where the touch is the user's. */
export function swipeStart(t: { x: number; y: number; onHandle: boolean; inOverlay: boolean },
  s: { open: boolean; drawerMode: boolean }): SwipeStart {
  if (!s.drawerMode || t.inOverlay) return null;
  if (s.open) return { x: t.x, y: t.y, mode: 'close' };
  if (t.x <= EDGE || t.onHandle) return { x: t.x, y: t.y, mode: 'open' };
  return null;
}

/** A mostly sideways move far enough in the right direction. */
export function swipeDone(start: NonNullable<SwipeStart>, x: number, y: number): boolean {
  const dx = x - start.x;
  const dy = Math.abs(y - start.y);
  if (dy > Math.abs(dx)) return false;
  return start.mode === 'open' ? dx >= OPEN_DX : dx <= -OPEN_DX;
}

/** The menu is a drawer (not always on screen) below 1024 px: phones and iPads. */
export const isDrawerWidth = (w: number) => w < 1024;
