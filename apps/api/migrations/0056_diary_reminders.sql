-- =============================================================================
-- 0056_diary_reminders.sql
-- =============================================================================
-- Court-diary entries gain three fields:
--
--   1. next_hearing_date    — the date the matter is next posted to, captured
--      when logging a hearing entry.
--   2. reminder_offset_days — when set, the advocate wants to be reminded this
--      many days BEFORE `next_hearing_date` (0 = on the day). The reminder is
--      surfaced in-app on the Diary view; there is no email/SMS delivery yet,
--      so this is purely a stored preference the UI computes "due" against.
--   3. bench                — the bench / presiding judge for the entry
--      (the UI labels this "Bench"; the matter-level column on `cases` is still
--      named `judge`).
--
-- Everything is additive and nullable so existing rows continue to work.
-- =============================================================================

alter table diary_entries add column if not exists next_hearing_date    date;
alter table diary_entries add column if not exists reminder_offset_days  integer;
alter table diary_entries add column if not exists bench                 text not null default '';
