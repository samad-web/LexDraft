import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { limitationsService, daysBetween } from '../limitations.service';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('daysBetween', () => {
  beforeEach(() => {
    // Pin "now" to a fixed local-midnight so rounding edges don't flake
    // across DST boundaries / CI time zones.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 8, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 for today', () => {
    expect(daysBetween('2026-05-08')).toBe(0);
  });

  it('returns positive for future dates', () => {
    expect(daysBetween('2026-05-15')).toBe(7);
  });

  it('returns negative for past dates', () => {
    expect(daysBetween('2026-05-01')).toBe(-7);
  });

  it('handles year boundaries', () => {
    expect(daysBetween('2027-05-08')).toBe(365);
  });
});

describe('limitationsService', () => {
  it('returns empty list when firmId is null (cross-tenant safety)', async () => {
    const items = await limitationsService.list(null);
    expect(items).toEqual([]);
  });

  it('refuses to create without a firm attachment', async () => {
    await expect(
      limitationsService.create(
        {
          caseLabel: 'X v Y',
          cnr: 'CNR-1',
          filingType: 'Appeal',
          forum: 'HC',
          deadline: isoDaysFromNow(30),
          filedBy: 'AB',
        },
        null,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});
