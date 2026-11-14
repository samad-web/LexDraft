# PLAN — Open drafting: any legal document (approved 2026-11-08)

## Goal and scope
- Goal: an advocate can ask for any Indian legal document and get a complete, carefully checked draft, whether or not DifAi has a format for it. Match or beat a general AI and DraftBotPro.
- For: practising advocates, Tamil Nadu first, all-India law where it applies.
- Output must read and look as a practising advocate drafts it: same structure, phrasing and Word layout as our built-in formats and the firm's own formats, with no AI style.
- Out of scope now: drafting in Tamil or other languages; new built-in formats (demand log decides later); live database changes; deployment.

## Project memory that applies
- 84 built-in formats stay as the first choice when they truly match: they have engine rules and tests. Nothing waits on them.
- Sonnet 5.5 only. Testing through the Agent SDK, never the API. Never invent facts. Black and white UI. No live DB changes; this plan needs no migration.
- Deploy only on command. Live server needs a funded AI key; the current Anthropic key has no credit.

## Where this plan pushes back
- "Correct like ChatGPT" is too low a bar and not a guarantee. General AIs cite wrong sections and invent cases. This plan adds a blueprint, a review pass and code checks, and marks what could not be verified. An advocate must still check every draft.
- Beating DraftBotPro can only be claimed after scoring its real drafts.

## Features (detail: `features/open-drafting.md`)
1. F1 Router that can say "not on the list": no more wrong-format substitution.
2. F2 Open drafting flow: blueprint, draft, review, repair.
3. F3 Law and citation safety.
4. F4 Word layout per kind of document.
5. F5 Composer: honest label, points to confirm, citations to verify.
6. F6 Proof: 30 out-of-list briefs, blind scoring against a plain AI.

## Build order
F1 → F2 → F3 → F4 → F5 → F6. F3 needs F2's draft; F5 needs F2 and F3's notes; F6 scores the whole flow. Each feature is tested and committed on its own.

## Needs from you
- Approval of this plan.
- Optional, for F6: DraftBotPro drafts of 5 to 10 of the test briefs from its free plan.

---

# PLAN — Mobile app upgrade (approved 2026-11-03)

## Goal and scope
- Make the existing Capacitor Android app (Play 2.0.2, `in.sirahdigital.difai`) feel native and safe for client data: lock, push, offline reads, and three phone-first interactions.
- Same web bundle, same API. Capacitor plugins only where the WebView can't do the job.
- Out of scope: Flutter/RN rewrite (rejected 2026-11-03), iOS build, OneSignal, offline *editing*, case tags (no tag model exists), Play Billing (separate track), deploy.

## Project memory that applies
- Strictly black and white; red only as a button naming a mandatory issue → Limitation Ring is ink; red button only when ≤7 days.
- No live DB changes without approval → migration 0100 (device tokens) is additive and needs a yes before it runs on Supabase/prod.
- Play: 2.0.2 production is in review. Release decision (c): build now; ship APK 2.1 only after 2.0.2 is approved, so the review isn't reset. Nothing here touches payments, so it doesn't wait for Play Billing.
- Android WebView: no Web Speech, no inline PDF; OneDrive locks android/app/build (Gradle output already moved).

## Architecture (how it fits)
- Web: `apps/web/src/lib/native.ts` stays the single native entry; new `lib/app-lock.ts` and `lib/push.ts` loaded only when `Capacitor.isNativePlatform()`.
- Server: push rides the existing in-app feed. `notificationsStore.create()` (notifications.service.ts) → after insert, enqueue `push.send` (pg-boss) → FCM HTTP v1 to that user's device tokens. Every existing notification (eCourts sync summaries, co-counsel, eFiling) gets push for free.
- Limitation alerts: new daily pg-boss cron (09:00 Asia/Kolkata) creates notifications at 90/30/7/1 days, `dedupe_key = limitation:<id>:<n>`.
- Offline: TanStack Query cache persisted for an allow-list of read queries; cleared on sign-out.

## Feature list (prioritised) — one doc each in `features/`
1. **mobile-biometric-lock** — fingerprint/face/PIN gate on launch and resume.
2. **mobile-push** — FCM device registration + server send; tap opens the right screen.
3. **limitation-alerts** — 90/30/7/1-day notifications (needs 2 for the phone buzz).
4. **mobile-offline-cache** — diary, case timelines, recent drafts readable offline.
5. **limitation-ring** — dashboard ring widget.
6. **case-swipe-actions** — swipe a case card to archive / add hearing.
7. **draft-citation-sheet** — tap a citation in a draft → bottom sheet with the section text.
8. **launch-splash** — DifAi + Powered by Sirah Digital over an ink courtroom (user request 2026-11-03). Built.

## Build order
1 → 2 → 3 → 4 → 5 → 6 → 7. 1 and 4 together protect cached data (no offline cache without the lock). Each: implement, tests, run, regressions, docs, commit `feat(<name>): …`, APK smoke test on a device.

## Needs from you
- Firebase: add Android app `in.sirahdigital.difai` to Cloud project difai-513007, download `google-services.json`, and create a service-account key for FCM send (stored as a server secret, never committed).
- Approval for migration 0100 (`push_devices` table).
- Git: there is still no repo here, so the per-feature commits can't happen until one exists.

---

# PLAN — eFiling redesign in DifAi's design (approved 2026-11-03)

