import { describe, expect, it } from 'vitest';
import { workingLine } from '@/hooks/usePresence';

describe('workingLine', () => {
  const w = { 'doc:a': [{ userId: '1', name: 'Priya' }], 'draft:a': [{ userId: '2', name: 'Anand' }, { userId: '1', name: 'Priya' }], 'doc:b': [] };
  it('names who is working, once each', () => {
    expect(workingLine(w, ['doc:a'])).toBe('Priya is working on this now');
    expect(workingLine(w, ['doc:a', 'draft:a'])).toBe('Priya and Anand are working on this now');
    expect(workingLine(w, ['doc:b'])).toBe('');
    expect(workingLine({ x: [{ userId: '1', name: 'A' }, { userId: '2', name: 'B' }, { userId: '3', name: 'C' }] }, ['x'])).toBe('A and 2 others are working on this now');
  });
});
