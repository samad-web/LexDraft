/** Owner 2026-11-17: analytics stays on every plan, named after the plan. */
import { describe, expect, it } from 'vitest';
import { analyticsLabel, visibleNavGroups } from '../nav-config';

const tabLabel = (plan?: 'Solo' | 'Practice' | 'Firm') =>
  visibleNavGroups(['analytics.firm', 'practice.analytics', 'firm.dashboard.view', 'firm.members.view'], plan)
    .flatMap((g) => g.items).flatMap((i) => i.tabs ?? []).find((t) => t.to === '/app/analytics')?.label;

describe('analytics page name by plan', () => {
  it('Advocate (Solo) never reads "Firm"', () => {
    expect(analyticsLabel('Solo')).toBe('My Practice Analytics');
    expect(tabLabel('Solo')).toBe('My Practice Analytics');
  });
  it('Chambers (Practice) and Firm', () => {
    expect(tabLabel('Practice')).toBe('Chambers Analytics');
    expect(tabLabel('Firm')).toBe('Firm Analytics');
  });
  it('unknown plan falls back to Firm Analytics', () => expect(analyticsLabel(undefined)).toBe('Firm Analytics'));
});
