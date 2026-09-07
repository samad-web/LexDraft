import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';
import { notificationsStore } from '../services/notifications.service';

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
