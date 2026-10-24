-- Tamil Nadu Land Records (eservices.tn.gov.in) applications an advocate is
-- following - patta transfer / F-Line applications ("0000/0000/00/000000").
-- Additive only: one new table, nothing existing changes.
--
-- The site's Application Status page is CAPTCHA-gated, so LexDraft cannot
-- check it unattended; the status is recorded whenever the advocate checks
-- it in LexDraft (one captcha).
create table if not exists tn_land_applications (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references firms(id) on delete cascade,
  case_id             uuid references cases(id) on delete set null,
  title_report_id     uuid references title_reports(id) on delete set null,
  created_by_user_id  uuid references users(id) on delete set null,
  application_id      text not null check (application_id ~ '^[0-9]{4}/[A-Z0-9][0-9]{3}/[0-9]{2}/[0-9]{6}$'),
  kind                text not null default 'patta_transfer' check (kind in ('patta_transfer', 'fline', 'other')),
  note                text,
  last_status         text,
  last_result         jsonb,
  last_checked_at     timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (firm_id, application_id)
);

create index if not exists tn_land_applications_firm_idx on tn_land_applications (firm_id) where closed_at is null;
create index if not exists tn_land_applications_case_idx on tn_land_applications (case_id);
