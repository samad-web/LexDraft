-- hearings-calendar-feed (build-docs/features/hearings-calendar-feed.md). Additive.
-- The advocate's private hearings calendar link (Apple / Google / Outlook).
-- NULL = off. The link's token is derived from this version with a server
-- secret, so no token is stored; bumping the version kills every old copy.
alter table users add column if not exists calendar_feed_version int;
