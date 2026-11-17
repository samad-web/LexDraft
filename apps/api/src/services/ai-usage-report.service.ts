/**
 * AI token-usage reporting (read side of ai_token_usage).
 *
 * Aggregates the append-only ai_token_usage fact table for the superadmin
 * dashboard: headline totals, per-feature and per-firm breakdowns, and a daily
 * trend. Estimated cost is computed here from the per-row model column via the
 * static price map (lib/ai-pricing) - never persisted, so a price-card change
 * re-prices history automatically.
 *
 * Because cost depends on the model, every aggregation groups by model first,
 * prices each (group, model) bucket, then folds the buckets together.
 */

import type {
  AdminAiUsageUser,
  AdminAiUsageResponse,
  AiUsageByFeature,
  AiUsageByFirm,
  AiUsageFeature,
  AiUsageSummary,
  AiUsageTrendPoint,
} from '@lexdraft/types';
import { db } from '../db/client';
import { estimateCostUsd, USD_INR } from '../lib/ai-pricing';

interface ModelBucketRow {
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_write: number;
}

interface FeatureBucketRow extends ModelBucketRow {
  feature: string;
}

interface FirmBucketRow extends ModelBucketRow {
  firm_id: string | null;
  firm_name: string | null;
}

const EMPTY_SUMMARY: AiUsageSummary = {
  tokensIn: 0, tokensOut: 0, totalTokens: 0, estCostUsd: 0, estCostInr: 0,
};

