import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import * as efilingLive from '../services/efiling-live.service';
import { UnauthorizedError } from '../lib/errors';

// =============================================================================
// /api/efiling — browser-automation gateway into the National e-Filing
// portal (filing.ecourts.gov.in). See efiling-live.service.ts's file header
// for scope: login + CAPTCHA are real; the filing-form endpoints below
// return 501 until a real advocate login is used to capture their selectors.
//
// All endpoints sit behind `requireAuth + requireActivePlan` (applied at the
// mount site in routes/index.ts), same as /api/ecourts.
// =============================================================================

export const efilingRouter: Router = Router();

const SessionIdParam = z.object({ sessionId: z.string().uuid() });

const StartSessionBody = z.object({
  state: z.string().min(1).max(10),
  userType: z.enum(['advocate', 'litigant', 'pleader', 'clerk', 'gov_auth', 'insurance']),
});

efilingRouter.post(
  '/live/session',
  validate({ body: StartSessionBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { state, userType } = req.body as { state: string; userType: 'advocate' | 'litigant' | 'pleader' | 'clerk' | 'gov_auth' | 'insurance' };
      const result = await efilingLive.startEfilingSession(req.user.id, state, userType);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const LoginBody = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

efilingRouter.post(
  '/live/session/:sessionId/login',
  validate({ params: SessionIdParam, body: LoginBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const { username, password } = req.body as { username: string; password: string };
      const result = await efilingLive.submitEfilingCredentials(sessionId, req.user.id, username, password);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

efilingRouter.post(
  '/live/session/:sessionId/login/captcha/refresh',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const result = await efilingLive.refreshEfilingCaptcha(sessionId, req.user.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const LoginCaptchaBody = z.object({ captchaCode: z.string().min(1).max(20) });

efilingRouter.post(
  '/live/session/:sessionId/login/captcha',
  validate({ params: SessionIdParam, body: LoginCaptchaBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const result = await efilingLive.submitEfilingLoginCaptcha(sessionId, req.user.id, req.body.captchaCode);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

const DuplicateLoginBody = z.object({
  password: z.string().min(1).max(200),
  captchaCode: z.string().min(1).max(20),
});

// The advocate is already logged in elsewhere - eCourts enforces one active
// session per account. This confirms the logout-other-sessions prompt
// (#frm_duplicate_login on the portal) with the password re-entered (a
// separate form, separate field) plus a fresh captcha for THIS form.
efilingRouter.post(
  '/live/session/:sessionId/login/duplicate',
  validate({ params: SessionIdParam, body: DuplicateLoginBody }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      const { password, captchaCode } = req.body as { password: string; captchaCode: string };
      const result = await efilingLive.confirmDuplicateEfilingLogin(sessionId, req.user.id, password, captchaCode);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// --- Filing-form endpoints: wired up, but the service layer throws a clear
// 501 EfilingNotCapturedError until real selectors are captured from a
// logged-in advocate session. Not stubbed out of the router entirely so the
// frontend/UI contract is already settled.

efilingRouter.post(
  '/live/session/:sessionId/file',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      await efilingLive.openNewFiling(sessionId, req.user.id);
      res.json({ ok: true }); // unreachable until openNewFiling is implemented
    } catch (err) {
      next(err);
    }
  },
);

efilingRouter.post(
  '/live/session/:sessionId/upload',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      await efilingLive.uploadFilingDocument(sessionId, req.user.id);
      res.json({ ok: true }); // unreachable until uploadFilingDocument is implemented
    } catch (err) {
      next(err);
    }
  },
);

efilingRouter.post(
  '/live/session/:sessionId/end',
  validate({ params: SessionIdParam }),
  async (req, res, next) => {
    try {
      if (!req.user?.id) throw new UnauthorizedError('Not authenticated');
      const { sessionId } = req.params as unknown as { sessionId: string };
      await efilingLive.endEfilingSession(sessionId, req.user.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
