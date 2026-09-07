-- =============================================================================
-- 0067_shadow_pairs — recorded (model, engine) response pairs for shadow mode.
--
-- Shadow mode compares the current MODEL pipeline against the ENGINE for the SAME
-- real matter, to understand every divergence before routing s.138 through the
-- engine. The comparison is only meaningful on REAL traffic — a run on invented
-- fixtures tells us nothing. So each row is captured from an ACTUAL draft the
-- advocate ran; nothing here is synthetic.
--
-- The engine call is best-effort and never blocks the advocate's draft: the model
-- response is what they see; the engine response is recorded alongside for the
-- shadow report. `engine_status` distinguishes a genuine engine outcome
-- (generated/refused) from an error/skip so the reporter can exclude noise.
-- =============================================================================

create table if not exists shadow_pairs (
  id            uuid primary key default gen_random_uuid(),
  doc_type      text not null,                 -- 's138_notice' for Phase 1
  matter_id     uuid,                           -- the fact-sheet matter, when linked
  firm_id       uuid,
  captured_by   text not null,

  -- the inbound fields the engine adapter received (the shared input).
  fields_json   jsonb not null,

  -- the MODEL pipeline's response (drafting-orchestrator DraftPipelineResult).
  model_json    jsonb not null,

  -- the ENGINE's response, and a coarse status so the reporter can filter.
  --   'generated' | 'refused' | 'invalid_input' | 'error'
  engine_status text not null,
  engine_json   jsonb not null,

  captured_at   timestamptz not null default now()
);

create index if not exists shadow_pairs_doctype_idx
  on shadow_pairs (doc_type, captured_at desc);
create index if not exists shadow_pairs_firm_idx
  on shadow_pairs (firm_id);
