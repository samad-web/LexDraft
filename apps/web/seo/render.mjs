// Static HTML for the public pages in pages.mjs. Crawlers and AI answer
// engines that don't run JavaScript read these files as-is; no React mounts
// on them. Plain functions, no dependencies, so `vite build` stays unchanged.

import { OFFER } from './pages.mjs';

export const ORIGIN = 'https://difai.sirahdigital.in';
export const BRAND = 'DifAi';
// Full logo (symbol + wordmark) from components/brand/Logo.tsx, in currentColor so it follows the theme.
export const LOGO_SVG = '<svg viewBox="0 -1.5 253.86 101.5" fill="currentColor" role="img" aria-label="DifAi"><g><path d="M0 0H50C80.9 0 101.5 20 101.5 50C101.5 80 80.9 100 50 100H0ZM17 15H50C71.3 15 85.5 29 85.5 50C85.5 71 71.3 85 50 85H17Z" fill-rule="evenodd"/><path d="M29 28H68V39H29Z"/><path d="M29 46H76V57H29Z"/><path d="M29 64H44V75H29Z"/><path d="M51 60H59V79H51Z"/></g><g transform="translate(131.5 27) scale(0.46)"><path d="M0 0H44C75.93 0 95.5 19 95.5 50C95.5 81 75.93 100 44 100H0ZM14 12H44C66.63 12 80.5 26.44 80.5 50C80.5 73.56 66.63 88 44 88H14Z" fill-rule="evenodd"/><path d="M111.18 30H111.18A7 7 0 0 1 118.18 37V93A7 7 0 0 1 111.18 100H111.18A7 7 0 0 1 104.18 93V37A7 7 0 0 1 111.18 30Z"/><path d="M103.2 6.98A7.98 7.98 0 1 0 119.16 6.98A7.98 7.98 0 1 0 103.2 6.98Z"/><path d="M137.08 100V21.7A21.7 21.7 0 0 1 158.78 0H165.78V12.88H158.78A7.7 8.82 0 0 0 151.08 21.7V100Z"/><path d="M125.18 30H167.18V41.48H125.18Z"/><path d="M156.68 100L195.8 -1.5H207.56L171.52 100Z"/><path d="M229.6 100L195.8 -1.5H207.56L246.68 100Z"/><path d="M178.47 63H223.34V74.2H178.47Z"/><path d="M259 30H259A7 7 0 0 1 266 37V93A7 7 0 0 1 259 100H259A7 7 0 0 1 252 93V37A7 7 0 0 1 259 30Z"/><path d="M252 -1H266V15.8H252Z"/></g></svg>';
const ORG_ID = `${ORIGIN}/#org`;
const SIGNUP = '/auth?signup=1';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const urlOf = (page) => `${ORIGIN}/${page.slug}`;

