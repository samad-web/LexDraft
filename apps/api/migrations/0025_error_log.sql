-- =============================================================================
-- 0025_error_log.sql
-- =============================================================================
-- In-app, Postgres-backed error capture. We do not run OpenTelemetry or Sentry
-- in production, so the error middleware persists 5xx and a curated subset of
-- 4xx (403/422/429) into this table for the SuperAdmin viewer. Distinct from
-- `audit_log` (business events, 7-year DPDP retention) - these are technical
-- incidents that an operator triages, marks resolved, and eventually purges.
--
-- The capture path is fire-and-forget from the error middleware's perspective:
-- a failed insert MUST NOT crash request handling. The service implements that
-- semantically; this DDL just makes the destination available.
--
-- Indices are deliberately conservative - newest-first scans, status/user/firm
-- filters, and a partial index on the common "show me unresolved" query.
-- =============================================================================

create table if not exists error_log (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  request_id      text,
  user_id         uuid references users(id) on delete set null,
  firm_id         uuid references firms(id) on delete set null,
  method          text not null,
  path            text not null,
  status          integer not null,
  error_name      text not null,                  -- e.g. 'TypeError', 'HttpError', 'NotFoundError'
  error_message   text not null,
  error_stack     text,                            -- truncated to 4096 chars by the service
  user_agent      text,
  ip              text,
  -- Whatever extra context the handler thought useful. Bounded by
  -- pino-redact-style scrubbing in error-log.service.ts before insert.
  context         jsonb,
  -- Set when an operator marks the error as triaged or won't-fix.
  resolved_at     timestamptz,
  resolved_by     uuid references users(id) on delete set null,
  resolution_note text
);

create index if not exists error_log_occurred_idx    on error_log (occurred_at desc);
create index if not exists error_log_status_idx      on error_log (status);
create index if not exists error_log_user_idx        on error_log (user_id);
create index if not exists error_log_firm_idx        on error_log (firm_id);
-- The "unresolved feed" is the default landing query on the admin viewer;
-- a partial index keeps it cheap even as resolved rows accumulate.
create index if not exists error_log_unresolved_idx
  on error_log (occurred_at desc) where resolved_at is null;
