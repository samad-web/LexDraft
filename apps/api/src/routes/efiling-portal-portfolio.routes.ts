import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { UnauthorizedError } from '../lib/errors';
import { readPortalMenus, type LiveStep } from '../services/efiling-portal-vakalat.service';
import {
  deleteMyCases, exportMyCases, importMyCases, openPortfolioScreen, stepPortfolioScreen,
  type CourtType, type PortfolioView,
} from '../services/efiling-portal-portfolio.service';
import { StepSchema } from './efiling-portal-vakalat.routes';

// =============================================================================
// /api/efiling/live/session/:sessionId/portfolio/...
//
// The portal's Portfolio menu except My Cases (that is /my-cases in
// efiling.routes.ts): Search Cases and Planner driven on the advocate's own
// portal page; Import / Export / Delete my cases as the exact requests the
// portal's mycases_common_functions.js makes. Portal problems come back as
// 400 / 409 / 410 / 502 (EcourtsHttpError), never 401.
// =============================================================================

export const efilingPortalPortfolioRouter: Router = Router();

const SessionIdParam = z.object({ sessionId: z.string().uuid() });
const ViewParam = z.object({ sessionId: z.string().uuid(), view: z.enum(['search_cases', 'planner']) });
const Court = z.enum(['D', 'H']);

efilingPortalPortfolioRouter.get(
  '/live/session/:sessionId/portfolio/menu',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json({ menus: await readPortalMenus(sessionId, req.user.id) });
    } catch (err) {
      next(err);
    }
  },
);

// Export my cases: the file the portal's Download link holds (myCases.txt / hcMyCases.txt).
efilingPortalPortfolioRouter.post(
  '/live/session/:sessionId/portfolio/export',
  validate({ params: SessionIdParam, body: z.object({ court: Court }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(await exportMyCases(sessionId, req.user.id, (req.body as { court: CourtType }).court));
    } catch (err) {
      next(err);
    }
  },
);

// Import cases from a myCases.txt / hcMyCases.txt (adds to the portal's My Cases).
efilingPortalPortfolioRouter.post(
  '/live/session/:sessionId/portfolio/import',
  validate({
    params: SessionIdParam,
    body: z.object({
      court: Court,
      fileName: z.string().min(1).max(200),
      content: z.string().min(1).max(5_000_000),
      confirmed: z.literal(true),
    }),
  }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const { court, fileName, content } = req.body as { court: CourtType; fileName: string; content: string };
      res.json(await importMyCases(sessionId, req.user.id, court, fileName, content, true));
    } catch (err) {
      next(err);
    }
  },
);

// "Do you want to delete my cases ?" -> Delete.
efilingPortalPortfolioRouter.post(
  '/live/session/:sessionId/portfolio/delete',
  validate({ params: SessionIdParam, body: z.object({ confirmed: z.literal(true) }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      res.json(await deleteMyCases(sessionId, req.user.id, true));
    } catch (err) {
      next(err);
    }
  },
);

// Search Cases / Planner: open on the portal and read it.
efilingPortalPortfolioRouter.get(
  '/live/session/:sessionId/portfolio/:view',
  validate({ params: ViewParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId, view } = req.params as unknown as { sessionId: string; view: PortfolioView };
      res.json(await openPortfolioScreen(sessionId, req.user.id, view));
    } catch (err) {
      next(err);
    }
  },
);

// One step there: fields, then a button or link (Go, a case number, Add Case, Back ...).
efilingPortalPortfolioRouter.post(
  '/live/session/:sessionId/portfolio/:view/step',
  validate({ params: ViewParam, body: StepSchema }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId, view } = req.params as unknown as { sessionId: string; view: PortfolioView };
      res.json(await stepPortfolioScreen(sessionId, req.user.id, view, req.body as LiveStep));
    } catch (err) {
      next(err);
    }
  },
);
