# Feature: SEO + AEO + click-through rate

Status: **F1, F2, F4 rules built 2026-11-13** (not deployed). F3: 6 feature pages + FAQ + About built; pricing page waits for pricing v2 deploy; 5 guides pending (user skims before publish). Decisions in MEMORY.md.. Earlier work: [seo-setup memory] GSC + Bing verified, sitemap submitted, `#seo-static` block on `/` (aa19242).

## Purpose
- Rank on Google/Bing for what Indian advocates search ("legal notice drafting software", "ecourts case status app", "limitation period calculator India"), not only for "DifAi".
- AEO: get DifAi named and quoted by ChatGPT search, Perplexity, Google AI Overviews, Claude and Gemini when advocates ask "best AI drafting tool for Indian lawyers".
- High CTR: when we show up, the snippet earns the click.

## What we have today (checked live 2026-11-13)
- Public site = **one page** (`/`). Everything else is a client-rendered SPA.
- Crawlers that don't run JavaScript (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, most AI engines) see only the `#seo-static` block on `/`, and nothing on any other path.
- Every unknown URL returns **200 + index.html** (e.g. `/llms.txt` → 200 text/html). Google files these as soft 404s.
- Title, description, OG image and JSON-LD (Organization, WebSite, SoftwareApplication) exist on `/` only.

## Push-back (needs your decision)
1. **CTR can't be promised, only engineered and measured.** It depends on rank position first: position 1 gets roughly 10x the clicks of position 8. Plan: write snippets built for clicks, then read CTR per query in Search Console after 4–6 weeks and rewrite the weakest.
2. **Landing claims that AI engines will repeat word for word. Please confirm or correct each:**
   - "200+ Indian-format templates". Memory says 84 built-in formats.
   - "Where APIs exist, we file directly". eFiling is a manual hand-off today.
   - "Hindi templates ship with the Practice plan". Practice is being renamed Chamber.
   - "Marathi, Tamil, Kannada, Bengali on the 2026 roadmap". 2026 ends in 7 weeks.
   - "On Indian servers", "on-premise for Firm tier". Need to confirm where the Hostinger VPS is located.
   - Tribunal list (NCLT, ITAT, …).
   Wrong facts in an AI answer are worse than no answer. Fix these before scaling content.
