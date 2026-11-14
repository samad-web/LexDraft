-- AI credits (features/ai-credits.md). Additive: ai_generations / plan_ai_caps
-- stay for history but no longer limit anything.
-- 1 credit = one 400-word drafted page; amounts move in half credits.

-- Credits a firm can spend: the monthly plan allowance, Brief Packs, admin grants.
create table if not exists credit_grants (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms(id) on delete cascade,
  source      text not null check (source in ('plan', 'topup', 'admin')),
  amount      numeric(8,1) not null check (amount >= 0),
  remaining   numeric(8,1) not null check (remaining >= 0 and remaining <= amount),
  cycle_start timestamptz,
  expires_at  timestamptz not null,
  -- Idempotency: 'plan:<firm>:<cycle>', 'topup:<payment id>', 'admin:<uuid>'.
  ref         text not null unique,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists credit_grants_firm_idx on credit_grants (firm_id, expires_at);

-- Every spend and refund. ref_key is unique, so a retried charge never counts twice.
create table if not exists credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms(id) on delete cascade,
  user_id     uuid,
  action      text not null,
  credits     numeric(8,1) not null,          -- spend > 0, refund < 0
  kind        text not null check (kind in ('spend', 'refund')),
  ref_key     text not null unique,
  allocations jsonb not null default '[]',    -- [{grant, amount}] taken from / given back to
  meta        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists credit_ledger_firm_idx on credit_ledger (firm_id, created_at desc);

-- A draft's pages: paid so far vs needed. Pages past `paid` are locked (cut
-- server-side); `payload` holds the hidden full text of a plain-text draft.
create table if not exists metered_drafts (
  ref_key     text primary key,               -- 'intake:<matter>:<doc>' / 'text:<uuid>'
  firm_id     uuid not null references firms(id) on delete cascade,
  user_id     uuid,
  needed      numeric(8,1) not null default 0,
  paid        numeric(8,1) not null default 0,
  total_words integer not null default 0,
  payload     jsonb,
  updated_at  timestamptz not null default now()
);
create index if not exists metered_drafts_firm_idx on metered_drafts (firm_id, updated_at desc);
