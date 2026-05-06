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
      };
    }
  }
}

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
      };
    } catch {
      // ignore — leave req.user undefined
    }
  }
  next();
}

/** Gate for /api/admin/* routes. Must run AFTER requireAuth.
 *  An impersonation session (actAs claim present) is explicitly NOT allowed
 *  to hit admin routes — admins must end their impersonation first. */
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
