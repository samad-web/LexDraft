-- =============================================================================
-- 0057_court_judges.sql
-- =============================================================================
-- The sitting-judge roster for all 25 High Courts.
--
-- Source: the consolidated public list (Wikipedia "List of sitting judges of
-- the high courts of India", itself mirrored from Supreme Court collegium
-- resolutions + Dept. of Justice statements). We deliberately do NOT pull this
-- from the reverse-engineered eCourts mobile API — the roster is slow-moving
-- reference data and a single public page covers all 25 courts uniformly,
-- where the eCourts route would need per-establishment calls and only gives
-- the judge name embedded in a free-text bench label.
--
-- Scope note (read before extending): this captures WHO the sitting judges of
-- each High Court are. It does NOT capture live BENCH COMPOSITION (which judges
-- form which division bench on a given day) — that is a daily artifact only
-- published in each court's sitting list. When we add that, it belongs in a
-- separate `court_benches` / `court_bench_members` pair keyed by (high_court,
-- date), referencing this table; this roster stays the source of judge identity.
--
-- Refresh model: wipe-and-replace per provenance on every sync (the roster is
-- global reference data, not firm-scoped), so there is no firm_id here.
-- =============================================================================

create table if not exists court_judges (
  id               uuid primary key default gen_random_uuid(),

  -- Canonical High Court name, matching apps/web/src/lib/indian-courts.ts
  -- (e.g. "Punjab & Haryana High Court", "Jammu & Kashmir and Ladakh High Court").
  high_court       text not null,

  -- Judge name with any "(CJ)"/"(ACJ)" role marker stripped off (the role is
  -- captured in is_chief_justice / remarks instead).
  judge_name       text not null,

  is_chief_justice boolean not null default false,

  -- Permanent vs additional (acting) judge — both are currently sitting.
  judge_type       text not null default 'permanent'
                     check (judge_type in ('permanent', 'additional')),

  -- Elevation source as published: 'Bar' (advocate) or 'Service' (judicial
  -- service). Free text / nullable — the source occasionally carries variants.
  recruited_from   text,

  -- Best-available appointment date (permanent-appointment date when present,
  -- else first/additional appointment date).
  appointed_on     date,

  -- Permanent judges: scheduled retirement date.
  retires_on       date,

  -- Additional judges: expiry of the present (additional) term.
  term_expires_on  date,

  -- Free-text remarks from the source (transfers, parent High Court, acting-CJ
  -- notes, etc.).
  remarks          text,

  -- Provenance so a future authoritative source (DoJ scrape) can coexist and
  -- be refreshed independently of the Wikipedia-sourced rows.
  provenance       text not null default 'wikipedia',
  source_url       text not null,
  synced_at        timestamptz not null default now(),

  -- One row per judge per court. Re-sync upserts on this key.
  unique (high_court, judge_name)
);

-- List view: judges of a court, Chief Justice first, then by name.
create index if not exists court_judges_hc_idx
  on court_judges (high_court, is_chief_justice desc, judge_name);
