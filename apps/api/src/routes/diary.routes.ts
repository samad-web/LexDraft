import { Router } from 'express';
import { z } from 'zod';
import { diaryService } from '../services/diary.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

const Input = z.object({
  date: z.string(),
  time: z.string().default(''),
  kind: z.enum(['hearing', 'judgment', 'filing']),
  caseLabel: z.string().min(1),
  cnr: z.string().default(''),
  detail: z.string().default(''),
  forum: z.string().default(''),
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

diaryRouter.post('/', requireFeature('matter.create'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    res.status(201).json(await diaryService.create(Input.parse(req.body), firmId));
  } catch (err) {
    next(err);
  }
});
