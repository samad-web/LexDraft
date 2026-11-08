# Project memory (LexDraft / DifAi)

## Decisions
- 2026-11-08 — Deadline alerts: limitations alert at 90/30/7/1/0 days (no "filed" status yet, user accepted); tasks alert by priority (very high 3/1/0/-1, high 1/0/-1, medium 0/-1, low 0). Bell always, email for limitation ≤7 days and high/very-high tasks. Job runs hourly 9-21 IST because pg-boss does not replay a missed cron. Push waits for mobile-push.
- 2026-11-07 — Live "Missing details" typing re-drafts on the engine only (compose:false: no model call, no hourly limit, no AI quota); "Update document" runs the model polish. User chose this over composing on every typing pause (up to 5 Sonnet calls each).
- 2026-11-07 — Efficiency: engine runs WEB_CONCURRENCY=2 workers (stateless: sign-offs re-read from disk); the drafting progress poll is exempt from the 600/15 min IP limiter (office NAT). Preview-PDF debounce dropped: conversion already runs only when the .docx changes.
- 2026-11-04 — Android app loads the live site (server.url, "server driven UI", user's choice) so web deploys reach Play users without a release. Trade-offs shown to the user and accepted: a bad deploy hits every phone at once with no rollback; no offline use (offline.html only); one forced sign-out on 2.2. Rejected: Capgo live updates (recommended), Play-only releases. Blocks mobile-offline-cache. Rule: ship a new native plugin in a Play release before web code calls it.
- 2026-11-03 — Judgments corpus code approved and committed (dbc14d2). Migration 0098 (and 0099) NOT applied to live DBs, JUDGMENTS_SEARCH not switched on in prod — those still need an explicit go. Uncommitted backlog cleared into per-feature commits.
- 2026-11-03 — Android app shows no purchase UI (Upgrade/See plans buttons, plan picker, Dodo copy, free-plan strip) via `isNativeApp()`; Plan & Billing is status-only in the app. Reason: Play payments policy until Play Billing exists. User said "proceed" without picking between hide-all and "manage on website" text; hide-all chosen as the safer option — revisit when Play Billing ships.
- 2026-11-03 — Mobile: stay on Capacitor (no Flutter/RN rewrite: ~50 screens would be duplicated and the live Play app re-done). Push via Google FCM, not OneSignal (no extra vendor holding client data). Release: build now, ship APK 2.1 only after Play approves 2.0.2; doesn't wait for Play Billing (no payment surface touched). Case "tags" dropped (no tag model exists).
- 2026-11-03 — Drafting: the advocate's own account counts as a source of dates and amounts (it was excluded, so typed dates came out as "[to be drafted]"). Model-invented figures are still stripped.
- 2026-11-03 — Drafting: the local INTAKE_MODEL is Sonnet 5.5, to match prod (it had been Haiku to save credit; the dev route via Claude Code costs no API credit).
- 2026-11-03 — eFiling redesigned fully in DifAi's Chambers design; may reorganise menus/screens. Replaces 2026-11-02 "copy the portal's layout". Reason: user's choice after being shown the conflict with the earlier portal-copy request.
- 2026-11-02 — eFiling stays black and white (user reversed the portal-colour request the same day).
- 2026-11-02 — eFiling login = one-step Sign In with the captcha shown on load; a new Sign In never ends a live session until the new login succeeds; unused Sign In pages close after 3 min.
- eFiling portal actions always need the advocate's confirmation; captcha/OTP typed by the advocate; DifAi never pays.
- 2026-11-07 r13 — HRCP own-occupation ground is pleaded by its words under s.21(2) with no clause letter and no verify note (clause numbering after TN Act 19 of 2022 unconfirmed).

## Constraints
- Strictly black & white; red only as a button naming a mandatory issue. Light + dark.
- Live Supabase: no schema/data changes without approval; no test accounts; tests roll back.
- Deploy only when the user says "deploy".

## Open questions
- none. (eFiling redesign plan approved 2026-11-03.)

## Known issues
- 2026-11-03 — Supabase is IO-throttled (2.2 s to count the 1,300-row judgments table). Cause: the embedding backfill plus judgment searches, which ranked most of the corpus per query. Searches are now capped (1,500 FTS candidates, NN-200 vector). JUDGMENTS_SEARCH=false locally until it recovers; the backfill is paused. Dev uses the live Supabase, so heavy corpus work hurts it.
- eFiling Overview tiles are still portal-style (light tiles in dark mode) until redesign step 2.
- 2026-11-08 (r14) - place fallback fills only signing/filing places (place, place_of_execution, execution_place, city, court_place, verification_place), never factual ones (accident_place, marriage_place); affidavit_kind is optional (engine-doc-contract.json needs regenerating).
