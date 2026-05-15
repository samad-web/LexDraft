import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  applyPeriod,
  calculate,
  daysBetween,
  FILING_TYPES,
  getFilingType,
} from '../limitations.calculator';

describe('date helpers', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-01-30', 5)).toBe('2026-02-04');
  });

  it('adds months with last-day-of-month anchor adjustment', () => {
    // Jan 31 + 1 month must land on Feb 28/29, not Mar 3.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
  });

  it('adds months that wrap year', () => {
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('adds years with Feb 29 anchor adjustment', () => {
    // 2024 is a leap year; +1 year from Feb 29 must land on Feb 28 (2025).
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    // +4 years lands on the next leap year.
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });

  it('applies a period spec uniformly', () => {
    expect(applyPeriod('2026-01-01', { unit: 'days',   count: 30  })).toBe('2026-01-31');
    expect(applyPeriod('2026-01-01', { unit: 'months', count: 3   })).toBe('2026-04-01');
    expect(applyPeriod('2026-01-01', { unit: 'years',  count: 12  })).toBe('2038-01-01');
  });

  it('daysBetween returns positive for future, negative for past', () => {
    const now = new Date(2026, 4, 8);
    expect(daysBetween('2026-05-15', now)).toBe(7);
    expect(daysBetween('2026-04-08', now)).toBe(-30);
  });
});

describe('catalog integrity', () => {
  it('every filing type id is unique', () => {
    const ids = FILING_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getFilingType returns the right entry', () => {
    expect(getFilingType('art-65-possession')?.period).toEqual({ unit: 'years', count: 12 });
    expect(getFilingType('does-not-exist')).toBeUndefined();
  });
});

describe('calculate - simple articles', () => {
  it('Art. 65 (12-year possession)', () => {
    const result = calculate({
      filingTypeId: 'art-65-possession',
      triggerDate: '2010-06-01',
      now: new Date(2026, 4, 8),
    });
    expect(result.deadline).toBe('2022-06-01');
    expect(result.daysRemaining).toBeLessThan(0);
    expect(result.warnings.some((w) => /already passed/i.test(w))).toBe(true);
    expect(result.steps).toEqual([]);
  });

  it('Art. 137 (3-year residual)', () => {
    const result = calculate({
      filingTypeId: 'art-137-residual',
      triggerDate: '2024-05-08',
      now: new Date(2026, 4, 8),
    });
    expect(result.deadline).toBe('2027-05-08');
    expect(result.daysRemaining).toBeGreaterThan(360);
  });

  it('A&C §34 (3 months)', () => {
    const result = calculate({
      filingTypeId: 'arb-s34',
      triggerDate: '2026-04-01',
      now: new Date(2026, 4, 8),
    });
    expect(result.deadline).toBe('2026-07-01');
  });

  it('flags weekend deadlines', () => {
    // Pick a trigger such that +90 days lands on a weekend.
    // 2026-02-01 + 90 days = 2026-05-02 (Saturday).
    const result = calculate({
      filingTypeId: 'art-116-civil-appeal-hc',
      triggerDate: '2026-02-01',
      now: new Date(2026, 0, 1),
    });
    expect(result.deadline).toBe('2026-05-02');
    expect(result.warnings.some((w) => /weekend/i.test(w))).toBe(true);
  });

  it('rejects unknown filing types', () => {
    expect(() => calculate({ filingTypeId: 'nope', triggerDate: '2026-01-01' }))
      .toThrowError(/Unknown filing type/);
  });

  it('rejects malformed dates', () => {
    expect(() => calculate({ filingTypeId: 'art-137-residual', triggerDate: '01/01/2026' }))
      .toThrow();
  });
});

describe('calculate - NI Act §138 ladder', () => {
  it('produces three milestones at +30, +45, +75 days', () => {
    const result = calculate({
      filingTypeId: 'ni138-dishonor',
      triggerDate: '2026-01-01',
      now: new Date(2026, 0, 1),
    });
    expect(result.steps.length).toBe(3);
    expect(result.steps[0]).toMatchObject({
      daysFromTrigger: 30,
      date: '2026-01-31',
    });
    expect(result.steps[1]).toMatchObject({
      daysFromTrigger: 45,
      date: '2026-02-15',
    });
    expect(result.steps[2]).toMatchObject({
      daysFromTrigger: 75,
      date: '2026-03-17',
    });
    expect(result.deadline).toBe('2026-03-17');
  });

  it('warns about service-date assumption', () => {
    const result = calculate({
      filingTypeId: 'ni138-dishonor',
      triggerDate: '2026-01-01',
      now: new Date(2026, 0, 1),
    });
    expect(result.warnings.some((w) => /service/i.test(w))).toBe(true);
  });

  it('flags expired complaint deadline', () => {
    const result = calculate({
      filingTypeId: 'ni138-dishonor',
      triggerDate: '2024-01-01',
      now: new Date(2026, 4, 8),
    });
    expect(result.daysRemaining).toBeLessThan(0);
    expect(result.warnings.some((w) => /condonation/i.test(w))).toBe(true);
  });
});
