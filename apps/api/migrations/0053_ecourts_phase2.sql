-- =============================================================================
-- 0053_ecourts_phase2.sql
-- =============================================================================
-- Schema additions so eCourts sync (services/case-sync.service.ts) can persist
-- the rich data the gateway returns beyond what `cases` and `hearings` capture
-- today. Specifically:
--
--   1. Court-identity columns on `cases` — the administrative codes eCourts
--      issues per matter. Once stored we can call cause-list, related-cases,
--      and judgment search without re-asking the user for state/district/court.
--   2. FIR linkage columns on `cases` — for criminal matters.
--   3. `case_acts` — one row per (Act, Section) the matter is filed under.
--      Wires into Sanhita reference data later (act normalisation is a
--      separate exercise; for now we store the raw eCourts strings).
--   4. `case_parties` — captures multi-party matters (the ex_pet_namelegal[]
--      / ex_res_namelegal[] arrays from eCourts) plus opposing counsel.
--
-- Everything is additive and nullable so existing rows continue to work.
-- =============================================================================

-- ---- cases: court-identity columns -----------------------------------------
alter table cases add column if not exists est_code        text;
alter table cases add column if not exists court_code      integer;
alter table cases add column if not exists district_code   integer;
alter table cases add column if not exists state_code      integer;
alter table cases add column if not exists filing_no       text;
alter table cases add column if not exists efil_no         text;
alter table cases add column if not exists judge           text;

-- ---- cases: FIR linkage -----------------------------------------------------
alter table cases add column if not exists fir_no          text;
alter table cases add column if not exists fir_year        integer;
alter table cases add column if not exists police_st_code  integer;
-- Free text in the eCourts payload (caret-delimited "21^Ernakulam Central
-- Police Station^2023"). We surface it raw for now and normalise on render.
alter table cases add column if not exists fir_details     text;

-- ---- cases: source-of-truth marker -----------------------------------------
-- When set, the row was last synced from eCourts at this timestamp. Lets the
-- UI badge "Synced X minutes ago" without joining the audit log.
alter table cases add column if not exists ecourts_synced_at timestamptz;

-- ---- case_acts ---------------------------------------------------------------
-- One row per (act, section) the matter is filed under. eCourts may carry
-- duplicate act_name strings with different sections — we deliberately do
-- NOT enforce uniqueness on (case_id, act_name, section) so re-sync can
-- replace the full set atomically (delete + reinsert in one transaction).
create table if not exists case_acts (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  act_name        text not null,   -- "Cr. P.C.", "IPC", "Companies Act", ...
  section         text not null,   -- "439", "498A", ...
  position        integer not null default 0,
  source          text not null default 'ecourts' check (source in ('ecourts', 'manual')),
  created_at      timestamptz not null default now()
);
create index if not exists case_acts_case_idx on case_acts (case_id, position);

-- ---- case_parties -----------------------------------------------------------
-- Captures every party + their advocate. `side` mirrors the eCourts taxonomy
-- (petitioner / respondent); LexDraft's `cases.client` column tracks which
-- side the firm represents and is denormalised from here for fast list views.
do $$ begin
  create type case_party_side as enum ('petitioner', 'respondent');
exception when duplicate_object then null; end $$;

create table if not exists case_parties (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  side            case_party_side not null,
  party_name      text not null,
  -- Optional per-row labels: "Mantu Yadav" (ex_pet_namelegal[].partyname)
  -- carries a litigantStatus + legal-heir flag in the eCourts payload, which
  -- we preserve as free text here.
  role_label      text,
  advocate_name   text,
  position        integer not null default 0,
  source          text not null default 'ecourts' check (source in ('ecourts', 'manual')),
  created_at      timestamptz not null default now()
);
create index if not exists case_parties_case_idx on case_parties (case_id, side, position);
