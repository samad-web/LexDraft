-- 0097: post-sign-up onboarding (choose a plan -> your practice ->
-- verification).
--
-- users.onboarded_at is null while a self-serve account still has to finish
-- onboarding; the web app sends such users to /onboarding. The default is
-- now(), so every existing user and every account made any other way
-- (invites, admin-created members) counts as onboarded. Only self-serve
-- sign-up clears it.
--
-- Verification step: the ID the advocate gave (Bar Council enrolment card,
-- student ID, ...), its uploaded copy, GSTIN and business address. The
-- practice logo is kept on the firm. Additive only.

alter table users add column if not exists onboarded_at timestamptz default now();
alter table users add column if not exists id_document_type text;
alter table users add column if not exists id_document_number text;
alter table users add column if not exists id_document_key text;
alter table users add column if not exists gstin text;
alter table users add column if not exists address_line text;
alter table users add column if not exists pincode text;

alter table firms add column if not exists logo_key text;
