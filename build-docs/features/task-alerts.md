# task-alerts (2026-11-08)

## Purpose
An open task with a due date reminds its owner before and on the day, more often the higher its priority. Until now tasks only showed "Overdue" and "Due today" counts on the board.

## Rules (user's choice 2026-11-08: scaled by priority)
| Priority | 3 days before | 1 day before | Due day | 1 day overdue |
| --- | --- | --- | --- | --- |
| Very high | yes | yes | yes | yes |
| High | | yes | yes | yes |
| Medium | | | yes | yes |
| Low | | | yes | |

- Done tasks (`column_name = 'done'`) and tasks without a due date never alert.
- Email as well as the bell for very high and high; bell only for medium and low.
- Tone: overdue red, due today amber, earlier cobalt. Bell opens `/app/tasks`.

## Architecture
Shared with limitation alerts: `services/deadline-alerts.service.ts`, job `deadline.alerts` (see limitation-alerts.md).

## Impact map
- `tasks` table (read only, `case_id` via `to_jsonb` so it works before 0089), `cases.created_by_user_id`, `notifications` (dedupe), `email.send` job.
- Recipients: the matter owner when the task is linked to a matter; else the firm's active users, admins first, up to 5. `tasks.assignee` is free-text initials, so it can't pick a user.

## Edge cases
- Due date moved: the new date's days alert normally; old keys are harmless.
- Priority raised after an alert: the new schedule applies from the next run.
- A task moved to Done the same morning stops alerting at the next run.

## Acceptance criteria
- Each priority fires on exactly its days in the table, never twice for the same day.
- IST dates: a run at 00:30 IST counts the new day.
