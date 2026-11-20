import { describe, expect, it } from 'vitest';
import { toRemindAt } from '../useReminders';
import { appPathFromUrl } from '../useNativePush';

describe('reminders: time picked on this device', () => {
  it('becomes the same instant, sent as ISO so the server never guesses the zone', () => {
    const iso = toRemindAt('2026-11-24', '19:00');
    expect(new Date(iso).getTime()).toBe(new Date(2026, 10, 24, 19, 0, 0).getTime());
    expect(iso.endsWith('Z')).toBe(true);
  });
});

describe('android push: tapping a notification', () => {
  it('opens the page it is about', () => {
    expect(appPathFromUrl('/app/cases/5b2f8d1c-0000-4000-8000-000000000001')).toBe('/app/cases/5b2f8d1c-0000-4000-8000-000000000001');
  });

  it('never opens anything outside the app', () => {
    expect(appPathFromUrl('https://evil.example/app/cases')).toBeNull();
    expect(appPathFromUrl('//evil.example/app/x')).toBeNull();
    expect(appPathFromUrl('/app//evil.example')).toBeNull();
    expect(appPathFromUrl(undefined)).toBeNull();
  });
});
