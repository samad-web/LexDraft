import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { UnauthorizedError } from '../lib/errors';
import {
  openApplicationsDocument,
  payApplicationFees,
  pressApplicationsControl,
  readApplicationsScreen,
  searchSubmittedApplications,
  sendApplicationOtp,
  setApplicationsField,
  submitApplication,
  verifyApplicationOtp,
  type AppsScreenKey,
} from '../services/efiling-portal-applications.service';

// =============================================================================
// /api/efiling/live/session/:sessionId/applications/... - the portal's
// Applications menu (Interlocutory Application Filing, Submitted
// Applications), live over the advocate's logged-in portal page. See
// efiling-portal-applications.service.ts. Portal problems come back as
// 409 / 410 / 502 (EcourtsHttpError), never 401.
// =============================================================================

export const efilingPortalApplicationsRouter: Router = Router();

const SCREEN_KEYS = ['applications', 'submitted'] as const;
const Params = z.object({ sessionId: z.string().uuid() });
const Ref = z.string().regex(/^a\d{1,5}$/);
const Screen = z.enum(SCREEN_KEYS);

type Handler = (req: Request, userId: string, sessionId: string) => Promise<unknown>;

/** Every route: signed-in user, then the portal step; errors to the error middleware. */
const run = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
    const { sessionId } = req.params as unknown as { sessionId: string };
    res.json(await fn(req, req.user.id, sessionId));
  } catch (err) {
    next(err);
  }
};

const BASE = '/live/session/:sessionId/applications';

// Open / re-read a screen. fresh=1 opens it again from the portal's menu.
efilingPortalApplicationsRouter.get(
  `${BASE}/screen`,
  validate({ params: Params, query: z.object({ screen: Screen.default('applications'), fresh: z.enum(['0', '1']).optional() }) }),
  run((req, userId, sessionId) => {
    const q = req.query as unknown as { screen: AppsScreenKey; fresh?: '0' | '1' };
    return readApplicationsScreen(sessionId, userId, q.screen, q.fresh === '1');
  }),
);

// Choose / type / tick a field the portal shows.
efilingPortalApplicationsRouter.post(
  `${BASE}/field`,
  validate({
    params: Params,
    body: z.object({ screen: Screen, ref: Ref, value: z.string().max(20_000).optional(), checked: z.boolean().optional() })
      .refine((b) => b.value !== undefined || b.checked !== undefined, 'Give a value or checked.'),
  }),
  run((req, userId, sessionId) => {
    const b = req.body as { screen: AppsScreenKey; ref: string; value?: string; checked?: boolean };
    return setApplicationsField(sessionId, userId, b.screen, b.ref, { value: b.value, checked: b.checked });
  }),
);

// Press a portal button / link / tab. confirmed = the advocate said OK in DifAi.
efilingPortalApplicationsRouter.post(
  `${BASE}/press`,
  validate({ params: Params, body: z.object({ screen: Screen, ref: Ref, confirmed: z.boolean().optional() }) }),
  run((req, userId, sessionId) => {
    const b = req.body as { screen: AppsScreenKey; ref: string; confirmed?: boolean };
    return pressApplicationsControl(sessionId, userId, b.screen, b.ref, b.confirmed === true);
  }),
);

// Submit / Update the application (applications.js submitApplication).
efilingPortalApplicationsRouter.post(
  `${BASE}/submit`,
  validate({ params: Params, body: z.object({ confirmed: z.literal(true) }) }),
  run((_req, userId, sessionId) => submitApplication(sessionId, userId, true)),
);

// Pay Fees: pay the ticked applications from the wallet (payCourtFees).
efilingPortalApplicationsRouter.post(
  `${BASE}/fees/pay`,
  validate({ params: Params, body: z.object({ confirmed: z.literal(true) }) }),
  run((_req, userId, sessionId) => payApplicationFees(sessionId, userId, true)),
);

// Authentication: Send OTP (generateOTP).
efilingPortalApplicationsRouter.post(
  `${BASE}/otp/send`,
  validate({ params: Params }),
  run((_req, userId, sessionId) => sendApplicationOtp(sessionId, userId)),
);

// Authentication: the OTP the advocate typed (verifyOTP -> submitFinalData).
efilingPortalApplicationsRouter.post(
  `${BASE}/otp/verify`,
  validate({ params: Params, body: z.object({ otp: z.string().regex(/^\d{4,8}$/, 'Type the OTP as received.'), confirmed: z.literal(true) }) }),
  run((req, userId, sessionId) => verifyApplicationOtp(sessionId, userId, (req.body as { otp: string }).otp, true)),
);

// Submitted Applications: From Date / To Date (dd-mm-yyyy).
const Dmy = z.string().regex(/^\d{2}-\d{2}-\d{4}$/, 'Use DD-MM-YYYY.');
efilingPortalApplicationsRouter.post(
  `${BASE}/submitted/search`,
  validate({ params: Params, body: z.object({ fromDate: Dmy, toDate: Dmy }) }),
  run((req, userId, sessionId) => {
    const b = req.body as { fromDate: string; toDate: string };
    return searchSubmittedApplications(sessionId, userId, b.fromDate, b.toDate);
  }),
);

// A link that shows a document (an application): the PDF the portal shows.
efilingPortalApplicationsRouter.post(
  `${BASE}/document`,
  validate({ params: Params, body: z.object({ screen: Screen, ref: Ref }) }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const b = req.body as { screen: AppsScreenKey; ref: string };
      const f = await openApplicationsDocument(sessionId, req.user.id, b.screen, b.ref);
      const safe = f.name.replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'application.pdf';
      res.setHeader('Content-Type', f.contentType);
      res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(f.body);
    } catch (err) {
      next(err);
    }
  },
);
