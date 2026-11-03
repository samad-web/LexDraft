-- 0099: compose_outcomes — one row per COMPOSE pass (intake-compose), so the
-- superadmin can see, per document type, how often the drafted body reached the
-- advocate versus falling back to the engine's plain skeleton, and why.
--
-- No draft text, facts or names are stored: only the doc type, the outcome, a
-- reason category and counts. Append-only; additive only.

create table if not exists compose_outcomes (
  id               bigserial primary key,
  created_at       timestamptz not null default now(),
  firm_id          uuid,
  doc_type         text not null,
  -- 'composed' | 'skeleton'
  status           text not null,
  -- null when composed; else 'dropped' | 'unlocated' | 'reply_drift' | 'empty' | 'unavailable' | 'splice'
  reason_kind      text,
  removed_count    integer not null default 0,
  authorities      integer not null default 0,
  authorities_cited integer not null default 0,
  planned          boolean not null default false,
  repaired         boolean not null default false
);

create index if not exists compose_outcomes_created_idx on compose_outcomes (created_at);
create index if not exists compose_outcomes_doc_type_idx on compose_outcomes (doc_type, created_at);
