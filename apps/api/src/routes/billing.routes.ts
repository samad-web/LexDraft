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
  /** Chamber only: advocates to pay for. */
  seats: z.number().int().min(2).max(8).optional(),
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
    res.json(await billingService.startCheckout(req.user!.id, body.plan, body.cycle, body.seats));
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
    res.json(await billingService.startCheckout(userId, body.plan, body.cycle, body.seats));
  } catch (err) {
    next(err);
  }
});

// The page that opens Razorpay Checkout for a subscription. Public: the link is
// what checkout hands back, signed in or not (renew from the sign-in page).
billingRouter.get('/pay/:subscriptionId', (req, res) => {
  const html = billingService.payPage(req.params.subscriptionId);
  if (!html) { res.status(404).type('text/plain').send('Payment link not found.'); return; }
  res
    .set('Cache-Control', 'no-store')
    // Razorpay's checkout opens popups (bank pages, UPI apps) that must reach back.
    .set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
    .set('Content-Security-Policy',
      "default-src 'none'; script-src 'unsafe-inline' https://checkout.razorpay.com; style-src 'unsafe-inline'; " +
      "frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src https://*.razorpay.com; " +
      "img-src https: data:; form-action https://*.razorpay.com 'self'")
    .type('html').send(html);
});

// Razorpay Checkout posts here after paying (callback_url, form-encoded). Public.
billingRouter.post('/callback', (req, res) => {
  res.redirect(303, billingService.checkoutReturn((req.body ?? {}) as Record<string, unknown>));
});

// Razorpay webhook (X-Razorpay-Signature over the raw body). Public.
billingRouter.post('/webhook', async (req, res, next) => {
  try {
    const eventId = billingService.verifyWebhook(req.rawBody, req.headers);
    // Handled before answering: a failure returns 500 so Razorpay retries.
    await billingService.handleWebhook(eventId, req.body as Parameters<typeof billingService.handleWebhook>[1]);
    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});
