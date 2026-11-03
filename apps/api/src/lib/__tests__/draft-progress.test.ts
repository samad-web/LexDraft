import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftProgress } from '../draft-progress';

afterEach(() => vi.useRealTimers());

describe('draft-progress', () => {
  it('reports the latest stage per user, in plain words', () => {
    draftProgress.set('u1', 'planning');
    draftProgress.set('u1', 'writing');
    draftProgress.set('u2', 'reading');
    expect(draftProgress.get('u1')).toEqual({ stage: 'writing', label: 'Writing the draft' });
    expect(draftProgress.get('u2')?.label).toBe('Reading your facts');
  });
  it('forgets a stage after a while and on clear', () => {
    vi.useFakeTimers();
    draftProgress.set('u3', 'checking');
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(draftProgress.get('u3')).toBeNull();
    draftProgress.set('u4', 'word');
    draftProgress.clear('u4');
    expect(draftProgress.get('u4')).toBeNull();
  });
});
