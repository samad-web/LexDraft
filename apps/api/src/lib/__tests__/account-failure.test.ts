import { describe, expect, it } from 'vitest';
import { isAccountFailure } from '../anthropic-client';
import { HttpRetryError } from '../retry';

describe('isAccountFailure (W1: no AI credit must not read as "missing facts")', () => {
  it('no credit balance (the 2026-11-03 prod failure) is an account failure', () => {
    expect(isAccountFailure(new HttpRetryError(400,
      'Claude API 400: Your credit balance is too low to access the Anthropic API.'))).toBe(true);
  });

  it('bad or revoked key is an account failure', () => {
    expect(isAccountFailure(new HttpRetryError(401, 'Claude API 401: invalid x-api-key'))).toBe(true);
    expect(isAccountFailure(new HttpRetryError(403, 'Claude API 403: forbidden'))).toBe(true);
  });

  it('one-off failures are not (they keep the retry / fallback path)', () => {
    expect(isAccountFailure(new HttpRetryError(400, 'Claude API 400: prompt is too long'))).toBe(false);
    expect(isAccountFailure(new HttpRetryError(429, 'Claude API 429: rate limited'))).toBe(false);
    expect(isAccountFailure(new HttpRetryError(529, 'Claude API 529: overloaded'))).toBe(false);
    expect(isAccountFailure(new Error('socket hang up'))).toBe(false);
  });
});
