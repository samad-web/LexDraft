import { Router } from 'express';
import { z } from 'zod';
import { diaryService } from '../services/diary.service';

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

diaryRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ items: await diaryService.list() });
  } catch (err) {
    next(err);
  }
});

diaryRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await diaryService.create(Input.parse(req.body)));
  } catch (err) {
    next(err);
  }
});
