import { afterEach, describe, expect, it, vi } from 'vitest';
import { themeColorOf } from '../theme-color';

// ios-web-app AC7: Safari's bar tint follows the page's own background.
describe('themeColorOf', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is the page background (light or dark), near-black only when there is none', () => {
    vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgb(244, 244, 243)' }));
    expect(themeColorOf({} as Element)).toBe('rgb(244, 244, 243)');
    vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgba(0, 0, 0, 0)' }));
    expect(themeColorOf({} as Element)).toBe('#0a0a0a');
  });
});
