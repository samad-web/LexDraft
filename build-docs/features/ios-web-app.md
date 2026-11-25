# iPhone and iPad friendly web app (ios-web-app)

**Status:** BUILT 2026-11-25 (owner "yes proceed": Level 1 now, App Store app later). Not deployed.

## Purpose
Advocates use iPads (with Apple Pencil) and iPhones. DifAi should feel like an app there without an App Store app: Home Screen install, screens that fit, Pencil markup that works.

## Decisions
- **Level 1 now** (website works like an app); **Level 2 later** (App Store app: needs an Apple Developer account, a Mac or a cloud Mac build, Sign in with Apple, no in-app selling as with the Play app). Recorded so it isn't redone.
- **No `viewport-fit=cover`.** iOS then keeps every screen clear of the notch, Dynamic Island and home bar by itself, including iPhone landscape. With cover, every fixed bar would need manual padding. The existing `env(safe-area-inset-*)` rules stay (harmless, 0).
- Status bar style `default`; `format-detection telephone=no` so iOS doesn't turn case numbers and amounts into phone links.

## What changed
- `index.html`: Home Screen app tags (`apple-mobile-web-app-capable`, title, status bar), no phone-number links.
- `lib/ios.ts`: `isIosDevice()` also recognises iPads (iPadOS 13+ says it is a Mac; it's a "Mac" with a touch screen). `usePush` uses it, so iPads now get the "Add to Home Screen to get notifications" prompt (wording now "iPhone or iPad").
- `globals.css`: every `100vh` height has a `100dvh` twin, so full-height screens fit under Safari's address bar on iPhone.
- Review copy on iPad/iPhone: full-screen reading mode; notes become a slide-up panel below 900 px (iPad portrait, iPhone) and a column on wider screens; Pencil long-press shows no iOS callout or text selection; notes say Apple Pencil Scribble can write into them.
- Review copy robustness (found by the WebKit run): a pen stroke kept only its first point when the browser returned no coalesced events (now uses the event itself); pointer capture refusal no longer stops a stroke; the reading area keeps scrollbar space and ignores sub-2px width changes.

## Follow-up 2026-11-25 (owner: "blank space in the header and footer when scrolling")
- Cause: Safari's rubber-band bounce shows the bare area above the header / below the footer, and `theme-color` was fixed at near-black, so the light theme showed a dark band in Safari's bars.
- Fix: `html, body { overscroll-behavior-y: none }` inside `@supports (-webkit-touch-callout: none)` (iOS only, so Android keeps pull-to-refresh); `lib/theme-color.ts` keeps `<meta name="theme-color">` equal to the page background in light and dark (retries until the stylesheet has loaded; follows theme switches).
- AC6: no blank band when pulled at the top or bottom on iPhone/iPad. AC7: Safari's bars match the page in both themes.

## Impact map
- Every page (index.html meta, the dvh twins): only browsers that support dvh change; others ignore it.
- `usePush.ts` / `NotifyPrompt` / Settings wording: iPads now see the install prompt; Android/desktop unchanged.
- Review copy files only for the rest.

## Acceptance criteria
1. Added to the Home Screen, DifAi opens full-screen with its icon and name.
2. On iPad: Pencil draws full lines, a finger scrolls, notes slide up in portrait and sit beside the pages in landscape.
3. On iPhone: no sideways scrolling; full-height screens aren't cut off by the address bar.
4. iPads are recognised as iOS (notifications prompt).
5. On a computer: the mouse draws.

## Known open item
- Playwright's WebKit build for Windows hangs on the signed-in app at desktop sizes (any page, also before this change; mobile sizes are fine). It may be a quirk of that WebKit build, not real Safari: needs a check in Safari on a Mac.
