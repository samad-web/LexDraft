-- =============================================================================
-- 0026_contract_reviews.sql
-- =============================================================================
-- Document review feature - replaces the mock UI behind /app/review with a
-- real, persisted, LLM-backed clause analyzer.
--
-- One row per "review run": the user pastes / uploads a contract, picks a
-- perspective (Client, Vendor, Employer, …), and gets back a risk score plus
-- a list of clause-level findings. The findings shape mirrors what the LLM
-- emits (see services/review.service.ts) and is stored verbatim so future
-- model upgrades can backfill comparable runs without a schema migration.
--
-- Multi-tenant: every read/write is firm-scoped via firm_id. Reviews may
-- optionally attach to a case (case_id ON DELETE SET NULL - keep the review
-- around if the case is archived) and a document
-- (document_id ON DELETE SET NULL - same reasoning).
--
-- The feature key `review.approve` (already in the catalog at 0009) is what
-- the routes gate on. No catalog change needed.
-- =============================================================================

do $$ begin
  create type contract_review_status as enum ('pending', 'analyzing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists contract_reviews (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references firms(id) on delete cascade,
  case_id         uuid references cases(id)     on delete set null,
  document_id     uuid references documents(id) on delete set null,
  -- "Client", "Vendor", "Employer", "Employee", "Landlord", "Tenant", "Company".
  -- Free-text so we can grow the list without a schema change; validated at
  -- the API layer.
  perspective     text not null,
  -- Title/filename surfaced in the history list. Falls back to first line of
  -- source_text when neither a filename nor an explicit title is given.
  title           text not null,
  source_filename text,
  -- Verbatim text the analyzer saw. Kept so we can re-run with a newer model
  -- without asking the user to re-upload, and so audit/incident response can
  -- inspect what was fed to the LLM. Capped at ~200KB at the application
  -- layer; the column is unbounded to allow future increases.
  source_text     text not null,
  status          contract_review_status not null default 'pending',
  -- Aggregate risk score, 0-100, populated when status='completed'.
  risk_score      smallint check (risk_score is null or risk_score between 0 and 100),
  -- Findings payload - see ContractReviewFinding[] in types/review.types.ts.
  -- Stored as jsonb so we can index/query individual severities later.
  findings_json   jsonb,
  -- Plain-text 1-2 sentence executive summary, surfaced above the findings.
  summary         text,
  -- Which provider actually answered (xai / anthropic / demo / none). Useful
  -- for debugging cost surprises and for the "Demonstration" banner.
  provider        text,
  -- Capture failure reason so the UI can show "Re-run" with context instead
  -- of a generic spinner-then-blank.
  error_message   text,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists contract_reviews_firm_idx
  on contract_reviews (firm_id, created_at desc);
create index if not exists contract_reviews_case_idx
  on contract_reviews (case_id) where case_id is not null;
create index if not exists contract_reviews_status_idx
  on contract_reviews (status) where status in ('pending', 'analyzing');
