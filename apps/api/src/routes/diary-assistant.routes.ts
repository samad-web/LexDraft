import { Router, type Response } from 'express';
import { z } from 'zod';
import { diaryAssistantService } from '../services/diary-assistant.service';
import { firmIdForUser } from '../services/tenant';
import { requireFeature } from '../services/permissions.service';
import { validate, uuidParam } from '../middleware/validate';
import { llmGenerationLimiter } from '../middleware/rateLimit';
import { AiQuotaExceededError, type QuotaStatus } from '../services/ai-quota.service';

const ParseInput = z.object({ text: z.string().min(1).max(2000) });
const BriefingQuery = z.object({ range: z.enum(['today', 'week']).default('today') });

/** Mirror drafting.routes' quota response so the web client's axios
 *  interceptor (429 + code 'ai_quota_exceeded') shows the same upgrade modal. */
function respondQuotaExceeded(res: Response, status: QuotaStatus): Response {
  const resetMs = Math.max(0, new Date(status.cycleEnd).getTime() - Date.now());
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil(resetMs / 1000))));
  return res.status(429).json({
    error: 'AI generation quota exceeded',
    code: 'ai_quota_exceeded',
    cap: status.cap,
    used: status.used,
    remaining: 0,
    resetsAt: status.cycleEnd,
    planTier: status.planTier,
    upgrade: status.planTier !== 'Firm',
  });
}

export const diaryAssistantRouter: Router = Router();

// Diary is matter-adjacent; gate the assistant on the same feature the diary
// uses. AI cost is bounded by ai-quota inside the service.
diaryAssistantRouter.post('/parse', requireFeature('matter.view'), llmGenerationLimiter, async (req, res, next) => {
  try {
    const userId = req.user?.id ?? '';
    const firmId = await firmIdForUser(userId);
    const { text } = ParseInput.parse(req.body);
    res.json(await diaryAssistantService.parseCommand(text, { firmId, userId }));
  } catch (err) {
    next(err);
  }
});

diaryAssistantRouter.get('/briefing', requireFeature('matter.view'), validate({ query: BriefingQuery }), async (req, res, next) => {
  try {
    const userId = req.user?.id ?? '';
    const firmId = await firmIdForUser(userId);
    const range = (req.query.range as 'today' | 'week') ?? 'today';
    res.json(await diaryAssistantService.briefing(firmId, range, userId));
  } catch (err) {
    next(err);
  }
});

diaryAssistantRouter.post(
  '/judgment/:id/analyze',
  requireFeature('matter.view'),
  llmGenerationLimiter,
  validate({ params: uuidParam }),
  async (req, res, next) => {
    try {
      const userId = req.user?.id ?? '';
      const firmId = await firmIdForUser(userId);
      const forceRaw = String(req.query.force ?? '');
      const force = forceRaw === '1' || forceRaw === 'true';
      res.json(await diaryAssistantService.analyzeJudgment(String(req.params.id), { firmId, userId, force }));
    } catch (err) {
      if (err instanceof AiQuotaExceededError) {
        respondQuotaExceeded(res, err.status);
        return;
      }
      next(err);
    }
  },
);
