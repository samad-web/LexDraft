-- =============================================================================
-- 0064_drafts_matter_link — file a generated draft against a matter.
--
-- Drafts were global ("My drafts") and surfaced in the unified documents list
-- with a hardcoded case label of '-', so they never appeared under a matter's
-- Documents tab. This adds an optional `matter` label (the case title — the same
-- free-text link cases/clients/documents already use). When set, the documents
-- union reports the draft under that matter, so a bail app drafted for a case
-- shows up in that case's file.
-- =============================================================================

alter table drafts add column if not exists matter text not null default '';

create index if not exists drafts_matter_idx on drafts (matter);
