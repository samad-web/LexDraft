-- ---- eCourts case store ----------------------------------------------------
--
-- Every case record LexDraft fetches from eCourts is kept here, so opening a
-- case shows the stored copy instantly instead of waiting 5-15 s on eCourts
-- (or failing outright when eCourts is down or throttling). Same idea as the
-- 09:00 / 19:00 IST sync for matters, extended to every case an advocate
-- looks at:
--   - served instantly from here; refreshed in the background when older
--     than a few hours (ecourts-case-store.service.ts)
--   - written through by every live fetch, so the scheduled sync of the
--     firm's matters keeps their rows fresh automatically
--   - cases viewed in the last 7 days that are NOT matters are refreshed by
--     the same scheduled slots
--
-- Public court data (what anyone can see on eCourts), not firm data, so it
-- is one shared table rather than firm-scoped.

create table if not exists ecourts_case_store (
  -- 'history' = caseHistoryWebService (full case), 'filing' = filingCaseHistory
  -- (next date / status shown on search-result rows)
  kind        text not null check (kind in ('history', 'filing')),
  cnr         text not null,
  court       text not null check (court in ('DC', 'HC')),
  -- null = eCourts answered that it has no such case (kept so we don't ask again)
  data        jsonb,
  fetched_at  timestamptz not null default now(),
  viewed_at   timestamptz,
  primary key (kind, cnr, court)
);

create index if not exists ecourts_case_store_viewed_idx
  on ecourts_case_store (viewed_at desc)
  where viewed_at is not null;
