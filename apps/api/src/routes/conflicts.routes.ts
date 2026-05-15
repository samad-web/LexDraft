/**
 * Conflict-of-interest check - Practice-tier endpoint.
 *
 * Mount under `/api/conflicts` in `routes/index.ts`. The route is gated by
 * the `conflicts.check` feature key, which the permissions orchestrator
 * wires onto Practice + Firm tiers.
 *
 * Empty / partial input is intentionally NOT a 400 - the web UI debounces
 * on every keystroke, so noisy validation errors during typing would be
 * useless. The service returns `{ severity: 'green', hits: [] }` when
 * there's nothing to scan.
 */

import { Router } from 'express';
import { z } from 'zod';
import { conflictsService } from '../services/conflicts.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { BadRequestError } from '../lib/errors';

const NameList = z.array(z.string()).max(50);

const CheckBody = z.object({
  partyNames: NameList.default([]),
  opposingNames: NameList.default([]),
  excludeMatterId: z.string().uuid().optional(),
});

export const conflictsRouter: Router = Router();

conflictsRouter.post('/check', requireFeature('conflicts.check'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user?.id);
    if (!firmId) {
      // No firm attached - return green so the UI can render the new-matter
      // form normally. (Orchestrators sometimes provision users before
      // attaching a firm; we don't want that to break create-matter.)
      res.json({ severity: 'green', hits: [] });
      return;
    }

    let body: z.infer<typeof CheckBody>;
    try {
      body = CheckBody.parse(req.body ?? {});
    } catch (err) {
      throw new BadRequestError('Invalid conflicts.check payload', {
        details: err instanceof z.ZodError ? err.flatten() : undefined,
      });
    }

    const result = await conflictsService.check({
      firmId,
      partyNames: body.partyNames,
      opposingNames: body.opposingNames,
      ...(body.excludeMatterId ? { excludeMatterId: body.excludeMatterId } : {}),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
