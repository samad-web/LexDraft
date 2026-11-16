/**
 * features/paid-signup-gate.md: sign-up is paid-only (owner, 2026-11-16).
 * The server keeps the app closed until /onboarding (plan + payment) is done,
 * a sign-up can never skip onboarding, and demo accounts are refused.
 */
import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../../env';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { authService } from '../auth.service';
import { invalidatePlanStatusCache } from '../plan-status.service';
import { requireActivePlan } from '../../middleware/requireActivePlan';

const sql = () => getIntegrationSql();
const signupToken = (n: string) => jwt.sign(
  { purpose: 'google-signup', google: { sub: `g-${n}`, email: `gate-${n}@integration.test`, name: 'Gate Test' }, phone: `+9190000${n.slice(-5).padStart(5, '0')}` },
  `${env.JWT_SECRET}:google-signup`, { expiresIn: '5m' },
);
async function gate(userId: string) {
  invalidatePlanStatusCache(userId);
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  await requireActivePlan({ user: { id: userId, isSuperadmin: false } } as unknown as Request, {} as Response, next);
  return (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { status?: number; code?: string } | undefined;
}

describe('paid-only sign-up gate', () => {
  it('AC1: an account that has not finished onboarding gets 403 onboarding_required on app routes, even on a free-launch-style firm', async () => {
    const firm = await seedFirm('Gate Unpaid', 'Solo');
    await sql()`update firms set plan_status = 'trial', free_plan = true, trial_ends_at = '2027-06-01' where id = ${firm.id}::uuid`;
    const u = await seedUser(firm.id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    await sql()`update users set onboarded_at = null where id = ${u.id}::uuid`;
    const err = await gate(u.id);
    expect(err?.status).toBe(403);
    expect(err?.code).toBe('onboarding_required');
  });

  it('AC2: once onboarded (and plan in order) the same account passes', async () => {
    const firm = await seedFirm('Gate Paid', 'Solo');
    await sql()`update firms set plan_status = 'active', renews_at = now() + interval '20 days' where id = ${firm.id}::uuid`;
    const u = await seedUser(firm.id, { role: 'Solo Advocate', systemRole: 'Solo Advocate' });
    expect(await gate(u.id)).toBeUndefined();
  });

  it('AC3: Google sign-up that names a plan still has to onboard (no skipping to a free account)', async () => {
    const n = String(Date.now());
    const r = await authService.googleSignUp({ signupToken: signupToken(n), password: 'longenough1', role: 'solo', plan: 'sanad', intent: 'paid' } as never);
    expect(r.user.needsOnboarding).toBe(true);
    const [row] = await sql()<{ onboarded_at: Date | null; plan_status: string }[]>`
      select u.onboarded_at, f.plan_status from users u join firms f on f.id = u.firm_id where u.id = ${r.user.id}::uuid`;
    expect(row!.onboarded_at).toBeNull();
    expect(row!.plan_status).toBe('trial'); // never 'active' without a payment
    expect((await gate(r.user.id))?.code).toBe('onboarding_required');
  });

  it('AC4: demo sign-up is refused and creates nothing', async () => {
    const n = String(Date.now() + 1);
    await expect(authService.googleSignUp({ signupToken: signupToken(n), password: 'longenough1', role: 'solo', intent: 'demo' } as never))
      .rejects.toMatchObject({ status: 403, code: 'demo_disabled' });
    const [c] = await sql()<{ n: number }[]>`select count(*)::int as n from users where email = ${`gate-${n}@integration.test`}`;
    expect(c!.n).toBe(0);
  });
});
