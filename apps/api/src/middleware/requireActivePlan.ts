import type { NextFunction, Request, Response } from 'express';
import { getPlanState, evaluatePlanState } from '../services/plan-status.service';
import { PaymentRequiredError } from '../lib/errors';
import { logger } from '../logger';

/**
 * Rejects requests whose firm plan is no longer active. Must run AFTER
 * requireAuth so req.user is populated.
 *
 * Bypasses (the request still goes through):
 *  - Superadmins: an admin needs to be able to access the system even when
 *    their own firm's plan has lapsed (and to fix lapsed customer firms).
 *  - Impersonation sessions (actAs claim): the admin's own subscription
 *    isn't what we're billing for here.
 *
 * Failure mode on DB error: log + allow through. Failing closed would
 * potentially log every signed-in user out during a brief DB hiccup. The
 * cache layer absorbs most of these anyway.
 */
export async function requireActivePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.isSuperadmin || req.user.actAs) {
    next();
    return;
  }
  try {
    const state = await getPlanState(req.user.id);
    const check = evaluatePlanState(state);
    if (!check.ok) {
      // PaymentRequiredError is mapped to 402 with `{ error, code }` by the
      // central error handler. The frontend axios interceptor watches for
      // this status and clears the auth store, which is the "log them out"
      // behaviour requested at the plan boundary.
      next(new PaymentRequiredError('Your firm plan is no longer active. Please renew to continue.', {
        code: check.reason,
        details: check.renewsAt ? { renewsAt: check.renewsAt.toISOString() } : undefined,
      }));
      return;
    }
    next();
  } catch (err) {
    logger.warn({ err, userId: req.user.id }, 'requireActivePlan lookup failed; allowing through');
    next();
  }
}
