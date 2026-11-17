import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, reloadForStaleChunk } from '../stale-chunk';

// After a deploy, a page opened earlier asks for old JS files and fails with
// "Failed to fetch dynamically imported module" (owner saw it on Google
// sign-in, 2026-11-17). It must reload once, never loop.

describe('stale code files after a deploy', () => {
  const reload = vi.fn();
  // The web suite runs in node: stub the two browser globals the module uses.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal('window', { location: { reload } });
    reload.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('recognises the browsers’ stale-chunk messages', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/AuthView-abc.js'))).toBe(true);
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true);
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
  });

  it('reloads once for a stale-chunk error', () => {
    expect(reloadForStaleChunk(new TypeError('Failed to fetch dynamically imported module'), 1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not loop: a second failure within 30 s shows the error instead', () => {
    reloadForStaleChunk(new TypeError('Failed to fetch dynamically imported module'), 1_000_000);
    expect(reloadForStaleChunk(new TypeError('Failed to fetch dynamically imported module'), 1_010_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('tries again after the window passes (a later deploy)', () => {
    reloadForStaleChunk(new TypeError('Failed to fetch dynamically imported module'), 1_000_000);
    expect(reloadForStaleChunk(new TypeError('Failed to fetch dynamically imported module'), 1_040_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('ignores ordinary errors', () => {
    expect(reloadForStaleChunk(new Error('Network down'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
