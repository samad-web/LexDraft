// =============================================================================
// AI credit costs (build-docs/features/ai-credits.md). DRAFT numbers from
// pricing v4, not final: change them here only. Mirrored in web
// lib/credit-costs.ts (ai-credits.test keeps them in step).
// 1 credit = one 400-word drafted page. Costs move in half credits.
// =============================================================================

export const WORDS_PER_CREDIT = 400;

/** Fixed costs per AI action, in credits. */
export const CREDIT_COSTS = {
  draft_chat: 0.5,        // Draft-box question
  matter_chat: 0.5,
  diary_assistant: 0.5,
  document_ask: 0.5,
  extract: 0.5,           // facts from a document
  title_report: 0.5,      // title report AI read
  check_missing: 1,       // Check what's missing / draft review
  research: 2,            // legal research / related law
  matter_intel: 2,        // matter brief / document summary
  format_read: 2,         // upload a format
  mock_arguments: 3,      // one session
  contract_review: 6,     // up to 10 pages, then ½ a page
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS | 'draft' | 'revise';

/** Monthly credits for free-launch accounts till 1 Jun 2027 (owner, 2026-11-14). */
export const FREE_LAUNCH_CREDITS = 25;

/** Round up to the next half credit. */
export const roundUpHalf = (n: number) => Math.ceil(n * 2 - 1e-9) / 2;

/** Credits for a drafted document: 1 per 400 words, rounded up to ½, minimum 1. */
export function draftCredits(words: number): number {
  return Math.max(1, roundUpHalf(words / WORDS_PER_CREDIT));
}

/** "Update document": ½ per page rewritten, minimum ½. */
export function reviseCredits(words: number): number {
  return Math.max(0.5, roundUpHalf(words / WORDS_PER_CREDIT));
}

/** Contract review: 6 credits up to 10 pages, then ½ per extra page. */
export function contractReviewCredits(words: number): number {
  const pages = Math.ceil(words / WORDS_PER_CREDIT);
  return CREDIT_COSTS.contract_review + Math.max(0, pages - 10) * 0.5;
}

export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}
