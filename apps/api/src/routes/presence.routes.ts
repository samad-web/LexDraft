// team-docs presence: report "I'm working on this" and see who else is.
import { Router } from 'express';
import { z } from 'zod';
import { requireFeature } from '../services/permissions.service';
import { firmIdForUser } from '../services/tenant';
import { nameOf, presence, TARGET } from '../services/presence.service';

export const presenceRouter: Router = Router();

const Targets = z.object({ targets: z.array(z.string().regex(TARGET)).min(1).max(10) });

presenceRouter.get('/', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    const firmId = await firmIdForUser(req.user!.id);
    res.json({ working: firmId ? presence.view(firmId, req.user!.id) : {} });
  } catch (err) { next(err); }
});

/** Heartbeat: "I'm working on these"; answers who else is on them. */
presenceRouter.post('/', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    const parsed = Targets.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
    const userId = req.user!.id;
    const firmId = await firmIdForUser(userId);
    if (!firmId) { res.json({ working: {} }); return; }
    presence.beat(firmId, userId, await nameOf(userId), parsed.data.targets);
    res.json({ working: presence.view(firmId, userId, parsed.data.targets) });
  } catch (err) { next(err); }
});

// "Stopped working on these" (closing the screen); otherwise an entry lapses by itself.
presenceRouter.post('/leave', requireFeature('shared.documents'), async (req, res, next) => {
  try {
    const parsed = Targets.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'validation' }); return; }
    const firmId = await firmIdForUser(req.user!.id);
    if (firmId) presence.leave(firmId, req.user!.id, parsed.data.targets);
    res.status(204).end();
  } catch (err) { next(err); }
});
