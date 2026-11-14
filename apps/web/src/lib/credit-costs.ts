// AI credit costs shown on buttons. Mirrors apps/api/src/lib/credit-costs.ts
// (ai-credits.test checks they match). 1 credit = one 400-word drafted page.
export const CREDIT_COSTS = {
  draft_chat: 0.5,
  matter_chat: 0.5,
  diary_assistant: 0.5,
  document_ask: 0.5,
  extract: 0.5,
  title_report: 0.5,
  check_missing: 1,
  research: 2,
  matter_intel: 2,
  format_read: 2,
  mock_arguments: 3,
  contract_review: 6,
} as const;

/** "½ credit" / "1 credit" / "2½ credits". */
export function creditLabel(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  const num = whole === 0 && half ? '½' : `${whole}${half ? '½' : ''}`;
  return `${num} credit${n === 1 || (whole === 0 && half) ? '' : 's'}`;
}
