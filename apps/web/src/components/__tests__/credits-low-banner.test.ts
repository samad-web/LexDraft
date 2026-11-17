/** credits-not-pages.md AC5/AC6 (web): when the low / over warning shows. */
import { describe, expect, it } from 'vitest';
import type { CreditBalance } from '@lexdraft/types';
import { creditsWarning } from '../CreditsLowBanner';

const b = (o: Partial<CreditBalance>): CreditBalance => ({ balance: 100, allowance: 150, usedThisCycle: 50, topup: 0, resetsAt: null, unlimited: false, ...o } as CreditBalance);

describe('creditsWarning', () => {
  it('nothing above 20% of the month', () => expect(creditsWarning(b({ balance: 31 }))).toBeNull());
  it('low at <= 20%, never says "page"', () => {
    const w = creditsWarning(b({ balance: 30 }))!;
    expect(w.level).toBe('20');
    expect(w.text).toBe('AI credits running low: 30 left this month.');
    expect(w.text).not.toMatch(/page/i);
  });
  it('over at 0', () => expect(creditsWarning(b({ balance: 0 }))).toEqual({ level: '0', text: 'Your AI credits are over.' }));
  it('no plan yet / demo: no banner', () => {
    expect(creditsWarning(b({ balance: 0, allowance: 0, topup: 0 }))).toBeNull();
    expect(creditsWarning(b({ unlimited: true, balance: 0 }))).toBeNull();
  });
});
