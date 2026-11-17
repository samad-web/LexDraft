/** Unit tests for admin-ai-spend-guard.md (AC2 provider figure, pause backstop). */
import { describe, expect, it } from 'vitest';
import { anthropicCostUsd, monthStartUtc } from '../ai-spend.service';
import { platformPausedCached, setPlatformPausedCache } from '../../lib/ai-pause';

describe('AC2 Anthropic cost response', () => {
  it('amounts are cents as 6-decimal strings: "41280.000000" = $412.80', () => {
    expect(anthropicCostUsd({ data: [{ cost: { amount: '41280.000000' } }] })).toBeCloseTo(412.8, 6);
  });
  it('sums rows exactly and skips malformed amounts', () => {
    expect(anthropicCostUsd({ data: [
      { cost: { amount: '0.100000' } }, { cost: { amount: '0.200000' } }, { cost: { amount: 'abc' } }, {},
    ] })).toBeCloseTo(0.003, 9);
  });
  it('empty data = 0', () => {
    expect(anthropicCostUsd({})).toBe(0);
    expect(anthropicCostUsd({ data: [] })).toBe(0);
  });
});

describe('month start', () => {
  it('is the first of the UTC month', () => {
    expect(monthStartUtc(new Date('2026-11-17T20:30:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(monthStartUtc(new Date('2026-12-01T00:00:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('AC4 pause backstop for provider clients', () => {
  it('reflects the switch at once in this process', () => {
    setPlatformPausedCache(true);
    expect(platformPausedCached()).toBe(true);
    setPlatformPausedCache(false);
    expect(platformPausedCached()).toBe(false);
  });
});
