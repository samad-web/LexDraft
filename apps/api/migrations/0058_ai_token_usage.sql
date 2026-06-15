-- =============================================================================
-- LexDraft - AI token usage
-- =============================================================================
-- Append-only fact table recording the token consumption of every LLM call
-- made across the platform's AI features (drafting, matter-chat, diary
-- assistant, draft-extract, matter-intel, mock-arguments, review, title-report,
-- laws-search). One row per provider call. Powers the superadmin AI-usage
-- dashboard (token totals, per-firm / per-feature breakdowns, cost estimates,
-- daily trend).
--
-- Unlike ai_generations (which counts billable generations against a per-user
-- cap), this table stores the raw input/output token counts returned by the
-- provider so spend can be estimated at read time from a pricing map. Recording
-- is best-effort: a dropped insert never fails the user's AI response.
--
-- Cost is intentionally NOT persisted - model pricing changes over time, so it
-- is derived from the model column at query time.
--
-- Idempotent.
-- =============================================================================

create table if not exists ai_token_usage (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid references firms(id) on delete cascade,        -- null for platform/superadmin calls
  user_id     uuid references users(id) on delete set null,
  feature     text not null,        -- 'drafting' | 'matter_chat' | 'diary_assistant'
                                     -- | 'draft_extract' | 'matter_intel' | 'mock_arguments'
                                     -- | 'review' | 'title_report' | 'laws_search'
  provider    text,                 -- 'anthropic' | 'xai'
  model       text,                 -- e.g. 'claude-sonnet-4-6', 'grok-4'
  tokens_in   integer not null default 0 check (tokens_in  >= 0),
  tokens_out  integer not null default 0 check (tokens_out >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists ai_token_usage_created_idx
  on ai_token_usage (created_at desc);

create index if not exists ai_token_usage_firm_created_idx
  on ai_token_usage (firm_id, created_at desc);

create index if not exists ai_token_usage_feature_created_idx
  on ai_token_usage (feature, created_at desc);

-- Backfill historical Title Report AI runs - the only feature that captured
-- tokens before this table existed. Other features start accumulating at deploy.
insert into ai_token_usage (firm_id, user_id, feature, provider, model, tokens_in, tokens_out, created_at)
select
  run.firm_id,
  run.created_by,
  'title_report',
  run.provider,
  run.model,
  coalesce(run.tokens_in, 0),
  coalesce(run.tokens_out, 0),
  run.created_at
from title_report_ai_runs run
where (run.tokens_in is not null or run.tokens_out is not null)
  and not exists (
    -- Guard against re-running the migration double-inserting the backfill.
    select 1 from ai_token_usage u
    where u.feature = 'title_report'
      and u.created_at = run.created_at
      and u.tokens_in = coalesce(run.tokens_in, 0)
      and u.tokens_out = coalesce(run.tokens_out, 0)
  );
