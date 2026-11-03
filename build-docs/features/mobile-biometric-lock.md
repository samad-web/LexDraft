# mobile-biometric-lock

## Purpose
A lost or shared phone must not open an advocate's matters. Required before any offline cache exists.

## Architecture
- Plugin: @aparajita/capacitor-biometric-auth 10 (Capacitor 8, device-credential fallback). Native only; web unchanged.
- `lib/app-lock.ts` (not lib/native/: lib/native.ts already owns that import path): on app start and on `App` `resume` after ≥60 s in background → full-screen `LockScreen` overlay (Chambers, ink) → `authenticate({ allowDeviceCredential: true })`.
- Setting in Settings → Security: on by default for new installs; turning it off requires a successful unlock first.
- Recents thumbnail off via `setRecentsScreenshotEnabled(false)` (Android 13+). Not FLAG_SECURE: that would also block screenshots advocates use to share cause lists. Android 12 and older still show the thumbnail.

## Impact map
- `lib/native.ts` (back button must not dismiss the lock), `main.tsx` (AppLock wraps App), SettingsView (toggle), AndroidManifest (`USE_BIOMETRIC`), MainActivity (recents thumbnail).

## Edge cases
- No biometrics enrolled → device PIN/pattern; no screen lock at all → show "Set a screen lock to protect client data", allow in (can't lock without one), warn in Settings.
- 5 failed biometrics → OS falls back to PIN. Cancel → stay locked, "Unlock" button.
- Signed out → no lock (nothing to protect). Deep link/push tap while locked → unlock first, then route.

## Acceptance criteria
- Cold start and resume after 60 s show the lock; resume under 60 s doesn't.
- No case data visible behind the lock or in the recents thumbnail.
- Hardware back on the lock exits the app, never reveals it.
- Works in light and dark; screen-reader labels on Unlock.
