// hearings-calendar-feed acceptance criteria 2-5 (DB + hearings mocked; the live
// subscription is checked in the local end-to-end run).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarHearing } from '@lexdraft/types';
import { calendarFeedService, feedToken, hearingsIcs } from '../calendar-feed.service';
import { hearingsService } from '../hearings.service';

let version: number | null = 1;
vi.mock('../../db/client', () => ({
  db: () => Object.assign(async () => [{ v: version }], {}),
}));
vi.mock('../tenant', () => ({ firmIdForUser: async () => 'firm-1' }));
vi.mock('../hearings.service', () => ({ hearingsService: { listRange: vi.fn() } }));

const U = '11111111-2222-3333-4444-555555555555';
const H = (over: Partial<CalendarHearing>): CalendarHearing => ({
  id: 'h1', case: 'Ravi v. State', time: '10:30', court: 'Principal District Court, Madurai',
  purpose: 'Arguments', status: 'upcoming', date: '2026-12-02', ...over,
} as CalendarHearing);

describe('AC2: hearings as a calendar Apple Calendar reads', () => {
  const ics = hearingsIcs([
    H({}),
    H({ id: 'h2', time: '', purpose: 'Order', date: '2026-12-31' }),
    H({ id: 'h3', case: 'Kumar, Raj; and others v. State', purpose: 'வாய்தா', judge: 'Hon. A. Kumar' }),
  ], new Date('2026-11-25T00:00:00Z'));
  const lines = ics.split('\r\n');

  it('is a valid VCALENDAR with CRLF lines and refresh hints', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:DifAi hearings');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });

  it('a 10:30 IST hearing starts 05:00 UTC and lasts an hour', () => {
    expect(ics).toContain('DTSTART:20261202T050000Z');
    expect(ics).toContain('DTEND:20261202T060000Z');
    expect(ics).toContain('LOCATION:Principal District Court\\, Madurai');
  });

  it('a hearing with no time is an all-day event (year end rolls over)', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('escapes commas/semicolons, keeps Tamil, never splits a character when folding', () => {
    expect(ics).toContain('Kumar\\, Raj\\; and others v. State – வாய்தா');
    expect(ics).toContain('Judge: Hon. A. Kumar');
    for (const l of lines) expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
    expect(ics).not.toContain('�');
  });
});

describe('AC3-AC5: the private link', () => {
  beforeEach(() => {
    version = 1;
    vi.clearAllMocks();
    vi.mocked(hearingsService.listRange).mockResolvedValue([H({})]);
  });

  it('the same link for every device; Reset (version + 1) gives a new one', () => {
    expect(feedToken(U, 1, 's'.repeat(32))).toBe(feedToken(U, 1, 's'.repeat(32)));
    expect(feedToken(U, 2, 's'.repeat(32))).not.toBe(feedToken(U, 1, 's'.repeat(32)));
    expect(feedToken(U, 1, 's'.repeat(32))).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('the right link serves 30 days back to a year ahead of the firm\'s hearings', async () => {
    const out = await calendarFeedService.feed(U, feedToken(U, 1), new Date('2026-11-25T00:00:00Z'));
    expect(out).toContain('SUMMARY:Ravi v. State – Arguments');
    expect(hearingsService.listRange).toHaveBeenCalledWith('firm-1', '2026-10-26', '2027-11-25');
  });

  it('a wrong, old (after Reset) or turned-off link gets nothing', async () => {
    expect(await calendarFeedService.feed(U, 'x'.repeat(32))).toBeNull();
    version = 2;
    expect(await calendarFeedService.feed(U, feedToken(U, 1))).toBeNull();
    version = null;
    expect(await calendarFeedService.feed(U, feedToken(U, 1))).toBeNull();
    expect(await calendarFeedService.feed('not-a-uuid', feedToken(U, 1))).toBeNull();
    expect(hearingsService.listRange).not.toHaveBeenCalled();
  });
});
