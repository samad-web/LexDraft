# Daily brief (owner, 2026-11-20: "the notification should be sent daily")

## Purpose
Advocates heard from DifAi only when something was close (a hearing within
3 days, a reminder, an eCourts change). The owner wants a notification every
day: a 07:00 morning brief, and an evening notice of tomorrow's hearings sent
after the 19:00 eCourts update, covering hearings from eCourts AND entered by hand.

## Owner decisions (2026-11-20)
- The morning brief arrives at 07:00 IST every day. On a quiet day it reads "No hearings today. Next: <case> on <date>".
- The evening brief covers tomorrow's hearings and is sent after the 19:00 eCourts run.
- Each advocate can switch the brief off in Settings.

## Architecture
- **0121 (additive):** `users.daily_brief boolean not null default true`.
- **`daily-brief.service.ts`**
  - `hearingsOn(date)`: union of three sources, deduped per user by case (else by label):
    1. `cases.next_hearing`: eCourts-synced or edited, Active/Pending, not deleted.
    2. `hearings.hearing_date`: manual or eCourts history, status not 'past'.
    3. `diary_entries.next_hearing_date`.
  - Recipients:
    - `hearings.assigned_to_user_id`, else the case's lead advocate, else its creator.
    - Without any of those: the firm's recipients (the existing `resolveCaseRecipients` rule).
    - Diary entries have no owner, so they go to the firm's recipients.
  - The **morning** brief adds tasks due or overdue (assignee_user_id) and today's unsent reminders.
  - `composeMorning` / `composeEvening` are pure and return `{title, body}` or null.
- **Sending:** `notificationsStore.create` gains `repeat`:
  - `'never'` (morning): insert once per user per day; a rerun never pushes twice.
  - `'if-changed'` (evening): an eCourts retry that changes tomorrow's list updates the notice and pushes again. If nothing changed, no push.
- **Schedule:**
  - Morning: the job `brief.morning` runs at cron 07:00 IST. The 15-minute watchdog reruns it between 07:00 and 08:59, so a server that was down at 07:00 still sends (`'never'` keeps this idempotent).
  - Evening: runs at the end of the evening eCourts slot (first attempt), and again after each evening retry (`'if-changed'`).
  - It replaces the per-case "Hearing tomorrow" evening notices from e065f51: one notice instead of one per case.
- **Web:** a Settings row "Daily brief" with an on/off switch. The API is `GET/PUT /api/notifications/brief`.

## Impact map
- `notifications.service` create: new optional `repeat`. The default `'always'` keeps current behaviour for every caller.
- `jobs.service`: the evening branch swaps the per-case evening reminder for the brief; there is a new morning job and the watchdog changes.
- `ecourts-sync-runs` retry: the evening brief is re-sent after an evening retry.
- `case-sync.service`: `sendEveningHearingReminders` is removed. The 09:00 3-day reminders and the WhatsApp day-before message are unchanged.
- `SettingsView`: a new row.
- `users` table: a new column. The UI hides the toggle if the API errors.

## Edge cases
- No hearings, tasks, reminders or future hearing: no morning brief (nothing useful to say).
- No hearings tomorrow: no evening brief.
- A user who switched the brief off gets neither brief; other notices are unchanged.
- An inactive or deleted user: skipped.
- A case listed in both cases.next_hearing and hearings: counted once.
- Many hearings: the body names the first 3, then "+N more".
- The tap opens the cause list (`/app/causelist`).
- Dates are always IST (`now() at time zone 'Asia/Kolkata'`), never server UTC.

## Acceptance criteria
1. At 07:00 IST each user with any hearing, task, reminder or next hearing gets one morning brief: bell + device push.
2. On a quiet day the brief says "No hearings today" and names the next hearing.
3. After the 19:00 run, users with hearings tomorrow get one evening brief listing them. It includes manual hearings, diary entries and eCourts dates.
4. Rerunning the morning brief does not push twice. An evening retry pushes again only if the list changed.
5. With the switch off, no brief is sent.
