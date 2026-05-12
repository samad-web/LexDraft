import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  __testing,
  invalidatePermissionsCache,
  requireFeature,
  resolveFeatures,
  userCan,
} from '../permissions.service';
import { authService } from '../auth.service';
import { signInForTest } from '../../__tests__/auth-test-helpers';

const { demoFallbackFor } = __testing;

beforeEach(() => {
  // Each test starts with a clean cache so behaviour is independent.
  invalidatePermissionsCache();
});

// =============================================================================
// Tier matrix — these tests are the canonical "who can see what" table.
// Update them BEFORE changing role/plan grants in the resolver or migrations.
// =============================================================================

describe('demoFallbackFor — Solo Advocate', () => {
  const f = demoFallbackFor('Solo Advocate');

  it('grants tenant CRUD that Solo plan permits', () => {
    expect(f).toContain('matter.view');
    expect(f).toContain('matter.create');
    expect(f).toContain('client.view');
    expect(f).toContain('client.create');
    expect(f).toContain('leads.view');
    expect(f).toContain('leads.create');
    expect(f).toContain('billing.view');
    expect(f).toContain('billing.invoice');
    expect(f).toContain('billing.expense');
    expect(f).toContain('research.basic');
    expect(f).toContain('drafting.basic');
    expect(f).toContain('drafting.templates');
    expect(f).toContain('drafting.clauses');
    expect(f).toContain('review.comment');
  });

  it('denies everything Solo plan excludes', () => {
    // Solo plan: no AI, no compare, no esign.send, no review.approve
    expect(f).not.toContain('drafting.ai');
    expect(f).not.toContain('drafting.compare');
    expect(f).not.toContain('review.approve');
    expect(f).not.toContain('review.track_changes');
    expect(f).not.toContain('esign.send');
    expect(f).not.toContain('esign.bulk');
    expect(f).not.toContain('matter.assign');
  });

  it('denies every admin.* + firm.* + analytics.* feature', () => {
    // This is the bug fix: Solo MUST NOT see firm overview, members,
    // analytics, manage firm, audit log, role editor, billing admin.
    expect(f).not.toContain('admin.users');
    expect(f).not.toContain('admin.roles');
    expect(f).not.toContain('admin.audit');
    expect(f).not.toContain('admin.billing');
    expect(f).not.toContain('admin.practice_groups');
    expect(f).not.toContain('firm.dashboard.view');
    expect(f).not.toContain('firm.members.view');
    expect(f).not.toContain('analytics.firm');
    expect(f).not.toContain('reports.activity');
    expect(f).not.toContain('reports.billing');
  });

  it('includes the spec-§5.1 baseline keys', () => {
    for (const k of ['profile.view', 'profile.update', 'announcements.view', 'shared.documents', 'search.workspace']) {
      expect(f).toContain(k);
    }
  });
});

describe('demoFallbackFor — Practice tier roles', () => {
  it('Practice Group Lead gets Solo set + AI + review + Practice surfaces', () => {
    const f = demoFallbackFor('Practice Group Lead');
    expect(f).toContain('matter.view');             // inherited from Solo
    expect(f).toContain('drafting.ai');             // Practice-plan unlock
    expect(f).toContain('drafting.compare');
    expect(f).toContain('review.approve');
    expect(f).toContain('esign.send');
    expect(f).toContain('firm.members.view');       // Practice plan unlocks Members
    expect(f).toContain('firm.dashboard.view');     // PG Lead sees chambers dash
    expect(f).toContain('reports.activity');
    expect(f).toContain('admin.practice_groups');
  });

  it('Practice Group Lead does NOT get Firm-only features', () => {
    const f = demoFallbackFor('Practice Group Lead');
    expect(f).not.toContain('admin.users');
    expect(f).not.toContain('admin.roles');
    expect(f).not.toContain('admin.billing');
    expect(f).not.toContain('reports.billing');
    expect(f).not.toContain('analytics.firm');
    expect(f).not.toContain('esign.bulk');
  });

  it('Practice Lead text role maps to Practice Group Lead set', () => {
    // auth.service generates the text 'Practice Lead' for `role: 'group'`.
    const f = demoFallbackFor('Practice Lead');
    expect(f).toContain('drafting.ai');
    expect(f).not.toContain('admin.users');
  });
});

describe('demoFallbackFor — Firm Admin', () => {
  const f = demoFallbackFor('Firm Admin');

  it('gets the full firm-admin surface', () => {
    expect(f).toContain('admin.users');
    expect(f).toContain('admin.roles');
    expect(f).toContain('admin.audit');
    expect(f).toContain('admin.billing');
    expect(f).toContain('analytics.firm');
    expect(f).toContain('reports.billing');
    expect(f).toContain('firm.dashboard.view');
    expect(f).toContain('esign.bulk');
  });

  it('Managing Partner text role maps to Firm Admin set', () => {
    // auth.service generates 'Managing Partner' for `role: 'firm'`.
    const f2 = demoFallbackFor('Managing Partner');
    expect(f2).toContain('admin.users');
    expect(f2).toContain('firm.dashboard.view');
  });
});

