-- =============================================================================
-- 0062_leads_legal_intake — turn the generic sales funnel into a legal-intake
-- pipeline.
--
-- WHY: a law-firm lead is a prospective client who has not yet signed an
-- engagement. The intake flow is legally distinct from generic B2B sales in
-- three ways this migration supports:
--   1. A CONFLICT CHECK is a mandatory gate before a matter can be discussed /
--      an engagement sent — so we add a conflict stage + a conflict_status.
--   2. A retained lead must become a CLIENT + MATTER — so we record the
--      practice area / matter description needed to open that matter, and the
--      contact needed to create the client + portal.
--   3. Pipeline value is an ESTIMATE weighted by likelihood — so we add a
--      probability the app multiplies by value_inr for expected value.
--
-- Enum: we ADD the two new legal stages ('conflict', 'consultation') to the
-- existing lead_stage type rather than rewrite it. ADD VALUE is non-destructive
-- and keeps every existing row valid. The remaining stages are re-mapped in the
-- app layer to the legal labels:
--   new        -> New enquiry
--   conflict   -> Conflict check          (new)
--   consultation -> Consultation          (new)
--   qualified  -> (legacy; app treats as Consultation for old rows)
--   proposal   -> Engagement sent
--   won        -> Retained
--   lost       -> Declined
-- Old rows in 'qualified' still render (mapped to Consultation) — no data loss.
-- =============================================================================

-- ADD VALUE cannot run inside a transaction block with other statements in some
-- PG versions; the migration runner executes each file in its own connection.
alter type lead_stage add value if not exists 'conflict' after 'new';
alter type lead_stage add value if not exists 'consultation' after 'conflict';

-- New lead columns for the legal-intake data. All nullable / defaulted so
-- existing rows and the current insert path keep working unchanged.
alter table leads add column if not exists contact        text    not null default '';
alter table leads add column if not exists practice_area  text    not null default '';
alter table leads add column if not exists matter_summary text    not null default '';
-- 0..100; multiplied by value_inr for the weighted pipeline value.
alter table leads add column if not exists probability    integer not null default 50;
-- Conflict-check outcome: '' (unchecked) | 'clear' | 'conflict'. Kept as text
-- (not an enum) so it is trivially extensible and needs no second enum type.
alter table leads add column if not exists conflict_status text   not null default '';
-- Why a lead was declined (only meaningful in the 'lost' stage).
alter table leads add column if not exists decline_reason text    not null default '';
-- Link to the client/case created when the lead is retained (audit trail).
alter table leads add column if not exists converted_client text  not null default '';

-- Keep probability sane at the DB layer.
do $$ begin
  alter table leads add constraint leads_probability_range check (probability between 0 and 100);
exception when duplicate_object then null; end $$;
