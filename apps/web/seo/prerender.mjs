// Runs after `vite build` (web only, never the Android build): writes the
// public pages, 404 page, sitemap.xml and llms.txt into dist/.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PAGES } from './pages.mjs';
import { render404, renderLlms, renderPage, renderSitemap } from './render.mjs';

// Optional output dir (tests); defaults to apps/web/dist.
const dist = process.argv[2] ? pathToFileURL(`${process.argv[2]}/`) : new URL('../dist/', import.meta.url);
const published = PAGES.filter((p) => !p.draft);
const newest = published.map((p) => p.updated).sort().at(-1);

for (const page of published) {
  writeFileSync(new URL(`${page.slug}.html`, dist), renderPage(page, published));
}
writeFileSync(new URL('404.html', dist), render404(published));
writeFileSync(new URL('sitemap.xml', dist), renderSitemap(published, newest));
writeFileSync(new URL('llms.txt', dist), renderLlms(published));

console.log(`prerendered ${published.length} pages + 404, sitemap.xml, llms.txt`);
