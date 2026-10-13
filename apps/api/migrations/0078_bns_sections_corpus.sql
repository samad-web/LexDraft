-- =============================================================================
-- 0078_bns_sections_corpus.sql — local BNS full-text search corpus
-- =============================================================================
-- The "Search statutes" tab in ResearchView.tsx has always called out to an
-- external indiacode-rag Postgres (LAWS_DATABASE_URL + a pgvector hybrid
-- search over embeddings) that was never deployed from this repo — see
-- LEXDRAFT_INTEGRATION.md. Separately, apps/api/scripts/data/bns-bnss-
-- sections.json already carries the full, real gazette text for all 358
-- sections of the Bharatiya Nyaya Sanhita, 2023 (scraped from the official
-- IndiaCode PDF, not AI-generated) — committed to git, sitting unused.
--
-- This migration seeds that real text into a small table HERE, in the main
-- app DB (laws are public reference data, not tenant data — kept in its own
-- table/namespace rather than a separate Postgres instance, since we're not
-- running pgvector/an embedding service locally). Native Postgres full-text
-- search (tsvector + GIN, built-in, no external API, no embedding model) is
-- the whole engine — exact-match on section number short-circuits it
-- entirely (see bns-search.service.ts).
--
-- IMPORTANT — every row ships with verified = false. The source JSON itself
-- tags every row this way: parsed from the gazette PDF by regex, not yet
-- checked by counsel against the primary source. ingest-bns-bnss.ts's own
-- rule is that unverified rows are "needs-review, never a hard citation" —
-- this corpus preserves that distinction end-to-end: the API response and
-- the UI both surface it, so a result reads as "here's the section, verify
-- it" rather than "this is confirmed correct."
--
-- Idempotent: re-running re-seeds via ON CONFLICT DO UPDATE (the source JSON
-- is the source of truth; a newer parse should win).
-- =============================================================================

create table if not exists bns_sections (
  id              uuid primary key default gen_random_uuid(),
  act             text not null,                 -- 'BNS' today; BNSS/others can land in this same table later
  act_title       text not null,
  act_year        integer not null,
  section_number  text not null,
  heading         text,
  body_text       text not null,
  old_act         text,                           -- e.g. 'IPC', when the source JSON carries a crosswalk
  old_section     text,
  verified        boolean not null default false,
  search_vector   tsvector generated always as (
    setweight(to_tsvector('english', coalesce(heading, '')), 'A')
    || setweight(to_tsvector('english', coalesce(body_text, '')), 'B')
  ) stored,
  updated_at      timestamptz not null default now(),
  unique (act, section_number)
);

create index if not exists bns_sections_search_idx on bns_sections using gin (search_vector);
create index if not exists bns_sections_section_lookup_idx on bns_sections (act, section_number);
create index if not exists bns_sections_old_section_idx on bns_sections (old_act, old_section) where old_section is not null;
