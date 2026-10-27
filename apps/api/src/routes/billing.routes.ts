import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { signInLimiter } from '../middleware/rateLimit';
import { billingService } from '../services/billing.service';
import { verifyRenewToken } from '../services/auth.service';

// Mounted WITHOUT requireActivePlan: a firm whose trial or plan has lapsed
// must still be able to see its plan and pay.
export const billingRouter: Router = Router();

const Checkout = z.object({
  plan: z.enum(['solo', 'practice']),
  cycle: z.enum(['monthly', 'annual']),
}).strict();

billingRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.json(await billingService.state(req.user!.id));
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const body = Checkout.parse(req.body);
    res.json(await billingService.startCheckout(req.user!.id, body.plan, body.cycle));
  } catch (err) {
    next(err);
  }
});

// Signed-out checkout for an owner whose trial / plan has ended: sign-in
// hands back a short-lived renewToken instead of a session.
billingRouter.post('/renew-checkout', signInLimiter, async (req, res, next) => {
  try {
    const body = Checkout.extend({ renewToken: z.string().min(20).max(4096) }).strict().parse(req.body);
    const userId = verifyRenewToken(body.renewToken);
    res.json(await billingService.startCheckout(userId, body.plan, body.cycle));
  } catch (err) {
    next(err);
  }
});

// Dodo Payments webhook (Standard Webhooks signature). Public.
billingRouter.post('/webhook', async (req, res, next) => {
  try {
    const webhookId = billingService.verifyWebhook(req.rawBody, req.headers);
    // Handled before answering: a failure returns 500 so Dodo retries.
    await billingService.handleWebhook(webhookId, req.body as { type?: string; data?: Record<string, unknown> });
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});
