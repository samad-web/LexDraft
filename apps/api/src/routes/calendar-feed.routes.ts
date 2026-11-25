// hearings-calendar-feed: manage the private calendar link (signed in), and
// serve it (public, the link is the key; rate-limited per IP).
import { Router, type Request } from 'express';
import { calendarFeedService } from '../services/calendar-feed.service';
import { requireFeature } from '../services/permissions.service';

export const calendarFeedRouter: Router = Router();
export const publicCalendarRouter: Router = Router();

function linksFor(req: Request, userId: string, token: string) {
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? '';
  const path = `/api/calendar/${userId}/${token}.ics`;
  return { https: `https://${host}${path}`, webcal: `webcal://${host}${path}` };
}

calendarFeedRouter.get('/', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const token = await calendarFeedService.tokenFor(userId);
    res.json(token ? { on: true, ...linksFor(req, userId, token) } : { on: false });
  } catch (err) { next(err); }
});

calendarFeedRouter.post('/', requireFeature('matter.view'), async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const token = await calendarFeedService.enable(userId, req.body?.reset === true);
    res.json({ on: true, ...linksFor(req, userId, token) });
  } catch (err) { next(err); }
});

calendarFeedRouter.delete('/', requireFeature('matter.view'), async (req, res, next) => {
  try {
    await calendarFeedService.disable(req.user!.id);
    res.json({ on: false });
  } catch (err) { next(err); }
});

publicCalendarRouter.get('/:userId/:file', async (req, res, next) => {
  try {
    const m = /^([A-Za-z0-9_-]{32})\.ics$/.exec(String(req.params.file));
    const ics = m ? await calendarFeedService.feed(String(req.params.userId), m[1]!) : null;
    if (!ics) { res.status(404).type('text/plain').send('Not found'); return; }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline; filename="difai-hearings.ics"');
    res.send(ics);
  } catch (err) { next(err); }
});
