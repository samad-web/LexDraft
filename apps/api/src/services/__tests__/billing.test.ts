import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

// Standard Webhooks signing, as Dodo Payments does it.
const SECRET_BYTES = crypto.randomBytes(24);
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

function sign(id: string, ts: string, body: string, key = SECRET_BYTES): string {
  return `v1,${crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

let billing: typeof import('../billing.service');

beforeAll(async () => {
  process.env['DODO_PAYMENTS_WEBHOOK_SECRET'] = SECRET;
  billing = await import('../billing.service');
});

describe('billing webhook signature', () => {
  const body = JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_1' } });
  const now = () => String(Math.floor(Date.now() / 1000));

  it('accepts a correctly signed delivery and returns its id', () => {
    const ts = now();
    const id = billing.billingService.verifyWebhook(Buffer.from(body), {
      'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': sign('msg_1', ts, body),
    });
    expect(id).toBe('msg_1');
  });

  it('accepts when any of several signatures matches', () => {
    const ts = now();
    const header = `v1,${Buffer.alloc(32).toString('base64')} ${sign('msg_2', ts, body)}`;
    expect(billing.billingService.verifyWebhook(Buffer.from(body), {
      'webhook-id': 'msg_2', 'webhook-timestamp': ts, 'webhook-signature': header,
    })).toBe('msg_2');
  });

  it('rejects a tampered body', () => {
    const ts = now();
    expect(() => billing.billingService.verifyWebhook(Buffer.from(body.replace('sub_1', 'sub_2')), {
      'webhook-id': 'msg_3', 'webhook-timestamp': ts, 'webhook-signature': sign('msg_3', ts, body),
    })).toThrow(/signature/i);
  });

  it('rejects a wrong secret', () => {
    const ts = now();
    expect(() => billing.billingService.verifyWebhook(Buffer.from(body), {
      'webhook-id': 'msg_4', 'webhook-timestamp': ts, 'webhook-signature': sign('msg_4', ts, body, crypto.randomBytes(24)),
    })).toThrow(/signature/i);
  });

  it('rejects an old timestamp (replay)', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    expect(() => billing.billingService.verifyWebhook(Buffer.from(body), {
      'webhook-id': 'msg_5', 'webhook-timestamp': ts, 'webhook-signature': sign('msg_5', ts, body),
    })).toThrow(/timestamp/i);
  });

  it('rejects missing headers', () => {
    expect(() => billing.billingService.verifyWebhook(Buffer.from(body), {})).toThrow();
  });
});

describe('billing plans', () => {
  it('offers the four launch plans and nothing is purchasable without Dodo keys', () => {
    const plans = billing.billingPlans();
    expect(plans.map((p) => p.id)).toEqual(['free', 'solo', 'practice', 'firm']);
    expect(plans.find((p) => p.id === 'solo')?.monthlyInr).toBe(1499);
    expect(plans.find((p) => p.id === 'practice')?.annualMonthlyInr).toBe(3999);
    expect(plans.every((p) => !p.purchasable)).toBe(true);
  });
});
