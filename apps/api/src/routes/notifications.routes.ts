import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { notificationsStore } from '../services/notifications.service';
import { pushService } from '../services/push.service';
import { dailyBrief } from '../services/daily-brief.service';

// =============================================================================
// /api/notifications — the current user's in-app notification feed.
//
// User-scoped (not firm-scoped): every row is addressed to a specific
// `user_id`, and each handler reads `req.user.id`, so a caller can only ever
// see or mutate their own notifications. Mounted behind requireAuth in
// routes/index.ts (no requireActivePlan — a lapsed-plan user should still be
// able to clear their bell).
// =============================================================================

export const notificationsRouter: Router = Router();

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// GET /notifications — newest-first feed + unread count.
notificationsRouter.get('/', validate({ query: ListQuery }), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { limit } = req.query as { limit?: number };
    const [items, unreadCount] = await Promise.all([
      notificationsStore.listForUser(userId, limit ?? 50),
      notificationsStore.unreadCount(userId),
    ]);
    res.json({ items, unreadCount });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/:id/read — mark one read (idempotent).
const IdParam = z.object({ id: z.string().uuid() });
notificationsRouter.post('/:id/read', validate({ params: IdParam }), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params as unknown as { id: string };
    const ok = await notificationsStore.markRead(userId, id);
    if (!ok) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /notifications/read-all — mark every unread notification read.
notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const count = await notificationsStore.markAllRead(userId);
    res.json({ ok: true, marked: count });
  } catch (err) {
    next(err);
  }
});

// ---- web push (build-docs/features/web-push.md) ----------------------------
// The browser needs the server's public VAPID key to subscribe; then it saves
// its subscription here. Own devices only (user-scoped like the feed).
notificationsRouter.get('/push/key', (_req, res) => {
  res.json({ publicKey: pushService.publicKey() });
});

const PushSub = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

notificationsRouter.post('/push/subscription', validate({ body: PushSub }), async (req, res, next) => {
  try {
    if (!pushService.publicKey()) { res.status(503).json({ error: 'push_off' }); return; }
    await pushService.subscribe(req.user!.id, req.body, req.get('user-agent'));
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Android app (FCM) token, sent after sign-in (android-push.md).
const NativeToken = z.object({ token: z.string().min(20).max(4096).regex(/^[\w:.\-]+$/) });
notificationsRouter.post('/push/native', validate({ body: NativeToken }), async (req, res, next) => {
  try {
    await pushService.subscribeNative(req.user!.id, req.body.token, req.get('user-agent'));
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Daily brief on/off for this user (daily-brief.md).
notificationsRouter.get('/brief', async (req, res, next) => {
  try {
    res.json({ on: await dailyBrief.isOn(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.put('/brief', validate({ body: z.object({ on: z.boolean() }) }), async (req, res, next) => {
  try {
    await dailyBrief.setOn(req.user!.id, req.body.on);
    res.json({ on: req.body.on });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/push/unsubscribe', validate({ body: PushSub.pick({ endpoint: true }) }), async (req, res, next) => {
  try {
    await pushService.unsubscribe(req.user!.id, req.body.endpoint);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
