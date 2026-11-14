import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthArt } from '../AuthArt';

afterEach(() => vi.useRealTimers());

describe('sign-in page', () => {
  it('the hearing card shows the live date and time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 17, 5));
    const html = renderToStaticMarkup(createElement(AuthArt));
    expect(html).toContain('>NOV<');
    expect(html).toContain('>14<');
    expect(html).toMatch(/>5:05 PM</);
    expect(html).toContain('>HEARING TODAY<');
    expect(html).toContain('Court 4 · Arguments');
    expect(html).not.toContain('OCT');
  });

  it('the plans line is gone from under "Create your account"', () => {
    const auth = readFileSync(resolve(__dirname, '../../views/AuthView.tsx'), 'utf8');
    expect(auth).not.toContain("'A custom plan, set up with you' : freeLine}");
    expect(auth).not.toContain("'Every feature for 14 days · no card needed'");
  });
});
