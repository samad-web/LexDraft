// SEO/AEO acceptance criteria (build-docs/features/seo-aeo.md).
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGES, V4, V4_LIVE, buildPages, offerFor } from './pages.mjs';
import { ORIGIN, render404, renderLlms, renderPage, renderSitemap, schemaFor } from './render.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const published = PAGES.filter((p) => !p.draft);
const drafts = PAGES.filter((p) => p.draft);
const words = (s) => s.trim().split(/\s+/).length;
const ldOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

const nginx = read('nginx.conf');
const SPA_RE = new RegExp(nginx.match(/location ~ (\^\/\([^)]*\)\(\/\|\$\))/)[1]);

// Both settings of the pricing v4 switch must pass, so flipping it is safe.
const VARIANTS = [['now', buildPages(false)], ['after v4', buildPages(true)]];

describe('CTR rules for every page (drafts too, so they are ready to publish)', () => {
  for (const [label, pages] of VARIANTS) {
    for (const p of pages) {
      it(`${label} ${p.slug}: title <= 60 chars and names the brand`, () => {
        expect(p.title.length).toBeLessThanOrEqual(60);
        expect(p.title).toContain('DifAi');
      });
      it(`${label} ${p.slug}: description 120-155 chars`, () => {
        expect(p.description.length).toBeGreaterThanOrEqual(120);
        expect(p.description.length).toBeLessThanOrEqual(155);
      });
      it(`${label} ${p.slug}: direct answer is 40-70 words`, () => {
        expect(words(p.answer)).toBeGreaterThanOrEqual(40);
        expect(words(p.answer)).toBeLessThanOrEqual(70);
      });
    }
    it(`${label}: titles, descriptions and slugs are unique`, () => {
      for (const k of ['title', 'description', 'slug']) {
        expect(new Set(pages.map((p) => p[k])).size).toBe(pages.length);
      }
    });
  }
});

describe('pricing v4 switch', () => {
  const plansTs = read('../api/src/lib/plans.ts');
  const apiPlan = (id) => {
    const m = plansTs.match(new RegExp(`${id}:\\s*\\{[^}]*monthlyInr:\\s*(\\d+),\\s*annualInr:\\s*(\\d+),\\s*pages:\\s*(\\d+)`));
    return { monthly: +m[1], yearly: +m[2], pages: +m[3] };
  };
  for (const id of ['sanad', 'vakalat', 'brief', 'associates']) {
    it(`${id} price and pages match apps/api/src/lib/plans.ts`, () => {
      expect(apiPlan(id)).toEqual({ monthly: V4[id].monthly, yearly: V4[id].yearly, pages: V4[id].pages });
    });
  }
  it('Munshi seat and Associates seat range match plans.ts', () => {
    const m = plansTs.match(/MUNSHI = \{ monthlyInr: (\d+), annualInr: (\d+)/);
    expect([+m[1], +m[2]]).toEqual([V4.munshi.monthly, V4.munshi.yearly]);
    expect(plansTs).toContain(`perAdvocate: { min: ${V4.associates.min}, max: ${V4.associates.max} }`);
  });
  it('/pricing is published exactly when v4 is live', () => {
    expect(buildPages(false).find((p) => p.slug === 'pricing').draft).toBe(true);
    expect(buildPages(true).find((p) => p.slug === 'pricing').draft).toBe(false);
    expect(PAGES.find((p) => p.slug === 'pricing').draft).toBe(!V4_LIVE);
  });
  it('after v4 no page promises the old free plan or a firm trial to new sign-ups', () => {
    const text = JSON.stringify(buildPages(true)) + JSON.stringify(offerFor(true));
    expect(text).not.toMatch(/Free for solo advocates|14-day|free trial/i);
  });
  it('pricing page shows every price, GST-inclusive, and makes no unconfirmed Partners claims', () => {
    const html = renderPage(buildPages(true).find((p) => p.slug === 'pricing'), published);
    const inr = (n) => `\u20b9${n.toLocaleString('en-IN')}`;
    for (const k of Object.keys(V4)) {
      expect(html).toContain(inr(V4[k].monthly));
      expect(html).toContain(inr(V4[k].yearly));
    }
    expect(html).toContain('include 18% GST');
    expect(html).not.toMatch(/\bSSO\b|audit log|success manager|\bSLA\b/i);
  });
});

describe('rendered page is complete without JavaScript', () => {
  for (const p of PAGES) {
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
  for (const g of PAGES.filter((p) => p.kind === 'guide')) {
    it(`${g.slug}: guide cites official sources, is dated and has an error link`, () => {
      expect(g.sources.length).toBeGreaterThan(0);
      for (const s of g.sources) expect(s.url).toMatch(/^https:\/\/(www\.indiacode\.nic\.in|[a-z]+\.ecourts\.gov\.in|ecourts\.gov\.in)\//);
      const html = renderPage(g, published);
      expect(html).toContain(`Last checked ${g.updated}`);
      expect(html).toContain('Report it</a>');
      expect(ldOf(html)['@graph'][0]['@type']).toBe('Article');
    });
    it(`${g.slug}: links into a DifAi page that exists`, () => {
      const links = [...g.body.matchAll(/href="\/([a-z0-9-]+)"/g)].map((m) => m[1]);
      expect(links.length).toBeGreaterThan(0);
      for (const l of links) expect(PAGES.map((p) => p.slug)).toContain(l);
    });
  }
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
    expect(robots).toMatch(/User-agent: \*\r?\nAllow: \//);
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
