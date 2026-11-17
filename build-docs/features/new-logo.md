# new-logo

## Purpose
Owner approved a new logo on 2026-11-16 (the one in the product video): "Draft Lines", a D outline with three ragged text lines and a cursor bar, plus a hand-built "DifAi" wordmark whose last i-dot is the cursor. Replace the old traced wordmark everywhere in the web app. Source files: owner's `DifAi Logo/final/` (usage guide, SVGs, PNGs, loader.html); copied into the repo, never referenced from OneDrive.

## v2: the symbol is the D (owner, 2026-11-17)
- Owner: the full lockup read "D DifAi" (symbol + a wordmark starting with D). Rule: the symbol IS the letter D.
- Wordmark = symbol at cap height (scale 1: symbol 0-100 = "ifAi" cap 0-100), same baseline, then the original "ifAi" paths moved +6.32 so the D-i space is 9 units (round-to-straight pair; the old lettered D had 8.68). Width 272.32 x 101.5. Checked scales 0.96 / 1.0 / 1.04 and gaps 9 / 11 at 96, 36, 22 and 16 px: 1.0 + 9 reads as one word; 0.96 looks small next to f/A, 11 too loose.
- Compact decision: no separate plain-lettering wordmark any more. The same symbol+ifAi word is used at every size (min 16 px tall), because a second, lettered D would break the "symbol is the D" rule and the symbol stays legible at 16 px. The owner's compact-*.svg now hold the same drawing; v1 files kept as *-v1.svg.
- FullLogo removed; `Wordmark` (with `motion`) is the one lockup. Never set the symbol beside or above the word.

## Architecture
- `components/brand/Logo.tsx` is the only React source of the drawing (all `currentColor`, so it follows light/dark):
  - `Wordmark` ("DifAi" with the symbol as its D; `motion` plays the signature animation once; unsized it is max(0.74em, 16px) tall),
  - `LogoMark` (symbol; below 24 px it uses the pixel-drawn favicon-16 drawing, per the usage guide),
  - `LogoLoader` (looping loader motion).
- Motion CSS in globals.css (`.difai-sig`, `.difai-loader`): lines type in left to right with a stagger, cursor blinks, about 1.15 s; reduced motion shows the still mark.
- Non-React copies, kept in step by tests: `index.html` boot loader, `public/favicon.svg` (= favicon-16), `public/offline.html`, `seo/render.mjs` (`LOGO_SVG`), API GST invoice header.
- Rasterised: `favicon-32.png`, `apple-touch-icon.png` (180, from app-icon-512.svg), `og-image.png` (1200x630, same copy as before), `brand/app-icon-512.png` (JSON-LD Organization logo).

## Lockup choice (owner's guide: pick by space)
- Wordmark: landing header (28 px), sign-in head (40/34/30 px), Android welcome (64 px, motion), launch splash (motion), app + admin sidebar, sign-in art panel, onboarding, sign-up, app lock, intro modal, product tour, terms consent, legal pages, share page, SEO header (28 px), offline page, invoice (24 px), og-image.
- Icon: collapsed sidebar rail (26 px). Favicons: favicon-16 drawing (SVG, follows OS theme) + 32 px PNG.
- Loader motion: route loader (PageLoader) and the first-paint boot loader; the old bar is gone.

## Impact map
- Logo.tsx: every importer (Sidebar, AdminSidebar, AppLock, IntroModal, LandingHeader, PageLoader, Splash, TermsConsent, ProductTour, AppWelcomeView, AuthView, LegalView, OnboardingView, ShareOpenView, SignupView). API of `Wordmark`/`LogoMark` kept (no `ink` prop: nobody passed one); `BRAND_PATHS` replaced by `ICON`/`ICON_16`/`WORD`.
- Splash.tsx: the "Di grows into DifAi" moves replaced by `FullLogo motion`; courtroom, timing, tap-to-skip and reduced motion unchanged.
- globals.css: auth logo heights, splash sizes, page-loader bar removed, motion classes added.
- index.html / seo/render.mjs: favicon links (+32 px PNG), JSON-LD logo URL, header logo.
- apps/api subscription-invoice.service.ts: header markup only (PDF renders inline SVG; no behaviour change).
- Not changed: Android source (`apps/web/android`, parked): launcher icons `res/mipmap-*/ic_launcher*.png`, `res/drawable/ic_launcher_*.xml`, Android 12 splash icon and Play listing icon would need the new app-icon-foreground/background SVGs and PNGs.

## Edge cases
- Dark mode / dark sidebar: currentColor everywhere; favicon follows the OS theme; PNGs are fixed ink on a solid ground.
- Small sizes: below 24 px the symbol switches to the favicon drawing; compact never below 14 px.
- Reduced motion: still mark in splash, loader, boot loader and welcome.
- Screen readers: lockups are `role="img"` named "DifAi"; the splash logo is decorative (the splash names itself); loaders are hidden (their status text announces).

## Acceptance criteria
- No old wordmark geometry left in the web app; every logo spot renders the new drawing in light and dark, desktop and phone.
- Favicon, apple-touch-icon, og:image and JSON-LD logo point at new files that exist with the right sizes.
- Loader and splash use the signature motion and stop under reduced motion.
- Tests: `brand-logo.test.tsx`, `page-loader.test.tsx`, gst-invoices header test.