describe('demoFallbackFor — restricted roles', () => {
  it('Intern only sees baseline + minimal drafting / view', () => {
    const f = demoFallbackFor('Intern');
    expect(f).toContain('matter.view');
    expect(f).toContain('drafting.basic');
    expect(f).not.toContain('matter.create');
    expect(f).not.toContain('billing.view');
    expect(f).not.toContain('admin.users');
  });

  it('Unknown role falls through to baseline only', () => {
    const f = demoFallbackFor('Some Custom Role');
    expect(f).toContain('profile.view');
    expect(f).not.toContain('matter.view');
    expect(f).not.toContain('admin.users');
  });
});

// =============================================================================
// Integration via authService + resolveFeatures (memory mode round-trip)
// =============================================================================

describe('resolveFeatures — role-aware via memUsers', () => {
  it('a freshly-provisioned Solo Advocate sees no firm.* / analytics.firm / admin.* keys', async () => {
    const auth = await signInForTest({ email: `solo-${Date.now()}@example.com`, password: 'p' });
    const r = await resolveFeatures(auth.user.id);
    expect(r.features).toContain('matter.view');
    expect(r.features).toContain('billing.invoice');
    expect(r.features).not.toContain('firm.dashboard.view');
    expect(r.features).not.toContain('firm.members.view');
    expect(r.features).not.toContain('analytics.firm');
    expect(r.features).not.toContain('admin.users');
  });

  it('a signUp with role=firm gets the Firm Admin set', async () => {
    const email = `firm-${Date.now()}@example.com`;
    const auth = await authService.signUp({
      email, password: 'longenough', name: 'Test Partner', role: 'firm',
    });
    const r = await resolveFeatures(auth.user.id);
    expect(r.features).toContain('admin.users');
    expect(r.features).toContain('firm.dashboard.view');
    expect(r.features).toContain('analytics.firm');
  });

  it('a signUp with role=group gets the Practice set (no admin.users, no analytics.firm)', async () => {
    const email = `practice-${Date.now()}@example.com`;
    const auth = await authService.signUp({
      email, password: 'longenough', name: 'Test Lead', role: 'group',
    });
    const r = await resolveFeatures(auth.user.id);
    expect(r.features).toContain('drafting.ai');
    expect(r.features).toContain('firm.members.view');
    expect(r.features).not.toContain('admin.users');
    expect(r.features).not.toContain('analytics.firm');
  });
});

// =============================================================================
// Cache + middleware (unchanged contracts)
// =============================================================================

describe('cache behaviour', () => {
  it('invalidatePermissionsCache(userId) drops only that user', async () => {
    const a = await signInForTest({ email: `a-${Date.now()}@example.com`, password: 'p' });
    const b = await signInForTest({ email: `b-${Date.now()}@example.com`, password: 'p' });
    await resolveFeatures(a.user.id);
    await resolveFeatures(b.user.id);
    invalidatePermissionsCache(a.user.id);
    expect(await userCan(a.user.id, 'matter.view')).toBe(true);
    expect(await userCan(b.user.id, 'matter.view')).toBe(true);
  });

  it('invalidatePermissionsCache() drops every entry', async () => {
    const a = await signInForTest({ email: `c-${Date.now()}@example.com`, password: 'p' });
    await resolveFeatures(a.user.id);
    invalidatePermissionsCache();
    expect(await userCan(a.user.id, 'matter.view')).toBe(true);
  });
});

// ---- requireFeature middleware -------------------------------------------

function mkReq(userId?: string): Request {
  return {
    user: userId ? { id: userId, email: 'u@example.com', role: '', isSuperadmin: false } : undefined,
  } as unknown as Request;
}
function mkRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const status = vi.fn();
  const json = vi.fn();
  const res = { status: status.mockReturnThis(), json } as unknown as Response;
  status.mockImplementation(() => res);
  return { res, status, json };
}

describe('requireFeature middleware', () => {
  it('401s when no user is attached', async () => {
    const handler = requireFeature('matter.view');
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = mkRes();
    await handler(mkReq(undefined), res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the resolved feature is granted (Solo on matter.view)', async () => {
    const auth = await signInForTest({ email: `mw1-${Date.now()}@example.com`, password: 'p' });
    const handler = requireFeature('matter.view');
    const next = vi.fn() as unknown as NextFunction;
    const { res } = mkRes();
    await handler(mkReq(auth.user.id), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('403s a Solo user trying to hit a firm.* feature', async () => {
    const auth = await signInForTest({ email: `mw2-${Date.now()}@example.com`, password: 'p' });
    const handler = requireFeature('firm.dashboard.view');
    const next = vi.fn() as unknown as NextFunction;
    const { res, status, json } = mkRes();
    await handler(mkReq(auth.user.id), res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "Forbidden: missing 'firm.dashboard.view'" });
    expect(next).not.toHaveBeenCalled();
  });
});
