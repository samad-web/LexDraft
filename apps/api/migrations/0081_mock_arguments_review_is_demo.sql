-- =============================================================================
-- 0081_mock_arguments_review_is_demo.sql
-- =============================================================================
-- Flags a review row as a placeholder/demonstration review — produced when
-- no LLM provider is configured (env.llmProvider === 'none') or when the
-- model's response couldn't be parsed into a real review (distilReview
-- returned null). Previously the ONLY signal of this was a sentence buried
-- in qualitativeSummary ("Demonstration review — no LLM provider is
-- configured..."); the big, prominent overall-score donut (e.g. "58/100")
-- rendered with zero visual distinction from a real graded review — an
-- advocate skimming the page had no reliable way to tell a canned stub
-- apart from genuine feedback on their actual argument. The UI now checks
-- this column directly and shows the same kind of warning banner already
-- used for the "scores didn't parse" case, rather than a fragile string
-- match on qualitativeSummary's exact wording.
--
-- Nullable-default-false + backward compatible with existing rows (treated
-- as real reviews, which they were — demo mode is new, not retroactive).
-- =============================================================================

alter table mock_argument_reviews
  add column if not exists is_demo boolean not null default false;
