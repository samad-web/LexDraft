import { Router } from 'express';
import { z } from 'zod';
import { creditService } from '../services/credit.service';
import { firmIdForUser } from '../services/tenant';

// AI credits (features/ai-credits.md): the firm's balance, and unlocking a
// draft whose pages went past it. Behind requireAuth + requireActivePlan.
export const creditsRouter: Router = Router();

creditsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await creditService.balance(await firmIdForUser(req.user!.id)));
  } catch (err) {
    next(err);
  }
});

// Pays the locked rest of a draft (all or nothing; 402 credits_exhausted when
// short). Only the draft's own firm can unlock it. Intake drafts come back by
// re-loading the matter; a plain-text draft's full text is returned here.
const Unlock = z.object({
  draftKey: z.string().min(6).max(600).refine((k) => k.startsWith('intake:') || k.startsWith('text:'), 'unknown draft'),
}).strict();

creditsRouter.post('/unlock', async (req, res, next) => {
  try {
    const { draftKey } = Unlock.parse(req.body);
    const firmId = await firmIdForUser(req.user!.id);
    const { payload } = await creditService.unlock({ firmId, userId: req.user!.id }, draftKey);
    res.json({ unlocked: true, ...(payload && typeof payload === 'object' ? payload : {}) });
  } catch (err) {
    next(err);
  }
});
