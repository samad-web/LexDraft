-- Google sign-in + WhatsApp-verified phone at sign-up.
-- Additive only: three nullable columns on users and one new table. Existing
-- email + password accounts are untouched (their new columns stay null).
--
-- users.google_sub         Google's stable account id ("sub" claim). Set when
--                          a user signs up with Google, or when an existing
--                          email user first signs in with the same Google email.
-- users.phone              E.164 WhatsApp number verified at sign-up.
-- users.phone_verified_at  When the WhatsApp OTP for that number was proved.
alter table users add column if not exists google_sub text;
alter table users add column if not exists phone text;
alter table users add column if not exists phone_verified_at timestamptz;

create unique index if not exists users_google_sub_key on users (google_sub) where google_sub is not null;
create index if not exists users_phone_idx on users (phone) where phone is not null;

-- One row per OTP sent over WhatsApp. The code itself is never stored, only
-- its SHA-256. A challenge is tied to the Google account that requested it,
-- so a code proved by one sign-up can't be replayed by another.
create table if not exists phone_otp_challenges (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  purpose      text not null default 'signup' check (purpose in ('signup')),
  google_sub   text,
  code_hash    text not null,
  attempts     int not null default 0,
  expires_at   timestamptz not null,
  verified_at  timestamptz,
  ip_address   text,
  created_at   timestamptz not null default now()
);

create index if not exists phone_otp_challenges_phone_idx on phone_otp_challenges (phone, created_at desc);
