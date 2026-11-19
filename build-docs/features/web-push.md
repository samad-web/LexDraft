# Phone notifications (web push) — owner 2026-11-19

## Purpose
Owner: "after WhatsApp the app notification should also push in the phone notification bar". Every in-app notice (hearing reminders, assigned work, eCourts updates, credits…) also appears in the device notification bar. Email reminders: not wanted (owner).

## Architecture
- DB 0119 (additive): `push_subscriptions(user_id, endpoint unique, p256dh, auth, user_agent, last_ok_at)`.
- `services/push.service.ts` (web-push lib, VAPID keys `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` in server env; blank = off). `notificationsStore.create` pushes to the user's devices after the insert (fire-and-forget). Gone devices (404/410) are pruned.
- Routes (user-scoped, auth only): `GET /notifications/push/key`, `POST /notifications/push/subscription`, `POST /notifications/push/unsubscribe`.
- Web: `public/sw.js` (push + click → open `/app/<view>`; no caching), `public/manifest.webmanifest` (+ link), worker registered at start (not in the native app), Settings → "Phone notifications" turn on/off.

## Reach
- Android Chrome and desktop browsers: yes. iPhone: only after Add to Home Screen (iOS 16.4+). Android APK (Capacitor WebView): no — needs FCM, Android is parked.

## Impact map
- notifications.service (every notice), new table, env, web entry, Settings, nginx serves sw.js under `location /` (no-store).

## Edge cases
- Permission denied → "blocked" with how to fix. Server keys missing → "not switched on yet", nothing asked.
- Shared browser: the device follows the last account that turned it on.
- Daily-updated notices (hearing in 3 days → today) push once per day each.
- Only https endpoints accepted.

## Acceptance criteria
- AC1 subscribed device gets each new notice with the page to open. AC2 https only. AC3 gone devices pruned. AC4 unsubscribe own only; no keys = no send. AC5 device moves to last subscriber. AC6 Settings control + worker/manifest served. AC7 server off → plain message.
