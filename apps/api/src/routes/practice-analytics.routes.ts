/**
 * Practice-tier analytics routes.
 *
 *   GET /api/practice-analytics/workload
 *   GET /api/practice-analytics/profitability?since=2025-01-01
 *
 * Both gated by the `practice.analytics` feature key — the orchestrator
 * wires this feature into the Practice + Firm plans (see PRICING_AND_TIERS).
 * Solo callers will hit a 403; that's intentional, workload-fairness only
 * matters in a team setting.
 */

import { Router } from 'express';
import { z } from 'zod';
import { practiceAnalyticsService } from '../services/practice-analytics.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { BadRequestError } from '../lib/errors';

const SinceQuery = z.object({
  // Accepts a plain YYYY-MM-DD or any Date-parseable string. We coerce here
  // so the service can stay typed on `Date` rather than `string | undefined`.
  since: z.string().optional(),
});

export const practiceAnalyticsRouter: Router = Router();

practiceAnalyticsRouter.get(
  '/workload',
  requireFeature('practice.analytics'),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      res.json(await practiceAnalyticsService.workload(firmId));
    } catch (err) {
      next(err);
    }
  },
);

practiceAnalyticsRouter.get(
  '/profitability',
  requireFeature('practice.analytics'),
  async (req, res, next) => {
    try {
      const firmId = await firmIdForUser(req.user?.id);
      const parsed = SinceQuery.safeParse(req.query);
      if (!parsed.success) {
        throw new BadRequestError('Invalid query', { details: parsed.error.flatten() });
      }
      let since: Date | undefined;
      if (parsed.data.since) {
        const d = new Date(parsed.data.since);
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestError('Invalid since (expected ISO date)');
        }
        since = d;
      }
      res.json(await practiceAnalyticsService.profitability(firmId, { since }));
    } catch (err) {
      next(err);
    }
  },
);
