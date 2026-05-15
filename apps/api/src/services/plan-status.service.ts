import { db } from '../db/client';

// =============================================================================
// plan-status.service - reads firms.plan_status / renews_at for a user and
// decides whether the session should be allowed to continue. Used by both
// the requireActivePlan middleware (mid-session enforcement) and
// auth.service.signIn (refuse to issue a token when plan is already
// inactive at login).
//
// Cache: 60s per-user, in-memory. Plan changes via Stripe webhook take at
// most a minute to take effect; the cache absorbs the per-request DB hit
// that would otherwise be paid on every authenticated call.
// =============================================================================

export type PlanStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | null;

export interface PlanState {
  firmId: string | null;
  planStatus: PlanStatus;
  renewsAt: Date | null;
}

export type PlanCheck =
  | { ok: true }
  | { ok: false; reason: 'plan_cancelled' | 'plan_past_due' | 'plan_expired'; renewsAt: Date | null };

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { state: PlanState; expiresAt: number }>();

async function loadPlanState(userId: string): Promise<PlanState> {
  const sql = db();
  // Dev / in-memory mode: no DB, no plan to evaluate - treat as active.
  if (!sql) return { firmId: null, planStatus: 'active', renewsAt: null };

  const rows = await sql<Array<{
    firm_id: string | null;
    plan_status: PlanStatus;
    renews_at: Date | null;
  }>>`
    select u.firm_id, f.plan_status, f.renews_at
    from users u
    left join firms f on f.id = u.firm_id
    where u.id = ${userId}::uuid
    limit 1
  `;
  const row = rows[0];
  return {
    firmId: row?.firm_id ?? null,
    planStatus: row?.plan_status ?? null,
    renewsAt: row?.renews_at ?? null,
  };
}

/**
 * Pure decision function over a known PlanState. Stays pure so signIn and
 * requireActivePlan share identical semantics.
 *
 * Rules (most-specific first):
 *  - No firm (superadmin / pre-onboarding) -> ok
 *  - plan_status = 'cancelled' -> 402 plan_cancelled
 *  - plan_status = 'past_due'  -> 402 plan_past_due
 *  - renews_at in the past AND status not 'trial' -> 402 plan_expired
 *  - otherwise -> ok
 */
export function evaluatePlanState(state: PlanState): PlanCheck {
  if (!state.firmId) return { ok: true };
  if (state.planStatus === 'cancelled') {
    return { ok: false, reason: 'plan_cancelled', renewsAt: state.renewsAt };
  }
  if (state.planStatus === 'past_due') {
    return { ok: false, reason: 'plan_past_due', renewsAt: state.renewsAt };
  }
  if (state.renewsAt && state.planStatus !== 'trial') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (state.renewsAt < today) {
      return { ok: false, reason: 'plan_expired', renewsAt: state.renewsAt };
    }
  }
  return { ok: true };
}

/** Cached lookup. Reads from `cache` when fresh, else re-loads from DB. */
export async function getPlanState(userId: string): Promise<PlanState> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.state;
  const state = await loadPlanState(userId);
  cache.set(userId, { state, expiresAt: Date.now() + CACHE_TTL_MS });
  return state;
}

/** Invalidate the cache after a plan change (Stripe webhook, admin override). */
export function invalidatePlanStatusCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
