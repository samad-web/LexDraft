import { Router } from 'express';
import { z } from 'zod';
import { invitationsService } from '../services/invitations.service';
import { authService } from '../services/auth.service';
import { firmIdForUser } from '../services/tenant';
import { requireAuth } from '../middleware/auth';

const InviteRoles = z.enum([
  'Managing Partner',
  'Senior Associate',
  'Associate',
  'Junior Associate',
  'Of Counsel',
  'Paralegal',
]);

const Create = z.object({
  email: z.string().email(),
  role: InviteRoles,
  message: z.string().max(500).optional(),
});

const Accept = z.object({
  name: z.string().min(1),
  password: z.string().min(8),
});

export const invitationsRouter: Router = Router();

// ---- Public (token-scoped) ------------------------------------------------

invitationsRouter.get('/by-token/:token', async (req, res, next) => {
  try {
    res.json(await invitationsService.lookupByToken(req.params.token!));
  } catch (err) {
    next(err);
  }
});

invitationsRouter.post('/by-token/:token/accept', async (req, res, next) => {
  try {
    const body = Accept.parse(req.body);
    const auth = await invitationsService.accept(req.params.token!, body, (record, firmId) =>
      authService.registerExternalUser(record, firmId),
    );
    res.status(201).json(auth);
  } catch (err) {
    next(err);
  }
});

// ---- Authenticated --------------------------------------------------------

invitationsRouter.use(requireAuth);

invitationsRouter.get('/', async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await invitationsService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

invitationsRouter.post('/', async (req, res, next) => {
  try {
    const body = Create.parse(req.body);
    const inviter = await authService.getById(req.user!.id);
    if (!inviter) {
      res.status(401).json({ error: 'Inviter not found' });
      return;
    }
    const firmId = await firmIdForUser(req.user?.id);
    const inv = await invitationsService.create(
      body,
      { id: inviter.id, name: inviter.name, email: inviter.email, firm: inviter.firm },
      firmId,
    );
    res.status(201).json(inv);
  } catch (err) {
    next(err);
  }
});

invitationsRouter.delete('/:id', async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const ok = await invitationsService.cancel(req.params.id!, firmId);
    if (!ok) {
      res.status(404).json({ error: 'Invitation not found or not pending' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

invitationsRouter.post('/:id/resend', async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const updated = await invitationsService.resend(req.params.id!, firmId);
    if (!updated) {
      res.status(404).json({ error: 'Invitation not found or not pending' });
      return;
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
