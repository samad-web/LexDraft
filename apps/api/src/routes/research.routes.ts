import { Router, type Response } from 'express';
import { z } from 'zod';
import { researchService } from '../services/research.service';
import { requireFeature } from '../services/permissions.service';
import { firmIdForUser } from '../services/tenant';
import { AiQuotaExceededError, type QuotaStatus } from '../services/ai-quota.service';

const Ask = z.object({ q: z.string().min(2) });

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

export const researchRouter: Router = Router();

researchRouter.get('/', requireFeature('research.basic'), async (req, res, next) => {
  try {
    const { q } = Ask.parse(req.query);
    const userId = req.user?.id;
    const ctx = userId ? { firmId: await firmIdForUser(userId), userId } : null;
    res.json(await researchService.ask(q, ctx));
  } catch (err) {
    if (err instanceof AiQuotaExceededError) {
      respondQuotaExceeded(res, err.status);
      return;
    }
    next(err);
  }
});
