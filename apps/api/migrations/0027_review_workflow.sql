-- =============================================================================
-- 0027_review_workflow.sql
-- =============================================================================
-- Human-review workflow layer on top of contract_reviews (0026).
--
-- Concept:
--   The AI run produces findings + a risk score. A human reviewer (often a
--   senior on the matter) reads the findings, threads comments inline or at
--   the document level, and either Approves or Requests Changes. The decision
--   is what the requester acts on; the AI's score is advisory.
--
-- New columns on contract_reviews:
--   assigned_to     - who's responsible for the human review (optional;
--                     reviews can sit unassigned in a "Needs reviewer" queue)
--   decision        - pending|changes_requested|approved (null until decided)
--   decided_at      - when the decision was recorded
--   decided_by      - who decided (the assignee, or any user with override
--                     rights - we don't lock this in DB; service enforces)
--
-- New table contract_review_comments:
--   Threaded comments. `finding_index` ties a comment to a specific finding
--   in findings_json (by position), null for review-level comments. Threading
--   via `parent_comment_id` (one level deep is the spec; the column allows
--   arbitrary depth and the client renders nesting).
--
--   Soft-delete via `deleted_at` instead of hard-delete so a thread keeps
--   its structure when a stale reply is removed (the UI renders a tombstone
--   "comment removed" placeholder rather than re-parenting children).
-- =============================================================================

do $$ begin
  create type contract_review_decision as enum ('pending', 'changes_requested', 'approved');
exception when duplicate_object then null; end $$;

alter table contract_reviews
  add column if not exists assigned_to uuid references users(id) on delete set null,
  add column if not exists decision contract_review_decision,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references users(id) on delete set null;

create index if not exists contract_reviews_assignee_idx
  on contract_reviews (assigned_to) where assigned_to is not null;
create index if not exists contract_reviews_decision_idx
  on contract_reviews (firm_id, decision) where decision is not null;

create table if not exists contract_review_comments (
  id                  uuid primary key default gen_random_uuid(),
  review_id           uuid not null references contract_reviews(id) on delete cascade,
  -- Position of the finding in findings_json this comment hangs off. Null
  -- for review-level (document-wide) comments.
  finding_index       integer,
  -- Self-reference for threads. ON DELETE SET NULL keeps replies visible
  -- as orphans rather than cascading the delete through a thread.
  parent_comment_id   uuid references contract_review_comments(id) on delete set null,
  author_id           uuid not null references users(id) on delete cascade,
  body                text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Soft delete: row stays, body is hidden by the API. Required so the
  -- thread structure (parent_comment_id) survives the removal of a reply.
  deleted_at          timestamptz
);

create index if not exists contract_review_comments_review_idx
  on contract_review_comments (review_id, created_at asc);
create index if not exists contract_review_comments_finding_idx
  on contract_review_comments (review_id, finding_index) where finding_index is not null;

do $$ begin
  create trigger trg_contract_review_comments_updated
    before update on contract_review_comments
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
