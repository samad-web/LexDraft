-- eFiling 3.0 portal fields with no column of their own yet (user-approved
-- 2026-10-22). Additive only: one column, defaulted, no existing row changes
-- meaning.
--   Initial Inputs: reliefSought; Subordinate Court (appeals): subCourt*
--   Case Details:   disputeState/District/Taluka/Village, *Local (vernacular
--                   cause of action / prayer / important information)
-- Values are strings keyed as above; the API merges patches into it.
alter table case_filing_particulars
  add column if not exists extra jsonb not null default '{}'::jsonb;
