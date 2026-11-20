# Reminders (owner, 2026-11-20)

## Purpose
Advocates must not miss a hearing. Automatic hearing reminders existed (09:00
IST, 3 days → today), but: the Court Diary "remind N days before" field was
saved and never fired; no reminder could be set by hand; nothing came the
evening before; turning on device notifications was buried in Settings.

## Architecture
- **Table `reminders`** (0120, additive): firm_id, user_id, case_id (nullable),
  title, note, remind_at timestamptz, sent_at. A reminder belongs to the user
  who set it.
- **API** `/api/reminders` (requireAuth + active plan + matter.view):
  `GET ?caseId=` (own, upcoming first), `POST {caseId?, title, note?, remindAt}`,
  `DELETE /:id` (own only). remindAt must be in the future and within 2 years;
  caseId must belong to the user's firm.
- **Job `reminders.due`** every 5 min (IST cron): claims due rows
  (`for update skip locked`), marks sent, then creates a bell notification
  (which also pushes to web + Android devices). Opens the case when linked.
- **Evening run:** replaced on 2026-11-20 by the evening daily brief (one
  "Tomorrow: N hearings" notice per advocate, see daily-brief.md).
- **Diary reminders:** the 09:00 run also fires diary entries whose
  `next_hearing_date - reminder_offset_days = today` (firm recipients;
  diary entries have no owner column).
- **Web UI:** "Remind me" in the hearing dialog (automatic, or also on a date
  and time); a Reminders card on the case Overview (list, add, delete);
  a one-time "Turn on notifications" banner, plus a row in the bell panel.

## Impact map
- `notifications.service` (create → push): unchanged contract; new callers.
- `push.service`: also sends to Android (see android-push.md).
- `jobs.service` runSlot: morning adds diary reminders, evening adds
  tomorrow's hearings. A failure in either is caught and logged; the sync
  result is unaffected.
- `NewHearingModal`, `CaseDetailView`/`CaseTabs`: new optional UI; saving a
  hearing never fails because a reminder failed (toast instead).
- Case delete → reminders cascade. User delete → cascade.

## Edge cases
- Past or >2-year remindAt → 400. Unknown/other-firm caseId → 404.
- Job runs late or twice → `skip locked` + `sent_at` = sent once.
- Notification write fails → row stays sent (no spam loop); logged.
- Push off / no devices → bell only.
- Time zone: the browser sends an ISO instant; the server never guesses.

## Acceptance criteria
1. A reminder set for a time fires within 5 minutes of it: bell + device push.
2. Diary "remind N days before" fires on that day at ~09:00 IST.
3. Cases with a hearing tomorrow are in the evening brief (daily-brief.md AC3).
4. Users can list and delete only their own reminders.
5. The banner shows only when notifications are supported and off, and never after dismiss/turn-on.
