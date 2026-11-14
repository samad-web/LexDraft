-- Brief Packs (features/brief-packs.md). Additive: one more billing event kind.
alter table billing_events drop constraint if exists billing_events_kind_check;
alter table billing_events add constraint billing_events_kind_check check (kind in (
  'signup', 'checkout_started', 'subscription_active', 'renewed',
  'plan_changed', 'payment_failed', 'on_hold', 'cancelled', 'expired', 'pack_bought'));
