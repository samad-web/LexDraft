# limitation-alerts

## Purpose
Today limitation deadlines only appear as a dashboard count. A missed limitation is malpractice; the advocate must be told at 90, 30, 7 and 1 day(s).

## Architecture
- pg-boss cron `limitation.alerts`, `0 9 * * *` Asia/Kolkata.
- Query open `limitations` whose `deadline - today ∈ {90, 30, 7, 1, 0}` (IST dates). Recipients = existing case recipient resolution (`resolveCaseRecipients`) or the creator when not case-linked.
- `notificationsStore.create({ dedupeKey: 'limitation:<id>:<days>', view: 'limitation', tone: days <= 7 ? 'vermillion' : 'cobalt' })` → push via mobile-push. Email for ≤7 days through the existing `email.send` path.

## Impact map
- limitations table (read only; confirm "done/filed" column name before writing the query), jobs.service.ts, notifications.service.ts, email templates, dashboard-today (unchanged, still the 7-day count).

## Edge cases
- Deadline already passed → one "overdue" notice on day 0 only, no daily spam.
- Server down at 09:00 → pg-boss does NOT replay a missed cron, so the job runs hourly 09:00–21:00 IST; the dedupe key makes later runs send only what was missed.
- Deadline edited → new day counts trigger normally; stale ones are harmless (dedupe per days value).
- Holidays: deadline as stored; computing court-holiday extension stays in LimitationCalculator, not here.

## Acceptance criteria
- A limitation 30 days out produces exactly one notification on that day, even if the job runs twice.
- ~~Filed/closed limitations never alert.~~ Not possible yet: `limitations` has no status column. User accepted alerting as designed (2026-11-08); a "mark as filed" feature (migration) can follow.
- Days computed in IST (a 23:30 UTC run doesn't shift the day).

## Built (2026-11-08)
- `services/deadline-alerts.service.ts` + job `deadline.alerts` (`0 9-21 * * *`, Asia/Kolkata), shared with task alerts (task-alerts.md).
- Channels: bell (in-app) for every alert; email when 7 days or fewer. Push waits for mobile-push (not built).
- Recipients: matter owner (`cases.created_by_user_id` via `case_id`), else firm active users, admins first, up to 5.
- Already-notified check (user + dedupe key) before creating, so a re-run never re-sends the email or re-marks the bell unread.
