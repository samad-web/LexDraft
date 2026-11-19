import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  applyPeriod,
  calculate,
  closedDayReason,
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
    expect(result.warnings.some((w) => /Saturday|Sunday/.test(w))).toBe(true);
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

describe('calculate - NI Act §138 ladder (build-docs/features/limitation-ladder-fix.md)', () => {
  const ladder = (triggerDate: string, noticeReceivedDate?: string, now = new Date(2025, 0, 1)) =>
    calculate({ filingTypeId: 'ni138-dishonor', triggerDate, noticeReceivedDate, now });

  it('AC1: matches Saketh India (1999) 3 SCC 1 - notice served 29 Sep, 15 days end 14 Oct, file by 15 Nov', () => {
    const r = ladder('1995-09-10', '1995-09-29', new Date(1995, 8, 30));
    expect(r.steps.map((s) => s.date)).toEqual(['1995-10-10', '1995-10-14', '1995-10-15', '1995-11-15']);
    expect(r.deadline).toBe('1995-11-15');
    expect(r.steps.some((s) => /estimate/.test(s.label))).toBe(false);
  });

  it('AC2: without the receipt date the later steps are marked as an estimate from day 30', () => {
    const r = ladder('2026-01-01');
    expect(r.steps.map((s) => s.date)).toEqual(['2026-01-31', '2026-02-15', '2026-02-16', '2026-03-16']);
    expect(r.steps.slice(1).every((s) => /\(estimate\)/.test(s.label))).toBe(true);
    expect(r.warnings.some((w) => /assume the drawer received the notice on 2026-01-31/.test(w))).toBe(true);
  });

  it('AC3: one calendar month, not 30 days - 31 Jan cause of action gives 28 Feb', () => {
    const r = ladder('2026-01-02', '2026-01-15');
    expect(r.steps[2]!.date).toBe('2026-01-31');
    expect(r.deadline).toBe('2026-02-28');
  });

  it('AC4: a missed deadline points to the proviso to s.142(1)(b), never the CrPC', () => {
    const r = ladder('2024-01-01', '2024-01-20', new Date(2026, 4, 8));
    expect(r.daysRemaining).toBeLessThan(0);
    expect(r.warnings.some((w) => /proviso to §142\(1\)\(b\)/.test(w))).toBe(true);
    expect(r.warnings.join(' ')).not.toMatch(/CrPC|473/);
  });

  it('AC5: warns against filing before the cause of action (premature complaint)', () => {
    const r = ladder('2026-01-02', '2026-01-15', new Date(2026, 0, 20));
    expect(r.warnings.some((w) => /Do not file before 2026-01-31/.test(w))).toBe(true);
  });

  it('AC6: a receipt date before the bank memo is refused', () => {
    expect(() => ladder('2026-01-10', '2026-01-05')).toThrow(/before the bank/);
  });

  it('AC7: last day on a national holiday or weekend cites General Clauses Act s.10', () => {
    const holiday = ladder('2026-08-01', '2026-08-17', new Date(2026, 7, 1));
    expect(holiday.deadline).toBe('2026-10-02');
    expect(holiday.warnings.some((w) => /Gandhi Jayanti.*General Clauses Act s\.10/.test(w))).toBe(true);
    expect(closedDayReason('2026-01-26')).toBe('Republic Day');
    expect(closedDayReason('2026-11-22')).toBe('a Sunday');
    expect(closedDayReason('2026-11-23')).toBeNull();
  });

  it('AC8: notes name the cases and say which holidays are not checked', () => {
    const notes = getFilingType('ni138-dishonor')!.notes!.join(' ');
    expect(notes).toMatch(/Saketh India/);
    expect(notes).toMatch(/refused or unclaimed/);
    expect(notes).toMatch(/Check the court calendar/);
  });
});
