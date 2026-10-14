-- ---- ecourts_business_notes ---------------------------------------------
--
-- eCourts' free-text "Business" narrative (Daily Status page) is CAPTCHA-
-- gated on every path on the real eCourts site - there's no way to fetch it
-- programmatically (see ecourts-live.service.ts). An advocate reads it there
-- once (via the "Open Daily Status" link next to each hearing) and can paste
-- it into LexDraft so it's visible inline from then on, without re-solving
-- the captcha every time they look at the case.
--
-- Scoped by firm (not case_id) because the CNR being annotated may not
-- correspond to a case the advocate has added to their matters yet - eCourts
-- search results are annotatable before "Add to my cases" is ever clicked.
-- One note per (firm, cino, hearing_date) - re-saving the same hearing date
-- replaces it (upsert), it isn't a running log of edits.

create table if not exists ecourts_business_notes (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references firms(id) on delete cascade,
  cino           text not null,
  hearing_date   text not null, -- eCourts' own date string (not always ISO - kept verbatim, matches what historyOfCaseHearing/last_business_date already carry)
  business_text  text not null,
  created_by     uuid references users(id) on delete set null,
  updated_at     timestamptz not null default now(),

  constraint ecourts_business_notes_uniq unique (firm_id, cino, hearing_date)
);

create index if not exists ecourts_business_notes_lookup_idx
  on ecourts_business_notes (firm_id, cino);
