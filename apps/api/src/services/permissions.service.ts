/**
 * Permission resolver - implements the 3-layer entitlement model from
 * `lexdraft-user-management-spec.md` §5.
 *
 *   can(user, F) = baseline(F)
 *               OR (planHas(plan, F) AND NOT denyOverride(user, F)
 *                   AND (grantOverride(user, F) OR roleHas(role, F)))
 *
 * Results are cached in-memory keyed by userId. The cache is invalidated by
 * any mutation that could change the answer (role change, plan change,
 * override change, plan-features change, role-features change). The api
 * process is single-instance for now, so a process-local cache is sufficient.
 */

import type { FeatureKey, MeFeaturesResponse, UserPlan } from '@lexdraft/types';
import { db } from '../db/client';
import { authService } from './auth.service';
import { cacheBroadcaster } from './cache-broadcaster';

interface ResolverRow {
  user_id: string;
  feature_key: string;
}

interface RoleSummaryRow {
  id: string;
  name: string;
  is_system: boolean;
  plan_tier: UserPlan | null;
}

const CACHE_TTL_MS = 60_000;

interface CachedEntry {
  features: Set<FeatureKey>;
  role: MeFeaturesResponse['role'];
  plan: UserPlan | null;
  expiresAt: number;
}

const cache = new Map<string, CachedEntry>();

// ---- Demo-mode (no DB) fallback feature sets ------------------------------
// Mirrors the plan ∩ role intersection the DB resolver would compute, scoped
// per auth-service text role. Keep these in sync with migrations
// 0009/0012/0013. New plan/role grants land here too.

const BASELINE_FEATURES: ReadonlyArray<FeatureKey> = [
  'profile.view', 'profile.update', 'announcements.view',
  'shared.documents', 'search.workspace',
];

const SOLO_FEATURES: ReadonlyArray<FeatureKey> = [
  ...BASELINE_FEATURES,
  // Drafting basics (no AI, no compare on Solo plan)
  'drafting.basic', 'drafting.templates', 'drafting.clauses',
  'review.comment',
  // Matter & client
  'matter.view', 'matter.create',
  'client.view', 'client.create',
  // Leads
  'leads.view', 'leads.create',
  // Billing
  'billing.view', 'billing.invoice', 'billing.expense',
  // Research / usage report
  'research.basic',
  'reports.usage',
  // Sweep B cross-tier features available even at Solo
  'tools.calculators',
  'caseload.health',
  'exports.financial',
];

const PRACTICE_LEAD_FEATURES: ReadonlyArray<FeatureKey> = [
  ...SOLO_FEATURES,
  // Practice plan unlocks AI / compare / review / esign / matter.assign
  'drafting.ai', 'drafting.compare',
  'review.approve', 'review.track_changes',
  'esign.send',
  'matter.assign',
  // Practice-tier nav surfaces
  'firm.members.view',
  'firm.dashboard.view',  // PG Lead can see firm dashboard within Practice
  'admin.practice_groups',
  'reports.activity',
  // Sweep B Practice-tier additions
  'conflicts.check',
  'coverage.requests',
  'practice.analytics',
];

const FIRM_ADMIN_FEATURES: ReadonlyArray<FeatureKey> = [
  ...PRACTICE_LEAD_FEATURES,
  // Firm plan unlocks billing/admin/audit fully
  'esign.bulk',
  'admin.users', 'admin.roles', 'admin.audit', 'admin.billing',
  'analytics.firm',
  'reports.billing',
  // Sweep B Firm-tier additions
  'engagement.letters',
];

function demoFallbackFor(roleText: string): FeatureKey[] {
  switch (roleText) {
    case 'Solo Advocate':
      return [...SOLO_FEATURES];
    case 'Practice Lead':
    case 'Practice Group Lead':
    case 'Partner':
    case 'Senior Associate':
    case 'Associate':
      return [...PRACTICE_LEAD_FEATURES];
    case 'Managing Partner':
    case 'Firm Admin':
      return [...FIRM_ADMIN_FEATURES];
    case 'Paralegal':
    case 'Legal Secretary':
    case 'Intern':
      // Limited tenant access: view + drafting basics + review (as a reader/
      // commenter). `review.comment` is granted to these roles via migration
      // 0028 so the Review tab is reachable from every system role.
      return [
        ...BASELINE_FEATURES,
        'drafting.basic', 'drafting.templates',
        'review.comment',
        'matter.view', 'client.view',
        'firm.members.view',
      ];
    default:
      return [...BASELINE_FEATURES];
  }
}

/** Visible for tests so they don't have to reach into the cache. */
export const __testing = { demoFallbackFor };

/**
 * Drop one user's resolved feature set, or the whole cache when `userId` is
 * undefined.
 *
 * Mutations that MUST trigger an invalidation (else stale `requireFeature`
 * decisions will be served for up to `CACHE_TTL_MS`):
 *
 *   - `users.role_id`  → `invalidatePermissionsCache(userId)`
 *   - `users.firm_id`  → `invalidatePermissionsCache(userId)`  (firm move)
 *   - `users.status`   → `invalidatePermissionsCache(userId)`
 *   - `firms.plan_tier`            → `invalidatePermissionsCache()` (firm-wide)
 *   - `role_features` row INSERT/UPDATE/DELETE for a role used by ≥ 1 user
 *     → `invalidatePermissionsCache()` until per-role keying lands
 *   - `plan_features` row change   → `invalidatePermissionsCache()`
 *   - `user_feature_overrides` for `user_id`
 *     → `invalidatePermissionsCache(userId)`
 *
 * The cache is process-local. With multiple API replicas, a Redis-backed
 * cache or pub/sub fanout is required to keep them coherent; until then,
 * each replica's TTL bounds the stale window.
 */
