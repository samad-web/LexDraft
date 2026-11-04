# mobile-live-web

## Purpose
User request 2026-11-04: changes should reach the Play Store app automatically. User chose "server driven UI": the app loads the live website instead of a bundled copy.

## Design
- `capacitor.config.ts` → `server.url = https://difai.sirahdigital.in`, `server.errorPath = offline.html`.
- Every web deploy reaches the app on its next open (index.html is `no-store`). Only native changes (new plugin, permission, icon, name, SDK) need a Play release.
- `public/offline.html`: self-contained "Can't reach DifAi / Try again" page, served from the APK by Capacitor's local server (`isErrorUrl`) when the site can't load (offline, DNS, 5xx).
- Capacitor injects the native bridge into the remote page, so `isNativePlatform()`, plugins (Google sign-in, biometric lock, dictation, share, filesystem, back button) keep working.

## Impact map
- capacitor.config.ts, public/offline.html (also served on the website, harmless), android build.gradle (2.2, code 13).
- API: app origin moves from https://localhost to the site origin, so CORS no longer applies; keep https://localhost in CORS_ORIGINS for old APKs.
- localStorage is per origin: users are signed out once after updating to 2.2 (the token, app-lock and UI prefs lived under https://localhost).
- Deploys now change the app instantly: a broken web deploy breaks every phone (no rollback).
- Plugins: web code may only call a plugin the installed APK has. A new native plugin must ship in a Play release before (or guarded by `Capacitor.isPluginAvailable`) the web code that calls it.
- mobile-offline-cache.md: in conflict; without bundled assets the app can't open offline (it shows offline.html).

## Edge cases
- Offline / site down → offline.html; Try again reloads the site.
- Slow network → white screen until first paint (system splash covers cold start).
- External links (other hosts) → system browser (Capacitor default).

## Acceptance criteria
- 2.2 opens the live site with the Android-only behaviour intact (no landing page, no purchase UI, splash, app lock, native Google sign-in, dictation, downloads to the share sheet).
- Airplane mode → offline.html; Try again after reconnecting → app.
- A web deploy shows up on the phone after closing and reopening the app, with no reinstall.
