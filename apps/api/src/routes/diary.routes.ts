import { Router } from 'express';
import { z } from 'zod';
import { diaryService } from '../services/diary.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { validate, uuidParam } from '../middleware/validate';

const InputShape = z.object({
  date: z.string(),
  time: z.string().default(''),
  kind: z.enum(['hearing', 'judgment', 'filing']),
  caseLabel: z.string().min(1),
  cnr: z.string().default(''),
  detail: z.string().default(''),
  forum: z.string().default(''),
  bench: z.string().max(200).default(''),
  // Next hearing date + in-app reminder offset (days before that date).
  nextHearingDate: z.string().nullable().optional(),
  reminderOffsetDays: z.number().int().min(0).max(60).nullable().optional(),
  // Judgment-PDF attachment. base64 of the file body; the row also records
  // the filename, mime and size so the diary list can render an icon + size
  // without having to ship the bytes back.
  attachmentFileName: z.string().max(255).optional(),
  attachmentMime: z.string().max(120).optional(),
  attachmentSize: z.number().int().nonnegative().optional(),
  attachmentBase64: z.string().optional(),
});

function checkReminderNeedsHearing(val: { reminderOffsetDays?: number | null; nextHearingDate?: string | null }, ctx: z.RefinementCtx) {
  if (val.reminderOffsetDays != null && !val.nextHearingDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reminderOffsetDays requires nextHearingDate to be set',
      path: ['reminderOffsetDays'],
    });
  }
}

const Input = InputShape.superRefine(checkReminderNeedsHearing);
// Patch body: same fields, all optional. Built from the un-refined shape so
// `.partial()` is available (ZodEffects from `.superRefine()` doesn't expose
// it); the hearing/reminder relationship is still enforced on top.
const PatchInput = InputShape.partial().superRefine(checkReminderNeedsHearing);

export const diaryRouter: Router = Router();

// Diary is matter-adjacent - gates on matter.view/create.
diaryRouter.get('/', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.json({ items: await diaryService.list(firmId) });
  } catch (err) {
    next(err);
  }
});

// Per-entry detail including the base64 attachment body. Split off the list
// endpoint so the diary index stays small.
diaryRouter.get(
  '/:id',
  requireFeature('matter.view'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const entry = await diaryService.getWithAttachment(String(req.params.id ?? ''), firmId);
      if (!entry) { res.status(404).json({ error: 'Diary entry not found' }); return; }
      res.json(entry);
    } catch (err) { next(err); }
  },
);

diaryRouter.post('/', requireFeature('matter.create'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.status(201).json(await diaryService.create(Input.parse(req.body), firmId));
  } catch (err) {
    next(err);
  }
});

diaryRouter.patch(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const updated = await diaryService.update(
        String(req.params.id ?? ''),
        PatchInput.parse(req.body),
        firmId,
      );
      if (!updated) {
        res.status(404).json({ error: 'Diary entry not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

diaryRouter.delete(
  '/:id',
  requireFeature('matter.create'),
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const removed = await diaryService.remove(String(req.params.id ?? ''), firmId);
      if (!removed) {
        res.status(404).json({ error: 'Diary entry not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
