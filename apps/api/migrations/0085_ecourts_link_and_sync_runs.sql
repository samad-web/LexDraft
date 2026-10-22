-- ---- eCourts link state + scheduled sync runs ------------------------------
--
-- Two problems this closes:
--
-- 1. A matter's connection to eCourts was implicit - "has a CNR that looks
--    valid" - with no record of whether it had ever actually been fetched,
--    whether the last attempt failed, or why. A case added while eCourts was
--    down just sat unlinked until someone happened to click "Sync", and a
--    manual matter with a TEMP-… placeholder CNR was never linked at all.
--    `ecourts_link_status` makes that state explicit so the UI can show it
--    and the scheduler can retry what's outstanding.
--
-- 2. The court tier (District vs High Court) was guessed from free-text
--    `cases.court` on every run (`/high\s*court/i`), so an HC matter whose
--    court name didn't literally say "High Court" was looked up against the
--    wrong backend and failed forever. `ecourts_court_tier` stores the tier
--    that actually answered, once.
--
-- `ecourts_sync_runs` records each 09:00 / 19:00 IST scheduled run (and its
-- retries while eCourts is unreachable) so a retry knows which cases the
-- original run already covered, and so overlapping runs can be refused.

alter table cases
  add column if not exists ecourts_link_status text not null default 'unlinked',
  add column if not exists ecourts_court_tier text,
  add column if not exists ecourts_last_attempt_at timestamptz,
  add column if not exists ecourts_last_error text,
  add column if not exists ecourts_fail_count int not null default 0,
  -- Last time a sync moved something an advocate acts on (next hearing,
  -- status, stage, disposal). Lets the post-run summary count "updated"
  -- cases across the original run AND its retries from the table itself.
  add column if not exists ecourts_last_changed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cases_ecourts_link_status_chk') then
    alter table cases add constraint cases_ecourts_link_status_chk
      check (ecourts_link_status in ('unlinked', 'pending', 'linked', 'not_found', 'error'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cases_ecourts_court_tier_chk') then
    alter table cases add constraint cases_ecourts_court_tier_chk
      check (ecourts_court_tier is null or ecourts_court_tier in ('DC', 'HC'));
  end if;
end $$;

-- Backfill: anything that has synced before is linked; anything carrying a
-- real-looking CNR that never synced is pending (the next scheduled run picks
-- it up). TEMP-… placeholders and blanks stay 'unlinked'.
update cases set ecourts_link_status = 'linked'
  where ecourts_synced_at is not null and ecourts_link_status = 'unlinked';
update cases set ecourts_link_status = 'pending'
  where ecourts_synced_at is null
    and ecourts_link_status = 'unlinked'
    and upper(trim(cnr)) ~ '^[A-Z]{4}[A-Z0-9]{12}$';
update cases set ecourts_court_tier = 'HC'
  where ecourts_court_tier is null and court ~* 'high\s*court';

create index if not exists cases_ecourts_link_status_idx
  on cases (ecourts_link_status)
  where deleted_at is null;

create table if not exists ecourts_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  slot         text not null check (slot in ('morning', 'evening', 'manual')),
  run_date     date not null,
  attempt      int  not null default 1,
  status       text not null default 'running'
               check (status in ('running', 'completed', 'partial', 'upstream_down', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  scanned      int not null default 0,
  synced       int not null default 0,
  changed      int not null default 0,
  not_found    int not null default 0,
  failed       int not null default 0,
  deferred     int not null default 0
);

create index if not exists ecourts_sync_runs_recent_idx
  on ecourts_sync_runs (run_date desc, slot, attempt desc);
