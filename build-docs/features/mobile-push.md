# mobile-push

## Purpose
Hearing changes and deadlines reach the advocate when the app is closed.

## Architecture
- Client: `@capacitor/push-notifications` (+ `google-services.json`). After sign-in: request permission → `register` → `POST /v1/push/devices {token, platform}`. On sign-out: `DELETE /v1/push/devices/:token`. Tap → `notification.data.view` → router.
- Migration 0100 (additive): `push_devices(id, user_id → users on delete cascade, firm_id, token unique, platform, created_at, last_seen_at)`.
- Server: `notificationsStore.create()` → on success enqueue `push.send {notificationId}` → handler loads row + tokens → FCM HTTP v1 (`google-auth-library` if installed, else signed JWT). Title/body only — no client names in the payload body beyond what the in-app title already says.
- Secret: `FCM_SERVICE_ACCOUNT` (JSON) in server env; absent → push is a no-op (dev/web unaffected).

## Impact map
- notifications.service.ts (one enqueue after insert; failure must not fail the insert), jobs.service.ts (new handler), routes (2 endpoints, auth required), ecourts-sync-summary tests (insert mock — enqueue must be tolerated), DPDP export/delete (include push_devices), android build (google-services plugin), CORS unchanged.

## Edge cases
- Permission denied → in-app feed still works; Settings shows "Notifications off — enable in Android settings".
- FCM `UNREGISTERED`/`INVALID_ARGUMENT` → delete that token. 5xx → pg-boss retry with backoff.
- Same token re-registered by another user (shared phone) → upsert moves it to the new user.
- Dedupe upsert (same dedupe_key) → re-pushes; acceptable because it means the content changed.

## Acceptance criteria
- Signed-in device receives a push within 1 min of a notification row being created; tap opens its `view`.
- Sign-out removes the token; no pushes after.
- No FCM secret → no errors, no jobs fail.
- Tokens never returned by any API or logged in full.
