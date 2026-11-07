# Testing

## Mobile live web (2.2, versionCode 13) — 2026-11-04, Samsung via adb
- Pass: 2.2 opens the live site; the launch splash plays (Powered by Sirah Digital, courtroom), then the current welcome screen (no landing page).
- Pass: airplane mode → bundled offline.html "Can't reach DifAi / Try again".
- Pass: Play API access: `scripts/play-publish.mjs --status` lists tracks; 2.2 uploaded to internal, then production.
- Found: the phone's Play install was still 2.0.2 (Play-signed); a sideloaded build can't be updated by Play, so testers must uninstall first.
- Not run on device: Google sign-in, app lock, dictation, PDF download (unchanged native code; same web bundle as 2.1-preview.3).

## Dictate in the Android app — 2026-11-03
- User report: Dictate showed "Listening" but no text (WebView has no Web Speech API). Fix: useDictation uses the device recogniser via @capacitor-community/speech-recognition 7.0.1 on native; restarts per phrase until stop; silence keeps listening; mic refused exits; 3 real failures give up. Tests lib/__tests__/dictation-native.test.ts 4/4; web 70/70; tsc clean. 2.1-preview.3 (versionCode 12) installed; on-device speech check pending (user).

## W1 root cause + fixes — 2026-11-03
- Prod API log: `Claude API 400: Your credit balance is too low` on every intake extract → empty extraction → engine "not generated", no missing list → misleading "I need a little more". AI drafting was down for all users. Needs Anthropic credit top-up (user).
- Fix (uncommitted, see below): `isAccountFailure` + `AiUnavailableError` (lib/anthropic-client.ts); intake extract/classify rethrow on account failure; drafting routes → 503 `ai_unavailable`; app shows "AI drafting is temporarily unavailable"; draft error scrolls into view (was under the dock). Test: lib/__tests__/account-failure.test.ts 3/3; API intake/drafting/research/anthropic 200/200; web 66/66.
- W4 fix (uncommitted): `GET /research/status` → `{ ask }`; Research screen hides Ask Lex.AI and opens on Search statutes when false (older API → unchanged).
- Committed: 576b5d0 (mobile app). Backlog committed feature by feature, each verified in a clean checkout of its own commit (api+web tsc, api+web tests; engine pytest for the engine commit): 93d818b engine (1,679 pass), dbc14d2 judgments corpus, c2a62c0 drafting quality, e545c58 platform fixes, 6480f50 AI-unavailable/research/Draft fixes — api 63/63 files, web 9/9 at the top.
- Found while splitting: main had 3 failing tests (code committed without its tests: India-only phone, intake attachments); and intake/compose suites only passed with a real ANTHROPIC_API_KEY in .env (key pool read at import) — fixed with vi.hoisted dummy key.

## Mobile E2E re-run — 2026-11-03, 2.1-preview.2 (versionCode 11), same device
- Fixed + verified on device: N4 notifications sheet (bottom sheet, back/tap-outside close, stays on page); Draft keyboard (no autofocus on touch; dock + FABs hide while keyboard open); M12 (no Upgrade/See plans/plan picker/Dodo copy in the app; free-plan strip hidden); font size change no longer restarts the app (same pid, no relock; new size applies on next open). Web suite 66/66, tsc clean on changed files.
- W2 pass (Cause List PDF → Android share sheet). W3 pass (diary entry added then deleted; nothing left). L4 pass (user signed in with Google on this build).
- W4 fail (live): Ask Lex.AI → 501 "isn't configured on this deployment" — judgments corpus not live on prod (0098 / JUDGMENTS_SEARCH pending approval). Known gap, but the tab is shown to everyone.
- W1 fail (live): complete s.138 notice brief → no draft; generic "I need a little more… Submit again" with no missing-fact list (fallback path DraftBotModal.tsx:515 = engine returned not-generated with no outstanding labels). Message renders below the button, hidden behind the dock, no scroll-into-view; red tinted box. No saved draft left behind; intake session may remain server-side. Needs prod engine log check.
- New minor: diary form opens with matter suggestions already dropped over the label; picking a matter fills CNR with internal "TEMP-…" id; delete icon next to FAB; Court Fee "% of ₹" field shows "5" (too narrow), state defaults to Maharashtra; Mock Arguments says "open in Chrome" inside the app; Client Messages desktop split pane; Leads/Tasks are drag-only boards.
- Still needs the user: L11 (turn app lock off/on — fingerprint) and Dictate speech-to-text (voice). Not opened: Clause Bank (opened, no errors, not inspected), Sanhita, Physical Docs, Closed Matters.

