-- =============================================================================
-- 0082_cases_opposing_party.sql
-- =============================================================================
-- Adds a real, structured opposing_party column to cases — closes one of the
-- three documented gaps in conflicts.service.ts's own header comment: "The
-- cases table doesn't yet carry a structured opposing_party column - we mine
-- cases.title ('X v. Y') which is heuristic."
--
-- That mining was never actually implemented server-side (confirmed by
-- reading conflicts.service.ts's real check() function — it only ever did a
-- plain substring match against cases.title/cases.client, never parsed "X v.
-- Y" at all). The ACTUAL "X v. Y" parser (deriveOpposingFromTitle) already
-- existed, but only client-side in NewCaseModal.tsx, used for the live
-- pre-filing conflict check — its result was never persisted, so once a case
-- was saved, any LATER conflict check against it fell back to the cruder
-- title/client substring match, losing the precision the form already had at
-- creation time.
--
-- This migration adds the column; cases.service.ts's create() now derives
-- and persists it server-side (same regex, moved/duplicated into the API so
-- it's always populated regardless of what the client sends); a one-time
-- backfill below derives it for every existing row with a parseable title.
--
-- Nullable — a case whose title doesn't follow "X v. Y" (consent terms,
-- miscellaneous applications, etc.) legitimately has no derivable opposing
-- party; conflicts.service.ts falls back to the title/client substring
-- match for those rows, same as before.
-- =============================================================================

alter table cases add column if not exists opposing_party text;

create index if not exists cases_opposing_party_idx on cases (lower(opposing_party))
  where opposing_party is not null;

-- One-time backfill for existing rows: same "v. / vs. / versus" split the
-- frontend already uses, expressed in SQL. regexp_match returns null (not an
-- error) when the pattern doesn't match, so titles without a recognisable
-- separator are correctly left null.
update cases
set opposing_party = trim(
  substring(title from '(?i)\s+(?:v\.?|vs\.?|versus)\s+(.+)$')
)
where opposing_party is null
  and title ~* '\s+(?:v\.?|vs\.?|versus)\s+';
