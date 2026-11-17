# new-logo

## Purpose
Owner approved a new logo on 2026-11-16 (the one in the product video): "Draft Lines", a D outline with three ragged text lines and a cursor bar, plus a hand-built "DifAi" wordmark whose last i-dot is the cursor. Replace the old traced wordmark everywhere in the web app. Source files: owner's `DifAi Logo/final/` (usage guide, SVGs, PNGs, loader.html); copied into the repo, never referenced from OneDrive.

## Architecture
- `components/brand/Logo.tsx` is the only React source of the drawing (all `currentColor`, so it follows light/dark):
  - `FullLogo` (symbol + wordmark; `motion` plays the signature animation once),
  - `Wordmark` (compact: wordmark only),
  - `LogoMark` (symbol; below 24 px it uses the pixel-drawn favicon-16 drawing, per the usage guide),
  - `LogoLoader` (looping loader motion).
- Motion CSS in globals.css (`.difai-sig`, `.difai-loader`): lines type in left to right with a stagger, cursor blinks, about 1.15 s; reduced motion shows the still mark.
- Non-React copies, kept in step by tests: `index.html` boot loader, `public/favicon.svg` (= favicon-16), `public/offline.html`, `seo/render.mjs` (`LOGO_SVG`), API GST invoice header.
- Rasterised: `favicon-32.png`, `apple-touch-icon.png` (180, from app-icon-512.svg), `og-image.png` (1200x630, same copy as before), `brand/app-icon-512.png` (JSON-LD Organization logo).

## Lockup choice (owner's guide: pick by space)
- Full: landing header (36 px), sign-in head (52/44/36 px), Android welcome, launch splash.
- Compact: app + admin sidebar, sign-in art panel, onboarding, sign-up, app lock, intro modal, product tour, terms consent, legal pages, share page, offline page, invoice.
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