3. **Pricing page waits for the deploy.** Pricing v2 (b9f5ea9) is pushed but not live. A pricing page must show only live prices.
4. **What we will NOT do:** fake star ratings or `aggregateRating` without real reviews (Google penalty); bulk AI-written legal articles (Google's "scaled content abuse" policy, plus legal accuracy risk); keyword stuffing. Every guide gets an advocate review before it goes live.
5. **FAQ schema** no longer gives rich results for commercial sites on Google (since 2023). We still add it, because AI engines and Bing read Q&A, but it won't change how the Google listing looks.

## Architecture
### F1 Prerendered public pages (the foundation)
- No SSR server. A build step `scripts/prerender.mjs` runs after `vite build`. From one content file `src/seo/pages.ts` (title, description, h1, body sections, FAQ, schema), it writes `dist/<slug>/index.html` with real HTML in `#root`, so crawlers read the full content without JS.
- React mounts over it as it does today (the same pattern as `#seo-static`, removed on mount). Users see the same page.
- The nginx web container already serves `$uri/` before falling back to `/index.html`, so `dist/<slug>/index.html` is served with no nginx change.
- The `#seo-static` block moves into this system, so there is one source of truth.

### F2 Technical fixes
- Real 404: add an nginx `location` that returns 404 + `index.html` body for paths not in the known route list. Generated from the router's top-level prefixes; the SPA still renders its NotFound page.
- `robots.txt`: explicitly allow AI *search* bots (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Claude-User, Bingbot). Training bots (GPTBot, ClaudeBot, Google-Extended, CCBot) are **your call** (see questions).
- `/llms.txt`: a plain-text summary of DifAi plus links to every public page (an emerging AEO convention, cheap to add).
- Per-page `<link rel=canonical>`, OG and Twitter tags, `BreadcrumbList`.
- Sitemap generated from `pages.ts` with real `lastmod`. Drop `/signup`; a sign-up form isn't a search landing page.

### F3 Content pages (AEO + keyword SEO)
Each page leads with a 40–60 word direct answer (the part AI engines quote), then steps or a table, then FAQ, then CTA.
- **Feature pages (6):** `/legal-notice-drafting`, `/plaint-drafting`, `/ecourts-case-status`, `/contract-review`, `/limitation-calculator`, `/advocate-diary`.
- **Hubs:** `/pricing` (after the v2 deploy), `/faq` (FAQPage), `/about` (who builds it; E-E-A-T, Organization `sameAs`).
- **Answer guides, first batch of 5, all advocate-reviewed:** e.g. "How to send a legal notice in India (with format)", "Section 80 CPC notice format", "How to check case status by CNR number", "Limitation period for a money recovery suit", "Vakalatnama format for Madras High Court". Each cites its sections and carries `Article` schema with author, reviewer and dateModified.
- **Comparison (optional):** "DifAi vs ChatGPT for legal drafting". Only verifiable statements; no DraftBotPro page until we have scored its real drafts.

### F4 CTR work
- Titles ≤ 60 chars: keyword first, benefit second, brand last. Example: "Legal Notice Drafting in Indian Format – Free | DifAi". Descriptions ≤ 155 chars, ending in a concrete hook ("Free for solo advocates till June 2027").
- The one-line answer sits in the first paragraph, which is what Google often pulls into the snippet.
- Breadcrumbs instead of a raw URL in the listing; SoftwareApplication `offers` (price ₹0).
- Measure: a GSC baseline export now, a re-check at week 4 and week 8, and rewrite titles where CTR is below the expected CTR for that position.

### F5 Off-site signals (you do these; I prepare the text)
- Google Business Profile, LinkedIn page, Play Store listing; then I add `sameAs`.
- AI engines lean heavily on third-party mentions: Reddit r/LegalAdviceIndia answers, LinkedIn posts by advocates, listings on legal-tech directories, bar association newsletters. I can draft the copy.

## Impact map
- `apps/web/index.html`: the default head stays; `#seo-static` moves to the prerender. Risk: the Capacitor build must not ship prerendered pages (the `mobile` mode skips prerender).
- `apps/web/package.json`: the `build` script adds the prerender step. Risk: the Dockerfile build must run it too; checked in the docker build.
- `apps/web/nginx.conf`: the 404 rule. Risk: a missed SPA route would 404 on hard refresh. Mitigation: a test reads the route prefixes from App.tsx.
- `LandingView.tsx`: claim fixes only after your answers. Landing design untouched.
- `public/robots.txt`, `sitemap.xml`, `llms.txt`.
- No API or DB change. No migration.

## Edge cases and failure modes
- A JS-disabled visitor or crawler on `/app/*`: still disallowed, nothing private is prerendered.
- A user visits `/pricing` while signed in: React renders the normal page; prerendered HTML is replaced on mount.
- Hydration flash: the prerendered HTML uses the same fonts and colours (black and white) and is removed in the first effect, the same as `#seo-static` today.
- A legal guide goes stale (law changes, e.g. BNS replacing IPC): every guide shows its "Reviewed on" date, and old section numbers carry their BNS/BNSS equivalents.
- Title rewrites during a CTR test: change one page at a time so the effect can be read.

## Acceptance criteria
- `curl` of each public URL (no JS) returns its unique title, description, canonical, h1 and full body text.
- Unknown path → HTTP 404; every real SPA route → 200 on hard refresh (test covers all route prefixes).
- `robots.txt`, `sitemap.xml`, `llms.txt` serve with the right content types; sitemap lists exactly the public pages.
- JSON-LD on every page passes schema validation (parsed in a test; Rich Results Test spot-check after deploy).
- Titles ≤ 60 chars and descriptions ≤ 155 chars, enforced by a test over `pages.ts`.
- Android build contains no prerendered pages.
- After deploy: all pages submitted in GSC + Bing; CTR baseline recorded in TESTING.md.
