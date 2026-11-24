/** Suggested hand-sale price per credit = best Brief Pack rate (never undercuts a pack). */
import { describe, expect, it } from 'vitest';
import { ADMIN_CREDIT_PRICE_INR, BRIEF_PACKS } from '../plans';

describe('ADMIN_CREDIT_PRICE_INR', () => {
  it('is the best pack rate, ₹1,549 / 330 = ₹4.69', () => {
    expect(ADMIN_CREDIT_PRICE_INR).toBe(4.69);
    for (const p of Object.values(BRIEF_PACKS)) expect(ADMIN_CREDIT_PRICE_INR).toBeLessThanOrEqual(Math.round((p.priceInr / p.credits) * 100) / 100);
  });
});