## Mobile E2E on device (MOBILE-E2E-TESTS.md) — 2026-11-03, 2.1-preview, Samsung SM-E075F Android 16, live account
- Pass: L1 L3 L5 (first frame 0.55 s, prompt after splash) L6 L7 L8 L9 L10 · N1 N3 N5 N6 (tablet layout, no reload) · M1–M8 M10 M11 · R1 (recovers when online) R3 (no crash/ANR, 176 MB).
- Fail N4: notifications panel opens clipped under the top bar and can't be closed (back navigates instead; tap-outside/Esc do nothing; stays across screens). Cause: `.topbar` backdrop-filter makes the phone bottom-sheet's `position: fixed` resolve against the 60 px top bar.
- Fail: Draft composer autofocuses → keyboard on entry; bottom dock floats above the keyboard, covering the box and Attach.
- Fail (Play policy) M12: Plan & Billing shows Dodo/UPI checkout copy and a plan picker inside the Play app.
- Issues: changing phone font size reloads the app (fontScale not in configChanges) → state lost + relock; AI usage shows raw "0 / 1000000"; plan called Free / Trial / Solo in different places; duplicate add buttons (FAB + top button) on Cases, Clients, Tasks, Invoices, Documents; FAB covers filter chips; desktop wording on phone (Esc/↑↓ hints in search, "Click a day", "Drop a contract here", "Drag a card"); offline Cause List shows 0/0/0 counts beside the error; splash ceiling fade not visible on device.
- Not run: W1–W4 (live writes, no approval), L4/L11 (need user), Dictate speech-to-text (needs user voice), N2 partly (14 of ~25 menu screens opened).

## Mobile — launch splash (visual; scratchpad shoot-splash.mjs, 390 px frames at 0.25–2.9 s)
- 2026-11-03 - frames reviewed: Di → DifAi slide, dot drop, gavel strike, fans, Powered by Sirah Digital; gone by ~2.7 s. Fixed after review: floating fans (ceiling + long rods), dais box overlapping the advocate (now a step), hairline gap in drawn circles (dash 1.05). Web suite 66/66; tsc clean on changed files.
- Not automated: cold start on a device; lock prompt after the splash.

## Mobile — biometric lock (apps/web/src/lib/__tests__/app-lock.test.ts)
- 2026-11-03 - 10/10 pass (relock at 60 s, cold start signed in/out, PIN screen not counted as leaving, unlock ok/cancel/retry, no-screen-lock phone, turning off needs unlock, lock off, sign-out). Web suite 66/66; tsc clean on changed files.
- Not automated: on-device check (real prompt, back button exits, recents thumbnail blank on Android 13+). Do on the 2.1 APK.


