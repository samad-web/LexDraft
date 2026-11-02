import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { UnauthorizedError } from '../lib/errors';
import { requireFeature } from '../services/permissions.service';
import { lastSyncSummary, linkPortalFiling, syncPortalToDifai } from '../services/efiling-portal-sync.service';

// =============================================================================
// /api/efiling/live/session/:sessionId/sync
//
// eFiling portal -> DifAi (services/efiling-portal-sync.service.ts): what the
// advocate has on filing.ecourts.gov.in saved into their matters. Read-only
// on the portal.
//
//   POST /live/session/:sessionId/sync        run now -> summary
//   GET  /live/session/:sessionId/sync        last summary (+ running)
//   POST /live/session/:sessionId/sync/link   { portalEfilingNo, caseId | createCase: true }
//
// Portal problems come back as 404 / 409 / 410 / 502 (EcourtsHttpError), never 401.
// =============================================================================

export const efilingPortalSyncRouter: Router = Router();

const SessionIdParam = z.object({ sessionId: z.string().uuid() });

efilingPortalSyncRouter.post(
  '/live/session/:sessionId/sync',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(await syncPortalToDifai(sessionId, req.user.id));
    } catch (err) {
      next(err);
    }
  },
);

efilingPortalSyncRouter.get(
  '/live/session/:sessionId/sync',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      res.json(lastSyncSummary(req.user.id));
    } catch (err) {
      next(err);
    }
  },
);

efilingPortalSyncRouter.post(
  '/live/session/:sessionId/sync/link',
  requireFeature('matter.create'),
  validate({
    params: SessionIdParam,
    body: z.union([
      z.object({ portalEfilingNo: z.string().trim().min(10).max(40), caseId: z.string().uuid() }),
      z.object({ portalEfilingNo: z.string().trim().min(10).max(40), createCase: z.literal(true) }),
    ]),
  }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const body = req.body as { portalEfilingNo: string; caseId?: string; createCase?: true };
      const target = body.caseId ? { caseId: body.caseId } : { createCase: true as const };
      res.json(await linkPortalFiling(sessionId, req.user.id, body.portalEfilingNo, target));
    } catch (err) {
      next(err);
    }
  },
);
