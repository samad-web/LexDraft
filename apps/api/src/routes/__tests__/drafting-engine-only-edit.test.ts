import { describe, expect, it } from 'vitest';
import { isEngineOnlyEdit } from '../drafting.routes';

// drafting-efficiency: only a genuinely model-free live edit may skip the hourly
// LLM limiter and the AI quota.
describe('isEngineOnlyEdit', () => {
  it('is true only for compose:false together with draftNow:true', () => {
    expect(isEngineOnlyEdit({ compose: false, draftNow: true })).toBe(true);
  });

  it('stays limited when either flag is missing or not a real boolean', () => {
    expect(isEngineOnlyEdit({ compose: false })).toBe(false); // phrases questions (model)
    expect(isEngineOnlyEdit({ draftNow: true })).toBe(false); // composes (model)
    expect(isEngineOnlyEdit({ compose: 'false', draftNow: true })).toBe(false);
    expect(isEngineOnlyEdit({ compose: 0, draftNow: 'true' })).toBe(false);
    expect(isEngineOnlyEdit(undefined)).toBe(false);
    expect(isEngineOnlyEdit(null)).toBe(false);
  });
});
