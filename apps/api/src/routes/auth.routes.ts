import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { requireAuth } from '../middleware/auth';

const SignIn = z.object({ email: z.string().email(), password: z.string().min(1) });
const SignUp = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['solo', 'group', 'firm']),
  firm: z.string().optional(),
  enrolment: z.string().optional(),
});

export const authRouter: Router = Router();

authRouter.post('/sign-in', async (req, res, next) => {
  try {
    const body = SignIn.parse(req.body);
    res.json(await authService.signIn(body));
  } catch (err) {
    next(err);
  }
});

authRouter.post('/sign-up', async (req, res, next) => {
  try {
    const body = SignUp.parse(req.body);
    res.status(201).json(await authService.signUp(body));
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
  // Stateless JWT — client just discards the token. Endpoint exists for symmetry.
  res.status(204).end();
});
