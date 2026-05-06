import { Router } from 'express';
import { z } from 'zod';
import { adminService } from '../services/admin.service';
import { templatesService } from '../services/templates.service';
import { impersonationService } from '../services/impersonation.service';
import { auditService } from '../services/audit.service';

export const adminRouter: Router = Router();

// ---- helpers ---------------------------------------------------------------

function actor(req: import('express').Request): { id: string; email: string } {
  return { id: req.user!.id, email: req.user!.email };
}

const FirmPlanTier  = z.enum(['Solo', 'Practice', 'Firm']);
const BillingStatus = z.enum(['trial', 'active', 'past_due', 'cancelled']);
const FirmStatus    = z.enum(['active', 'suspended']);
const UserStatus    = z.enum(['active', 'suspended', 'deactivated']);
const FeatureModule = z.enum([
  'drafting', 'cases', 'contracts', 'billing', 'research',
  'limitation', 'ecourts', 'analytics', 'firm_dashboard',
]);
const TemplateScope = z.enum(['platform', 'firm']);

// ---- platform stats --------------------------------------------------------

adminRouter.get('/stats', async (_req, res, next) => {
  try { res.json(await adminService.platformStats()); } catch (err) { next(err); }
});

// ---- firms -----------------------------------------------------------------

adminRouter.get('/firms', async (_req, res, next) => {
  try { res.json({ items: await adminService.listFirms() }); } catch (err) { next(err); }
});

adminRouter.get('/firms/:id', async (req, res, next) => {
  try {
    const firm = await adminService.getFirm(req.params.id!);
    if (!firm) { res.status(404).json({ error: 'Firm not found' }); return; }
    res.json(firm);
  } catch (err) { next(err); }
});

const CreateFirm = z.object({
  name: z.string().min(1),
  seats: z.number().int().min(1).max(500),
  plan: FirmPlanTier,
});
adminRouter.post('/firms', async (req, res, next) => {
  try {
    const body = CreateFirm.parse(req.body);
    res.status(201).json(await adminService.createFirm(body, actor(req)));
  } catch (err) { next(err); }
});

