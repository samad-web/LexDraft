import { Router } from 'express';
import { z } from 'zod';
import { errorLogService } from '../services/error-log.service';

/**
 * SuperAdmin-only routes for the internal error tracker. Mount in
 * `routes/index.ts` AFTER `requireAuth` + `requireSuperadmin` — those gates
 * live on the orchestrator side; this router intentionally adds no auth of
 * its own so the mount point is the single source of truth.
 *
 * Pagination defaults to 50, capped at 500 by the service layer. Filters are
 * all optional query params.
 */
export const adminErrorsRouter: Router = Router();

const ListQuery = z.object({
  since:  z.string().datetime().optional(),
  until:  z.string().datetime().optional(),
  status: z.coerce.number().int().min(100).max(599).optional(),
  userId: z.string().uuid().optional(),
  firmId: z.string().uuid().optional(),
  // Accept "true" / "false" / "all". Anything else → undefined.
  resolved: z.enum(['true', 'false', 'all']).optional(),
  limit:  z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

adminErrorsRouter.get('/', async (req, res, next) => {
  try {
    const q = ListQuery.parse(req.query);
    const resolved = q.resolved === 'all' || q.resolved === undefined
      ? undefined
      : q.resolved === 'true';
    res.json(await errorLogService.list({
      since:  q.since,
      until:  q.until,
      status: q.status,
      userId: q.userId,
      firmId: q.firmId,
      resolved,
      limit:  q.limit,
      offset: q.offset,
    }));
  } catch (err) { next(err); }
});

const StatsQuery = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

adminErrorsRouter.get('/stats', async (req, res, next) => {
  try {
    const q = StatsQuery.parse(req.query);
    res.json(await errorLogService.stats({ since: q.since, until: q.until }));
  } catch (err) { next(err); }
});

adminErrorsRouter.get('/:id', async (req, res, next) => {
  try {
    const row = await errorLogService.get(req.params.id!);
    if (!row) { res.status(404).json({ error: 'Error not found' }); return; }
    res.json(row);
  } catch (err) { next(err); }
});

const ResolveBody = z.object({ note: z.string().max(2000).optional() });

adminErrorsRouter.post('/:id/resolve', async (req, res, next) => {
  try {
    const body = ResolveBody.parse(req.body ?? {});
    await errorLogService.resolve(req.params.id!, req.user!.id, body.note);
    res.status(204).end();
  } catch (err) { next(err); }
});

adminErrorsRouter.post('/:id/unresolve', async (req, res, next) => {
  try {
    await errorLogService.unresolve(req.params.id!);
    res.status(204).end();
  } catch (err) { next(err); }
});
