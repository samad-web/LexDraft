/** land-records-tn-gate.md: the access rule (AC1-AC5) without the database. */
import { describe, expect, it } from 'vitest';
import { decideLandAccess, isTamilNadu } from '../land-access';

const d = (o: Partial<{ platformOn: boolean; firmMode: 'on' | 'off' | null; state: string | null }>) =>
  decideLandAccess({ platformOn: true, firmMode: null, state: null, ...o });

describe('Land Records access rule', () => {
  it('AC1 Tamil Nadu (any spelling) is available', () => {
    for (const s of ['Tamil Nadu', ' tamil nadu ', 'TamilNadu', 'TN', 'Tamil-Nadu']) expect(d({ state: s })).toBe('available');
    expect(isTamilNadu('Telangana')).toBe(false);
  });
  it('AC2 no state asks for it', () => {
    expect(d({ state: null })).toBe('state_required');
    expect(d({ state: '  ' })).toBe('state_required');
  });
  it('AC3 another state is coming soon', () => {
    expect(d({ state: 'Kerala' })).toBe('coming_soon');
  });
  it('AC4 platform off disables everyone, a firm override cannot bypass it', () => {
    expect(d({ platformOn: false, state: 'Tamil Nadu' })).toBe('disabled');
    expect(d({ platformOn: false, firmMode: 'on', state: 'Tamil Nadu' })).toBe('disabled');
  });
  it('AC5 firm override on/off wins over the state', () => {
    expect(d({ firmMode: 'on', state: 'Kerala' })).toBe('available');
    expect(d({ firmMode: 'on', state: null })).toBe('available');
    expect(d({ firmMode: 'off', state: 'Tamil Nadu' })).toBe('disabled');
  });
});
