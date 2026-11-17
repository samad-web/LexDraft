import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageLoader } from '../PageLoader';
import { ICON } from '../brand/Logo';

const file = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');

describe('loading screens', () => {
  it('PageLoader is an accessible status with the logo loader motion', () => {
    const html = renderToStaticMarkup(createElement(PageLoader, { full: true }));
    expect(html).toContain('role="status"');
    expect(html).toContain('page-loader--full');
    expect(html).toContain('class="difai-loader"');
    expect(html).toContain(ICON.frame);
    expect(html).not.toContain('page-loader__bar');
    expect(html).toContain('Loading…');
    expect(renderToStaticMarkup(createElement(PageLoader))).not.toContain('page-loader--full');
  });

  it('every route Suspense in App uses the loader, none a bare "Loading…" text', () => {
    const app = file('src/App.tsx');
    const fallbacks = [...app.matchAll(/<Suspense fallback=\{([^}]+)\}>/g)].map((m) => m[1]);
    // 4 since the client portal (its own Suspense) was removed on 2026-11-16.
    expect(fallbacks.length).toBeGreaterThanOrEqual(4);
    for (const f of fallbacks) expect(['pageFallback', 'contentFallback']).toContain(f);
    expect(app).toContain('const pageFallback = <PageLoader full />;');
    expect(app).toContain('const contentFallback = <PageLoader />;');
  });

  it('index.html shows the boot loader from first paint, with the new logo loader, without hiding the SEO copy from bots', () => {
    const html = file('index.html');
    expect(html).toContain("b.id = 'boot-loader';");
    expect(html).not.toMatch(/<div id="boot-loader"/); // added by script only, so no-JS readers see #seo-static
    expect(html).toContain('id="seo-static"');
    for (const p of [ICON.frame, ...ICON.lines, ICON.cursor]) expect(html).toContain(p);
    expect(html).toContain('prefers-reduced-motion');
    expect(html).not.toContain('0 0 758 266'); // old wordmark gone
  });
});
