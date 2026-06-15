import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { listHighCourtJudges } from '../services/judges-roster.service';
import { logger } from '../logger';

// =============================================================================
// /api/judges — sitting-judge roster for the High Courts.
//
// Reference data sourced from a public list (see migration 0057_court_judges
// + services/judges-roster.service.ts), NOT the eCourts gateway. Used to
// populate the BENCH dropdown when logging a hearing against a High Court.
//
// Behind `requireAuth + requireActivePlan` (applied at the mount in
// routes/index.ts).
// =============================================================================

export const judgesRouter: Router = Router();

const ListQuery = z.object({
  // Canonical High Court name, e.g. "Kerala High Court". Omit to list all.
  highCourt: z.string().min(1).max(120).optional(),
});

judgesRouter.get(
  '/',
  validate({ query: ListQuery }),
  async (req, res, next) => {
    try {
      const { highCourt } = req.query as { highCourt?: string };
      const items = await listHighCourtJudges(highCourt);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  },
);

logger.debug('Judges routes mounted');
