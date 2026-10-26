import { Router } from 'express';
import { z } from 'zod';
import { invitationsService } from '../services/invitations.service';
import { authService } from '../services/auth.service';
import { firmIdForUser } from '../services/tenant';
import { requireAuth } from '../middleware/auth';
import { requireFeature } from '../services/permissions.service';
import { validate } from '../middleware/validate';
import { tokenLookupLimiter } from '../middleware/rateLimit';

const InviteRoles = z.enum([
  'Managing Partner',
  'Senior Associate',
  'Associate',
  'Junior Associate',
  'Of Counsel',
  'Paralegal',
  'Other',
]);

// Access levels a custom ("Other") role may inherit. No Firm Admin: admin
// rights go through the Managing Partner preset.
const CustomRoleAccess = z.enum(['Partner', 'Senior Associate', 'Associate', 'Paralegal', 'Legal Secretary', 'Intern']);

const Create = z.object({
  email: z.string().email(),
  role: InviteRoles,
  customRoleName: z.string().trim().min(2).max(60).optional(),
  accessLevel: CustomRoleAccess.optional(),
  message: z.string().max(500).optional(),
}).strict().refine(
  (v) => v.role !== 'Other' || (!!v.customRoleName && !!v.accessLevel),
  { message: 'Name the role and choose its access level', path: ['customRoleName'] },
);

const Accept = z.object({
  name: z.string().min(1).max(200),
  signupToken: z.string().min(20).max(4096),
}).strict();

// Anonymous token lookup is the principal brute-force surface. Bound the
// shape to base64url so probes for arbitrary paths get rejected by the
// validator instead of hitting the service layer.
const TokenParam = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/, 'Invalid token shape'),
});

// Invitation ids are text ('inv_' + hex, see generateId), not uuids. Using
// uuidParam here rejected every cancel/resend with a 400.
const InvitationIdParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, 'Invalid invitation id') });

export const invitationsRouter: Router = Router();

// ---- Public (token-scoped) ------------------------------------------------

invitationsRouter.get(
  '/by-token/:token',
  tokenLookupLimiter,
  validate({ params: TokenParam }),
  async (req, res, next) => {
    try {
      res.json(await invitationsService.lookupByToken((req.params as { token: string }).token));
    } catch (err) {
      next(err);
    }
  },
);

invitationsRouter.post(
  '/by-token/:token/accept',
  tokenLookupLimiter,
  validate({ params: TokenParam, body: Accept }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof Accept>;
      const { google, phone } = await authService.verifiedSignup(body.signupToken);
      const auth = await invitationsService.accept(
        (req.params as { token: string }).token,
        { name: body.name, google, phone },
        (record, firmId) => authService.registerExternalUser(record, firmId),
      );
      res.status(201).json(auth);
    } catch (err) {
      next(err);
    }
  },
);

// ---- Authenticated --------------------------------------------------------

invitationsRouter.use(requireAuth);

// All read+write below requires `admin.users`. The previous setup gated only
// on `requireAuth`, which let any Solo/Practice-tier user mint invitations
// at any role including Managing Partner — a textbook privilege-escalation
// path. `admin.users` is the canonical "manage firm members" capability and
// is intentionally limited to Firm Admins + Practice/Firm-tier leads.
invitationsRouter.get('/', requireFeature('admin.users'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await invitationsService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

invitationsRouter.post(
  '/',
  requireFeature('admin.users'),
  validate({ body: Create }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof Create>;
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
  },
);

invitationsRouter.delete(
  '/:id',
  requireFeature('admin.users'),
  validate({ params: InvitationIdParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const ok = await invitationsService.cancel((req.params as { id: string }).id, firmId);
      if (!ok) {
        res.status(404).json({ error: 'Invitation not found or not pending' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

invitationsRouter.post(
  '/:id/resend',
  requireFeature('admin.users'),
  validate({ params: InvitationIdParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await invitationsService.resend((req.params as { id: string }).id, firmId);
      if (!updated) {
        res.status(404).json({ error: 'Invitation not found or not pending' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);
