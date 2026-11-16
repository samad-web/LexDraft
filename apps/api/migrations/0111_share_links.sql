-- Secure share links (build-docs/features/secure-share-link.md).
-- The advocate sends the client a DifAi link instead of the file. Each link
-- holds its own encrypted copy of the file (storage key under shares/), expires,
-- can be revoked, can need a password, and counts views. Additive: new table only.
--
-- token_hash: sha256 of the random token; the token itself is only in the URL.
-- password_hash: scrypt$<salt>$<hash>, null = no password.

create table if not exists share_links (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid not null references firms(id) on delete cascade,
  created_by       uuid references users(id) on delete set null,
  token_hash       text not null unique,
  storage_key      text,
  file_name        text not null,
  content_type     text not null,
  file_size        bigint not null,
  password_hash    text,
  failed_attempts  integer not null default 0,
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  view_count       integer not null default 0,
  last_viewed_at   timestamptz,
  file_deleted_at  timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists share_links_firm_idx on share_links (firm_id, created_at desc);
create index if not exists share_links_sweep_idx on share_links (expires_at) where file_deleted_at is null;
