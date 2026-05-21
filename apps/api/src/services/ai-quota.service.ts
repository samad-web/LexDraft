/**
 * AI generation quota service.
 *
 * Enforces a per-user monthly cap anchored to the firm's billing cycle
 * (firms.renews_at). Each successful AI document generation - whether from
 * /api/drafting/generate or /api/drafting/generate/stream - is recorded as
 * one row in ai_generations. Rows are append-only; when an associated draft
 * is deleted we set deleted_at as a tombstone but the row still counts
 * against the user's cap. This is intentional: the cap is "how many
 * generations did this user request this cycle", not "how many drafts
 * currently exist".
 *
 * Cap values are sourced from plan_ai_caps, which is set by migration only.
 * No admin path is exposed for editing them - see migration 0045.
 */

import { db } from '../db/client';

export type PlanTier = 'Solo' | 'Practice' | 'Firm';

export interface QuotaStatus {
  cap: number;
  used: number;
  remaining: number;
  cycleStart: string;
  cycleEnd: string;
  planTier: PlanTier | null;
}

export class AiQuotaExceededError extends Error {
  status: QuotaStatus;
  constructor(status: QuotaStatus) {
    super('AI generation quota exceeded');
    this.name = 'AiQuotaExceededError';
    this.status = status;
  }
}

// Demo-mode (no DATABASE_URL) cap fallbacks. These mirror the seed values in
// migration 0045 so dev behaviour without Postgres approximates production.
const DEMO_CAP_BY_TIER: Record<PlanTier, number> = {
  Solo: 20,
  Practice: 200,
  Firm: 1000,
};

function calendarMonthBoundsUtc(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

// Demo-mode usage tracker. Process-local, lost on restart - acceptable for
// dev. Keyed by userId, value is a list of generation timestamps within the
// current cycle. Cleaned lazily on read.
const memUsage = new Map<string, number[]>();

interface UsageRow {
  cycle_start: Date;
  cycle_end: Date;
  plan_tier: PlanTier | null;
  cap: number | null;
  used: number;
}

export const aiQuotaService = {
  async status(firmId: string | null, userId: string): Promise<QuotaStatus> {
    const sql = db();
    if (!sql) {
      // No DB: calendar-month UTC bucket, Solo cap default.
      const { start, end } = calendarMonthBoundsUtc();
      const all = memUsage.get(userId) ?? [];
      const inCycle = all.filter((ts) => ts >= start.getTime() && ts < end.getTime());
      memUsage.set(userId, inCycle);
      const cap = DEMO_CAP_BY_TIER.Solo;
      return {
        cap,
        used: inCycle.length,
        remaining: Math.max(0, cap - inCycle.length),
        cycleStart: start.toISOString(),
        cycleEnd: end.toISOString(),
        planTier: null,
      };
    }

    if (!firmId) {
      // Authenticated user with no firm attachment - block AI generation.
      // Shouldn't happen in normal flows; users without firms can't reach
      // requireFeature('drafting.ai') anyway. Returning cap=0 makes this
      // safe by default if it ever does.
      const { start, end } = calendarMonthBoundsUtc();
      return {
        cap: 0,
        used: 0,
        remaining: 0,
        cycleStart: start.toISOString(),
        cycleEnd: end.toISOString(),
        planTier: null,
      };
    }

    const [row] = await sql<UsageRow[]>`
      with firm as (
        select plan_tier, renews_at from firms where id = ${firmId}::uuid limit 1
      ),
      bounds as (
        select
          case
            when (select renews_at from firm) is null
              then date_trunc('month', now())
            else ((select renews_at from firm) - interval '1 month')::timestamptz
          end as cycle_start,
          case
            when (select renews_at from firm) is null
              then (date_trunc('month', now()) + interval '1 month')
            else ((select renews_at from firm))::timestamptz
          end as cycle_end,
          (select plan_tier from firm) as plan_tier
      )
      select
        b.cycle_start,
        b.cycle_end,
        b.plan_tier,
        (select monthly_cap from plan_ai_caps where plan_tier = b.plan_tier) as cap,
        (select count(*)::int from ai_generations
         where user_id = ${userId}::uuid
           and created_at >= b.cycle_start
           and created_at <  b.cycle_end) as used
      from bounds b
    `;

    const cap = row?.cap ?? 0;
    const used = Number(row?.used ?? 0);
    const cycleStart = row?.cycle_start ?? new Date();
    const cycleEnd = row?.cycle_end ?? new Date();
    return {
      cap,
      used,
      remaining: Math.max(0, cap - used),
      cycleStart: cycleStart instanceof Date ? cycleStart.toISOString() : String(cycleStart),
      cycleEnd: cycleEnd instanceof Date ? cycleEnd.toISOString() : String(cycleEnd),
      planTier: row?.plan_tier ?? null,
    };
  },

  /**
   * Throws AiQuotaExceededError when the user is at or above their cap.
   * Returns the resolved status for callers who want to log it.
   */
  async assertCanGenerate(firmId: string | null, userId: string): Promise<QuotaStatus> {
    const status = await this.status(firmId, userId);
    if (status.used >= status.cap) {
      throw new AiQuotaExceededError(status);
    }
    return status;
  },

  /**
   * Append a generation event. Called after the LLM call succeeds (for
   * non-stream) or after the first delta arrives (for stream). Failure to
   * record is non-fatal - we swallow and log via the caller, because a
   * dropped insert is a smaller harm than a 500 to the user who already
   * got their document.
   */
  async record(
    firmId: string | null,
    userId: string,
    kind: 'generate' | 'stream',
    meta: { provider?: string | null; docType?: string | null; draftId?: string | null } = {},
  ): Promise<void> {
    const sql = db();
    if (!sql) {
      const arr = memUsage.get(userId) ?? [];
      arr.push(Date.now());
      memUsage.set(userId, arr);
      return;
    }
    await sql`
      insert into ai_generations
        (firm_id, user_id, kind, provider, doc_type, draft_id)
      values
        (${firmId}, ${userId}::uuid, ${kind},
         ${meta.provider ?? null}, ${meta.docType ?? null},
         ${meta.draftId ?? null})
    `;
  },

  /**
   * Soft-delete every generation row linked to this draft. The counter
   * remains intact - tombstoned rows still count against the cap. Safe to
   * call on drafts that have no linked generation (no-op).
   */
  async tombstoneByDraft(draftId: string): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`
      update ai_generations
      set deleted_at = now()
      where draft_id = ${draftId}::uuid and deleted_at is null
    `;
  },
};
