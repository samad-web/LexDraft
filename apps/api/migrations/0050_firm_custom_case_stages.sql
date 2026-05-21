-- =============================================================================
-- LexDraft — Firm-defined custom case stages
-- =============================================================================
-- The pipeline catalogs in `case-pipeline.service.ts` ship a sensible default
-- per matter type (civil / criminal / consumer / writ). Real practices want
-- their own additions: an "IA" (Interlocutory Application) checkpoint, a
-- "Mediation" stage between filing and trial, a firm-specific "Pre-filing
-- review" gate, etc.
--
-- This table holds those firm-scoped additions. The pipeline snapshot merges
-- them into the canonical catalog at read time, so existing stage events keep
-- working unchanged.
--
--   * `kind` matches PipelineKind in case-pipeline.service.ts. 'all' means the
--     custom stage applies to every matter type for this firm.
--   * `position` is a stable sort key — append-only by default, but the API
--     lets an admin re-order by passing an explicit number.
--   * Uniqueness is per (firm, kind, lower(name)) so we don't dedupe across
--     casing differences ("ia" vs "IA").

create table if not exists firm_custom_case_stages (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references firms(id) on delete cascade,
  kind          text not null,           -- 'civil' | 'criminal' | 'consumer' | 'writ' | 'default' | 'all'
  stage_name    text not null,
  position      integer not null default 1000,
  created_by    uuid null references users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create unique index if not exists firm_custom_case_stages_uniq
  on firm_custom_case_stages (firm_id, kind, lower(stage_name));

create index if not exists firm_custom_case_stages_firm_kind_idx
  on firm_custom_case_stages (firm_id, kind);
