-- =============================================================================
-- 0040_trial_and_demo.sql
-- =============================================================================
-- Adds trial + demo plumbing for the new landing-page funnel:
--
--   firms.trial_ends_at    Timestamp at which a trialing firm's grace ends.
--                          Null on legacy/paid firms (no trial constraint).
--                          Set when /api/auth/sign-up is hit with intent='trial'.
--                          plan-status.service refuses sessions when status='trial'
--                          AND trial_ends_at < now() (with a 1-day grace).
--
--   firms.is_demo          Marks a firm provisioned through the interactive
--                          demo flow. The UI surfaces a "Demo session" badge
--                          and a "Convert to a real account" CTA; ops uses
--                          this flag to prune stale demo tenants on a job.
--
--   demo_requests          Public submissions from the landing page's "Get a
--                          demo" form. Mirrors firm_enquiries but separates
--                          contact vs schedule intents so sales can route.
-- =============================================================================

alter table firms
  add column if not exists trial_ends_at timestamptz;

alter table firms
  add column if not exists is_demo boolean not null default false;

create table if not exists demo_requests (
  id             uuid primary key default gen_random_uuid(),
  submitted_at   timestamptz not null default now(),
  ip_address     inet,
  user_agent     text,

  name           text not null,
  email          text not null,
  firm_name      text,
  phone          text,
  preferred_time text,                  -- free-text time window the prospect proposed
  message        text,
  -- 'contact'  - prospect wants sales to reach out
  -- 'schedule' - prospect proposed a specific time slot
  demo_type      text not null,

  -- new -> contacted -> demoed -> won|lost; sales advances it
  status         text not null default 'new',

  constraint demo_requests_demo_type_chk
    check (demo_type in ('contact', 'schedule')),
  constraint demo_requests_status_chk
    check (status in ('new', 'contacted', 'demoed', 'won', 'lost')),
  constraint demo_requests_email_nonempty
    check (length(btrim(email)) > 0)
);

create index if not exists demo_requests_submitted_at_idx
  on demo_requests (submitted_at desc);
create index if not exists demo_requests_status_idx
  on demo_requests (status, submitted_at desc);
create index if not exists demo_requests_email_idx
  on demo_requests (lower(email));
