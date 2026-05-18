-- =============================================================================
-- 0034_firm_enquiries.sql
-- =============================================================================
-- Firm-tier sales enquiries captured by the public /auth/firm-enquiry endpoint.
-- Picking "Firm" in the sign-up role chooser short-circuits the self-serve
-- flow: instead of creating an account, the prospect leaves their contact
-- details and a partner reaches out. One row per submission.
--
-- This is intentionally NOT linked to the users/firms tables -- the prospect
-- has no account at this point. If/when they're converted, sales onboards
-- them manually and the existing sign-up endpoint creates the user record.
--
-- Submission metadata (submitted_at / ip_address / user_agent) is set
-- server-side from req.ip and req.headers; the client never sets them.
-- status starts at 'new'; sales advances it through the lifecycle.
-- =============================================================================

create table if not exists firm_enquiries (
  id            uuid primary key default gen_random_uuid(),
  submitted_at  timestamptz not null default now(),
  ip_address    inet,
  user_agent    text,

  -- Contact + organisation -------------------------------------------------
  name          text not null,
  email         text not null,
  phone         text,
  firm_name     text not null,
  -- Coarse size bucket so sales can route by deal size before the call.
  firm_size     text not null,
  -- Geo / practice context to pre-load for the partner call.
  primary_court text,
  practice_areas text,
  -- Free-text "what brought you to us" so the partner has something to open with.
  message       text,

  -- Lifecycle --------------------------------------------------------------
  -- new       → just submitted, untouched
  -- contacted → partner has reached out
  -- demo      → demo scheduled or held
  -- won       → converted to a paid Firm account (manually onboarded)
  -- lost      → not pursuing
  status        text not null default 'new',

  constraint firm_enquiries_email_nonempty   check (length(btrim(email)) > 0),
  constraint firm_enquiries_firm_nonempty    check (length(btrim(firm_name)) > 0),
  constraint firm_enquiries_firm_size_chk    check (firm_size in ('9-25','26-50','51-100','100+')),
  constraint firm_enquiries_status_chk       check (status in ('new','contacted','demo','won','lost'))
);

create index if not exists firm_enquiries_submitted_at_idx
  on firm_enquiries (submitted_at desc);

create index if not exists firm_enquiries_status_idx
  on firm_enquiries (status, submitted_at desc);

-- Lower-cased email for dedup investigations / follow-up. Not unique:
-- a prospect may legitimately resubmit (different firm, asking again, etc.).
create index if not exists firm_enquiries_email_idx
  on firm_enquiries (lower(email));
