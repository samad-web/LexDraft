import { describe, expect, it } from 'vitest';
import { placeholderSecrets } from '../env';

describe('env — production refuses the repo placeholder secrets', () => {
  it('flags "change-me" JWT / storage secrets, not real ones', () => {
    expect(placeholderSecrets({ JWT_SECRET: 'change-me-in-production-to-a-long-random-string' })).toEqual(['JWT_SECRET']);
    expect(placeholderSecrets({ JWT_SECRET: 'x7Kq9...realrandomsecret', STORAGE_SIGNING_SECRET: 'CHANGE_ME' })).toEqual(['STORAGE_SIGNING_SECRET']);
    expect(placeholderSecrets({ JWT_SECRET: 'a3f9c2e1b7d84a6f9e0c1b2a3d4e5f60' })).toEqual([]);
  });
});
