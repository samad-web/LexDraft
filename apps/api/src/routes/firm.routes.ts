import { Router } from 'express';
import { z } from 'zod';
import { firmService } from '../services/firm.service';
import { firmAdminService } from '../services/firm-admin.service';
import { auditService } from '../services/audit.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { firmStageAdmin } from '../services/case-pipeline.service';
import { validate, idParam } from '../middleware/validate';

export const firmRouter: Router = Router();

// Firm overview surface: gated on `firm.dashboard.view`. Per the dashboard
// spec (WORKFLOW_DASHBOARDS.md §3) only Firm-plan users land here; Practice-
// plan Group Leads can also see it; Solo never.
firmRouter.get('/dashboard', requireFeature('firm.dashboard.view'), async (req, res, next) => {
  try {
    res.json(await firmService.dashboard(req.user?.id));
  } catch (err) {
    next(err);
  }
});

// ---- /firm/users (spec §9, §7.2) -----------------------------------------
// Gated on the `admin.users` feature, which the resolver only grants when the
// caller's plan and role both include it (Firm Admin role + Practice/Firm plan).

firmRouter.get('/users', requireFeature('admin.users'), async (req, res, next) => {
  try {
    res.json({ items: await firmAdminService.listUsers(req.user!.id) });
  } catch (err) { next(err); }
});

const FirmCreateUser = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  roleId: z.string().uuid(),
  practiceGroupId: z.string().uuid().nullable().optional(),
  password: z.string().min(8).optional(),
});

firmRouter.post('/users', requireFeature('admin.users'), async (req, res, next) => {
  try {
    const body = FirmCreateUser.parse(req.body);
    const result = await firmAdminService.createUser(
      req.user!.id,
      body,
      { id: req.user!.id, email: req.user!.email },
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
});

const FirmUpdateUser = z.object({
  roleId: z.string().uuid().optional(),
  practiceGroupId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'suspended', 'deactivated']).optional(),
});

firmRouter.patch('/users/:id', requireFeature('admin.users'), async (req, res, next) => {
  try {
    const body = FirmUpdateUser.parse(req.body);
    const targetId = String(req.params.id ?? '');
    const result = await firmAdminService.updateUser(
      req.user!.id,
      targetId,
      body,
      { id: req.user!.id, email: req.user!.email },
    );
    res.json(result);
  } catch (err) { next(err); }
});

// ---- /firm/roles --------------------------------------------------------
// Read-only in Phase 1 - surfaces the seeded system roles + counts.
firmRouter.get('/roles', requireFeature('admin.users'), async (req, res, next) => {
  try {
    res.json({ items: await firmAdminService.listAvailableRoles(req.user!.id) });
  } catch (err) { next(err); }
});

// ---- /firm/practice-groups ----------------------------------------------
// Read-only in Phase 1.
firmRouter.get('/practice-groups', requireFeature('admin.users'), async (req, res, next) => {
  try {
    res.json({ items: await firmAdminService.listPracticeGroups(req.user!.id) });
  } catch (err) { next(err); }
});

// ---- /firm/case-stages --------------------------------------------------
// Per-firm custom case-pipeline stages. Folded into the snapshot returned by
// GET /api/cases/:id so the matter-detail stepper renders them inline. Lives
// on the firm router because management is a firm-admin concern, not a
// per-matter action.
const PipelineKindEnum = z.enum(['civil', 'criminal', 'consumer', 'writ', 'default', 'all']);
const CreateStageBody = z.object({
  kind: PipelineKindEnum,
  stageName: z.string().min(1).max(60),
  position: z.number().int().min(0).max(10000).optional(),
});

firmRouter.get('/case-stages', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) { res.json({ items: [] }); return; }
    res.json({ items: await firmStageAdmin.list(firmId) });
  } catch (err) { next(err); }
});

firmRouter.post(
  '/case-stages',
  requireFeature('admin.users'),
  validate({ body: CreateStageBody }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const body = req.body as z.infer<typeof CreateStageBody>;
      const created = await firmStageAdmin.create({
        firmId,
        kind: body.kind,
        stageName: body.stageName,
        ...(body.position !== undefined ? { position: body.position } : {}),
        createdBy: req.user?.id ?? null,
      });
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

firmRouter.delete(
  '/case-stages/:id',
  requireFeature('admin.users'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      if (!firmId) { res.status(422).json({ error: 'No firm attached' }); return; }
      const removed = await firmStageAdmin.remove(firmId, String(req.params.id ?? ''));
      if (!removed) { res.status(404).json({ error: 'Stage not found' }); return; }
      res.status(204).end();
    } catch (err) { next(err); }
  },
);

// ---- /firm/audit --------------------------------------------------------
// Tenant-scoped slice of the platform audit log. Filters to entries authored
// by users in the caller's firm + entries whose direct target is the firm.
firmRouter.get('/audit', requireFeature('admin.audit'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) { res.json({ items: [] }); return; }
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const items = await auditService.listForFirm(firmId, { limit });
    res.json({ items });
  } catch (err) { next(err); }
});
