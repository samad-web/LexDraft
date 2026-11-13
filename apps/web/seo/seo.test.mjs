// SEO/AEO acceptance criteria (build-docs/features/seo-aeo.md).
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGES } from './pages.mjs';
import { ORIGIN, render404, renderLlms, renderPage, renderSitemap, schemaFor } from './render.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const published = PAGES.filter((p) => !p.draft);
const drafts = PAGES.filter((p) => p.draft);
const words = (s) => s.trim().split(/\s+/).length;
const ldOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

const nginx = read('nginx.conf');
const SPA_RE = new RegExp(nginx.match(/location ~ (\^\/\([^)]*\)\(\/\|\$\))/)[1]);

describe('CTR rules for every page', () => {
  for (const p of published) {
    it(`${p.slug}: title <= 60 chars and names the brand`, () => {
      expect(p.title.length).toBeLessThanOrEqual(60);
      expect(p.title).toContain('DifAi');
    });
    it(`${p.slug}: description 120-155 chars`, () => {
      expect(p.description.length).toBeGreaterThanOrEqual(120);
      expect(p.description.length).toBeLessThanOrEqual(155);
    });
    it(`${p.slug}: direct answer is 40-70 words`, () => {
      expect(words(p.answer)).toBeGreaterThanOrEqual(40);
      expect(words(p.answer)).toBeLessThanOrEqual(70);
    });
  }
  it('titles, descriptions and slugs are unique', () => {
    for (const k of ['title', 'description', 'slug']) {
      expect(new Set(PAGES.map((p) => p[k])).size).toBe(PAGES.length);
    }
  });
});

describe('rendered page is complete without JavaScript', () => {
  for (const p of published) {
    const html = renderPage(p, published);
    it(`${p.slug}: title, description, canonical, h1, answer`, () => {
      expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/${p.slug}" />`);
      expect(html).toMatch(/<title>[^<]+<\/title>/);
      expect(html).toContain('<meta name="description"');
      expect((html.match(/<h1>/g) ?? []).length).toBe(1);
      expect(html).not.toContain('<script type="module"');
    });
    it(`${p.slug}: JSON-LD parses with breadcrumbs${p.faq?.length ? ' and FAQ' : ''}`, () => {
      const types = ldOf(html)['@graph'].map((n) => n['@type']);
      expect(types).toContain('BreadcrumbList');
      if (p.faq?.length) expect(types).toContain('FAQPage');
    });
  }
  it('guides carry Article schema with sources', () => {
    const guide = { ...PAGES[0], kind: 'guide', sources: [{ label: 'Act', url: 'https://example.org' }] };
    const article = schemaFor(guide)['@graph'][0];
    expect(article['@type']).toBe('Article');
    expect(article.citation).toHaveLength(1);
  });
  it('escapes HTML in titles', () => {
    expect(renderPage({ ...published[0], title: 'A <b> & "c"' }, published)).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
  });
});

describe('sitemap, llms.txt, 404', () => {
  const sitemap = renderSitemap(published, '2026-11-13');
  const llms = renderLlms(published);
  it('sitemap lists home and exactly the published pages', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([`${ORIGIN}/`, ...published.map((p) => `${ORIGIN}/${p.slug}`)]);
    for (const d of drafts) expect(sitemap).not.toContain(d.slug);
  });
  it('llms.txt links every published page', () => {
    for (const p of published) expect(llms).toContain(`${ORIGIN}/${p.slug}`);
  });
  it('404 page is noindex with no canonical', () => {
    const html = render404(published);
    expect(html).toContain('content="noindex"');
    expect(html).not.toContain('rel="canonical"');
  });
});

describe('routing: real 404s without breaking the app', () => {
  const app = read('src/App.tsx');
  const prefixes = new Set(
    [...app.matchAll(/(?:path="|pathname\.startsWith\('|pathname === '|<Navigate to="|navigate\(')\/([a-z-]+)/g)].map((m) => m[1]),
  );
  for (const pre of prefixes) {
    it(`SPA route /${pre} still gets the app shell`, () => {
      expect(SPA_RE.test(`/${pre}`)).toBe(true);
      expect(SPA_RE.test(`/${pre}/x`)).toBe(true);
    });
  }
  it('no public page is swallowed by an SPA route', () => {
    for (const p of PAGES) expect(SPA_RE.test(`/${p.slug}`)).toBe(false);
  });
  it('nginx serves prerendered pages and 404s the rest', () => {
    expect(nginx).toContain('try_files $uri $uri.html $uri/ =404;');
    expect(nginx).toContain('error_page 404 /404.html;');
  });
  it('trailing slash 301s to the clean URL with a relative Location', () => {
    expect(nginx).toMatch(/location ~ \^\/\(\.\+\)\/\$ \{\s+absolute_redirect off;\s+return 301 \/\$1;/);
  });
});

describe('internal links and crawl rules', () => {
  const index = read('index.html');
  const landing = read('src/views/LandingView.tsx');
  it('landing (static and React) links every published page', () => {
    for (const p of published) {
      expect(index).toContain(`href="/${p.slug}"`);
      if (p.kind === 'feature') expect(landing).toContain(`'/${p.slug}'`);
    }
  });
  it('robots.txt allows public pages, blocks the app, points at the sitemap', () => {
    const robots = read('public/robots.txt');
    expect(robots).toMatch(/User-agent: \*\nAllow: \//);
    expect(robots).toContain('Disallow: /app/');
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
  it('the Android build does not prerender marketing pages', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts.build).toContain('seo/prerender.mjs');
    expect(pkg.scripts['build:mobile']).not.toContain('prerender');
  });
});

describe('prerender script', () => {
  it('writes every page, 404, sitemap and llms.txt', () => {
    const out = mkdtempSync(join(tmpdir(), 'difai-seo-'));
    execFileSync(process.execPath, [fileURLToPath(new URL('./prerender.mjs', import.meta.url)), out]);
    const files = readdirSync(out);
    for (const p of published) expect(files).toContain(`${p.slug}.html`);
    for (const d of drafts) expect(files).not.toContain(`${d.slug}.html`);
    expect(files).toEqual(expect.arrayContaining(['404.html', 'sitemap.xml', 'llms.txt']));
  });
});
