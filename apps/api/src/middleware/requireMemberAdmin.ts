import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/client';
import { ForbiddenError } from '../lib/errors';
import { resolveFeatures } from '../services/permissions.service';

/**
 * Who may manage members (features/solo-munshi.md):
 *  - `admin.users` holders (Associates / Partners admins): everyone.
 *  - the owner of a Solo-tier account (Sanad / Vakalat / Brief): only their
 *    Munshi (clerk) seats. Sets res.locals.munshiOnly = true for the route.
 * Anyone else: 403.
 */
export async function requireMemberAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Authentication required' }); return; }
    const { features } = await resolveFeatures(userId);
    if ((features as string[]).includes('admin.users')) { res.locals.munshiOnly = false; next(); return; }
    const sql = db();
    const [row] = sql
      ? await sql<{ owner: boolean }[]>`
          select (u.role = 'Solo Advocate' and f.plan_tier = 'Solo') as owner
          from users u join firms f on f.id = u.firm_id
          where u.id = ${userId}::uuid and u.status = 'active' limit 1`
      : [];
    if (row?.owner) { res.locals.munshiOnly = true; next(); return; }
    next(new ForbiddenError("Forbidden: missing 'admin.users'", { code: 'forbidden' }));
  } catch (err) {
    next(err);
  }
}
