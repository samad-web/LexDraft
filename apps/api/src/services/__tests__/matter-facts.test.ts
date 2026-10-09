import { describe, expect, it } from 'vitest';
import { parseStrictIsoDate, factDedupeKey } from '../matter-intel.service';

describe('parseStrictIsoDate', () => {
  it('accepts a well-formed ISO-8601 date', () => {
    expect(parseStrictIsoDate('2026-03-18')).toBe('2026-03-18');
  });

  it('rejects null/undefined/empty', () => {
    expect(parseStrictIsoDate(null)).toBeNull();
    expect(parseStrictIsoDate(undefined)).toBeNull();
    expect(parseStrictIsoDate('')).toBeNull();
  });

  it('rejects free-text dates the LLM might emit instead of refusing', () => {
    expect(parseStrictIsoDate('circa 2024')).toBeNull();
    expect(parseStrictIsoDate('last Tuesday')).toBeNull();
    expect(parseStrictIsoDate('March 2026')).toBeNull();
    expect(parseStrictIsoDate('18/03/2026')).toBeNull();
  });

  it('rejects calendar-invalid dates that still match the shape regex', () => {
    // 2026 is not a leap year — Feb 30 doesn't exist and Date rolls it over
    // to March, which the strict round-trip check must catch.
    expect(parseStrictIsoDate('2026-02-30')).toBeNull();
    expect(parseStrictIsoDate('2026-13-01')).toBeNull();
  });

  it('accepts a genuine leap-day date', () => {
    expect(parseStrictIsoDate('2028-02-29')).toBe('2028-02-29');
  });
});

describe('factDedupeKey', () => {
  it('normalizes whitespace and case', () => {
    const a = factDedupeKey('2026-03-18', 'Cheque dishonoured');
    const b = factDedupeKey('2026-03-18', '  cheque   DISHONOURED  ');
    expect(a).toBe(b);
  });

  it('treats a null date as a distinct "undated" bucket', () => {
    const dated = factDedupeKey('2026-03-18', 'Cheque dishonoured');
    const undated = factDedupeKey(null, 'Cheque dishonoured');
    expect(dated).not.toBe(undated);
  });

  it('produces different keys for genuinely different events on the same date', () => {
    const a = factDedupeKey('2026-03-18', 'Cheque dishonoured');
    const b = factDedupeKey('2026-03-18', 'Notice issued');
    expect(a).not.toBe(b);
  });
});
