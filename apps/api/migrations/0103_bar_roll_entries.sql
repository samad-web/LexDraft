-- Bar Council rolls that are published only as PDFs (Punjab & Haryana, and
-- J&K via the High Court), imported monthly so an advocate's enrolment can be
-- checked against them. Additive only: one new table.
--
-- Data minimisation (DPDP): only the enrolment number and name are kept; the
-- PDFs' addresses, phone numbers and emails are never stored.
create table if not exists bar_roll_entries (
  council      text not null,
  enrolment_no text not null,
  num          int  not null,      -- the number part, for an indexed lookup
  name         text not null,
  source       text not null,      -- the PDF it came from
  imported_at  timestamptz not null default now()
);

create index if not exists bar_roll_entries_lookup_idx on bar_roll_entries (council, num);
