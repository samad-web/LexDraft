import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { permissionsService } from '../services/permissions.service';
import { aiQuotaService } from '../services/ai-quota.service';
import { firmIdForUser } from '../services/tenant';
import { isKnownLanguageCode } from '../lib/languages';
import { validate } from '../middleware/validate';

export const meRouter: Router = Router();

// Current User as the API knows it. Used at app boot to refresh the cached
// auth state - picks up plan changes (e.g. firm promoted to Practice) without
// a sign-out/sign-in cycle.
meRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const user = await authService.getById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// PATCH /me/preferences — update user-level preferences (currently just the
// default language used by AI-facing features). The body is intentionally
// narrow so adding more prefs later doesn't accidentally expose any other
// editable field through the same shape.
const PreferencesBody = z.object({
  defaultLanguageCode: z.string().min(2).max(16).optional(),
});
meRouter.patch('/preferences', validate({ body: PreferencesBody }), async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const body = req.body as z.infer<typeof PreferencesBody>;
    if (body.defaultLanguageCode && !isKnownLanguageCode(body.defaultLanguageCode)) {
      res.status(422).json({ error: `Unknown languageCode: ${body.defaultLanguageCode}` });
      return;
    }
    const user = await authService.updatePreferences(userId, body);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

// Resolved feature set for the current session (spec §9 self-service).
meRouter.get('/features', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json(await permissionsService.resolveFeatures(userId));
  } catch (err) {
    next(err);
  }
});

// `/usage` is now a thin shim over the canonical ai-quota service, so the
// legacy field shape (`{ aiDocuments: { used, limit } }`) keeps working for
// any client still calling it. `/ai-quota` is the richer endpoint that
// includes cycle bounds and reset-at, for the upgrade-prompt UI.
meRouter.get('/usage', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const firmId = await firmIdForUser(userId);
    const status = await aiQuotaService.status(firmId, userId);
    res.json({ aiDocuments: { used: status.used, limit: status.cap } });
  } catch (err) {
    next(err);
  }
});

meRouter.get('/ai-quota', async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const firmId = await firmIdForUser(userId);
    res.json(await aiQuotaService.status(firmId, userId));
  } catch (err) {
    next(err);
  }
});
