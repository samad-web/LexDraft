import { Router } from 'express';
import { z } from 'zod';
import { assertFirmPaidForMembers, invitationsService } from '../services/invitations.service';
import { authService } from '../services/auth.service';
import { firmIdForUser } from '../services/tenant';
import { requireAuth } from '../middleware/auth';
import { requireMemberAdmin } from '../middleware/requireMemberAdmin';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import { MUNSHI_ROLES } from '../lib/plans';
import { validate } from '../middleware/validate';
import { otpSendLimiter, signUpLimiter, tokenLookupLimiter } from '../middleware/rateLimit';
import { strongPassword } from '../lib/password';

const InviteRoles = z.enum([
  'Managing Partner',
  'Senior Associate',
  'Associate',
  'Junior Associate',
  'Of Counsel',
  'Paralegal',
  'Munshi',
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
  /** Owner 2026-11-18: every Google sign-up also sets a strong password. */
  password: strongPassword,
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
        { name: body.name, email: google.email, googleSub: google.sub, phone, password: body.password },
        (record, firmId) => authService.registerExternalUser(record, firmId),
      );
      res.status(201).json(auth);
    } catch (err) {
      next(err);
    }
  },
);

// Join with email + password instead of Google (team-join.md): the email is
// the invite's own, never typed, so the code and account are for that email.
const InviteEmailStart = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(200),
  phone: z.string().min(8).max(24),
}).strict();
const InviteEmailAccept = z.object({
  signupToken: z.string().min(20).max(4096),
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  password: strongPassword,
}).strict();

invitationsRouter.post(
  '/by-token/:token/email/start',
  otpSendLimiter,
  validate({ params: TokenParam, body: InviteEmailStart }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof InviteEmailStart>;
      const email = await invitationsService.pendingEmail((req.params as { token: string }).token);
      res.json(await authService.startEmailSignup({ name: body.name, email, phone: body.phone, ip: req.ip ?? null }));
    } catch (err) {
      next(err);
    }
  },
);

invitationsRouter.post(
  '/by-token/:token/email/accept',
  signUpLimiter,
  validate({ params: TokenParam, body: InviteEmailAccept }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof InviteEmailAccept>;
      const v = await authService.verifyEmailSignup(body);
      const auth = await invitationsService.accept(
        (req.params as { token: string }).token,
        { name: v.name, email: v.email, phone: v.phone, password: body.password },
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

// An existing DifAi user (signed in as the invited email) joins the firm.
invitationsRouter.post(
  '/by-token/:token/join',
  tokenLookupLimiter,
  validate({ params: TokenParam }),
  async (req, res, next) => {
    try {
      if (req.user!.actAs) throw new ForbiddenError('Not while acting as another user.');
      await invitationsService.join((req.params as { token: string }).token, req.user!.id);
      res.json(await authService.sessionFor(req.user!.id, req.user!.mfaVerifiedAt));
    } catch (err) {
      next(err);
    }
  },
);

// All read+write below requires `admin.users`. The previous setup gated only
// on `requireAuth`, which let any Solo/Practice-tier user mint invitations
// at any role including Managing Partner — a textbook privilege-escalation
// path. `admin.users` is the canonical "manage firm members" capability and
// is intentionally limited to Firm Admins + Practice/Firm-tier leads.
// A Solo-plan owner (res.locals.munshiOnly) sees and manages only Munshi
// invitations; see middleware/requireMemberAdmin.ts.
const isMunshiRole = (r: string) => MUNSHI_ROLES.includes(r);
async function assertMunshiInvite(res: import('express').Response, id: string, firmId: string | null): Promise<void> {
  if (!res.locals.munshiOnly) return;
  const inv = (await invitationsService.list(firmId)).find((i) => i.id === id);
  if (!inv) throw new NotFoundError('Invitation not found or not pending');
  if (!isMunshiRole(inv.role)) throw new ForbiddenError('Your plan can only manage Munshi seats.', { code: 'munshi_only' });
}

invitationsRouter.get('/', requireMemberAdmin, async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const items = await invitationsService.list(firmId);
    res.json({ items: res.locals.munshiOnly ? items.filter((i) => isMunshiRole(i.role)) : items });
  } catch (err) {
    next(err);
  }
});

// Members join only a set-up, paid firm (signup-hardening.md, F2). Checked
// before the member-admin check so an unpaid owner gets the clear 402.
async function requirePaidFirm(req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction): Promise<void> {
  try {
    await assertFirmPaidForMembers(await firmIdForUser(req.user?.id));
    next();
  } catch (err) {
    next(err);
  }
}

invitationsRouter.post(
  '/',
  requirePaidFirm,
  requireMemberAdmin,
  validate({ body: Create }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof Create>;
      if (res.locals.munshiOnly && !isMunshiRole(body.role)) {
        throw new ForbiddenError('Your plan can invite only a Munshi. Choose Associates to add advocates.', { code: 'munshi_only' });
      }
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
  requireMemberAdmin,
  validate({ params: InvitationIdParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      await assertMunshiInvite(res, (req.params as { id: string }).id, firmId);
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
  requireMemberAdmin,
  validate({ params: InvitationIdParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      await assertMunshiInvite(res, (req.params as { id: string }).id, firmId);
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
