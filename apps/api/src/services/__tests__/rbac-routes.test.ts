/**
 * RBAC route-gate regression tests.
 *
 * Goal: lock in the spec §5 3-layer entitlement model
 *   can(user, F) = baseline(F)
 *                OR (planHas(plan, F) AND NOT denyOverride(user, F)
 *                    AND (grantOverride(user, F) OR roleHas(role, F)))
 *
 * The `requireFeature(key)` middleware (apps/api/src/services/permissions.service.ts)
 * is the single chokepoint every route gate flows through. These tests exercise
 * it through real `signIn`/`signUp` users wherever possible (the canonical
 * approach used by the existing permissions.test.ts), and use `vi.spyOn` of
 * `authService.getById` for the role-text scenarios that demoFallbackFor
 * already encodes.
 *
 * Layer-by-layer coverage:
 *   - baseline       — `profile.view` is in BASELINE_FEATURES so every role
 *                      sees it (verified per-role below)
 *   - plan ∩ role    — Solo Advocate on `matter.view` (plan grants, role grants
 *                      → 200); Solo Advocate on `drafting.ai` (Solo plan
 *                      excludes → 403); Intern on `matter.create` (role
 *                      excludes → 403)
 *   - role explicit  — `firm.dashboard.view` is firm-only; a Solo Advocate
 *                      gets 403; a Practice Lead gets through
 *   - admin gates    — `admin.users` available only to Firm Admin
 *   - analytics      — `analytics.firm` is Firm-only
 *
 * About user-overrides: in DATABASE_URL='' (memory) mode, `resolveFeatures`
 * routes through `demoFallbackFor(role)` (see permissions.service.ts line
 * 162-167) and does NOT honour `user_feature_overrides` rows — those are
 * computed by the SQL CTE on lines 213-237 of the same file, and require a
 * live Postgres + the migration that defines `user_feature_overrides` to
 * exercise. We approximate the OUTCOMES below by mocking `resolveFeatures`
 * for a few targeted cases, which proves `requireFeature` honours whatever
 * the resolver returns (grant-wins-over-deny lives in the SQL CTE).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import {
  invalidatePermissionsCache,
  requireFeature,
} from '../permissions.service';
import { authService } from '../auth.service';
import type { User } from '@lexdraft/types';

// ---- request / response builders (mirrors permissions.test.ts) ----

function mkReq(userId?: string, role = 'Solo Advocate'): Request {
  return {
    user: userId
      ? { id: userId, email: 'u@example.com', role, isSuperadmin: false }
      : undefined,
  } as unknown as Request;
}

function mkRes(): {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const status = vi.fn();
  const json = vi.fn();
  const res = { status: status.mockReturnThis(), json } as unknown as Response;
  status.mockImplementation(() => res);
  return { res, status, json };
}

/**
 * Auto-provisions a Solo Advocate via signIn (uses the existing test setup
 * that flips DEV_AUTH_AUTO_PROVISION=true). Returns just the user id.
 */
async function newSoloUser(): Promise<string> {
  const auth = (await authService.signIn({
    email: `solo-rbac-${Math.random().toString(36).slice(2)}-${Date.now()}@example.com`,
    password: 'p',
  })) as { user: User; token: string };
  return auth.user.id;
}

/**
 * Creates a user via signUp with the requested role mapping:
 *   'solo'  -> 'Solo Advocate'
 *   'group' -> 'Practice Lead'      (resolver: Practice Group Lead set)
 *   'firm'  -> 'Managing Partner'   (resolver: Firm Admin set)
 */
async function newUserWithRole(roleKind: 'solo' | 'group' | 'firm'): Promise<string> {
  const auth = (await authService.signUp({
    email: `${roleKind}-${Math.random().toString(36).slice(2)}-${Date.now()}@example.com`,
    password: 'longenough',
    name: 'Test',
    role: roleKind,
  })) as { user: User; token: string };
  return auth.user.id;
}

beforeEach(() => {
  // Each test starts with a clean resolver cache so role/plan changes between
  // tests don't bleed through the 60s TTL.
  invalidatePermissionsCache();
});

// =============================================================================
// 401 — no user attached
// =============================================================================

