import { Router } from 'express';
import { z } from 'zod';
import { diaryService } from '../services/diary.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { validate, idParam } from '../middleware/validate';

const Input = z.object({
  date: z.string(),
  time: z.string().default(''),
  kind: z.enum(['hearing', 'judgment', 'filing']),
  caseLabel: z.string().min(1),
  cnr: z.string().default(''),
  detail: z.string().default(''),
  forum: z.string().default(''),
  // Judgment-PDF attachment. base64 of the file body; the row also records
  // the filename, mime and size so the diary list can render an icon + size
  // without having to ship the bytes back.
  attachmentFileName: z.string().max(255).optional(),
  attachmentMime: z.string().max(120).optional(),
  attachmentSize: z.number().int().nonnegative().optional(),
  attachmentBase64: z.string().optional(),
});

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
  validate({ params: idParam }),
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