// Cross-replica invalidation. See cache-broadcaster.ts for the full
// design. Local handler drops the entry; sister replicas' calls land
// here via the NOTIFY channel and apply the same drop.
cacheBroadcaster.subscribe('permissions', (userId) => {
  if (userId === null) cache.clear();
  else cache.delete(userId);
});

export function invalidatePermissionsCache(userId?: string): void {
  if (userId === undefined) cache.clear();
  else cache.delete(userId);
  // Fire-and-forget cross-replica broadcast. Failure is logged in the
  // broadcaster and falls through to TTL-based eventual consistency.
  void cacheBroadcaster.publish('permissions', userId ?? null);
}

/** Resolve the full feature set + role/plan summary for a user. Cached. */
export async function resolveFeatures(userId: string): Promise<MeFeaturesResponse> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) {
    return { features: [...hit.features], role: hit.role, plan: hit.plan };
  }

  const sql = db();
  if (!sql) {
    // No database - return a role-aware fallback so demo mode (no
    // DATABASE_URL) approximates what the real resolver would return for
    // each tier. The auth-service text role is the only signal we have.
    const memUser = await authService.getById(userId).catch(() => undefined);
    const roleText = memUser?.role ?? 'Solo Advocate';
    const planHint = memUser?.plan ?? null;
    const features = demoFallbackFor(roleText);
    cache.set(userId, { features: new Set(features), role: null, plan: planHint, expiresAt: now + CACHE_TTL_MS });
    return { features, role: null, plan: planHint };
  }

  // 1. Fetch role summary + plan in one round-trip.
  const [roleRow] = await sql<RoleSummaryRow[]>`
    select r.id, r.name, r.is_system, f.plan_tier
    from users u
    left join roles r on r.id = u.role_id
    left join firms f on f.id = u.firm_id
    where u.id = ${userId}
    limit 1
  `;

  const role: MeFeaturesResponse['role'] = roleRow?.id
    ? { id: roleRow.id, name: roleRow.name, isSystem: roleRow.is_system }
    : null;
  const plan: UserPlan | null = roleRow?.plan_tier ?? null;

  // 2. Run the resolver as a single SQL statement. Returns one row per granted
  //    feature key. The CTE structure mirrors the spec pseudocode exactly:
  //      - baseline features always granted
  //      - plan layer: keep only features the firm's plan unlocks
  //      - role layer: features granted by the user's role
  //      - override layer: grant overrides add features; deny overrides remove
  //
  //    This keeps the resolver portable to read-replicas and avoids the
  //    O(N features) round-trips a naive impl would do.
  const rows = await sql<ResolverRow[]>`
    with
      u as (
        select u.id, u.firm_id, u.role_id, f.plan_tier
        from users u left join firms f on f.id = u.firm_id
        where u.id = ${userId}
      ),
      baseline as (
        select key as feature_key from features where default_baseline = true
      ),
      plan_set as (
        select pf.feature_key
        from plan_features pf, u
        where pf.plan_tier = u.plan_tier and pf.enabled = true
      ),
      role_set as (
        select rf.feature_key
        from role_features rf, u
        where rf.role_id = u.role_id and rf.enabled = true
      ),
      grant_overrides as (
        select feature_key from user_feature_overrides
        where user_id = ${userId} and decision = 'grant'
      ),
      deny_overrides as (
        select feature_key from user_feature_overrides
        where user_id = ${userId} and decision = 'deny'
      ),
      candidates as (
        -- baseline always counts
        select feature_key from baseline
        union
        -- plan AND role grants the feature, unless explicitly denied
        select rs.feature_key
        from role_set rs
        join plan_set ps on ps.feature_key = rs.feature_key
        where rs.feature_key not in (select feature_key from deny_overrides)
        union
        -- a grant override needs only the plan layer (override > role)
        select go.feature_key
        from grant_overrides go
        join plan_set ps on ps.feature_key = go.feature_key
      )
    select ${userId}::text as user_id, feature_key from candidates
  `;

  const features = new Set<FeatureKey>(rows.map((r) => r.feature_key));

  cache.set(userId, { features, role, plan, expiresAt: now + CACHE_TTL_MS });
  return { features: [...features], role, plan };
}

export async function userCan(userId: string, featureKey: FeatureKey): Promise<boolean> {
  const { features } = await resolveFeatures(userId);
  return features.includes(featureKey);
}

/** Express middleware factory - gate a route on a feature key. */
export function requireFeature(featureKey: FeatureKey) {
  return async (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const ok = await userCan(userId, featureKey);
      if (!ok) {
        res.status(403).json({ error: `Forbidden: missing '${featureKey}'` });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Convenience for routes that need to load all features at once. */
export const permissionsService = {
  resolveFeatures,
  userCan,
  invalidate: invalidatePermissionsCache,
};
