import { Router } from 'express';
import { z } from 'zod';
import { firmService } from '../services/firm.service';
import { firmAdminService } from '../services/firm-admin.service';
import { auditService } from '../services/audit.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

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
// Read-only in Phase 1 — surfaces the seeded system roles + counts.
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