const UpdateFirm = z.object({
  name: z.string().min(1).optional(),
  seats: z.number().int().min(1).max(500).optional(),
  status: FirmStatus.optional(),
});
adminRouter.patch('/firms/:id', async (req, res, next) => {
  try {
    const body = UpdateFirm.parse(req.body);
    res.json(await adminService.updateFirm(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

adminRouter.delete('/firms/:id', async (req, res, next) => {
  try {
    await adminService.deleteFirm(req.params.id!, actor(req));
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---- plan ------------------------------------------------------------------

const UpdatePlan = z.object({
  tier: FirmPlanTier.optional(),
  status: BillingStatus.optional(),
  mrrInr: z.number().int().min(0).optional(),
  renewsAt: z.string().nullable().optional(),
});
adminRouter.patch('/firms/:id/plan', async (req, res, next) => {
  try {
    const body = UpdatePlan.parse(req.body);
    res.json(await adminService.updatePlan(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

// ---- flags -----------------------------------------------------------------

const UpdateFlags = z.object({
  flags: z.array(z.object({ module: FeatureModule, enabled: z.boolean() })).min(1),
});
adminRouter.patch('/firms/:id/flags', async (req, res, next) => {
  try {
    const body = UpdateFlags.parse(req.body);
    res.json({ items: await adminService.updateFlags(req.params.id!, body, actor(req)) });
  } catch (err) { next(err); }
});

// ---- branding --------------------------------------------------------------

const UpdateBranding = z.object({
  displayName: z.string().min(1).optional(),
  logoUrl: z.string().url().nullable().optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});
adminRouter.patch('/firms/:id/branding', async (req, res, next) => {
  try {
    const body = UpdateBranding.parse(req.body);
    res.json(await adminService.updateBranding(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

// ---- users -----------------------------------------------------------------

adminRouter.get('/users', async (req, res, next) => {
  try {
    const firmId = typeof req.query.firmId === 'string' ? req.query.firmId : undefined;
    const status = typeof req.query.status === 'string' ? (req.query.status as 'active' | 'suspended' | 'deactivated') : undefined;
    const q      = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json({ items: await adminService.listUsers({ firmId, status, q }) });
  } catch (err) { next(err); }
});

const UpdateUser = z.object({
  role: z.string().min(1).optional(),
  status: UserStatus.optional(),
  isSuperadmin: z.boolean().optional(),
  firmId: z.string().uuid().nullable().optional(),
});
adminRouter.patch('/users/:id', async (req, res, next) => {
  try {
    const body = UpdateUser.parse(req.body);
    res.json(await adminService.updateUser(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

adminRouter.delete('/users/:id', async (req, res, next) => {
  try {
    await adminService.deleteUser(req.params.id!, actor(req));
    res.status(204).end();
  } catch (err) { next(err); }
});

adminRouter.post('/users/:id/reset-password', async (req, res, next) => {
  try {
    res.json(await adminService.resetUserPassword(req.params.id!, actor(req)));
  } catch (err) { next(err); }
});

// ---- impersonation ---------------------------------------------------------

adminRouter.post('/impersonate/:userId', async (req, res, next) => {
  try {
    res.json(await impersonationService.start(req.params.userId!, actor(req)));
  } catch (err) { next(err); }
});

const EndImpersonation = z.object({ targetUserId: z.string().uuid().nullable().optional() });
adminRouter.post('/impersonate/end', async (req, res, next) => {
  try {
    const body = EndImpersonation.parse(req.body ?? {});
    await impersonationService.end(actor(req), body.targetUserId ?? null);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---- audit log -------------------------------------------------------------

adminRouter.get('/audit-log', async (req, res, next) => {
  try {
    const limit  = req.query.limit  ? Number(req.query.limit)  : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    const action = typeof req.query.action === 'string' ? (req.query.action as never) : undefined;
    const targetType = typeof req.query.targetType === 'string'
      ? (req.query.targetType as 'firm' | 'user' | 'template' | 'platform')
      : undefined;
    const targetId   = typeof req.query.targetId === 'string' ? req.query.targetId : undefined;
    const actorUserId = typeof req.query.actorUserId === 'string' ? req.query.actorUserId : undefined;
    res.json({ items: await auditService.list({ limit, offset, action, targetType, targetId, actorUserId }) });
  } catch (err) { next(err); }
});

// ---- templates -------------------------------------------------------------

adminRouter.get('/templates', async (req, res, next) => {
  try {
    const scope = typeof req.query.scope === 'string' ? (req.query.scope as 'platform' | 'firm') : undefined;
    const firmId = typeof req.query.firmId === 'string' ? req.query.firmId : undefined;
    res.json({ items: await templatesService.list(scope, firmId) });
  } catch (err) { next(err); }
});

adminRouter.get('/templates/:id', async (req, res, next) => {
  try {
    const t = await templatesService.get(req.params.id!);
    if (!t) { res.status(404).json({ error: 'Template not found' }); return; }
    res.json(t);
  } catch (err) { next(err); }
});

const CreateTemplate = z.object({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  scope: TemplateScope,
  firmId: z.string().uuid().nullable().optional(),
  body: z.string().min(1),
});
adminRouter.post('/templates', async (req, res, next) => {
  try {
    const body = CreateTemplate.parse(req.body);
    res.status(201).json(await templatesService.create(body, actor(req)));
  } catch (err) { next(err); }
});

const UpdateTemplate = z.object({
  name: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});
adminRouter.patch('/templates/:id', async (req, res, next) => {
  try {
    const body = UpdateTemplate.parse(req.body);
    res.json(await templatesService.update(req.params.id!, body, actor(req)));
  } catch (err) { next(err); }
});

adminRouter.delete('/templates/:id', async (req, res, next) => {
  try {
    await templatesService.remove(req.params.id!, actor(req));
    res.status(204).end();
  } catch (err) { next(err); }
});
