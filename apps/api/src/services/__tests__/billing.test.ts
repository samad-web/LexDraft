import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

// Razorpay webhook signing: hex HMAC-SHA256 of the raw body with the webhook secret.
const SECRET = crypto.randomBytes(24).toString('hex');
const sign = (body: string, secret = SECRET) => crypto.createHmac('sha256', secret).update(body).digest('hex');

let billing: typeof import('../billing.service');

beforeAll(async () => {
  process.env['RAZORPAY_WEBHOOK_SECRET'] = SECRET;
  billing = await import('../billing.service');
});

describe('billing webhook signature (AC2)', () => {
  const body = JSON.stringify({ event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_1' } } } });

  it('accepts a correctly signed delivery and returns its event id', () => {
    const id = billing.billingService.verifyWebhook(Buffer.from(body), {
      'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_1',
    });
    expect(id).toBe('evt_1');
  });

  it('rejects a tampered body', () => {
    expect(() => billing.billingService.verifyWebhook(Buffer.from(body.replace('sub_1', 'sub_2')), {
      'x-razorpay-signature': sign(body), 'x-razorpay-event-id': 'evt_2',
    })).toThrow(/signature/i);
  });

  it('rejects a wrong secret', () => {
    expect(() => billing.billingService.verifyWebhook(Buffer.from(body), {
      'x-razorpay-signature': sign(body, 'other-secret'), 'x-razorpay-event-id': 'evt_3',
    })).toThrow(/signature/i);
  });

  it('rejects missing headers', () => {
    expect(() => billing.billingService.verifyWebhook(Buffer.from(body), {})).toThrow();
    expect(() => billing.billingService.verifyWebhook(Buffer.from(body), { 'x-razorpay-signature': sign(body) })).toThrow();
  });
});

describe('billing plans', () => {
  it('offers the v4 plans and nothing is purchasable without Razorpay keys', () => {
    const plans = billing.billingPlans();
    expect(plans.map((p) => p.id)).toEqual(['sanad', 'vakalat', 'brief', 'associates', 'partners']);
    expect(plans.every((p) => !p.purchasable)).toBe(true);
  });
});
