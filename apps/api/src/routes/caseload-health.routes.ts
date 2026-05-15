/**
 * Caseload health endpoint - drives the SoloDashboard widget that flags
 * burnout-risk signals (open matters, imminent limitations, overdue
 * tasks/invoices, near-term hearings). One read-only GET; the assessment
 * is recomputed live every call. Gated by `caseload.health` so it can be
 * toggled per-tier from the permissions seed.
 */

import { Router } from 'express';
import { caseloadHealthService } from '../services/caseload-health.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';

export const caseloadHealthRouter: Router = Router();

caseloadHealthRouter.get('/', requireFeature('caseload.health'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    const summary = await caseloadHealthService.assess(req.user?.id, firmId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});
