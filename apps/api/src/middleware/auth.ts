import type { NextFunction, Request, Response } from 'express';
import { authService } from '../services/auth.service';

export interface ActAs {
  adminId: string;
  adminEmail: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        isSuperadmin: boolean;
        /** Present when the session is an admin impersonating a tenant user. */
        actAs?: ActAs;
        /** Unix seconds when this session last proved an MFA code. Absent
         *  when the user signed in without going through the MFA gate
         *  (either MFA isn't enrolled or hasn't been verified yet for this
         *  token). `requireMfa` middleware reads this. */
        mfaVerifiedAt?: number;
      };
    }
  }
}

/** Roles that mandate MFA-verified sessions for `requireMfa`-gated routes. */
const ROLES_REQUIRING_MFA: ReadonlySet<string> = new Set(['Firm Admin']);

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const claims = authService.verify(token);
    req.user = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      isSuperadmin: claims.isSuperadmin,
      ...(claims.actAs ? { actAs: claims.actAs } : {}),
      ...(typeof claims.mfaVerifiedAt === 'number' ? { mfaVerifiedAt: claims.mfaVerifiedAt } : {}),
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) {
    try {
      const claims = authService.verify(token);
      req.user = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        isSuperadmin: claims.isSuperadmin,
        ...(claims.actAs ? { actAs: claims.actAs } : {}),
        ...(typeof claims.mfaVerifiedAt === 'number' ? { mfaVerifiedAt: claims.mfaVerifiedAt } : {}),
      };
    } catch {
      // ignore - leave req.user undefined
    }
  }
  next();
}

/** Gate for /api/admin/* routes. Must run AFTER requireAuth.
 *  An impersonation session (actAs claim present) is explicitly NOT allowed
 *  to hit admin routes - admins must end their impersonation first. */
export function requireSuperadmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.user.actAs) {
    res.status(403).json({ error: 'End impersonation before accessing admin routes' });
    return;
  }
  if (!req.user.isSuperadmin) {
    res.status(403).json({ error: 'Superadmin access required' });
    return;
  }
  next();
}

/**
 * Gate routes that require a MFA-verified session for users whose role
 * mandates MFA (spec §10 - Firm Admin + superadmin).
 *
 * Must run AFTER `requireAuth`. Users whose role does NOT require MFA
 * pass through unconditionally - this middleware is a no-op for them.
 *
 * Currently exported but not wired to any router; the orchestrator will
 * attach it to sensitive admin routes in a follow-up. Two upgrade paths:
 *   - "session staleness": reject if `mfaVerifiedAt` is older than, say,
 *     24h. Not implemented here; add by comparing against Date.now().
 *   - "step-up MFA on per-action basis": let routes opt in via a param,
 *     not relevant yet.
 */
export function requireMfa(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const mustMfa = req.user.isSuperadmin || ROLES_REQUIRING_MFA.has(req.user.role);
  if (!mustMfa) {
    next();
    return;
  }
  if (typeof req.user.mfaVerifiedAt !== 'number') {
    res.status(403).json({
      error: 'MFA verification required',
      code: 'mfa_verification_required',
    });
    return;
  }
  next();
}
