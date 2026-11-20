/** Pure parts of the daily brief (build-docs/features/daily-brief.md). */
import { describe, expect, it } from 'vitest';
import { addDays, composeEvening, composeMorning, inMorningWindow, istDay, type BriefHearing, type UserBrief } from '../daily-brief.service';

const h = (label: string, time: string | null = null, court: string | null = null): BriefHearing => ({ key: label, label, time, court });
const brief = (p: Partial<UserBrief> = {}): UserBrief => ({ today: [], tomorrow: [], next: null, tasksDue: 0, tasksOverdue: 0, remindersToday: 0, ...p });

describe('AC1 morning brief lists today', () => {
  it('names hearings today with times and counts tomorrow and work', () => {
    expect(composeMorning(brief({ today: [h('Ravi v. State', '10:30'), h('Kumar v. Union')], tomorrow: [h('A v. B')], tasksDue: 2, tasksOverdue: 1, remindersToday: 1 })))
      .toEqual({ title: 'Today: 2 hearings', body: 'Ravi v. State (10:30) · Kumar v. Union. Tomorrow: 1 hearing. 2 tasks due today, 1 overdue, 1 reminder today.' });
  });
  it('caps the list at three names', () => {
    const t = composeMorning(brief({ today: ['A', 'B', 'C', 'D', 'E'].map((x) => h(x)) }));
    expect(t?.body).toBe('A · B · C · +2 more.');
  });
});

describe('AC2 quiet day', () => {
  it('says no hearings today and names the next one', () => {
    expect(composeMorning(brief({ next: { label: 'Ravi v. State', day: '2026-11-26' } })))
      .toEqual({ title: 'No hearings today', body: 'Next: Ravi v. State on Thu, 26 Nov.' });
  });
  it('prefers tomorrow over a later next hearing', () => {
    expect(composeMorning(brief({ tomorrow: [h('A v. B')], next: { label: 'A v. B', day: '2026-11-21' } }))?.body).toBe('Tomorrow: A v. B.');
  });
  it('sends nothing when there is nothing at all', () => {
    expect(composeMorning(brief())).toBeNull();
  });
  it('still sends for tasks alone', () => {
    expect(composeMorning(brief({ tasksOverdue: 3 }))).toEqual({ title: 'No hearings today', body: '3 overdue.' });
  });
});

describe('AC3 evening brief', () => {
  it('lists tomorrow with time and court; none when tomorrow is empty', () => {
    expect(composeEvening(brief({ tomorrow: [h('Ravi v. State', '10:30', 'Madras HC'), h('Meena v. Rajesh')] })))
      .toEqual({ title: 'Tomorrow: 2 hearings', body: 'Ravi v. State (10:30, Madras HC) · Meena v. Rajesh.' });
    expect(composeEvening(brief({ today: [h('X')] }))).toBeNull();
  });
});

describe('IST dates and the watchdog window', () => {
  it('uses the Indian date, not UTC', () => {
    expect(istDay(new Date('2026-11-20T19:00:00Z'))).toBe('2026-11-21'); // 00:30 IST
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('re-runs the morning brief only between 07:00 and 08:59 IST', () => {
    expect(inMorningWindow(new Date('2026-11-20T01:30:00Z'))).toBe(true); // 07:00 IST
    expect(inMorningWindow(new Date('2026-11-20T03:29:00Z'))).toBe(true); // 08:59 IST
    expect(inMorningWindow(new Date('2026-11-20T03:30:00Z'))).toBe(false); // 09:00 IST
    expect(inMorningWindow(new Date('2026-11-20T01:29:00Z'))).toBe(false); // 06:59 IST
  });
});
