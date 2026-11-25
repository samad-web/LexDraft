# Hearings in Apple Calendar (hearings-calendar-feed)

**Status:** BUILT 2026-11-25 (owner "yes proceed"). Not deployed; migration 0124 local only.

## Purpose
Advocates live in their phone calendar. The firm's hearings should appear in Apple Calendar on iPhone, iPad and Mac (and Google Calendar / Outlook), and keep themselves up to date, instead of a one-off .ics download.

## What the advocate sees
- Settings → **Hearings in your calendar** → **Add hearings to my calendar**. Then **Open in Apple Calendar** (webcal link: iOS/macOS ask to subscribe), **Copy link (Google / Outlook)**, **Reset link**, **Turn off**.
- Calendar page: **Add to my calendar** next to Export ICS, opens that Settings section.
- Shown plainly: Apple/Google keep a copy of case names, courts and dates in the calendar account; anyone with the link can see the hearings; Reset makes a new link.

## Architecture
- Migration **0124** (additive): `users.calendar_feed_version int` (null = off).
- Link: `/api/calendar/<userId>/<token>.ics`; token = HMAC-SHA256(storage signing secret, `calendar-feed:<userId>:<version>`), base64url 32 chars. Nothing secret stored; the same link for every device; Reset = version + 1 kills all old copies; Turn off = null.
- Public route (no sign-in; the link is the key), own IP limit of 300/min (Apple's iCloud fetches all subscribers from a few shared addresses). Wrong / old / off links all get the same 404.
- Feed: `hearingsService.listRange` (the same firm hearings as the Calendar page), 30 days back to a year ahead. Times are IST → UTC; no time → all-day event. RFC 5545: CRLF, escaping, folding at 75 bytes without splitting Tamil characters, `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` 1 hour.
- Managing the link: `GET/POST/DELETE /api/calendar-feed` (signed in, `matter.view`).

## Impact map
- `routes/index.ts`: two mounts; `middleware/rateLimit.ts`: `calendarFeedLimiter`. `hearings.service` read only (listRange also materialises case hearings, as the Calendar page does).
- `SettingsView` (new section), `CalendarView` (one link). No change to the .ics export.

## Edge cases
- A user removed from the firm: no firm → an empty calendar. A deleted user: 404.
- Server signing secret changed: every link changes (advocates add it again).
- A hearing date that isn't YYYY-MM-DD is skipped; a time like "10.30 AM" or "TBD" → all-day.
- Plan lapses: the link keeps working (it's the firm's own hearings); not blocked in v1.

## Acceptance criteria
1. Settings turns the link on; Apple Calendar subscribes via the webcal link.
2. The feed is a valid calendar: 11:15 IST shows at 11:15 in India; no time = all day; Tamil and commas survive.
3. Turning on again keeps the same link (iPhone + iPad + Mac share it).
4. Reset makes a new link and the old one stops (404); Turn off stops it.
5. Managing the link needs sign-in; the public link needs no sign-in.
