import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { firmEnquiriesService } from '../services/firm-enquiries.service';
import { requireAuth } from '../middleware/auth';
import { signInLimiter, signUpLimiter } from '../middleware/rateLimit';

const SignIn = z.object({ email: z.string().email(), password: z.string().min(1) });
const SignUp = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['solo', 'group', 'firm']),
  firm: z.string().optional(),
  enrolment: z.string().optional(),
  primaryCourt: z.string().optional(),
  practiceAreas: z.string().optional(),
});

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
