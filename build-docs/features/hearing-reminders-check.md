# eCourts sync + hearing reminders check (owner 2026-11-18)

## Findings on prod (18 Nov)
- Sync runs on time: 09:00 and 19:00 IST every day (ecourts_sync_runs), summary bell per run. eCourts reachable from prod (states 0.6 s; CNR lookup returns full record).
- "2 cases need attention" every run = the Play-review demo CNRs (TNMD…, TNCB…) that are not real eCourts records. Correct behaviour.
- Hearing reminders fire in-app (e.g. "Hearing today" 10 & 14 Nov). One row per case+date, updated daily (in 3 days → tomorrow → today).
- Gaps: reminders went to the case creator only; delivery is bell-only (no SMTP on prod, no WhatsApp).

## Fix
- Reminder recipient = case lead (case_assignments lead), else creator.
- Day-before WhatsApp from the daily 9 AM run only (never from on-save/per-firm calls, so one message per hearing), via `WHATSAPP_HEARING_TEMPLATE` (Wasi template, params member_name, case_title, hearing_date, court, app_link) to a verified number. Blank = off.
- Not fixed here: email needs SMTP credentials on prod.

## Acceptance criteria
- AC9 reminder to the lead. AC10 WhatsApp once, day before, daily run only, template on.
