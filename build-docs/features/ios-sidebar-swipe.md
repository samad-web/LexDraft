# Open the menu by swiping from the edge (ios-sidebar-swipe)

**Status:** BUILT 2026-11-25 (owner: "touching the side panels should open the sidebar, with an icon there"). Not deployed; no migration.

## What the advocate sees
- iPhone (and any phone): a small tab with the menu icon on the left edge, mid-screen. Tap it, or swipe in from the left edge, to open the menu. Swipe the open menu back to the left (or tap outside) to close it.
- iPad portrait (768-1023 px): the icon rail is already on the left edge and acts as the handle. Swiping from the rail opens the full menu.
- iPad landscape and computers (1024 px and up): the menu is always shown, so there's no tab and no swipe.
- Not on the pen screen or inside dialogs: a touch there belongs to the pen or the dialog.

## Safari limit (told to the owner)
In a Safari tab, a swipe starting on the very first pixels of the screen is Safari's own "back" gesture, which a website can't take over. The tab and the rail always work. Opened from the Home Screen (added as an app) there is no Safari back gesture, so the edge swipe works from the very edge.

## Architecture
- `lib/edge-swipe.ts` (pure): where a swipe may start (28 px edge strip, the handle or the rail to open; anywhere on the open menu to close), when it counts (mostly sideways, 40 px), drawer widths (< 1024 px).
- `components/shell/EdgeSwipe.tsx`: passive document touch listeners (scrolling is never blocked) + the handle button; mounted next to `Sidebar` in `App.tsx`. Uses the existing `toggleSidebar` store action, so the scrim, Esc and close-on-navigate behave as before.
- `globals.css`: `.edge-handle` shown below 768 px only.

## Acceptance criteria
1. iPhone: the tab shows; tapping it or swiping in from the edge opens the menu.
2. Swiping the open menu to the left closes it.
3. Swipes in the middle of the page, tiny drags and vertical scrolls don't open it; the pen screen and dialogs are never affected.
4. iPad: no extra tab; swiping from the rail opens the menu. Computer: no tab.
