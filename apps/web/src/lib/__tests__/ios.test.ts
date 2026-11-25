import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isIosDevice } from '../ios';

// ios-web-app acceptance criteria 1, 3, 4.
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  oldIpad: 'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
};

describe('AC4: iPhone and iPad are both recognised (iPadOS says it is a Mac)', () => {
  it.each([
    ['iPhone', { userAgent: UA.iphone, maxTouchPoints: 5 }, true],
    ['old iPad', { userAgent: UA.oldIpad, maxTouchPoints: 5 }, true],
    ['iPadOS 13+ (Mac user agent, touch screen)', { userAgent: UA.ipadOs, platform: 'MacIntel', maxTouchPoints: 5 }, true],
    ['a real Mac', { userAgent: UA.ipadOs, platform: 'MacIntel', maxTouchPoints: 0 }, false],
    ['Android', { userAgent: UA.android, platform: 'Linux armv8l', maxTouchPoints: 5 }, false],
  ])('%s', (_name, nav, expected) => {
    expect(isIosDevice(nav)).toBe(expected);
  });
});

describe('AC3: full-height screens fit the visible iPhone screen', () => {
  it('every 100vh height in the styles has a 100dvh twin (Safari\'s address bar)', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8');
    const decls = css.match(/(?:min-|max-)?height:\s*[^;{}]*\b100vh\b[^;{}]*;(?:\s*(?:min-|max-)?height:\s*[^;{}]*100dvh[^;{}]*;)?/g) ?? [];
    expect(decls.length).toBeGreaterThan(5);
    for (const d of decls) expect(d, d).toContain('100dvh');
  });
});

describe('AC1: Home Screen app', () => {
  it('index.html opens full-screen from the Home Screen and keeps case numbers plain', () => {
    const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
    for (const m of ['apple-mobile-web-app-capable', 'apple-mobile-web-app-title', 'format-detection', 'apple-touch-icon']) {
      expect(html).toContain(m);
    }
    // iOS keeps content clear of the notch / home bar itself (no viewport-fit=cover)
    expect(html).not.toContain('viewport-fit=cover');
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../../../public/manifest.webmanifest'), 'utf8'));
    expect(manifest.display).toBe('standalone');
  });
});

describe('AC6: no blank space when the page is pulled past its top or bottom', () => {
  it('iOS-only rule stops the rubber-band bounce (Android keeps pull-to-refresh)', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8');
    expect(css).toMatch(/@supports \(-webkit-touch-callout: none\)\s*\{\s*html, body \{ overscroll-behavior-y: none; \}/);
  });
});
