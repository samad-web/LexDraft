import { beforeEach, describe, expect, it, vi } from 'vitest';
import { presence, PRESENCE_TTL_MS, TARGET } from '../presence.service';

vi.mock('../../db/client', () => ({ db: () => null }));

// team-docs AC3: "Priya is working on this now".
const DOC = 'doc:11111111-1111-1111-1111-111111111111';
const NOTES = 'case-notes:22222222-2222-2222-2222-222222222222';
beforeEach(() => presence._reset());

describe('presence', () => {
  it('shows who else is working on an item, never yourself', () => {
    presence.beat('f1', 'priya', 'Priya', [DOC], 1000);
    presence.beat('f1', 'anand', 'Anand', [DOC, NOTES], 1000);
    expect(presence.view('f1', 'anand', undefined, 2000)).toEqual({ [DOC]: [{ userId: 'priya', name: 'Priya' }] });
    expect(presence.view('f1', 'priya', [NOTES], 2000)).toEqual({ [NOTES]: [{ userId: 'anand', name: 'Anand' }] });
  });
  it('lapses 75 s after the last report; leaving clears it at once', () => {
    presence.beat('f1', 'priya', 'Priya', [DOC], 0);
    expect(presence.view('f1', 'x', undefined, PRESENCE_TTL_MS - 1)[DOC]).toHaveLength(1);
    expect(presence.view('f1', 'x', undefined, PRESENCE_TTL_MS + 1)).toEqual({});
    presence.beat('f1', 'priya', 'Priya', [DOC], 10);
    presence.leave('f1', 'priya', [DOC]);
    expect(presence.view('f1', 'x', undefined, 20)).toEqual({});
  });
  it('another firm never sees it', () => {
    presence.beat('f1', 'priya', 'Priya', [DOC], 0);
    expect(presence.view('f2', 'x', undefined, 1)).toEqual({});
  });
  it('only known kinds of item are accepted', () => {
    expect(TARGET.test(DOC)).toBe(true);
    expect(TARGET.test(NOTES)).toBe(true);
    expect(TARGET.test('doc:../../etc')).toBe(false);
    expect(TARGET.test('user:11111111-1111-1111-1111-111111111111')).toBe(false);
  });
});
