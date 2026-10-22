import { describe, expect, it } from 'vitest';
import { latestDueSlot } from '../ecourts-sync-runs.service';

// Times are given in IST (+05:30) to read like the schedule itself.
const ist = (s: string) => new Date(`${s}+05:30`);

describe('latestDueSlot', () => {
  it('after 19:00 IST -> today evening', () => {
    expect(latestDueSlot(ist('2026-10-20T19:05:00'))).toMatchObject({ slot: 'evening', runDate: '2026-10-20' });
    expect(latestDueSlot(ist('2026-10-20T23:59:00'))).toMatchObject({ slot: 'evening', runDate: '2026-10-20' });
  });

  it('between 09:00 and 19:00 IST -> today morning', () => {
    const s = latestDueSlot(ist('2026-10-20T18:40:00'));
    expect(s).toMatchObject({ slot: 'morning', runDate: '2026-10-20' });
    expect(s.dueAt.toISOString()).toBe('2026-10-20T03:30:00.000Z'); // 09:00 IST
  });

  it('before 09:00 IST -> previous day evening, across month ends', () => {
    expect(latestDueSlot(ist('2026-10-21T02:00:00'))).toMatchObject({ slot: 'evening', runDate: '2026-10-20' });
    const s = latestDueSlot(ist('2026-11-01T08:59:00'));
    expect(s).toMatchObject({ slot: 'evening', runDate: '2026-10-31' });
    expect(s.dueAt.toISOString()).toBe('2026-10-31T13:30:00.000Z'); // 19:00 IST
  });

  it('exactly on the hour counts as that slot', () => {
    expect(latestDueSlot(ist('2026-10-20T09:00:00'))).toMatchObject({ slot: 'morning', runDate: '2026-10-20' });
    expect(latestDueSlot(ist('2026-10-20T19:00:00'))).toMatchObject({ slot: 'evening', runDate: '2026-10-20' });
  });
});
