import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageLoader } from '../PageLoader';
import { BRAND_PATHS } from '../brand/Logo';

const file = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');

describe('loading screens', () => {
  it('PageLoader is an accessible status with the wordmark and a bar', () => {
    const html = renderToStaticMarkup(createElement(PageLoader, { full: true }));
    expect(html).toContain('role="status"');
    expect(html).toContain('page-loader--full');
    expect(html).toContain('page-loader__bar');
    expect(html).toContain('viewBox="0 0 758 266"');
    expect(html).toContain('Loading…');
    expect(renderToStaticMarkup(createElement(PageLoader))).not.toContain('page-loader--full');
  });

  it('every route Suspense in App uses the loader, none a bare "Loading…" text', () => {
    const app = file('src/App.tsx');
    const fallbacks = [...app.matchAll(/<Suspense fallback=\{([^}]+)\}>/g)].map((m) => m[1]);
    expect(fallbacks.length).toBeGreaterThanOrEqual(5);
    for (const f of fallbacks) expect(['pageFallback', 'contentFallback']).toContain(f);
    expect(app).toContain('const pageFallback = <PageLoader full />;');
    expect(app).toContain('const contentFallback = <PageLoader />;');
  });

  it('index.html shows the boot loader from first paint, with the real wordmark, without hiding the SEO copy from bots', () => {
    const html = file('index.html');
    expect(html).toContain("b.id = 'boot-loader';");
    expect(html).not.toMatch(/<div id="boot-loader"/); // added by script only, so no-JS readers see #seo-static
    expect(html).toContain('id="seo-static"');
    const d = BRAND_PATHS.d.replace('Z' + 'M', 'ZM');
    for (const p of [d, BRAND_PATHS.i1, BRAND_PATHS.f, BRAND_PATHS.fBar, BRAND_PATHS.a, BRAND_PATHS.i2]) expect(html).toContain(p);
  });
});
