-- =============================================================================
-- 0098_judgments_corpus.sql — open-source judgment corpus (SC + Madras HC first)
-- =============================================================================
-- Drafts and the Research tab can cite statutes but no judgments. This adds a
-- local, public-reference corpus of REAL judgments so every case we cite is one
-- we actually hold, with a link to its source PDF and the paragraph relied on.
--
-- Source (see src/scripts/ingest-judgments.ts): the AWS Open Data buckets
-- "indian-supreme-court-judgments" and "indian-high-court-judgments" (Dattam
-- Labs, CC-BY-4.0, scraped from scr.sci.gov.in / judgments.ecourts.gov.in).
-- Public reference data, not tenant data: no firm_id, no RLS, same footing as
-- bns_sections (0078).
--
--   judgments            one row per judgment / final order. `source_key` is
--                        the stable dataset key ("sc:2024_10_108_125",
--                        "hc:33_10:HCMA010000062024_1_2024-04-18"), so the
--                        ingester upserts idempotently on it.
--   judgment_paragraphs  the judgment split into its own numbered paragraphs.
--                        `seq` orders them; `para_no` is the number the court
--                        printed (a very long paragraph is split into parts
--                        that share one para_no). Native FTS (tsvector + GIN)
--                        always works; `embedding` (BAAI/bge-m3, 1024-d, same
--                        space as matter_document_chunks in 0041) is nullable
--                        — rows ingested while the embed service was down stay
--                        FTS-only until re-embedded.
--
-- pgvector: `create extension if not exists vector` is idempotent and was
-- already run by 0041; repeated here so this file stands alone on Supabase.
--
-- Additive only: two new tables + indexes, nothing existing changes.
-- =============================================================================

create extension if not exists vector;

create table if not exists judgments (
  id                  uuid primary key default gen_random_uuid(),
  source              text not null default 'aws-open-data',     -- dataset the row came from
  source_key          text not null unique,                      -- stable dataset key, see header
  court               text not null,                             -- 'Supreme Court of India' | 'Madras High Court' | ...
  court_code          text not null,                             -- 'SC' | 'MHC' | ... (search filter)
  bench               text,                                      -- judges, e.g. 'Bela M. Trivedi, Satish Chandra Sharma'
  bench_size          integer,
  case_title          text not null,                             -- 'Vijay Singh @ Vijay Kr. Sharma v. The State of Bihar'
  case_number         text,                                      -- 'Criminal Appeal No. 1031 of 2015' / 'HCP/83/2024'
  cnr                 text,                                      -- eCourts CNR, when the source has one
  neutral_citation    text,                                      -- '2024 INSC 735' / '2024:MHC:1234'
  reported_citations  text[] not null default '{}',              -- ['[2024] 10 S.C.R. 108', ...]
  decision_date       date,
  disposal            text,                                      -- 'Disposed off' / 'ALLOWED' / ...
  language            text not null default 'en',
  source_url          text,                                      -- official portal for the judgment
  pdf_url             text,                                      -- public, permanent PDF (the S3 object)
  page_count          integer,
  para_count          integer not null default 0,
  metadata            jsonb not null default '{}'::jsonb,        -- parsed source metadata, for audit
  ingested_at         timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists judgments_court_date_idx on judgments (court_code, decision_date desc);
create index if not exists judgments_neutral_citation_idx on judgments (neutral_citation) where neutral_citation is not null;
create index if not exists judgments_reported_citations_idx on judgments using gin (reported_citations);

create table if not exists judgment_paragraphs (
  id            uuid primary key default gen_random_uuid(),
  judgment_id   uuid not null references judgments(id) on delete cascade,
  seq           integer not null,                                -- 0-based order within the judgment
  para_no       integer not null,                                -- the court's own paragraph number (0 = unnumbered preamble)
  text          text not null,
  search_vector tsvector generated always as (to_tsvector('english', coalesce(text, ''))) stored,
  embedding     vector(1024),
  created_at    timestamptz not null default now(),
  unique (judgment_id, seq)
);

create index if not exists judgment_paragraphs_search_idx on judgment_paragraphs using gin (search_vector);
create index if not exists judgment_paragraphs_judgment_idx on judgment_paragraphs (judgment_id, para_no);

-- HNSW + cosine, same build params as matter_document_chunks (0041). Rows with
-- a null embedding are simply not in the graph.
create index if not exists judgment_paragraphs_embedding_idx
  on judgment_paragraphs
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
