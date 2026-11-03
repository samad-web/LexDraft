# launch-splash

## Purpose
User request 2026-11-03: opening the app shows an animation — "DifAi, powered by Sirah Digital" over a working courtroom.

## Design
- Ink line-art courtroom (bench, judge's chair, scales on the wall, arched windows, columns, clerk's table with files, advocate at the lectern, two ceiling fans), faded behind the logo. Lines draw themselves in; fans turn; scales sway; gavel taps once.
- Logo: "Di" appears centred, the i-dot drops, then the word slides left as "fAi" rises in → full **DifAi**. "Powered by Sirah Digital" fades in below.
- ~2.4 s, then fades out. Tap anywhere skips. Reduced motion → static logo + scene for 0.9 s.
- Generic courtroom only: no real court building, no State Emblem / Ashoka Lion (Play listing says "not affiliated with any court"; the emblem's use is legally restricted). Black and white, no photo (weight + colour rule).

## Architecture
- `components/Splash.tsx` (+ `.splash*` in globals.css). Rendered in main.tsx above `AppLock`; native cold start only (`?splash` shows it on web for screenshots).
- `useSplashStore.showing`: AppLock waits for it before raising the fingerprint prompt, so the prompt doesn't cover the animation.
- Android 12+ still shows its own system icon splash first (white, same background), then this.

## Impact map
- main.tsx, AppLock.tsx (prompt timing), globals.css, brand paths (Logo.tsx, read only). No API, no data.

## Edge cases
- Resume from background → no splash (cold start only). Deep link/push cold start → splash then route (router already mounted underneath).
- Slow device → animation is CSS only; app loads underneath meanwhile.

## Acceptance criteria
- Shows once per cold start on native; never on web without `?splash`; gone by ~2.7 s or on tap; reduced motion respected; lock prompt appears only after it; screenshot reviewed at 390 px.