## Goal and scope
- Redesign the whole logged-in and logged-out eFiling experience (`/app/efiling`) in DifAi's Chambers design (`apps/web/src/styles/CHAMBERS.md`), organised the way an advocate works, not the way the portal's menus are laid out.
- Same data and behaviour: every screen still reads the advocate's live filing.ecourts.gov.in account; every portal action keeps its confirmation; captcha/OTP typed by the advocate; the portal → DifAi sync stays.
- Out of scope: API/service changes (only if a screen needs data it doesn't get today), new portal actions, the marketing site, the rest of DifAi, deploy.

## Project memory that applies
- Strictly black and white; red only as a button naming a mandatory issue (e.g. "Cure 1 objection"). Light + dark.
- 2026-11-03: eFiling fully in DifAi design; replaces the 2026-11-02 portal-copy layout (portal chrome clones go).
- No live DB changes; no test accounts; deploy only on "deploy".

## Feature list (prioritised) — detail in `features/efiling-redesign.md`
1. **Shell + navigation + Sign In** — PageHeader "eFiling" with a connection chip; `PillNav` sections; Sign In as a centred DifAi card.
2. **Overview** — stat cards (serif figures), "Needs attention" (objections as red named buttons), hearings calendar + today's listings, sync status.
3. **Filings** — one table of every filing (portal drafts, eFiled, completed pleadings, prepared in DifAi) with status chips, search and filters; a filing opens a side panel with Documents / Status / Court fee / Oath / History and the PDFs.
4. **Cases** — My Cases (group by district/date; pending/disposed), case detail, Search Cases, Planner, Import/Export.
5. **Forms** — New filing (stepper), Pleadings, Payments, Applications, Vakalat & Partners in one form system (sections, 2-column fields, one primary action).
6. **Cleanup** — remove PortalChrome, efiling-portal.css and portal-copy styling; shared pieces reduced to Chambers primitives.

## Build order
1 → 2 → 3 → 4 → 5 → 6. Each step: implement, update tests (UI selectors), run all eFiling suites, screenshot light/dark/phone, commit `feat(efiling-redesign): …`.

## Open question for approval
- Section names/grouping in feature doc §Navigation — confirm or adjust before step 1.

# Questions in the Draft box (approved 2026-11-10)
- **Goal:** a legal question typed in the Draft box gets a short answer, not an intake for a wrong format or a paid open draft. Test 2026-11-10: 0/12 questions answered (8 wrong intakes, 4 full open drafts).
- **Scope:** Draft box (DraftBotModal → start-auto) only. Out: a chat assistant, follow-up Q&A threads, answers inside an existing conversation.
- **Build:** one feature, `features/draft-box-questions.md`. Question-shaped text skips the keyword shortcut; the classifier flags a question; one answer call grounded on our law sources; UI shows the answer with an offer to draft.

# Check what's missing in the Draft box (approved 2026-11-10)
- User asked for a prompt enhancer; chose "show what's missing" over an AI rewrite (a rewrite can change facts). Button always available with text. Detail: `features/brief-check.md`.
# PLAN — SEO, AEO and click-through rate (approved 2026-11-13)

## Goal and scope
- Rank for what Indian advocates search, get DifAi quoted by AI answer engines, and earn the click when we appear.
- Out of scope: paid ads, a blog CMS, bulk AI-written articles, fake ratings, any API/DB change.

## Project memory that applies
- Domain is difai.sirahdigital.in only; GSC + Bing already verified; `#seo-static` live on `/`.
- Black and white UI; landing design untouched. Android app must not show marketing pages.
- Pricing v2 is pushed but not deployed, so the pricing page waits for it.

## Where this plan pushes back
- AI crawlers don't run JS: today they see one short block on `/` and nothing else. Prerendered pages come first.
- CTR is engineered and measured, not promised; it depends on rank first.
- Several landing claims may be untrue (200+ templates, direct e-filing, Hindi, 2026 language roadmap, Indian servers). AI engines repeat them. Confirm before we scale.

## Features (detail: `features/seo-aeo.md`)
1. F1 Prerendered public pages from one content file.
2. F2 Technical fixes: real 404s, robots for AI bots, llms.txt, per-page canonical/OG/breadcrumbs, generated sitemap.
3. F3 Content: 6 feature pages, pricing/faq/about, 5 advocate-reviewed answer guides.
4. F4 CTR: title/description rules enforced by tests, GSC baseline and 4/8-week rewrites.
5. F5 Off-site: profiles + mentions (you), copy drafted by me.

## Build order
F2 → F1 → F4 rules → F3 (feature pages first, guides after your review) → F5. Each tested and committed on its own.

## Needs from you
- Approval; answers to the claim check; training-bot choice; who reviews the legal guides.

---

# PLAN — Document protection beyond the server (approved 2026-11-14)

## Goal and scope
- Goal: documents stay protected after they leave DifAi (download, WhatsApp) and the server key is harder to steal.
- For: advocates sharing drafts and case documents with clients.
- Out of scope: encrypting typed case facts/notes in the database (option 2, user deferred); DRM (stopping a client who has the password from screenshotting or forwarding it).

## Project memory
- Builds on document encryption at rest (8e1a152, same FIELD_ENCRYPTION_KEY), WhatsApp share (372a7c2, f62cc44), signed storage links.
- No live DB changes without approval: feature 2 needs migration 0111 (additive, new table only).
- UI strictly black & white; red only for a mandatory issue.

## Features, prioritised
1. `features/key-lockdown.md`: key out of the app folder into a root-only secrets file; one offline backup held by the owner. Server only, no app change.
2. `features/protected-pdf.md`: "Lock with password" on Share/Download. AES-256 password PDF (qpdf) + "Confidential – for <client> – <date>" watermark.
3. `features/secure-share-link.md`: send a DifAi link instead of the file. Expires (default 7 days), can be revoked, optional password, view count.

## Build order
1 → 2 → 3. Each: tests, commit, push, deploy (2 and 3 rebuild api + web; 3 also needs 0111 approved).

## Needs from you
- Approve this plan.
- Feature 1: you store the key backup (password manager); I won't print it in chat.
- Feature 3: approve migration 0111 on prod when we get there.
