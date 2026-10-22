-- =============================================================================
-- 0091_firm_engine_formats — a firm's OWN drafting formats, drafted by the ENGINE
-- (user-approved 2026-10-22). Additive only: one new table, no existing row or
-- column changes.
--
-- An advocate uploads a format (PDF / scan / photo / Word / text) on the Draft
-- page; Claude reads it into a structured template spec (fields + paragraphs with
-- {{ placeholders }}), the engine validates and previews it, and the advocate
-- approves it. The spec is stored here and sent to the engine with every draft
-- (POST /v1/draft-spec) — the engine keeps no per-firm state.
--
-- Distinct from draft_format_templates (0063): that stores house-style TEXT the
-- general AI drafter follows; this stores an engine template spec.
-- =============================================================================

create table if not exists firm_engine_formats (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references firms(id) on delete cascade,
  -- Shown in the Draft page picker. Unique per firm (see index below).
  title         text not null,
  -- The engine template spec: { title, court_issued, fields[], blocks[] }.
  spec          jsonb not null,
  -- What the reader flagged for review: { corrections, law_updates, uncertain, summary }.
  review_notes  jsonb not null default '{}'::jsonb,
  -- 'approved' formats are draftable; 'pending_review' are saved but not offered.
  status        text not null default 'pending_review'
                check (status in ('pending_review', 'approved')),
  version       integer not null default 1,
  source_name   text not null default '',
  source_sha256 text not null default '',
  approved_by   uuid references users(id) on delete set null,
  approved_at   timestamptz,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists firm_engine_formats_firm_title_idx
  on firm_engine_formats (firm_id, lower(title));

do $$ begin
  create trigger trg_firm_engine_formats_updated
    before update on firm_engine_formats
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
