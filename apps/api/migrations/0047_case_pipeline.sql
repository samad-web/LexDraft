-- =============================================================================
-- LexDraft - Case pipeline: stage-change audit
-- =============================================================================
-- `cases.stage` is a free-text column with no audit history. We log every
-- transition into `case_stage_events` so the timeline on the matter detail
-- (advocate + portal) can render "who moved this matter from X to Y and when".
--
-- Lenient transition policy: any stage can move to any other stage (see
-- LexDraft pipeline ADR — the canonical sequence is per-matter-type but we
-- don't reject jumps). This table records what actually happened.
--
-- Visibility: events are firm-scoped (via cases.firm_id). Portal exposure is
-- decided at read time (visible_to_portal flag) so an advocate can mark a
-- stage move private (e.g. internal triage) without redacting the record.
--
-- Idempotent.
-- =============================================================================

create table if not exists case_stage_events (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id) on delete cascade,
  from_stage          text,
  to_stage            text not null,
  actor_user_id       uuid references users(id) on delete set null,
  actor_name          text,
  note                text,
  visible_to_portal   boolean not null default true,
  created_at          timestamptz not null default now()
);

create index if not exists case_stage_events_case_created_idx
  on case_stage_events (case_id, created_at desc);
