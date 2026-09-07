-- =============================================================================
-- 0061_notifications.sql
-- =============================================================================
-- In-app notification feed. Until now the only notification channel was email
-- (notifications.service.ts -> jobs.enqueue('email.send')), and the web app's
-- bell/panel was backed entirely by a client-side Zustand store seeded with a
-- demo item. This table gives notifications a server home so events raised by
-- backend jobs — the nightly eCourts sync being the first — surface in every
-- session, survive a reload, and carry a real read/unread state.
--
-- Scope: user-addressed. `user_id` is the recipient; `firm_id` is denormalised
-- for tenant-scoped queries and cascade cleanup. A firm-broadcast notification
-- is modelled as one row per recipient user (the sender fans out), matching how
-- the email path already resolves firm-admin recipients.
--
-- `view` mirrors the client store's field: the app-shell route the bell click
-- navigates to (e.g. 'cases'). `tone` / `icon` drive the panel's colour + glyph
-- and are constrained to the sets the UI already renders.
-- =============================================================================

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  tone        text not null default 'cobalt'
                check (tone in ('cobalt', 'sage', 'amber', 'vermillion')),
  icon        text not null default 'bell',
  title       text not null,
  body        text not null default '',
  -- App-shell route to open on click (matches the web store's `view`).
  view        text not null default 'dashboard',
  -- Optional dedupe / grouping key. The eCourts sync stamps this as
  -- `ecourts-sync:<caseId>:<yyyy-mm-dd>` so a re-run on the same day updates
  -- rather than piling on duplicates (handled in the service via upsert).
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- The panel query: newest-first for one user. Partial companion index keeps the
-- unread-count check cheap.
create index if not exists notifications_user_idx
  on notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx
  on notifications (user_id) where read_at is null;

-- One live row per (user, dedupe_key). Lets the service upsert same-day sync
-- notifications instead of spawning a new one every nightly run.
create unique index if not exists notifications_dedupe_uidx
  on notifications (user_id, dedupe_key) where dedupe_key is not null;
