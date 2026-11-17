// new-logo (build-docs/features/new-logo.md): the approved "Draft Lines" logo
// renders from one component, follows the theme, the symbol is the D of
// "DifAi" (never "D DifAi"), and every copy outside React (favicon, offline
// page, SEO pages, boot loader) uses the same drawing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ICON, ICON_16, IFAI, IFAI_DX, LogoLoader, LogoMark, Wordmark } from '../brand/Logo';

const file = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');
const html = (el: Parameters<typeof createElement>[0], props: object = {}) => renderToStaticMarkup(createElement(el, props));
/** The D of the old lettered wordmark: must never sit next to the symbol again. */
const LETTERED_D = 'M0 0H44C75.93 0 95.5 19 95.5 50';

describe('new-logo: brand components', () => {
  it('Wordmark = the symbol as the D, then "ifAi"; named "DifAi", drawn in currentColor', () => {
    const h = html(Wordmark, { height: 28 });
    expect(h).toContain('role="img"');
    expect(h).toContain('aria-label="DifAi"');
    expect(h).toContain('fill="currentColor"');
    expect(h).toContain('viewBox="0 -1.5 272.32 101.5"');
    expect(h.match(/M0 0H50C80\.9/g)).toHaveLength(1); // one D: the symbol
    expect(h).not.toContain(LETTERED_D);
    for (const p of IFAI) expect(h).toContain(p);
    expect(h).toContain(`translate(${IFAI_DX} 0)`);
    expect(h).not.toMatch(/fill="#/); // no fixed ink: follows light/dark
  });

  it('the D-i pair is spaced like letters: 9 units from the symbol to the i stem', () => {
    expect(101.5 + 9 - 104.18).toBeCloseTo(IFAI_DX, 2);
  });

  it('an unsized Wordmark never drops under the 16 px minimum', () => {
    expect(html(Wordmark)).toContain('height:max(0.74em, 16px)');
  });

  it('a decorative Wordmark (empty title) is hidden from screen readers', () => {
    const h = html(Wordmark, { title: '' });
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toContain('role="img"');
  });

  it('LogoMark uses the master symbol from 24 px and the pixel-drawn favicon drawing below', () => {
    expect(html(LogoMark, { size: 26 })).toContain(ICON.frame);
    const small = html(LogoMark, { size: 20, title: 'DifAi' });
    expect(small).toContain(ICON_16.frame);
    expect(small).toContain('aria-label="DifAi"');
  });

  it('Wordmark motion and LogoLoader carry the signature-motion classes; CSS honours reduced motion', () => {
    const m = html(Wordmark, { motion: true });
    expect(m).toContain('class="difai-sig"');
    for (const c of ['ln l1', 'ln l2', 'ln l3', 'cursor']) expect(m).toContain(`class="${c}"`);
    const l = html(LogoLoader);
    expect(l).toContain('class="difai-loader"');
    for (const c of ['ln l1', 'ln l2', 'ln l3', 'cursor']) expect(l).toContain(`class="${c}"`);
    const css = file('src/styles/globals.css');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.difai-sig path, \.difai-sig \.lk-word, \.difai-loader path \{ animation: none !important; \}/);
  });

  it('no old artwork and no "D DifAi" anywhere in the web app', () => {
    for (const p of ['src/components/brand/Logo.tsx', 'src/components/Splash.tsx', 'index.html', 'public/favicon.svg', 'public/offline.html', 'seo/render.mjs']) {
      const f = file(p);
      expect(f).not.toContain('261.5 135'); // the old traced D
      expect(f).not.toContain(LETTERED_D); // the lettered D next to the symbol
    }
  });
});

describe('new-logo: icons and copies outside React', () => {
  it('index.html points at the new favicon files and the new logo image', () => {
    const h = file('index.html');
    expect(h).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(h).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />');
    expect(h).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(h).toContain('"logo": "https://difai.sirahdigital.in/brand/app-icon-512.png"');
  });

  it('favicon.svg is the pixel-drawn 16 px symbol and follows the OS theme', () => {
    const f = file('public/favicon.svg');
    expect(f).toContain('viewBox="0 0 16 16"');
    expect(f).toContain(ICON_16.frame);
    expect(f).toContain('prefers-color-scheme:dark');
  });

  it('the referenced PNGs exist with the right sizes', () => {
    const size = (p: string) => { const b = readFileSync(resolve(__dirname, '../../../public', p)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
    expect(size('favicon-32.png')).toEqual([32, 32]);
    expect(size('apple-touch-icon.png')).toEqual([180, 180]);
    expect(size('brand/app-icon-512.png')).toEqual([512, 512]);
    expect(size('og-image.png')).toEqual([1200, 630]);
  });

  it('offline page and SEO pages draw the same wordmark, not the name typed in a font', () => {
    for (const p of ['public/offline.html', 'seo/render.mjs']) {
      const f = file(p);
      expect(f).toContain('viewBox="0 -1.5 272.32 101.5"');
      expect(f).toContain(ICON.frame);
      expect(f).toContain(`translate(${IFAI_DX} 0)`);
      for (const d of IFAI) expect(f).toContain(d);
    }
    expect(file('public/offline.html')).not.toContain('<h1>DifAi</h1>');
    expect(file('seo/render.mjs')).not.toContain('<img src="/favicon.svg"');
  });
});
