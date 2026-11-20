# Android app push (owner, 2026-11-20: "android app push is must")

## Purpose
Web push does not work inside the Android app (a Capacitor WebView), so
reminders and other notices never reached the phone's notification bar there.

## Architecture
- **App:** `@capacitor/push-notifications` (Firebase Cloud Messaging). After
  sign-in on native, `lib/native-push.ts` asks for permission (Android 13+),
  registers, and sends the FCM token to `POST /api/notifications/push/native`.
  Tapping a notification opens its `url` in the app.
- **Server:** tokens live in `push_subscriptions` with `kind = 'fcm'`
  (0120 adds the column, default 'web'). `push.service.sendToUser` sends web
  rows with web-push and fcm rows via `lib/fcm.ts` (FCM HTTP v1; OAuth token
  from a service-account JWT signed with the installed `jsonwebtoken`,
  cached ~50 min; no new server dependency).
- **Config:** server env `FCM_SERVICE_ACCOUNT` = base64 of the Firebase
  service-account JSON (secret; kept in /etc/lexdraft/secrets.env). App needs
  `android/app/google-services.json` (from the Firebase project, package
  in.sirahdigital.difai). Without either, everything is a quiet no-op.

## Impact map
- notifications.routes (new route), push.service (branch by kind), env.ts,
  App.tsx (one call after sign-in), Android build (google-services plugin is
  already conditional on the JSON file), Play Store: a new app version.

## Edge cases
- Token rotates → re-registered on every app start; endpoint unique.
- FCM says UNREGISTERED/404/INVALID token → row deleted.
- Permission denied → nothing sent; bell still works.
- Same phone used by two accounts → token belongs to the last signed-in user.
- FCM not configured on the server → token still stored; sends skipped.

## Acceptance criteria
1. On a signed-in Android app, a reminder shows in the notification bar.
2. Tapping it opens the right page.
3. A dead token is removed after the first failed send.
