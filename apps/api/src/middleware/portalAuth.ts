import type { NextFunction, Request, Response } from 'express';
import { portalService } from '../services/portal.service';

export interface PortalContext {
  clientId: string;
  firmId: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portalClient?: PortalContext;
    }
  }
}

/**
 * Validates a client-portal JWT. Distinct from `requireAuth` (tenant users)
 * because the two token kinds carry different claims and must never be
 * interchangeable - a portal token must NOT grant tenant-user access, and a
 * tenant-user token must NOT grant portal access.
 */
export function requirePortalAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Missing portal bearer token' });
    return;
  }
  try {
    const claims = portalService.verify(token);
    req.portalClient = {
      clientId: claims.sub,
      firmId: claims.firmId,
      email: claims.email,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired portal token' });
  }
}
