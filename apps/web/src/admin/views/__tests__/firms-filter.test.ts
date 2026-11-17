/** admin-firm-360 AC2: firms list filters (plan name, ending in 7 days, unpaid, custom). */
import { describe, expect, it } from 'vitest';
import type { FirmSummary } from '@lexdraft/types';
import { matchesFilter } from '../FirmsView';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const firm = ({ renewsAt, planStatus, ...o }: Partial<FirmSummary> & { renewsAt?: string | null; planStatus?: 'active' | 'trial' }): FirmSummary => ({
  id: 'f', name: 'F', seats: 1, seatsUsed: 1, caseCount: 0, status: 'active', aiPaused: false, creditsLeft: 0,
  planName: 'Advocate', createdAt: '2026-01-01T00:00:00Z',
  plan: { tier: 'Solo', status: planStatus ?? 'active', mrrInr: 699, renewsAt: renewsAt ?? '2026-12-30', creditAllowance: null },
  ...o,
} as FirmSummary);

describe('firms list filters', () => {
  it('ending: active paid plan ending within 7 days only', () => {
    expect(matchesFilter(firm({ renewsAt: '2026-11-20' }), 'ending', NOW)).toBe(true);
    expect(matchesFilter(firm({ renewsAt: '2026-12-20' }), 'ending', NOW)).toBe(false);
    expect(matchesFilter(firm({ renewsAt: '2026-11-20', planName: 'Free launch' }), 'ending', NOW)).toBe(false);
  });
  it('unpaid: picked a plan, still on trial, not free launch', () => {
    expect(matchesFilter(firm({ planStatus: 'trial' }), 'unpaid', NOW)).toBe(true);
    expect(matchesFilter(firm({ planStatus: 'trial', planName: 'Free launch' }), 'unpaid', NOW)).toBe(false);
    expect(matchesFilter(firm({}), 'unpaid', NOW)).toBe(false);
  });
  it('plan name and custom', () => {
    expect(matchesFilter(firm({ planName: 'Chambers' }), 'Chambers', NOW)).toBe(true);
    expect(matchesFilter(firm({ planName: 'Acme (custom)' }), 'custom', NOW)).toBe(true);
    expect(matchesFilter(firm({ planName: 'Enterprise' }), 'custom', NOW)).toBe(true);
    expect(matchesFilter(firm({ planName: 'Advocate' }), 'custom', NOW)).toBe(false);
    expect(matchesFilter(firm({}), 'all', NOW)).toBe(true);
  });
});
