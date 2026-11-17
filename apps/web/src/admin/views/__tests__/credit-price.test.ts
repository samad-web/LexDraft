/** Admin credits: amount calculated from credits × price per credit (+18% GST). */
import { describe, expect, it } from 'vitest';
import { creditPrice } from '../FirmCreditsCard';

describe('creditPrice', () => {
  it('3000 credits at ₹12.88 = ₹38,640 + ₹6,955.20 GST = ₹45,595.20', () => {
    expect(creditPrice(3000, 12.88)).toEqual({ amount: 38640, gst: 6955.2, total: 45595.2 });
  });
  it('rounds the ex-GST amount to whole rupees (the invoice needs it)', () => {
    expect(creditPrice(25, 17.16).amount).toBe(429);
    expect(creditPrice(0.5, 12.88)).toEqual({ amount: 6, gst: 1.08, total: 7.08 });
  });
  it('nothing to charge for empty, zero or bad input', () => {
    expect(creditPrice(0, 12.88).amount).toBe(0);
    expect(creditPrice(100, 0).amount).toBe(0);
    expect(creditPrice(Number.NaN, 12.88).amount).toBe(0);
  });
});
