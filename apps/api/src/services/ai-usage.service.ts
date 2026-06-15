/**
 * AI token-usage recorder.
 *
 * Sibling to ai-quota.service. Where the quota service counts billable
 * generations against a per-user cap, this service stores the raw token counts
 * returned by the provider for every LLM call, into ai_token_usage. The
 * superadmin AI-usage dashboard aggregates this table for token totals,
 * per-firm / per-feature breakdowns and cost estimates.
 *
 * Recording is strictly best-effort: a dropped insert must never turn a
 * successful AI response into a 500. Every caller wraps record() so a failure
 * is swallowed and logged, and record() itself no-ops when there is no DB
 * (demo mode) or when there are no tokens to record.
 */

import { db } from '../db/client';
import { logger } from '../logger';

export type AiUsageFeature =
  | 'drafting'
  | 'matter_chat'
  | 'diary_assistant'
  | 'draft_extract'
  | 'matter_intel'
  | 'mock_arguments'
  | 'review'
  | 'title_report'
  | 'laws_search';

export interface AiUsageRecord {
  firmId: string | null;
  userId: string | null;
  feature: AiUsageFeature;
  provider?: string | null;
  model?: string | null;
  /** Fresh (uncached) input tokens - billed at 1x. */
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** Input tokens served from the prompt cache - billed at ~0.1x. */
  cacheReadTokens?: number | null;
  /** Input tokens written to the prompt cache this call - billed at ~1.25x. */
  cacheWriteTokens?: number | null;
}

function clampToken(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

export const aiUsageService = {
  /**
   * Append one token-usage row. Best-effort: never throws. Skips the insert
   * when there is no DB or when both token counts are zero (nothing worth
   * recording - e.g. a template fallback that didn't call a provider).
   */
  async record(rec: AiUsageRecord): Promise<void> {
    const tokensIn = clampToken(rec.tokensIn);
    const tokensOut = clampToken(rec.tokensOut);
    const cacheRead = clampToken(rec.cacheReadTokens);
    const cacheWrite = clampToken(rec.cacheWriteTokens);
    if (tokensIn === 0 && tokensOut === 0 && cacheRead === 0 && cacheWrite === 0) return;

    const sql = db();
    if (!sql) return;

    try {
      await sql`
        insert into ai_token_usage
          (firm_id, user_id, feature, provider, model,
           tokens_in, tokens_out, cache_read_tokens, cache_write_tokens)
        values
          (${rec.firmId}, ${rec.userId}, ${rec.feature},
           ${rec.provider ?? null}, ${rec.model ?? null},
           ${tokensIn}, ${tokensOut}, ${cacheRead}, ${cacheWrite})
      `;
    } catch (err) {
      logger.warn({ err, feature: rec.feature }, 'ai-usage record failed');
    }
  },

  /**
   * Fire-and-forget variant for hot paths (streaming) where the caller does
   * not want to await the insert. Errors are swallowed internally by record().
   */
  recordAsync(rec: AiUsageRecord): void {
    void this.record(rec);
  },
};
