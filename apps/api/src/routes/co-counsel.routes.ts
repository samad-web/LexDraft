/**
 * Co-Counsel cross-firm handover routes.
 *
 * Split like invitations.routes.ts: the request/list/cancel endpoints require
 * an authenticated firm member; the accept-by-token endpoints are public
 * (rate-limited) because the person accepting may not have a DifAi account
 * yet. `POST /accept/:requestId` sits in between - authenticated, but the
 * caller may belong to a different firm than the one that raised the request.
 *
 * Gated on `matter.view` - the baseline Solo-tier matter-access feature -
 * rather than `matter.assign` (Practice+ only). Co-Counsel exists precisely
 * for Solo advocates with no in-firm colleague to hand off to, so it can't
 * require a paid-tier feature. assignmentsService's in-firm handover (used
 * when the target turns out to be a teammate) keeps its own `matter.view`
 * gate on the cases routes - unaffected by this choice.
 */

import { Router } from 'express';
import { z } from 'zod';
import { coCounselService } from '../services/co-counsel.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { requireAuth } from '../middleware/auth';
import { validate, uuidParam } from '../middleware/validate';
import { tokenLookupLimiter } from '../middleware/rateLimit';
import { UnauthorizedError } from '../lib/errors';

const TokenParam = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/, 'Invalid token shape'),
});

const CreateBody = z.object({
  target: z.union([
    z.object({ existingUserId: z.string().uuid() }),
    z.object({
      name: z.string().min(1).max(200),
      email: z.string().email(),
      phone: z.string().max(30).optional(),
    }),
    z.object({ open: z.literal(true) }),
  ]),
  reason: z.string().max(1000).optional(),
  urgency: z.enum(['normal', 'urgent']).optional(),
});

const AcceptByToken = z.object({
  name: z.string().min(1).max(200),
  signupToken: z.string().min(20).max(4096),
}).strict();

export const coCounselRouter: Router = Router();

// ---- Public (token-scoped) --------------------------------------------------

coCounselRouter.get(
  '/accept/by-token/:token',
  tokenLookupLimiter,
  validate({ params: TokenParam }),
  async (req, res, next) => {
    try {
      res.json(await coCounselService.lookupInviteByToken((req.params as { token: string }).token));
    } catch (err) { next(err); }
  },
);

coCounselRouter.post(
  '/accept/by-token/:token',
  tokenLookupLimiter,
  validate({ params: TokenParam, body: AcceptByToken }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof AcceptByToken>;
      const result = await coCounselService.acceptByToken((req.params as { token: string }).token, body);
      res.status(201).json(result);
    } catch (err) { next(err); }
  },
);

// ---- Authenticated -----------------------------------------------------------

coCounselRouter.use(requireAuth);

coCounselRouter.get('/requests', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await coCounselService.listForFirm(firmId) });
  } catch (err) { next(err); }
});

coCounselRouter.post(
  '/cases/:caseId/requests',
  requireFeature('matter.view'),
  requireFeature('co_counsel.handover'),
  validate({ params: z.object({ caseId: z.string().uuid() }), body: CreateBody }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new UnauthorizedError();
      const firmId = await firmIdForUser(userId);
      const actor = { id: userId, role: req.user!.role, isSuperadmin: req.user!.isSuperadmin };
      const body = req.body as z.infer<typeof CreateBody>;
      const created = await coCounselService.requestHandover({
        caseId: (req.params as { caseId: string }).caseId,
        firmId,
        actor,
        input: body,
      });
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

coCounselRouter.post(
  '/requests/:id/cancel',
  requireFeature('matter.view'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new UnauthorizedError();
      const firmId = await firmIdForUser(userId);
      const updated = await coCounselService.cancelHandover((req.params as { id: string }).id, firmId, userId);
      res.json(updated);
    } catch (err) { next(err); }
  },
);

coCounselRouter.post(
  '/requests/:id/accept',
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new UnauthorizedError();
      const result = await coCounselService.acceptExisting((req.params as { id: string }).id, userId);
      res.status(201).json(result);
    } catch (err) { next(err); }
  },
);

// ---- Guest-scoped read access (Phase 1: case summary only) -------------------

coCounselRouter.get('/guest-cases', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedError();
    res.json({ items: await coCounselService.listGuestCases(userId) });
  } catch (err) { next(err); }
});

// Full read-only bundle for a guest's case page: summary + hearings +
// shared notes + document metadata, gated by the same case_guest_grants
// check every section uses (see assertGuestGrant in co-counsel.service.ts).
coCounselRouter.get(
  '/guest-cases/:caseId',
  validate({ params: z.object({ caseId: z.string().uuid() }) }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new UnauthorizedError();
      const detail = await coCounselService.guestCaseDetail(userId, (req.params as { caseId: string }).caseId);
      res.json(detail);
    } catch (err) { next(err); }
  },
);
