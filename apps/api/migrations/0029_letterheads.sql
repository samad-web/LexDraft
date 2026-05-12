-- =============================================================================
-- 0029_letterheads.sql
-- =============================================================================
-- Per-firm + per-user letterhead library — the design data the Settings →
-- Letterhead editor saves, and the exporter renders at the top of every
-- generated document (PDF / DOCX). Replaces the centered "DOCUMENT TITLE"
-- block currently injected by buildDocumentHtml.
--
-- Two-library model (per product decision):
--   - Firm letterheads: `owner_user_id IS NULL`. Visible to every member of
--     the firm. Firm admins (or anyone with letterhead permission) manage
--     these.
--   - Personal letterheads: `owner_user_id IS NOT NULL`. Visible only to
--     the owner. Useful when one advocate in a firm wants their own.
--
-- The editor is template-driven: `template_key` selects one of a small fixed
-- set of layouts (defined client-side); `fields_json` carries the slot values
-- the chosen template expects (firm name, tagline, address lines, contact
-- details, registration number, footer, accent colour, etc). Storing the
-- fields as JSONB keeps the schema stable as new templates land.
--
-- The logo lives under the existing storage driver (local / s3 / r2). We
-- only persist `logo_key` here — never inline data URLs — so the JSON
-- blob stays small.
--
-- Default invariants:
--   - At most one firm-scoped default per firm.
--   - At most one personal default per user.
--   - These are enforced by partial unique indexes; the service also clears
--     the prior default within the same transaction when promoting a new one,
--     so concurrent toggles can't trip the index.
-- =============================================================================

create table if not exists letterheads (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references firms(id) on delete cascade,
  -- null = firm-scoped (shared with every firm member). non-null = personal.
  owner_user_id   uuid references users(id) on delete cascade,
  name            text not null,
  template_key    text not null,
  fields_json     jsonb not null default '{}'::jsonb,
  logo_key        text,
  is_default      boolean not null default false,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Browse by firm — the common list-letterheads-for-this-firm query.
create index if not exists letterheads_firm_idx on letterheads (firm_id);
-- Personal lookup — list-mine-only path.
create index if not exists letterheads_owner_idx
  on letterheads (owner_user_id) where owner_user_id is not null;

-- One firm-scoped default per firm. Partial index — non-default rows
-- coexist freely.
create unique index if not exists letterheads_firm_default_uq
  on letterheads (firm_id) where owner_user_id is null and is_default = true;
-- One personal default per user.
create unique index if not exists letterheads_user_default_uq
  on letterheads (owner_user_id) where owner_user_id is not null and is_default = true;

-- Keep updated_at fresh via the shared trigger function from 0001_init.sql.
do $$ begin
  create trigger trg_letterheads_updated
    before update on letterheads
    for each row execute function set_updated_at();
exception when duplicate_object then null; end $$;
