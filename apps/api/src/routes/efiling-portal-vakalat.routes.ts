import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { UnauthorizedError } from '../lib/errors';
import {
  openVakalatScreen, readPortalMenus, stepVakalatScreen,
  type LiveStep, type PartnersView, type VakalatView,
} from '../services/efiling-portal-vakalat.service';

// =============================================================================
// /api/efiling/live/session/:sessionId/vakalat/... and .../partners/...
//
// The portal's Vakalat menu (Assign Partners to Case, Accept Offer, Print
// Vakalat) and My Partners, driven on the advocate's own logged-in portal
// page (efiling-portal-vakalat.service.ts). Portal problems come back as
// 409 / 410 / 502 (EcourtsHttpError), never 401.
// =============================================================================

export const efilingPortalVakalatRouter: Router = Router();

const SessionIdParam = z.object({ sessionId: z.string().uuid() });
const VakalatViewParam = z.object({ sessionId: z.string().uuid(), view: z.enum(['vakalat', 'accept_offer', 'print_vakalat']) });

/** A field on the portal page (CSS selector DifAi read off that page) and what to set. */
export const FillSchema = z.object({
  key: z.string().min(1).max(300),
  value: z.union([z.string().max(2000), z.array(z.string().max(500)).max(200)]).optional(),
  checked: z.boolean().optional(),
});

export const StepSchema = z.object({
  fill: z.array(FillSchema).max(200).optional(),
  press: z.object({ text: z.string().min(1).max(120), nth: z.number().int().min(0).max(500).default(0) }).optional(),
  /** Required (true) when the button assigns, accepts, removes, deletes, submits ... */
  confirmed: z.boolean().optional(),
});

// The portal's menu bar (labels and order as the portal draws them).
efilingPortalVakalatRouter.get(
  '/live/session/:sessionId/vakalat/menu',
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

// Open Assign Partners to Case / Accept Offer / Print Vakalat on the portal and read it.
efilingPortalVakalatRouter.get(
  '/live/session/:sessionId/vakalat/:view',
  validate({ params: VakalatViewParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId, view } = req.params as unknown as { sessionId: string; view: VakalatView };
      res.json(await openVakalatScreen(sessionId, req.user.id, view));
    } catch (err) {
      next(err);
    }
  },
);

// One step there: set fields, press a button (Send OTP, Submit, Print ...).
efilingPortalVakalatRouter.post(
  '/live/session/:sessionId/vakalat/:view/step',
  validate({ params: VakalatViewParam, body: StepSchema }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId, view } = req.params as unknown as { sessionId: string; view: VakalatView };
      res.json(await stepVakalatScreen(sessionId, req.user.id, view, req.body as LiveStep));
    } catch (err) {
      next(err);
    }
  },
);

// My Partners > Add Partners / Accept Partnership / Revoke Partnership / Accept Revocation / My Partners Report.
const PartnersViewParam = z.object({ sessionId: z.string().uuid(), view: z.enum(['add_partner', 'accept_partnership', 'revoke_partnership', 'accept_revocation', 'partners_report']) });

efilingPortalVakalatRouter.get(
  '/live/session/:sessionId/partners/:view',
  validate({ params: PartnersViewParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId, view } = req.params as unknown as { sessionId: string; view: PartnersView };
      res.json(await openVakalatScreen(sessionId, req.user.id, view));
    } catch (err) {
      next(err);
    }
  },
);

efilingPortalVakalatRouter.post(
  '/live/session/:sessionId/partners/:view/step',
  validate({ params: PartnersViewParam, body: StepSchema }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId, view } = req.params as unknown as { sessionId: string; view: PartnersView };
      res.json(await stepVakalatScreen(sessionId, req.user.id, view, req.body as LiveStep));
    } catch (err) {
      next(err);
    }
  },
);
