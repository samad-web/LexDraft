import { describe, expect, it } from 'vitest';
import { checkRemindAt, diaryReminderDay } from '../reminders.service';
import { assertionClaims, isDeadToken } from '../../lib/fcm';

// build-docs/features/reminders.md + android-push.md acceptance criteria.

const NOW = Date.parse('2026-11-20T10:00:00Z');

describe('reminders: when a reminder may be set', () => {
  it('accepts a future time', () => {
    expect(checkRemindAt('2026-11-24T13:30:00.000Z', NOW).toISOString()).toBe('2026-11-24T13:30:00.000Z');
  });

  it('accepts "now" from a slow phone (one-minute grace)', () => {
    expect(() => checkRemindAt('2026-11-20T09:59:30Z', NOW)).not.toThrow();
  });

  it('refuses a time already passed', () => {
    expect(() => checkRemindAt('2026-11-20T09:00:00Z', NOW)).toThrow(/already passed/);
  });

  it('refuses more than two years ahead', () => {
    expect(() => checkRemindAt('2029-01-01T00:00:00Z', NOW)).toThrow(/two years/);
  });

  it('refuses something that is not a date', () => {
    expect(() => checkRemindAt('next tuesday', NOW)).toThrow(/valid date/);
  });
});

describe('reminders: Court Diary "remind N days before"', () => {
  it('is due N days before the next date', () => {
    expect(diaryReminderDay('2026-12-02', 3)).toBe('2026-11-29');
  });

  it('crosses month and year ends', () => {
    expect(diaryReminderDay('2027-01-01', 1)).toBe('2026-12-31');
  });

  it('0 days means the day itself', () => {
    expect(diaryReminderDay('2026-12-02', 0)).toBe('2026-12-02');
  });
});

describe('android push: FCM', () => {
  it('asks Google for a one-hour messaging token', () => {
    const c = assertionClaims('svc@difai.iam.gserviceaccount.com', 1000);
    expect(c).toEqual({
      iss: 'svc@difai.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    });
  });

  it('removes a token FCM says is gone', () => {
    expect(isDeadToken(404, '{"error":{"status":"NOT_FOUND"}}')).toBe(true);
    expect(isDeadToken(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(true);
    expect(isDeadToken(400, '{"error":{"status":"INVALID_ARGUMENT","message":"The registration token is not a valid FCM registration token"}}')).toBe(true);
  });

  it('keeps a token on a passing failure (quota, server error)', () => {
    expect(isDeadToken(429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}')).toBe(false);
    expect(isDeadToken(503, 'unavailable')).toBe(false);
  });
});
