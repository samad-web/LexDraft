// new-logo (build-docs/features/new-logo.md): the approved "Draft Lines" logo
// renders from one component, follows the theme, and every copy outside React
// (favicon, offline page, SEO pages, boot loader) uses the same drawing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FullLogo, ICON, ICON_16, LogoLoader, LogoMark, WORD, Wordmark } from '../brand/Logo';

const file = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');
const html = (el: Parameters<typeof createElement>[0], props: object = {}) => renderToStaticMarkup(createElement(el, props));

describe('new-logo: brand components', () => {
  it('FullLogo = symbol + wordmark, named "DifAi", drawn in currentColor', () => {
    const h = html(FullLogo, { height: 36 });
    expect(h).toContain('role="img"');
    expect(h).toContain('aria-label="DifAi"');
    expect(h).toContain('fill="currentColor"');
    expect(h).toContain(ICON.frame);
    for (const p of WORD) expect(h).toContain(p);
    expect(h).not.toMatch(/fill="#/); // no fixed ink: follows light/dark
  });

  it('Wordmark (compact) is the wordmark only', () => {
    const h = html(Wordmark, { height: 22 });
    expect(h).toContain('aria-label="DifAi"');
    expect(h).toContain('viewBox="0 -1.5 266 101.5"');
    expect(h).not.toContain(ICON.frame);
  });

  it('a decorative lockup (empty title) is hidden from screen readers', () => {
    const h = html(FullLogo, { title: '' });
    expect(h).toContain('aria-hidden="true"');
    expect(h).not.toContain('role="img"');
  });

  it('LogoMark uses the master symbol from 24 px and the pixel-drawn favicon drawing below', () => {
    expect(html(LogoMark, { size: 26 })).toContain(ICON.frame);
    const small = html(LogoMark, { size: 20, title: 'DifAi' });
    expect(small).toContain(ICON_16.frame);
    expect(small).toContain('aria-label="DifAi"');
  });

  it('FullLogo motion and LogoLoader carry the signature-motion classes; CSS honours reduced motion', () => {
    expect(html(FullLogo, { motion: true })).toContain('class="difai-sig"');
    const l = html(LogoLoader);
    expect(l).toContain('class="difai-loader"');
    for (const c of ['ln l1', 'ln l2', 'ln l3', 'cursor']) expect(l).toContain(`class="${c}"`);
    const css = file('src/styles/globals.css');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.difai-sig path, \.difai-sig \.lk-word, \.difai-loader path \{ animation: none !important; \}/);
  });

  it('the old traced wordmark is gone from the app', () => {
    for (const p of ['src/components/brand/Logo.tsx', 'src/components/Splash.tsx', 'index.html', 'public/favicon.svg', 'seo/render.mjs']) {
      expect(file(p)).not.toContain('261.5 135'); // the old bold D
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

  it('offline page and SEO pages draw the new logo, not the name typed in a font', () => {
    const off = file('public/offline.html');
    expect(off).toContain(WORD[0]);
    expect(off).not.toContain('<h1>DifAi</h1>');
    const seo = file('seo/render.mjs');
    expect(seo).toContain(ICON.frame);
    for (const p of WORD) expect(seo).toContain(p);
    expect(seo).not.toContain('<img src="/favicon.svg"');
  });
});
