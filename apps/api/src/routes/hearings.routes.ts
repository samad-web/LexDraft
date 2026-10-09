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

// Same YYYY-MM-DD constraint as DayParams.iso below - keeps malformed date
// strings from ever reaching the `::date` cast in hearings.service.ts, which
// Postgres rejects with an unhandled 500 rather than a 400.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format').optional();

// Local-date "today", not `.toISOString().slice(0,10)` - that UTC-shifts
// across midnight on Asia/Kolkata (+5:30), the exact bug already fixed in
// hearings.service.ts's week()/month() (see isoOfLocal there). Duplicated
// here rather than exported/shared, since it's three lines and this is the
// only other call site.
function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Cross-checks `status` against `date` so a hearing can't be saved in a
// self-contradictory state (e.g. status='today' with a date 2 months out) -
// that value then flows unchecked into the calendar UI's status badge and
// the .ics export's "Status:" line. `date` is optional (a hearing can be
// created without one yet), so the check only fires once both fields are
// present; it is not a replacement for deriving status from date entirely,
// just a guard against an obvious mismatch.
function checkStatusDate(
  val: { status: 'today' | 'upcoming' | 'past'; date?: string },
  ctx: z.RefinementCtx,
): void {
  if (!val.date) return;
  const today = todayIsoLocal();
  const isConsistent =
    (val.status === 'today' && val.date === today) ||
    (val.status === 'past' && val.date < today) ||
    (val.status === 'upcoming' && val.date >= today);
  if (!isConsistent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: `status '${val.status}' is inconsistent with date ${val.date} (today is ${today})`,
    });
  }
}

const Input = z.object({
  case: z.string().min(1),
  time: z.string().min(1),
  court: z.string().min(1),
  purpose: z.string().min(1),
  status: z.enum(['today', 'upcoming', 'past']).default('upcoming'),
  date: isoDate,
  judge: z.string().optional(),
  caseId: z.string().uuid().optional(),
}).superRefine(checkStatusDate);

// Edit form: same shape as Input. caseId pins the hearing to an exact case
// row (e.g. when editing from a case detail page) - without it, the server
// falls back to a title-match lookup that can silently reattach the hearing
// to the wrong case when two matters share the same title (newest wins).
// All fields required so the row is fully replaced.
const UpdateInput = z.object({
  case: z.string().min(1),
  time: z.string().min(1),
  court: z.string().min(1),
  purpose: z.string().min(1),
  status: z.enum(['today', 'upcoming', 'past']),
  date: isoDate,
  judge: z.string().optional(),
  caseId: z.string().uuid().optional(),
}).superRefine(checkStatusDate);

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