## Drafting quality (suite of 46 briefs; scratchpad suite.mjs)
- 2026-11-07 - r9b (date + stated-placeholder fixes) graded: 13 Competes / 21 Close / 12 Not yet (r8: 12/22/12). r9 itself was void: the VS Code extension updated mid-run and ~20 AI calls failed. New Competes: amendment IA, permanent injunction (schedule filled), counter affidavit, written statement; ejectment Not yet -> Close (dates right). Regressions are compose falling back to the plain draft (contempt, DV, contested divorce), not the date change. Remaining: compose fall-backs vary run to run; extractor still misses some given dates (summary suit, consumer).
- 2026-11-06 - r8 (after 9c5cb58) graded: 12 Competes / 22 Close / 12 Not yet (r7: 9/19/18). "[to be drafted]" files 30 -> 9; no doubled "Crime No." or broken "pleased to To". New Competes: anticipatory bail, DV, substituted service, general notice; permanent injunction slipped to Close (schedule left as a gap). Top remaining: cause-of-action/lease dates set to the drafting date (ejectment, plaint, consumer); placeholders for facts the brief gave (district, deponent, court, schedule).
- 2026-11-06 - fixes for the 3 systemic r7 defects: compose restate pass now fills or names every "[to be drafted]" (compose test), shared relief_clause() for free-text prayers (5 cases), bail pipelines strip a "Crime No." prefix (service test). API 694 passed, 4 skipped; engine 1,738 passed in both copies. Live re-run + re-grade pending (dev stack needs a restart).
- 2026-11-06 - r7 graded (4 parallel senior-advocate reviewers, round-6 rubric): 9 Competes / 19 Close / 18 Not yet. Competes: contempt, O.39 R.2A, regular bail, s.138 notice, judicial separation, permanent injunction, RCR, transfer petition, s.106 notice. Top systemic defects: stray "[to be drafted]" in 30/46 drafts; placeholders for facts the brief gave; broken prayer sentences; "Crime No. Crime No." (anticipatory bail does not use bare_crime_no). Regressions vs r6: counter affidavit, contested divorce (Not yet); anticipatory bail, s.138 complaint, succession certificate (Close).
- 2026-11-05 - r7 (6 drafts in flight, worker pool; AI via Claude Code, no API credit): all 46 drafted in ~15 min. 33 engine+composed, 3 plain engine, 10 AI fallback.
  - Root causes of the 10 fallbacks: draft-now never re-sent its own pre-filled gaps (anticipatory bail, maintenance); a missing motion/quit date took the first date on record (mutual first motion, s.106); WS/counter with unanswered paras or no para count; extractor did not derive counts/categories the brief fixes (consumer purpose, MACT employment).
  - After fixes, re-runs r7b-r7e: 7 of the 10 now draft on the engine and compose (anticipatory bail, mutual first, s.106, counter affidavit, maintenance, consumer); WS and contested divorce draft on the engine but compose was rejected (plain draft). Still AI fallback: HRCP (demand-notice service date not extracted), MACT (claimed total != computed total; decision pending).
  - Tests: API 691 passed, 4 skipped (new: motion/quit date fill; first-call refusal re-drafts on the engine - fails without the fix). Engine: tests/service/test_para_reply_gaps.py (2), both copies.
  - 2026-11-06 MACT: claimed total != computed now pleads the computed total with a chat note (user's choice); r7i: engine+composed, para 8 and prayer both Rs. 87,10,000. API 693 passed, 4 skipped. Dev route broke after a VS Code extension update (old claude.exe path): now falls back to the newest installed extension (claude-code-dev test).
  - Regression found by the full engine suite: the blank (empty-format) counter affidavit / WS hung, because the gap-fill wrote 99,999 "not admitted" paragraphs for the blank's int sentinel. Fix: skip the gap-fill for the sentinel; test_blank_and_lawe_library passes.
- 2026-11-03 - r6 (Madras layouts + fixes; judgment search off) graded 44: 6 Competes / 18 Close / 20 Not yet.
  - Competes: anticipatory bail, counter affidavit, contested divorce, permanent injunction, succession certificate, s138 complaint.
  - Top defects: engine-route "[to be drafted]" holes and prayers that miss reliefs; wrong Date line; computable sums left blank; State or co-respondents missing; affidavits only noted.
  - Adjournment and general notice errored twice (transient start-auto failures; under investigation).
  - Fix since: a RESTATE pass (cut sentences are rewritten once without the untraced detail). Compose tests 26/26.
  - Test data cleaned: 199 matters / 747 fact_sheets rows for firm@lexdraft.com. 2 patta-writ matters kept (may be the user's own).
- 2026-11-03 - r4 graded by a senior-advocate reviewer: 6 Competes / 15 Close / 25 Not yet. Engine 1,570 passed (both copies). API 680 passed, 4 skipped.
  - Root causes fixed: the enum placeholder 500; raw enum codes in the plaint; account dates stripped; whole compose lost to a filled gap or a Rs. 0 sentinel; splice refused multi-line paragraphs; mutual divorce mis-classified.
  - Judgment search timed out during r4 because the embedding backfill was hogging the CPU. The backfill is paused for suite runs.
## eFiling (apps/api/e2e/efiling*.e2e.ts)
- 2026-11-03 - Sign In compact + State list fix: login-ui, efiling, multi-advocate 62/62. Repro on the dev site: State list empty only when /portal/states failed once (API restarting); now retried 30x every 2 s, and a final failure says so.
- 2026-11-03 - redesign step 1 (shell, sections, Sign In card): 189 passed, 1 skipped.
  - Failures found: the new section/screen tabs collided with the wizard's own tabs ("Applications" twice); tests now look for tabs inside the screen (`.efiling > section`). Old portal "Case Filing" menu step removed from the Dashboard test.
  - Screenshots light/dark 1440 + phone 360 reviewed: fixed wrapped PillNav clipping corner pills (rounded overflow) and the captcha row breaking at 360.
  - `E2E_SCHEME` / `E2E_WIDTH` added to efiling-login-ui for dark and phone shots.
- 2026-11-03 - portal Sign In + review fixes: 189 passed, 1 skipped (preview, on request only); DB rollback clean.
  - New: a second Sign In leaves a live session alone (multi-advocate); one-step Sign In wrong captcha -> retry, duplicate login -> logged in (portal flow).
- 2026-11-03 - Land Records government template: flow fixtures 11/11 (patta print now keeps a header the site's print CSS hides); mocked-API UI check: result shows the PDF page, not the parsed table.

## Drafting efficiency (features/drafting-efficiency.md) — 2026-11-07
- apps/api/src/middleware/__tests__/rateLimit.test.ts → apiIpLimiter: 3 new tests (polls don't consume the IP budget; polls answer after it is spent; only GET on the exact path is exempt). 7/7 pass.
- Mutation check: with the `skip` removed, 2 of the 3 fail (the third guards the other direction).
- Engine workers: uvicorn with WEB_CONCURRENCY=2 started 2 server processes; 6 concurrent /healthz → 200 ×6; /v1/doc-types → 200. Engine code unchanged, so pytest not re-run.
