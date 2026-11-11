import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { BAR_COUNCILS } from '../lib/bar-councils';
import { otpSendLimiter, signInLimiter } from '../middleware/rateLimit';
import { barVerificationService } from '../services/bar-verification.service';

// Mounted at /me/bar-verification behind requireAuth (used during onboarding,
// before a plan is active, and later from Settings to re-check).
export const barVerificationRouter: Router = Router();

const TnStart = z.object({
  enrolmentNo: z.string().min(3).max(40),
  mobile: z.string().max(20).optional(),
}).strict();
const TnOtp = z.object({
  sessionId: z.string().uuid(),
  otp: z.string().regex(/^\d{4,8}$/, 'Enter the OTP the Bar Council sent you'),
}).strict();

barVerificationRouter.get('/', async (req, res, next) => {
  try {
    const sql = db();
    const [me] = sql
      ? await sql<{ bar_council: string | null; bar_verification_status: string | null; bar_record: unknown; bar_checked_at: Date | null }[]>`
          select bar_council, bar_verification_status, bar_record, bar_checked_at from users where id = ${req.user!.id}::uuid`
      : [];
    res.json({
      councils: BAR_COUNCILS,
      council: me?.bar_council ?? null,
      status: me?.bar_verification_status ?? null,
      record: me?.bar_record ?? null,
      checkedAt: me?.bar_checked_at?.toISOString() ?? null,
    });
  } catch (err) {
    next(err);
  }
});

barVerificationRouter.post('/tn/start', otpSendLimiter, async (req, res, next) => {
  try {
    const body = TnStart.parse(req.body);
    res.json(await barVerificationService.startTn({ userId: req.user!.id, ...body }));
  } catch (err) {
    next(err);
  }
});

barVerificationRouter.post('/tn/otp', signInLimiter, async (req, res, next) => {
  try {
    const body = TnOtp.parse(req.body);
    res.json(await barVerificationService.finishTn({ userId: req.user!.id, ...body }));
  } catch (err) {
    next(err);
  }
});

const LiveCheck = z.object({
  council: z.string().max(40),
  enrolmentNo: z.string().min(3).max(40),
}).strict();

// Karnataka / AP / Gujarat: one request to the council's public search.
barVerificationRouter.post('/check', otpSendLimiter, async (req, res, next) => {
  try {
    const body = LiveCheck.parse(req.body);
    res.json(await barVerificationService.checkLive(req.user!.id, body.council, body.enrolmentNo));
  } catch (err) {
    next(err);
  }
});
