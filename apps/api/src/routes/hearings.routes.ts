import { Router } from 'express';
import { z } from 'zod';
import { hearingsService } from '../services/hearings.service';
import { assignmentsService } from '../services/assignments.service';
import { firmIdForUser } from '../services/tenant';
import { validate } from '../middleware/validate';
import { withAudit } from '../middleware/audit';
import { requireFeature } from '../services/permissions.service';
import { notify } from '../services/notifications.service';
import { db } from '../db/client';

const Input = z.object({
  case: z.string().min(1),
  time: z.string().min(1),
  court: z.string().min(1),
  purpose: z.string().min(1),
  status: z.enum(['today', 'upcoming', 'past']).default('upcoming'),
  date: z.string().optional(),
  judge: z.string().optional(),
  caseId: z.string().uuid().optional(),
});

// Edit form: same shape as Input minus caseId (re-resolved server-side from the
// matter label). All fields required so the row is fully replaced.
const UpdateInput = z.object({
  case: z.string().min(1),
  time: z.string().min(1),
  court: z.string().min(1),
  purpose: z.string().min(1),
  status: z.enum(['today', 'upcoming', 'past']),
  date: z.string().optional(),
  judge: z.string().optional(),
});

const WeekQuery = z.object({ start: z.string().optional() });
const MonthQuery = z.object({
  year:  z.coerce.number().int().min(1970).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});
const DayParams = z.object({ iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const IdParams = z.object({ id: z.string().uuid() });

export const hearingsRouter: Router = Router();

// Hearings live under the matter feature domain - re-uses matter.view/create
// rather than introducing dedicated hearings.* keys.

hearingsRouter.get('/today', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await hearingsService.listToday(firmId) });
  } catch (err) {
    next(err);
  }
});

hearingsRouter.post(
  '/',
  requireFeature('matter.create'),
  validate({ body: Input }),
  withAudit({ action: 'hearing.create', targetType: 'hearing' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const created = await hearingsService.create(req.body, firmId);
      // Best-effort: if the hearing's matter is portal-visible, email the
      // associated client. Resolves matter → client name → clientId.
      try {
        const sql = db();
        if (sql && firmId) {
          const matterTitle = (typeof req.body?.case === 'string' && req.body.case) || '';
          if (matterTitle) {
            const rows = await sql<Array<{ id: string }>>`
              select c.id
              from cases cs
              join clients c on c.firm_id = cs.firm_id and c.name = cs.client
              where cs.firm_id = ${firmId}::uuid
                and cs.title = ${matterTitle}
                and cs.visible_to_client = true
                and c.portal_enabled = true
              limit 1
            `;
            const clientId = rows[0]?.id;
            if (clientId) {
              await notify.hearingScheduled(clientId, {
                matterTitle,
                date: typeof req.body?.date === 'string' ? req.body.date : undefined,
                time: typeof req.body?.time === 'string' ? req.body.time : '',
                court: typeof req.body?.court === 'string' ? req.body.court : '',
              });
            }
          }
        }
      } catch { /* best effort */ }
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

hearingsRouter.get('/week', requireFeature('matter.view'), validate({ query: WeekQuery }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const start = typeof req.query['start'] === 'string' ? req.query['start'] as string : undefined;
    res.json(await hearingsService.week(firmId, start));
  } catch (err) {
    next(err);
  }
});

hearingsRouter.get('/month', requireFeature('matter.view'), validate({ query: MonthQuery }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const year = Number(req.query['year']);
    const month = Number(req.query['month']);
    res.json(await hearingsService.month(firmId, year, month));
  } catch (err) {
    next(err);
  }
});

hearingsRouter.get('/day/:iso', requireFeature('matter.view'), validate({ params: DayParams }), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const iso = typeof req.params['iso'] === 'string' ? (req.params['iso'] as string) : '';
    res.json({ items: await hearingsService.listForDay(firmId, iso) });
  } catch (err) {
    next(err);
  }
});

hearingsRouter.get('/', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await hearingsService.listUpcoming(firmId) });
  } catch (err) {
    next(err);
  }
});

hearingsRouter.patch(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: IdParams, body: UpdateInput }),
  withAudit({ action: 'hearing.update', targetType: 'hearing' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const id = String(req.params['id']);
      const updated = await hearingsService.update(id, req.body, firmId);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

// Hand a single hearing to a colleague (or clear with userId=null). The
// service enforces who may reassign (firm head, the matter lead, or the
// current assignee), so the route only needs the matter feature gate.
const AssigneeInput = z.object({ userId: z.string().uuid().nullable() });

hearingsRouter.get(
  '/:id/assignee',
  requireFeature('matter.view'),
  validate({ params: IdParams }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const assignee = await assignmentsService.getHearingAssignee(String(req.params['id']), firmId);
      res.json({ assignee });
    } catch (err) {
      next(err);
    }
  },
);

hearingsRouter.put(
  '/:id/assignee',
  requireFeature('matter.view'),
  validate({ params: IdParams, body: AssigneeInput }),
  withAudit({ action: 'hearing.update', targetType: 'hearing' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const id = String(req.params['id']);
      const actor = { id: req.user!.id, role: req.user!.role, isSuperadmin: req.user!.isSuperadmin };
      const assignee = await assignmentsService.assignHearing({
        hearingId: id, firmId, targetUserId: req.body.userId, actor,
      });
      res.json({ assignee });
    } catch (err) {
      next(err);
    }
  },
);

hearingsRouter.delete(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: IdParams }),
  withAudit({ action: 'hearing.delete', targetType: 'hearing' }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const id = String(req.params['id']);
      await hearingsService.remove(id, firmId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
