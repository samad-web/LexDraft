/** Suggested hand-sale price per credit = best Brief Pack rate (never undercuts a pack). */
import { describe, expect, it } from 'vitest';
import { ADMIN_CREDIT_PRICE_INR, BRIEF_PACKS } from '../plans';

describe('ADMIN_CREDIT_PRICE_INR', () => {
  it('is the largest pack rate, ₹4,249 / 330 = ₹12.88', () => {
    expect(ADMIN_CREDIT_PRICE_INR).toBe(12.88);
    for (const p of Object.values(BRIEF_PACKS)) expect(ADMIN_CREDIT_PRICE_INR).toBeLessThanOrEqual(Math.round((p.priceInr / p.credits) * 100) / 100);
  });
});
