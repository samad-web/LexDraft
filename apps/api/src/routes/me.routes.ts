import { Router } from 'express';
import { db } from '../db/client';
import { authService } from '../services/auth.service';
import { permissionsService } from '../services/permissions.service';

export const meRouter: Router = Router();

// Current User as the API knows it. Used at app boot to refresh the cached
// auth state — picks up plan changes (e.g. firm promoted to Practice) without
// a sign-out/sign-in cycle.
meRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user = await authService.getById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// Resolved feature set for the current session (spec §9 self-service).
meRouter.get('/features', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json(await permissionsService.resolveFeatures(userId));
  } catch (err) {
    next(err);
  }
});

const PLAN_LIMITS: Record<string, number | null> = {
  Solo: 50,
  Practice: 500,
  Firm: null,
};

interface PlanRow { plan_tier: string | null }
interface CountRow { c: string | number }

function limitFor(tier: string | null): number | null {
  if (!tier) return PLAN_LIMITS.Solo ?? 50;
  if (tier in PLAN_LIMITS) return PLAN_LIMITS[tier]!;
  return PLAN_LIMITS.Solo ?? 50;
}

meRouter.get('/usage', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const sql = db();
    if (!sql) {
      res.json({ aiDocuments: { used: 0, limit: 50 } });
      return;
    }
    const [planRows, countRows] = await Promise.all([
      sql<PlanRow[]>`
        select f.plan_tier
        from users u
        left join firms f on f.id = u.firm_id
        where u.id = ${userId}
        limit 1
      `,
      sql<CountRow[]>`
        select count(*)::int as c
        from drafts
        where user_id = ${userId}
          and created_at >= date_trunc('month', now())
      `,
    ]);
    const tier = planRows[0]?.plan_tier ?? null;
    const limit = limitFor(tier);
    const used = Number(countRows[0]?.c ?? 0);
    res.json({ aiDocuments: { used, limit } });
  } catch (err) {
    next(err);
  }
});
