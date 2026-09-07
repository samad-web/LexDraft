-- =============================================================================
-- 0066_fact_sheets — versioned Matter Fact Sheet (append-only, immutable rows).
--
-- The drafting engine (Python) keys document sign-off on (matter_id, version) and
-- treats a sign-off against a SUPERSEDED version as stale — if the facts change
-- after a document is signed, the signature no longer corresponds to the facts,
-- and the review banner must come back. That guarantee only holds if the Node
-- side versions the fact sheet the SAME way the engine does:
--
--   * immutable revisions   — a fact edit INSERTS a new row; existing rows are
--                             NEVER updated in place (contrast drafts.update);
--   * monotonic version     — version starts at 1 and increments by exactly 1
--                             per matter; enforced by a unique (matter_id,version);
--   * current = max(version) — "the facts now" is always the highest version.
--
-- Mutating in place, or handing the engine a stale version, would leave a signed
-- document signed after the facts moved — the exact failure this table prevents.
-- There is deliberately NO UPDATE path in the service; only INSERT + SELECT.
-- =============================================================================

create table if not exists fact_sheets (
  -- surrogate id per ROW (per version), distinct from the matter identity.
  id            uuid primary key default gen_random_uuid(),

  -- the matter identity, stable across every version (the engine's matter_id).
  matter_id     uuid not null,

  -- monotonic per-matter version. (matter_id, version) is unique, so two writers
  -- racing on the same next-version collide on the constraint rather than both
  -- committing — see factsheet.service revise() for the retry.
  version       integer not null check (version >= 1),

  -- tenancy — same firm/user model the rest of the schema uses.
  firm_id       uuid,
  created_by    text not null,          -- who authored THIS version

  -- the facts themselves, as the engine's inbound contract (JSONB so a document
  -- adapter's field set can evolve without a migration).
  facts_json    jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),

  unique (matter_id, version)
);

-- current-version lookups and history walks are both by matter_id.
create index if not exists fact_sheets_matter_idx
  on fact_sheets (matter_id, version desc);

create index if not exists fact_sheets_firm_idx
  on fact_sheets (firm_id);

-- A trigger belt-and-braces: reject any UPDATE to a fact_sheets row. The service
-- never issues one, but a stray UPDATE elsewhere would silently break the
-- immutability the engine's staleness check depends on, so make it impossible.
create or replace function fact_sheets_no_update() returns trigger as $$
begin
  raise exception 'fact_sheets rows are immutable; insert a new version instead';
end;
$$ language plpgsql;

drop trigger if exists fact_sheets_immutable on fact_sheets;
create trigger fact_sheets_immutable
  before update on fact_sheets
  for each row execute function fact_sheets_no_update();
