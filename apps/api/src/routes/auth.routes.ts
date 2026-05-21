import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { firmEnquiriesService } from '../services/firm-enquiries.service';
import { demoRequestsService } from '../services/demo-requests.service';
import { requireAuth } from '../middleware/auth';
import { signInLimiter, signUpLimiter } from '../middleware/rateLimit';

const SignIn = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
}).strict();
const SignUp = z.object({
  email: z.string().email().max(254),
  // Min 8 retained for backwards-compat with existing accounts. Max 128
  // blocks bcrypt-truncation-at-72 attacks and stops memory-exhaustion
  // via gigabyte-long passwords.
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200),
  role: z.enum(['solo', 'group', 'firm']),
  firm: z.string().max(200).optional(),
  enrolment: z.string().max(80).optional(),
  primaryCourt: z.string().max(160).optional(),
  practiceAreas: z.string().max(280).optional(),
  /** What landed the user on the form. Determines the firm's plan_status:
   *   - 'trial' (default) → firm.status='trial', trial_ends_at=now()+14d
   *   - 'paid'            → firm.status='active', no trial clock
   *   - 'demo'            → firm.status='trial' + is_demo=true; same 14d clock
   *                         but the UI surfaces a Demo badge and pruning is
   *                         eligible on these tenants.
   * Existing clients that omit it default to 'trial' so behaviour matches
   * the new self-serve funnel without breaking any current caller. */
  intent: z.enum(['trial', 'paid', 'demo']).optional(),
}).strict();

const FirmEnquiry = z.object({
  name:          z.string().min(1).max(120),
  email:         z.string().email().max(254),
  phone:         z.string().max(40).optional(),
  firmName:      z.string().min(1).max(160),
  firmSize:      z.enum(['9-25', '26-50', '51-100', '100+']),
  primaryCourt:  z.string().max(160).optional(),
  practiceAreas: z.string().max(280).optional(),
  message:       z.string().max(2000).optional(),
});

const DemoRequest = z.object({
  name:          z.string().min(1).max(120),
  email:         z.string().email().max(254),
  firmName:      z.string().max(160).optional(),
  phone:         z.string().max(40).optional(),
  preferredTime: z.string().max(120).optional(),
  message:       z.string().max(2000).optional(),
  demoType:      z.enum(['contact', 'schedule']),
});

export const authRouter: Router = Router();

authRouter.post('/sign-in', signInLimiter, async (req, res, next) => {
  try {
    const body = SignIn.parse(req.body);
    res.json(await authService.signIn(body));
  } catch (err) {
    next(err);
  }
});

authRouter.post('/sign-up', signUpLimiter, async (req, res, next) => {
  try {
    const body = SignUp.parse(req.body);
    res.status(201).json(await authService.signUp(body));
  } catch (err) {
    next(err);
  }
});

// Firm-tier prospects skip self-serve sign-up entirely (see AuthView). This
// endpoint captures their contact details so a partner can reach out. Shares
// the sign-up rate limiter so the same IP can't flood the table.
authRouter.post('/firm-enquiry', signUpLimiter, async (req, res, next) => {
  try {
    const body = FirmEnquiry.parse(req.body);
    const created = await firmEnquiriesService.create(body, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ ok: true, id: created.id });
  } catch (err) {
    next(err);
  }
});

// Public demo capture from the landing-page "Get a demo" funnel. Same rate
// limit as sign-up so the same IP can't flood the table.
authRouter.post('/demo-request', signUpLimiter, async (req, res, next) => {
  try {
    const body = DemoRequest.parse(req.body);
    const created = await demoRequestsService.create(body, {
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(201).json({ ok: true, id: created.id });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await authService.getById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/sign-out', requireAuth, (_req, res) => {
  // Stateless JWT - client just discards the token. Endpoint exists for symmetry.
  res.status(204).end();
});
