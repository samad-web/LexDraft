import { describe, expect, it } from 'vitest';
import { BRIEF_PACKS, PLANS } from '../plans';

// Owner 2026-11-24: Brief Packs earn 42-45% at full use, on the same basis as the
// plans' 30% floor (build-docs/features/pricing-v5.md "Margin check"):
// AI ₹2.5 a credit (measured ₹1.6 + 50% for redrafts) and the Razorpay fee
// (2.36% + 18% GST on it). Packs carry no server cost; the plan pays the seats.
const AI_PER_CREDIT = 2.5;
const FEE = 0.0236 * 1.18;
const margin = (p: { credits: number; priceInr: number }) =>
  (p.priceInr - p.priceInr * FEE - p.credits * AI_PER_CREDIT) / p.priceInr;

describe('Brief Pack margins', () => {
  it.each(Object.entries(BRIEF_PACKS))('%s earns 42-45% at full use', (_id, p) => {
    expect(margin(p)).toBeGreaterThanOrEqual(0.42);
    expect(margin(p)).toBeLessThanOrEqual(0.45);
  });

  it('no pack sells a credit for less than any plan does', () => {
    const cheapestPlanRate = Math.min(...Object.values(PLANS).map((p) => p.monthlyInr / p.credits));
    for (const p of Object.values(BRIEF_PACKS)) expect(p.priceInr / p.credits).toBeGreaterThanOrEqual(cheapestPlanRate);
  });

  it('bigger packs never cost more per credit', () => {
    const rates = Object.values(BRIEF_PACKS).sort((a, b) => a.credits - b.credits).map((p) => p.priceInr / p.credits);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]!);
  });
});