function summariseModelBuckets(rows: ModelBucketRow[]): AiUsageSummary {
  // `tokensIn` reported to the UI is the TOTAL input processed (fresh + cache
  // read + cache write) so the token volume reads honestly; cost prices each
  // class at its own rate.
  let inputTotal = 0;
  let tokensOut = 0;
  let estCostUsd = 0;
  for (const r of rows) {
    const fresh = Number(r.tokens_in) || 0;
    const cacheRead = Number(r.cache_read) || 0;
    const cacheWrite = Number(r.cache_write) || 0;
    const to = Number(r.tokens_out) || 0;
    inputTotal += fresh + cacheRead + cacheWrite;
    tokensOut += to;
    estCostUsd += estimateCostUsd(r.model, fresh, to, cacheRead, cacheWrite);
  }
  return {
    tokensIn: inputTotal,
    tokensOut,
    totalTokens: inputTotal + tokensOut,
    estCostUsd: round2(estCostUsd),
    estCostInr: Math.round(estCostUsd * USD_INR),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Coerce a raw aggregated DB row (bigint → string) into a numeric bucket. */
function toBucket(r: { model: string | null; tokens_in: number; tokens_out: number; cache_read: number; cache_write: number }): ModelBucketRow {
  return {
    model: r.model,
    tokens_in: Number(r.tokens_in),
    tokens_out: Number(r.tokens_out),
    cache_read: Number(r.cache_read),
    cache_write: Number(r.cache_write),
  };
}

export const aiUsageReportService = {
  /** Headline totals for [start, end). Used by the dashboard cards + /stats. */
  async summary(start: Date, end: Date): Promise<AiUsageSummary> {
    const sql = db();
    if (!sql) return EMPTY_SUMMARY;
    const rows = await sql<ModelBucketRow[]>`
      select model,
             coalesce(sum(tokens_in), 0)::bigint         as tokens_in,
             coalesce(sum(tokens_out), 0)::bigint        as tokens_out,
             coalesce(sum(cache_read_tokens), 0)::bigint  as cache_read,
             coalesce(sum(cache_write_tokens), 0)::bigint as cache_write
      from ai_token_usage
      where created_at >= ${start} and created_at < ${end}
      group by model
    `;
    return summariseModelBuckets(rows.map(toBucket));
  },

  /** Full breakdown payload for GET /admin/ai-usage. */
  async report(start: Date, end: Date): Promise<AdminAiUsageResponse> {
    const sql = db();
    if (!sql) {
      return {
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
        totals: EMPTY_SUMMARY,
        byFeature: [],
        byFirm: [],
        trend: [],
      };
    }

    const [featureRows, firmRows, trendRows] = await Promise.all([
      sql<FeatureBucketRow[]>`
        select feature, model,
               coalesce(sum(tokens_in), 0)::bigint         as tokens_in,
               coalesce(sum(tokens_out), 0)::bigint        as tokens_out,
               coalesce(sum(cache_read_tokens), 0)::bigint  as cache_read,
               coalesce(sum(cache_write_tokens), 0)::bigint as cache_write
        from ai_token_usage
        where created_at >= ${start} and created_at < ${end}
        group by feature, model
      `,
      sql<FirmBucketRow[]>`
        select u.firm_id,
               f.name as firm_name,
               u.model,
               coalesce(sum(u.tokens_in), 0)::bigint         as tokens_in,
               coalesce(sum(u.tokens_out), 0)::bigint        as tokens_out,
               coalesce(sum(u.cache_read_tokens), 0)::bigint  as cache_read,
               coalesce(sum(u.cache_write_tokens), 0)::bigint as cache_write
        from ai_token_usage u
        left join firms f on f.id = u.firm_id
        where u.created_at >= ${start} and u.created_at < ${end}
        group by u.firm_id, f.name, u.model
      `,
      sql<Array<{ day: string; tokens_in: number; tokens_out: number }>>`
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
               coalesce(sum(tokens_in + cache_read_tokens + cache_write_tokens), 0)::bigint as tokens_in,
               coalesce(sum(tokens_out), 0)::bigint as tokens_out
        from ai_token_usage
        where created_at >= ${start} and created_at < ${end}
        group by 1
        order by 1 asc
      `,
    ]);

    // --- fold per-(feature, model) buckets into per-feature rows ---
    const byFeatureMap = new Map<string, ModelBucketRow[]>();
    for (const r of featureRows) {
      const arr = byFeatureMap.get(r.feature) ?? [];
      arr.push(toBucket(r));
      byFeatureMap.set(r.feature, arr);
    }
    const byFeature: AiUsageByFeature[] = Array.from(byFeatureMap.entries())
      .map(([feature, buckets]) => {
        const s = summariseModelBuckets(buckets);
        return {
          feature: feature as AiUsageFeature,
          tokensIn: s.tokensIn,
          tokensOut: s.tokensOut,
          totalTokens: s.totalTokens,
          estCostUsd: s.estCostUsd,
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens);

    // --- fold per-(firm, model) buckets into per-firm rows ---
    const byFirmMap = new Map<string, { firmId: string | null; firmName: string; buckets: ModelBucketRow[] }>();
    for (const r of firmRows) {
      const key = r.firm_id ?? '__none__';
      const entry = byFirmMap.get(key) ?? {
        firmId: r.firm_id,
        firmName: r.firm_name ?? (r.firm_id ? '(deleted firm)' : 'Platform / no firm'),
        buckets: [],
      };
      entry.buckets.push(toBucket(r));
      byFirmMap.set(key, entry);
    }
    const byFirm: AiUsageByFirm[] = Array.from(byFirmMap.values())
      .map((e) => {
        const s = summariseModelBuckets(e.buckets);
        return {
          firmId: e.firmId,
          firmName: e.firmName,
          tokensIn: s.tokensIn,
          tokensOut: s.tokensOut,
          totalTokens: s.totalTokens,
          estCostUsd: s.estCostUsd,
        };
      })
      .sort((a, b) => b.totalTokens - a.totalTokens);

    const trend: AiUsageTrendPoint[] = trendRows.map((r) => ({
      day: r.day,
      tokensIn: Number(r.tokens_in),
      tokensOut: Number(r.tokens_out),
    }));

    const totals = summariseModelBuckets(featureRows.map(toBucket));

    return {
      rangeStart: start.toISOString(),
      rangeEnd: end.toISOString(),
      totals,
      byFeature,
      byFirm,
      trend,
    };
  },

  /** Per-user AI use for [start, end) (admin-per-user-usage): calls, tokens,
   *  estimated cost, credits spent (net of refunds), top feature, cap. */
  async byUser(start: Date, end: Date, firmId?: string): Promise<AdminAiUsageUser[]> {
    const sql = db();
    if (!sql) return [];
    const firm = firmId ?? null;
    const [tokens, credits, users] = await Promise.all([
      sql<Array<ModelBucketRow & { user_id: string; feature: string; calls: string }>>`
        select user_id, feature, model, count(*)::bigint as calls,
               coalesce(sum(tokens_in), 0)::bigint as tokens_in, coalesce(sum(tokens_out), 0)::bigint as tokens_out,
               coalesce(sum(cache_read_tokens), 0)::bigint as cache_read, coalesce(sum(cache_write_tokens), 0)::bigint as cache_write
        from ai_token_usage
        where created_at >= ${start} and created_at < ${end} and user_id is not null
          and (${firm}::uuid is null or firm_id = ${firm}::uuid)
        group by user_id, feature, model`,
      sql<{ user_id: string; credits: string }[]>`
        select user_id, coalesce(sum(credits), 0) as credits from credit_ledger
        where created_at >= ${start} and created_at < ${end} and user_id is not null
          and (${firm}::uuid is null or firm_id = ${firm}::uuid)
        group by user_id`,
      sql<{ id: string; name: string; email: string | null; role: string | null; firm_id: string | null; firm_name: string | null; cap: string | null }[]>`
        select u.id, u.name, u.email, u.role, u.firm_id, f.name as firm_name, u.credit_cap_month as cap
        from users u left join firms f on f.id = u.firm_id
        where (${firm}::uuid is null or u.firm_id = ${firm}::uuid)`,
    ]);
    const acc = new Map<string, { calls: number; tokensIn: number; tokensOut: number; usd: number; feat: Map<string, number> }>();
    for (const r of tokens) {
      const a = acc.get(r.user_id) ?? { calls: 0, tokensIn: 0, tokensOut: 0, usd: 0, feat: new Map() };
      const calls = Number(r.calls);
      const fresh = Number(r.tokens_in) || 0, cr = Number(r.cache_read) || 0, cw = Number(r.cache_write) || 0, out = Number(r.tokens_out) || 0;
      a.calls += calls; a.tokensIn += fresh + cr + cw; a.tokensOut += out;
      a.usd += estimateCostUsd(r.model, fresh, out, cr, cw);
      a.feat.set(r.feature, (a.feat.get(r.feature) ?? 0) + calls);
      acc.set(r.user_id, a);
    }
    const spent = new Map(credits.map((c) => [c.user_id, Math.max(0, Number(c.credits))]));
    return users
      .filter((u) => acc.has(u.id) || spent.has(u.id) || u.cap != null || firm != null)
      .map((u) => {
        const a = acc.get(u.id);
        const top = a ? [...a.feat.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null : null;
        return {
          userId: u.id, name: u.name, email: u.email, role: u.role, firmId: u.firm_id, firmName: u.firm_name,
          calls: a?.calls ?? 0, tokensIn: a?.tokensIn ?? 0, tokensOut: a?.tokensOut ?? 0,
          estCostUsd: round2(a?.usd ?? 0), estCostInr: Math.round((a?.usd ?? 0) * USD_INR),
          creditsUsed: spent.get(u.id) ?? 0, topFeature: top as AdminAiUsageUser['topFeature'],
          creditCapMonth: u.cap == null ? null : Number(u.cap),
        };
      })
      .sort((x, y) => y.estCostUsd - x.estCostUsd || y.creditsUsed - x.creditsUsed);
  },
};
