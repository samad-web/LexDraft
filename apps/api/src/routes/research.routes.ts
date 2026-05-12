import { Router } from 'express';
import { z } from 'zod';
import { researchService } from '../services/research.service';
import { requireFeature } from '../services/permissions.service';

const Ask = z.object({ q: z.string().min(2) });

export const researchRouter: Router = Router();

researchRouter.get('/', requireFeature('research.basic'), (req, res, next) => {
  try {
    const { q } = Ask.parse(req.query);
    res.json(researchService.ask(q));
  } catch (err) {
    next(err);
  }
});
