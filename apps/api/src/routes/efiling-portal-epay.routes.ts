import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { UnauthorizedError } from '../lib/errors';
import {
  openEpayForm,
  payFromWallet,
  proceedToGateway,
  readEpayTransactions,
  readEpayWallet,
  runEpayTransactionAction,
  sendEpayOtp,
  setEpayFields,
} from '../services/efiling-portal-epay.service';

// =============================================================================
// /api/efiling/live/session/:sessionId/epay/... — the portal's ePayments menu
// (Payment, transactions / GRN, Court Fee Wallet) over the advocate's own
// logged-in eFiling session. See efiling-portal-epay.service.ts.
//
// Portal problems come back as 409 / 410 / 502 (EcourtsHttpError), never 401.
// The two steps that commit money - verifying the OTP (the portal then
// creates the payment request for the gateway) and paying from the wallet -
// need { confirmed: true }. The gateway payment itself is the advocate's.
// =============================================================================

export const efilingPortalEpayRouter: Router = Router();

const SessionParam = z.object({ sessionId: z.string().uuid() });
// The portal's control ids / names (cases, epayOptions, sel_pde_no, payee, amount ...).
const FieldKey = z.string().regex(/^[A-Za-z][\w-]{0,63}$/);

type Step = (req: Request, userId: string, sessionId: string) => Promise<unknown>;
function step(fn: Step) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      res.json(await fn(req, req.user.id, String(req.params['sessionId'] ?? '')));
    } catch (err) {
      next(err);
    }
  };
}

// Payment: open (fresh) or read the form as it stands on the portal.
efilingPortalEpayRouter.post(
  '/live/session/:sessionId/epay/form/open',
  validate({ params: SessionParam, body: z.object({ fresh: z.boolean().default(true) }).strict() }),
  step((req, userId, sessionId) => openEpayForm(sessionId, userId, (req.body as { fresh: boolean }).fresh)),
);

// Payment: set controls in order (the portal's own handlers run for each).
efilingPortalEpayRouter.post(
  '/live/session/:sessionId/epay/form/fields',
  validate({
    params: SessionParam,
    body: z.object({
      fields: z.array(z.object({ key: FieldKey, value: z.string().max(300) })).min(1).max(30),
    }).strict(),
  }),
  step((req, userId, sessionId) => setEpayFields(sessionId, userId, (req.body as { fields: Array<{ key: string; value: string }> }).fields)),
);

// Payment: "I agree" + the portal's Send OTP (epay/generate_otp). Nothing is paid.
efilingPortalEpayRouter.post(
  '/live/session/:sessionId/epay/form/otp',
  validate({ params: SessionParam, body: z.object({ agreed: z.literal(true) }).strict() }),
  step((req, userId, sessionId) => sendEpayOtp(sessionId, userId, (req.body as { agreed: boolean }).agreed === true)),
);

// Payment: verify the OTP (epay/verify_otp_new) -> the portal prepares the
// payment request; the gateway is returned for the advocate's browser.
efilingPortalEpayRouter.post(
  '/live/session/:sessionId/epay/form/proceed',
  validate({
    params: SessionParam,
    body: z.object({ otp: z.string().regex(/^\d{4,10}$/), confirmed: z.literal(true) }).strict(),
  }),
  step((req, userId, sessionId) => {
    const { otp, confirmed } = req.body as { otp: string; confirmed: boolean };
    return proceedToGateway(sessionId, userId, otp, confirmed === true);
  }),
);

// Transactions (the portal's viewDetails list): read; press a row's own link.
efilingPortalEpayRouter.get(
  '/live/session/:sessionId/epay/transactions',
  validate({ params: SessionParam }),
  step((_req, userId, sessionId) => readEpayTransactions(sessionId, userId)),
);

efilingPortalEpayRouter.post(
  '/live/session/:sessionId/epay/transactions/action',
  validate({
    params: SessionParam,
    body: z.object({
      ref: z.string().regex(/^\d{1,2}:[\w-]{1,40}$/),
      fn: z.enum(['getGRNGras', 'getCINGras', 'viewDetailsDouble', 'getPrevChallanGras', 'getChallanData']),
    }).strict(),
  }),
  step((req, userId, sessionId) => {
    const { ref, fn } = req.body as { ref: string; fn: string };
    return runEpayTransactionAction(sessionId, userId, ref, fn);
  }),
);

// Court Fee Wallet: the menu page as shown + the wallet's Pay Fees list.
efilingPortalEpayRouter.get(
  '/live/session/:sessionId/epay/wallet',
  validate({
    params: SessionParam,
    query: z.object({
      page: z.coerce.number().int().min(1).max(500).optional(),
      search: z.string().max(100).optional(),
      refresh: z.enum(['1', '0']).optional(),
    }),
  }),
  step((req, userId, sessionId) => {
    const q = req.query as { page?: number; search?: string; refresh?: string };
    return readEpayWallet(sessionId, userId, { page: q.page, search: q.search, refresh: q.refresh === '1' });
  }),
);

// Court Fee Wallet: pay the ticked applications' fees from the wallet.
efilingPortalEpayRouter.post(
  '/live/session/:sessionId/epay/wallet/pay',
  validate({
    params: SessionParam,
    body: z.object({ checks: z.array(z.string().min(1).max(120)).min(1).max(100), confirmed: z.literal(true) }).strict(),
  }),
  step((req, userId, sessionId) => {
    const { checks, confirmed } = req.body as { checks: string[]; confirmed: boolean };
    return payFromWallet(sessionId, userId, checks, confirmed === true);
  }),
);