/** Every JSON-LD node for one page, as a single @graph. */
export function schemaFor(page) {
  const url = urlOf(page);
  const graph = [
    {
      '@type': page.kind === 'guide' ? 'Article' : 'WebPage',
      '@id': `${url}#page`,
      url,
      name: page.title,
      headline: page.h1,
      description: page.description,
      inLanguage: 'en-IN',
      isPartOf: { '@id': `${ORIGIN}/#website` },
      publisher: { '@id': ORG_ID },
      dateModified: page.updated,
      ...(page.kind === 'guide'
        ? {
            author: { '@id': ORG_ID },
            datePublished: page.published ?? page.updated,
            citation: (page.sources ?? []).map((s) => ({ '@type': 'Legislation', name: s.label, url: s.url })),
          }
        : { about: { '@id': ORG_ID } }),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: BRAND, item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: page.crumb, item: url },
      ],
    },
  ];
  if (page.faq?.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: page.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

const CSS = `
:root{--ink:#0a0a0a;--paper:#fafafa;--muted:#555;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--ink:#fafafa;--paper:#0a0a0a;--muted:#aaa;--line:#333}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
a{color:inherit}
.wrap{max-width:820px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:20px;min-height:64px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:20px;text-decoration:none}
.brand svg{display:block;height:32px;width:auto}
nav.top{margin-left:auto;display:flex;gap:16px;flex-wrap:wrap;font-size:15px}
nav.top a{text-decoration:none}
.btn{display:inline-block;background:var(--ink);color:var(--paper);padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600}
.crumbs{font-size:14px;color:var(--muted);margin:24px 0 0}
h1,h2,h3{font-family:Georgia,'Times New Roman',serif;line-height:1.2;font-weight:600}
h1{font-size:clamp(30px,5vw,44px);margin:12px 0 16px}
h2{font-size:26px;margin:40px 0 12px}
h3{font-size:20px;margin:24px 0 8px}
.answer{font-size:19px;border-left:3px solid var(--ink);padding-left:16px}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
details{border-top:1px solid var(--line);padding:12px 0}
summary{cursor:pointer;font-weight:600}
.cta{border:1px solid var(--ink);border-radius:12px;padding:24px;margin:48px 0}
.note{font-size:14px;color:var(--muted)}
@media (max-width:640px){header .wrap{gap:10px;padding-top:10px}nav.top{order:3;width:100%;margin:0;flex-wrap:nowrap;overflow-x:auto;gap:18px;padding-bottom:10px;white-space:nowrap}header .btn{margin-left:auto;padding:8px 14px}}
footer{border-top:1px solid var(--line);margin-top:64px;padding:32px 0;font-size:14px;color:var(--muted)}
footer ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:8px 20px}
`.trim();

function layout({ page, body, canonical, robots = 'index, follow, max-image-preview:large', schema, nav }) {
  const ogTitle = page.ogTitle ?? page.title;
  return `<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}" />
<meta name="robots" content="${robots}" />
${canonical ? `<link rel="canonical" href="${canonical}" />` : ''}
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#0a0a0a" />
<meta property="og:type" content="${page.kind === 'guide' ? 'article' : 'website'}" />
<meta property="og:site_name" content="${BRAND}" />
<meta property="og:locale" content="en_IN" />
${canonical ? `<meta property="og:url" content="${canonical}" />` : ''}
<meta property="og:title" content="${esc(ogTitle)}" />
<meta property="og:description" content="${esc(page.description)}" />
<meta property="og:image" content="${ORIGIN}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(ogTitle)}" />
<meta name="twitter:description" content="${esc(page.description)}" />
<meta name="twitter:image" content="${ORIGIN}/og-image.png" />
${schema ? `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>` : ''}
<style>${CSS}</style>
</head>
<body>
<header><div class="wrap">
<a class="brand" href="/">${LOGO_SVG}</a>
<nav class="top" aria-label="Main">${nav}</nav>
<a class="btn" href="${SIGNUP}">Get started</a>
</div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">${page.footer}</div></footer>
</body>
</html>
`;
}

function navHtml(pages) {
  const top = pages.filter((p) => p.nav).map((p) => `<a href="/${p.slug}">${esc(p.nav)}</a>`);
  return [...top, '<a href="/auth">Sign in</a>'].join('');
}

function footerHtml(pages) {
  const links = pages.map((p) => `<li><a href="/${p.slug}">${esc(p.crumb)}</a></li>`).join('');
  return `<ul><li><a href="/">${BRAND} home</a></li>${links}<li><a href="/terms">Terms</a></li><li><a href="/privacy">Privacy</a></li></ul>
<p>${BRAND} is built by Sirah Digital, India. ${OFFER.line}</p>`;
}

export function renderPage(page, published) {
  const others = published.filter((p) => p.slug !== page.slug);
  const faq = page.faq?.length
    ? `<h2>Frequently asked questions</h2>${page.faq
        .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
        .join('')}`
    : '';
  const sources = page.sources?.length
    ? `<h2>Sources</h2><ul>${page.sources
        .map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a></li>`)
        .join('')}</ul>`
    : '';
  const checked =
    page.kind === 'guide'
      ? `<p class="note">Last checked ${esc(page.updated)} against ${esc(page.checkedAgainst ?? 'the bare Act')}. This is general information, not legal advice. Spotted an error? <a href="mailto:support@sirahdigital.in?subject=${encodeURIComponent(`Error on /${page.slug}`)}">Report it</a>.</p>`
      : '';
  const related = `<h2>More from ${BRAND}</h2><ul>${others
    .map((p) => `<li><a href="/${p.slug}">${esc(p.h1)}</a></li>`)
    .join('')}</ul>`;
  const body = `<p class="crumbs"><a href="/">${BRAND}</a> › ${esc(page.crumb)}</p>
<article>
<h1>${esc(page.h1)}</h1>
<p class="answer">${esc(page.answer)}</p>
${page.body}
${faq}
${sources}
${checked}
</article>
<section class="cta"><h2 style="margin-top:0">${esc(page.cta ?? `Try ${BRAND} free`)}</h2>
<p>${OFFER.line}</p>
<a class="btn" href="${SIGNUP}">Create your free account</a></section>
${related}`;
  return layout({
    page: { ...page, footer: footerHtml(published) },
    body,
    canonical: urlOf(page),
    schema: schemaFor(page),
    nav: navHtml(published),
  });
}

/** 404 body: real HTTP 404 from nginx, page tells people where to go. */
export function render404(published) {
  const page = {
    title: `Page not found | ${BRAND}`,
    description: 'This page does not exist.',
    footer: footerHtml(published),
  };
  const body = `<h1>Page not found</h1>
<p>The link may be old or mistyped. Try one of these:</p>
<ul><li><a href="/">${BRAND} home</a></li>${published.map((p) => `<li><a href="/${p.slug}">${esc(p.h1)}</a></li>`).join('')}</ul>`;
  return layout({ page, body, robots: 'noindex', nav: navHtml(published) });
}

export function renderSitemap(published, homeUpdated) {
  const urls = [{ loc: `${ORIGIN}/`, lastmod: homeUpdated }, ...published.map((p) => ({ loc: urlOf(p), lastmod: p.updated }))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}
</urlset>
`;
}

/** llms.txt: plain-markdown map of the site for AI agents (llmstxt.org). */
export function renderLlms(published) {
  const section = (kind) =>
    published
      .filter((p) => p.kind === kind)
      .map((p) => `- [${p.h1}](${urlOf(p)}): ${p.description}`)
      .join('\n');
  return `# ${BRAND}

> ${BRAND} is legal drafting and practice management software for Indian advocates and law firms, built by Sirah Digital. It drafts notices, plaints, petitions and deeds in Indian court formats (84 built-in formats, plus any other document on request), tracks District Court and High Court cases through eCourts by CNR number, reviews contracts clause by clause, tracks limitation deadlines, and handles billing. Web and Android. ${OFFER.line} Data is stored in India.

## Product
${section('feature')}

## Guides
${section('guide')}

## About
${section('hub')}
- [Sign up](${ORIGIN}${SIGNUP})
`;
}
