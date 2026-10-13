-- =============================================================================
-- 0079_esign.sql — self-built electronic signature (Section 3A "electronic
-- signature", NOT Section 3 "digital signature"/DSC, NOT Aadhaar eSign)
-- =============================================================================
-- LEGAL SCOPE — read before touching this feature. Researched against the IT
-- Act 2000, BSA 2023, and CCA's own published rules (see the deep-research
-- pass this migration followed):
--
--   - A Section 3 "digital signature" (First Schedule) and Aadhaar eSign
--     (Second Schedule, via Section 3A) BOTH require a licensed Certifying
--     Authority relationship. CCA only licenses CAs, never end-platforms;
--     becoming a CA needs Rs 5 crore+ paid-up capital. This is a hard legal
--     wall for a self-built, non-partnered system — not an engineering
--     problem to solve around. LexDraft does NOT claim either tier.
--
--   - What IS achievable in-house: a basic "electronic signature" under
--     Section 3A, valid for most contracts via Section 10A (validity of
--     electronic contracts) and ordinary contract/evidence law. Its legal
--     weight if challenged depends ENTIRELY on audit-trail quality and
--     procedural rigor — there is no statutory certificate backing it. The
--     UI must never call this a "digital signature" or imply DSC/Aadhaar-
--     tier legal status; "electronic signature" is the correct term
--     throughout (see Section 2(1)(ta)).
--
--   - Under BSA 2023 Section 63(4) (successor to Evidence Act Section 65B,
--     held MANDATORY by the Supreme Court in Arjun Panditrao Khotkar (2020)
--     7 SCC 1 — not curable, no exceptions besides producing the original
--     device), this audit trail is itself an "electronic record" that will
--     need a signed certificate (Part A by the party, Part B by a technical
--     expert, with a hash value) at the point it's ever tendered as
--     litigation evidence. That certificate only proves the record is an
--     authentic COPY — it does NOT prove the truth of what it describes;
--     genuineness of each entry can still be separately contested. This is
--     why the audit trail below is append-only and hash-chained: the goal
--     is to produce corroborating, hard-to-fabricate evidence (not a single
--     "trust me" document), mirroring what Leegality's own audit-trail
--     documentation captures (Opened/OTP/Consent/Signed events + IP/device/
--     geolocation) as the real-world benchmark for persuasive weight.
--
-- Four tables:
--   esign_requests      - one row per signature request, holds the source +
--                          signed document hashes.
--   esign_signers       - one row per party asked to sign. Signers are
--                          usually NOT LexDraft users (clients, opposing
--                          counsel) - token-based access, same entropy as
--                          invitations.service.ts's generateToken().
--   esign_otp_challenges - OTP issue/verify records, kept separate from
--                          esign_signers so a resend doesn't lose history.
--   esign_audit_events  - append-only, hash-chained. prev_event_hash links
--                          each row to the one before it (per request), so
--                          any after-the-fact edit or deletion breaks the
--                          chain visibly - the closest a self-built system
--                          can get to tamper-evidence without a CA.
--
-- Idempotent.
-- =============================================================================

do $$ begin
  create type esign_request_status as enum ('draft', 'sent', 'partially_signed', 'completed', 'declined', 'cancelled', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type esign_signer_status as enum ('pending', 'viewed', 'otp_sent', 'otp_verified', 'signed', 'declined');
exception when duplicate_object then null; end $$;

create table if not exists esign_requests (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references firms(id) on delete cascade,
  case_id             uuid references cases(id) on delete set null,
  requested_by        uuid not null references users(id) on delete cascade,
  title               text not null,
  -- The document AS SENT FOR SIGNING. source_document_id points at the
  -- existing documents row; source_sha256 is computed at request-creation
  -- time from those exact bytes, so any later edit to the source document
  -- is detectable even before signing completes.
  source_document_id  uuid not null references documents(id) on delete restrict,
  source_sha256       text not null,
  -- Populated once every signer has signed: a NEW documents row (the signed
  -- PDF, with the audit-trail summary page appended) and its hash. Kept
  -- separate from source_document_id - signing never mutates the original.
  signed_document_id  uuid references documents(id) on delete set null,
  signed_sha256       text,
  status              esign_request_status not null default 'draft',
  -- Advisory, not enforced: IT Act Section 1(4) / First Schedule excludes
  -- certain instruments from electronic execution entirely regardless of
  -- signature tier (negotiable instruments other than cheques, powers of
  -- attorney, trusts, wills, and immovable-property conveyances are the
  -- commonly-cited examples - flagged here as a UI warning prompt, not
  -- independently re-verified against primary source for this migration,
  -- so it must not be used as a hard block).
  document_type_hint  text,
  expires_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists esign_requests_firm_idx on esign_requests (firm_id);
create index if not exists esign_requests_case_idx on esign_requests (case_id) where case_id is not null;
create index if not exists esign_requests_source_doc_idx on esign_requests (source_document_id);

create table if not exists esign_signers (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null references esign_requests(id) on delete cascade,
  -- Set when the signer is a LexDraft user (e.g. a co-counsel); null for an
  -- external party (client, opposing counsel) who signs via token link only.
  user_id             uuid references users(id) on delete set null,
  name                text not null,
  email               text not null,
  "order"             integer not null default 1,
  token               text not null unique,
  status              esign_signer_status not null default 'pending',
  -- Captured once, at the moment of signing - the explicit "I agree to sign
  -- electronically" consent screen Leegality's audit trail and the Second
  -- Schedule reliability test both treat as load-bearing. Free text so the
  -- exact disclosure wording in force at signing time is preserved verbatim,
  -- not just a boolean.
  consent_text        text,
  consent_at          timestamptz,
  signed_at           timestamptz,
  -- IP/device/geolocation captured at the SIGNING moment specifically (also
  -- logged per-event in esign_audit_events, but kept here too for a fast
  -- single-row summary on the signed-document audit page).
  signed_ip           text,
  signed_user_agent   text,
  declined_reason     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists esign_signers_request_idx on esign_signers (request_id);
create unique index if not exists esign_signers_token_idx on esign_signers (token);

create table if not exists esign_otp_challenges (
  id                  uuid primary key default gen_random_uuid(),
  signer_id           uuid not null references esign_signers(id) on delete cascade,
  -- Never store the raw OTP - only its hash, same discipline as a password.
  code_hash           text not null,
  sent_to_email       text not null,
  expires_at          timestamptz not null,
  verified_at         timestamptz,
  attempts            integer not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists esign_otp_challenges_signer_idx on esign_otp_challenges (signer_id);

create table if not exists esign_audit_events (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null references esign_requests(id) on delete cascade,
  signer_id           uuid references esign_signers(id) on delete set null,
  -- 'request_created' | 'sent' | 'opened' | 'consent_provided' |
  -- 'otp_sent' | 'otp_verified' | 'otp_failed' | 'signed' | 'declined' |
  -- 'completed' | 'cancelled' | 'expired' | 'downloaded'
  event_type          text not null,
  detail              jsonb not null default '{}'::jsonb,
  ip_address          text,
  user_agent          text,
  -- Hash chain: sha256(prev_event_hash || event_type || detail || occurred_at)
  -- for the previous event on this SAME request (null for the first event).
  -- Any later edit/delete of an earlier row changes what a re-computed chain
  -- produces, so tampering is detectable by recomputation even without a CA-
  -- backed timestamp authority. See esign-audit.service.ts for the exact
  -- hashing procedure.
  prev_event_hash     text,
  event_hash          text not null,
  occurred_at         timestamptz not null default now()
);
create index if not exists esign_audit_events_request_idx on esign_audit_events (request_id, occurred_at);
