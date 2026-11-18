-- Forgot password via a WhatsApp code (features/forgot-password-whatsapp.md).
-- Additive only: phone_otp_challenges also holds password-reset codes, bound
-- to the account (user_id) instead of a Google sign-up (google_sub).
alter table phone_otp_challenges drop constraint if exists phone_otp_challenges_purpose_check;
alter table phone_otp_challenges add constraint phone_otp_challenges_purpose_check
  check (purpose in ('signup', 'password_reset'));
alter table phone_otp_challenges add column if not exists user_id uuid references users(id) on delete cascade;