describe('requireFeature — auth gate', () => {
  it('401s when no user is attached', async () => {
    const handler = requireFeature('matter.view');
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = mkRes();
    await handler(mkReq(undefined), res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });
});

// =============================================================================
// `matter.view` — Solo plan + Solo Advocate role should grant.
// =============================================================================

describe('requireFeature("matter.view")', () => {
  it('grants a Solo Advocate (plan-grants ∩ role-grants)', async () => {
    const id = await newSoloUser();
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('matter.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('grants a Practice Lead (broader plan still includes matter.view)', async () => {
    const id = await newUserWithRole('group');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('matter.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('grants a Firm Admin (full surface)', async () => {
    const id = await newUserWithRole('firm');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('matter.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// =============================================================================
// `firm.dashboard.view` — Practice + Firm only.
// =============================================================================

describe('requireFeature("firm.dashboard.view")', () => {
  it('403s a Solo Advocate (firm.* not in Solo plan)', async () => {
    const id = await newSoloUser();
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = mkRes();
    await requireFeature('firm.dashboard.view')(mkReq(id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: "Forbidden: missing 'firm.dashboard.view'",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('grants a Practice Lead (PG Lead sees chambers dashboard)', async () => {
    const id = await newUserWithRole('group');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('firm.dashboard.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('grants a Firm Admin', async () => {
    const id = await newUserWithRole('firm');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('firm.dashboard.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// =============================================================================
// `admin.users` — Firm Admin only.
// =============================================================================

describe('requireFeature("admin.users")', () => {
  it('403s a Solo Advocate', async () => {
    const id = await newSoloUser();
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = mkRes();
    await requireFeature('admin.users')(mkReq(id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s a Practice Lead (admin.users is Firm-only)', async () => {
    const id = await newUserWithRole('group');
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = mkRes();
    await requireFeature('admin.users')(mkReq(id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('grants a Firm Admin', async () => {
    const id = await newUserWithRole('firm');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('admin.users')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// =============================================================================
// `drafting.ai` — Solo plan excludes it; Practice + Firm include it.
// This is the "plan denies the feature" coverage.
// =============================================================================

describe('requireFeature("drafting.ai")', () => {
  it('403s a Solo Advocate (Solo plan excludes drafting.ai)', async () => {
    const id = await newSoloUser();
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = mkRes();
    await requireFeature('drafting.ai')(mkReq(id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('grants a Practice Lead', async () => {
    const id = await newUserWithRole('group');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('drafting.ai')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('grants a Firm Admin', async () => {
    const id = await newUserWithRole('firm');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('drafting.ai')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// =============================================================================
// `drafting.clauses` — Solo plan includes the clause library (no AI).
// =============================================================================

describe('requireFeature("drafting.clauses")', () => {
  it('grants a Solo Advocate', async () => {
    const id = await newSoloUser();
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('drafting.clauses')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('grants a Practice Lead', async () => {
    const id = await newUserWithRole('group');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('drafting.clauses')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// =============================================================================
// `analytics.firm` — Firm Admin only.
// =============================================================================

describe('requireFeature("analytics.firm")', () => {
  it('403s a Solo Advocate', async () => {
    const id = await newSoloUser();
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = mkRes();
    await requireFeature('analytics.firm')(mkReq(id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('403s a Practice Lead (Practice plan excludes analytics.firm)', async () => {
    const id = await newUserWithRole('group');
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = mkRes();
    await requireFeature('analytics.firm')(mkReq(id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('grants a Firm Admin', async () => {
    const id = await newUserWithRole('firm');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('analytics.firm')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// =============================================================================
// Role-explicit deny — Intern role doesn't grant matter.create even though
// the plan would allow it (the role layer excludes write operations).
// =============================================================================

describe('requireFeature — role-layer deny', () => {
  it('an Intern is blocked from matter.create (role excludes write)', async () => {
    // Memory-mode resolveFeatures uses authService.getById(userId).role to
    // pick the demoFallbackFor set. Spy on getById to return an Intern role
    // for a freshly-provisioned user without touching any production code
    // path.
    const id = await newSoloUser();
    const spy = vi.spyOn(authService, 'getById').mockResolvedValueOnce({
      id,
      name: 'Test Intern',
      email: 'intern@example.com',
      role: 'Intern',
      isSuperadmin: false,
      firm: '',
    });
    // Clear any cached resolution from the signIn call above.
    invalidatePermissionsCache(id);

    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = mkRes();
    await requireFeature('matter.create')(mkReq(id, 'Intern'), res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: "Forbidden: missing 'matter.create'",
    });
    expect(next).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('an Intern still sees matter.view (read is in the Intern role set)', async () => {
    const id = await newSoloUser();
    const spy = vi.spyOn(authService, 'getById').mockResolvedValueOnce({
      id,
      name: 'Test Intern',
      email: 'intern@example.com',
      role: 'Intern',
      isSuperadmin: false,
      firm: '',
    });
    invalidatePermissionsCache(id);

    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('matter.view')(mkReq(id, 'Intern'), res, next);
    expect(next).toHaveBeenCalledWith();
    spy.mockRestore();
  });

  it('an unknown role falls through to baseline only (no matter.view)', async () => {
    const id = await newSoloUser();
    const spy = vi.spyOn(authService, 'getById').mockResolvedValueOnce({
      id,
      name: 'Test',
      email: 'oddrole@example.com',
      role: 'Some Custom Role',
      isSuperadmin: false,
      firm: '',
    });
    invalidatePermissionsCache(id);

    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = mkRes();
    await requireFeature('matter.view')(mkReq(id, 'Some Custom Role'), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('an unknown role still gets the baseline profile.view', async () => {
    const id = await newSoloUser();
    const spy = vi.spyOn(authService, 'getById').mockResolvedValueOnce({
      id,
      name: 'Test',
      email: 'oddrole@example.com',
      role: 'Some Custom Role',
      isSuperadmin: false,
      firm: '',
    });
    invalidatePermissionsCache(id);

    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('profile.view')(mkReq(id, 'Some Custom Role'), res, next);
    expect(next).toHaveBeenCalledWith();
    spy.mockRestore();
  });
});

// =============================================================================
// User-override outcomes — the SQL resolver implements
//   - grant override wins over a role that lacks the feature (provided the
//     plan still grants it), and
//   - deny override removes a feature the role granted.
//
// In memory mode these branches aren't exercised. We mock the auth lookup to
// flip the resolver's outcome to the equivalent of an override and confirm
// `requireFeature` honours the resolved decision either way. This proves
// the middleware doesn't short-circuit around the resolver.
// =============================================================================

describe('requireFeature — outcome honours resolver (override-layer wiring)', () => {
  // Loose typing on the spy: vi.spyOn returns a parameterised MockInstance and
  // we don't need the precise generic shape — we only ever call mockRestore.
  let getByIdSpy: { mockRestore(): void } | undefined;

  afterEach(() => {
    getByIdSpy?.mockRestore();
    getByIdSpy = undefined;
  });

  it('an override-DENY outcome (modelled by a role that excludes the feature) 403s', async () => {
    // Spec scenario: a Practice Lead has drafting.ai via their role, but a
    // user-feature-override of decision='deny' removes it. We can't insert
    // override rows in memory mode, so we model the same outcome by
    // resolving the user as a Solo Advocate — drafting.ai is then absent
    // from the feature set, and requireFeature must 403.
    const id = await newSoloUser();
    getByIdSpy = vi.spyOn(authService, 'getById').mockResolvedValue({
      id,
      name: 'Test',
      email: 'override-deny@example.com',
      role: 'Solo Advocate',
      isSuperadmin: false,
      firm: '',
    });
    invalidatePermissionsCache(id);

    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = mkRes();
    await requireFeature('drafting.ai')(mkReq(id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('an override-GRANT outcome (modelled by a role that includes the feature) passes', async () => {
    // Spec scenario: a Paralegal has no drafting.ai via their role, but a
    // user-feature-override decision='grant' adds it back (plan permitting).
    // We model the same outcome by resolving the user as a Practice Lead
    // (role grants it, plan grants it) — requireFeature must call next().
    const id = await newSoloUser();
    getByIdSpy = vi.spyOn(authService, 'getById').mockResolvedValue({
      id,
      name: 'Test',
      email: 'override-grant@example.com',
      role: 'Practice Lead',
      isSuperadmin: false,
      firm: '',
    });
    invalidatePermissionsCache(id);

    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = mkRes();
    await requireFeature('drafting.ai')(mkReq(id), res, next);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
});

// =============================================================================
// `firm.members.view` — Practice plan unlock. Useful for the broader
// "plan ∩ role" matrix beyond what's explicitly named in the spec.
// =============================================================================

describe('requireFeature("firm.members.view")', () => {
  it('403s a Solo Advocate', async () => {
    const id = await newSoloUser();
    const next = vi.fn() as unknown as NextFunction;
    const { res, status } = mkRes();
    await requireFeature('firm.members.view')(mkReq(id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('grants a Practice Lead', async () => {
    const id = await newUserWithRole('group');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('firm.members.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('grants a Firm Admin', async () => {
    const id = await newUserWithRole('firm');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('firm.members.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

// =============================================================================
// Smoke: every persona sees `profile.view` (baseline). This is the
// always-allowed layer of the resolver — if it ever 403s the resolver is
// fundamentally broken.
// =============================================================================

describe('requireFeature("profile.view") — baseline guarantee', () => {
  it('Solo Advocate', async () => {
    const id = await newSoloUser();
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('profile.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('Practice Lead', async () => {
    const id = await newUserWithRole('group');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('profile.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('Firm Admin', async () => {
    const id = await newUserWithRole('firm');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await requireFeature('profile.view')(mkReq(id), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
