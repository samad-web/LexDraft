# Testing
## Document encryption at rest — 2026-11-14 (features/document-encryption.md)
- `storage-encryption.test.ts` 8/8: on-disk file encrypted (no plaintext, magic header); download returns original bytes + type; fresh IV; legacy plaintext still opens; tampered file refused; wrong key refused; empty file; prod without key refuses upload and writes nothing.
- Regression: `storage.test.ts` 6/6; full API vitest 1043 passed, 1 failed: `anthropic-failover` xAI fallback, fails on HEAD too (no xAI key locally), unrelated. tsc clean on touched files.


## Share on WhatsApp — 2026-11-14 (features/whatsapp-share.md)
- New `whatsapp-share.test.ts` 7/7: case/hearing/invoice/document messages carry only the listed fields, skip empty ones, never notes or fees; wa.me text encoded and capped at 60,000; share sheet result passed through, fallback downloads + opens WhatsApp with the note. Existing `share-file.test.ts` 7/7.
- Web tsc 0. Full web suite: 216 pass / 4 fail (SEO + policy-pages tests, from uncommitted legal-pages work, not this feature) - see clean checkout result in the commit.


## Draft PDF on WhatsApp — 2026-11-12
- `share-file.test.ts` 7/7: Android app shares the cached PDF + note; dismissed sheet = cancelled; browser shares a PDF File + note; no file sharing / no Web Share / expired click activation = fallback (download + wa.me); AbortError = cancelled.
- Failures found: 2 test-side (Node has no FileReader; afterEach unstubbed it). Fixed in the test, no app logic change.
- Regression: full web vitest 90/90; tsc clean on touched files. Not tried on a real phone yet.

## Playwright full-UI suite — 2026-11-12 (features/e2e-ui-suite.md)
- Local web (`npx playwright test`): public project 26/26 green. Signed-in projects (app, mobile) not run: `.env.e2e` account (Play review) does not exist in the local DB; needs a local account.
- Play Store app on the user's phone (`-c playwright.android.config.ts`, 48 tests, ~65 min): 2026-11-13 two full runs, both 43 passed, 4 skipped (not in the account's sidebar), 1 failed (palette Back, below). Cleanup sweep green both runs. Web unit 169/169.
  - FAIL (real app bug, fixed in code, not deployed): hardware Back left the search palette open and navigated the page behind it. Fix: CmdK listens for `difai:back` like NotificationPanel. Stays red on the phone until a web deploy. Local regression test added in shell.e2e.ts.
  - FAIL (test, fixed): diary flow. Root causes, all test-side: MATTER is pre-filled (fill() now select-all + delete); MATTER's suggestion list covers the DETAIL label (fill DETAIL first; fill() verifies the value landed); keys sent while the keyboard opens are dropped (fill() waits for it); a failed `uiautomator dump` left the previous XML, read as the current screen (dump() deletes it first, retries, throws). Diary test alone: 1 passed (10.5 min incl. cleanup sweep).
- Test-side fixes on the way: topbar/dock/footer taps must not scroll (tapPinned); tree bounds include parts under overlays (safe area); no swiping with the keyboard up (it typed "666666"); never press Back to reset (leaves the app → app lock); a Python edit wrote a literal backspace into a regex.
- Live data: leftovers deleted by their own row buttons: task E2E-mwdag0ut, diary "…E2E-mwdcth6u", "…E2E-mwdd03b9", E2E-mwddf6k6 (by the sweep). Verified 2026-11-12: no E2E task, Court Diary back to the 3 real entries.

## Bar Council verification, phase 3 (rolls + recent-enrolment councils) — 2026-11-11
- `bar-councils.test.ts` 19/19: added Uttarakhand table (transferred advocate with two numbers), Rajasthan date list + batch rows, P&H PDF page (serial+number cell, wrapped name, address dropped), J&K CIS page (JK/number/year items, nearby name), and "every live/roll council has a lookup/source".
- Parsers on the real PDFs: P&H 112,561 / 112,561 number cells parsed; J&K 9,709 / 9,752 (99.6%; misses are odd rows). 18k P&H one-word names are genuine (the roll prints one name).
- Real import into the local DB (migration 0103 applied locally): 92 s, P&H 112,561 + J&K 9,709 rows; 3 random entries per council looked up by number: own name -> verified, wrong name -> name_mismatch. 72 names contain "@" = the roll's alias marker, no phones/emails stored.
- Live: Uttarakhand (359 entries) and Rajasthan (7,048 entries) - own name -> verified, wrong name -> name_mismatch, unknown number -> not_found.

## Bar Council verification, phase 2 (live councils) — 2026-11-11
- `bar-councils.test.ts` 15/15: added 2-digit years (KAR/123/85 = 1985), glued prefixes (MS1234/2019), alphanumeric prefixes with padded numbers, exact match for unparseable numbers, inactive statuses (Death, Retired, Voluntary Suspended, Transfered, Non practice), and parsers for Karnataka JSON, Gujarat {Data}, AP HTML table (fixtures shaped like the real replies, made-up people).
- Live check against the councils (one real roll entry per council held in memory, nothing stored): Karnataka own name -> verified, wrong name -> name_mismatch; Gujarat same; AP own name -> inactive (entry listed "Died"), wrong name -> name_mismatch.
- Found: Kerala's directory returns 405 to any non-browser client and MP's firewall blocks automated POSTs; both left as "no automatic check" (not worked around). UP's reply showed no result table for test numbers, so UP stays "coming soon".

## Bar Council verification, phase 1 (Tamil Nadu) — 2026-11-11 (features/bar-council-verification.md)
- New `bar-councils.test.ts` 8/8: enrolment parsing/equality (prefix, leading zeros, separators, year), name matching (initials, titles, run-together, different person rejected), TN payload reading (list and `{record}`), verify only on number + name, nameless row proves nothing, council list sanity. Passed first run.
- Live page dry run (bctnpy.org, nothing submitted, no OTP sent): every selector the service uses exists; search defaults to "Enrolment Number".
- Not run: a real end-to-end TN check (needs a real enrolment number + the advocate's phone for the council's OTP). The council's result keys (fullName, bcteno, bcteDate, status) come from its page code, not a live response.
- Regression: API unit 882 pass / 1 fail (`anthropic-failover`, pre-existing, see 2026-11-10); web tsc 0.

## Co-Counsel lockdown — 2026-11-10 (features/co-counsel-lockdown.md)
- New `co-counsel.integration.test.ts` (local PG16, throwaway schema): 13/13 — AC1 guest gets no firm-A case/document/client via firm-scoped services, guest view shows shared notes only, other case 404; AC2 forwarded link refused for another verified number (incl. new-account path: no stray account); AC3 existing user accepts onto own firm, single use; AC4 revoke → case page/list/chat gone, firm member unaffected, only requester/head; AC5 leave; AC6 chat from grant date only; AC7 expiry; AC8 cross-firm existingUserId → 400; AC9 teammate handoff unchanged.
- `co-counsel.service.test.ts` 12/12 (incl. `assertClaimant`). Passed first run; no logic fixes needed.
- Regression: API unit 874 pass / 1 fail (`anthropic-failover` xAI case — uncommitted anthropic-client.ts change, not this feature); API integration 62/64 (0042 migration not idempotent; signUp role=group tier 'Firm' vs 'Practice') — both unrelated, see clean-checkout check below; web 79/79 (untracked e2e/landing.spec.ts picked up by vitest).
- Clean checkout of ddad447: API unit 875/875, web 79/79, web tsc 0. The 2 integration failures also fail on parent cf59a82 (pre-existing). Clean tsc caught 2 type errors in the new integration test (destructuring a possibly-undefined row); fixed in the follow-up commit, 13/13 still pass.

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
- 2026-11-08 - r16 (after 8efbbe4) graded 76 Competes / 6 Close / 1 Not yet of 83 - same count as r15 but different formats slip each run (AI extraction/compose variance: SLP impugned date missed, DV fell back to the plain skeleton, indigent schedule dropped, execution employer, specific performance refund, criminal revision 5(a), substituted service affidavit prayer). Every format except indigent_application has reached Competes in at least one round. Test rows cleaned (1,930).
- 2026-11-08 - r14 71/10/2 (run-to-run variance + 4 real bugs) -> fixes 945785b (deterministic place fallback, lettered grounds, payment mode, ejectment schedule, call-for-records case, HRCP classifier) -> r15 graded 76 Competes / 7 Close / 0 Not yet of 83. HRCP own-use clause left uncited on purpose (post-2022 s.21(2) lettering unverified). Last 6 handed to one agent.
- 2026-11-08 - r13 (after wave 3, 4 agents; ea3c9d2) graded 83 formats: 72 Competes / 11 Close / 0 Not yet (r12: 48/32/3). No draft contains a bare "[to be drafted]" (settleGaps + RESTATE after REPAIR). Last 11 (amendment IA, batta, s.256, succession certificate, writ petition, call-for-records, HRCP, consumer (regressed), condone delay, indigent, s.80) handed to one agent. Engine 1,957, API 716 passed.
- 2026-11-07 - r12: suite widened to all 83 drafting formats (46 + 37 deeds/court forms; briefs-all.json). After waves 1-2 (8 parallel agents, merged b215b8c) graded 48 Competes / 32 Close / 3 Not yet. Merge lessons: regenerate engine-doc-contract.json once after merging (separate regenerations merged textually and dropped fields -> r11 type errors); MACT 500 on unset dependants fixed. Wave 3 (4 agents) on the remaining 35.
- 2026-11-07 - r10 (2 repairs, retried splice, dates sweep) graded: 12 Competes / 24 Close / 10 Not yet; 42/46 composed (r9b 39). Not yet 12 -> 10 (contempt, maintenance, summary suit up). Anticipatory bail was dated with the offence-date stand-in (application_date unset): fixed, re-drafted r10b dated today -> Competes again, so 13/23/10. Still flipping run to run: contested divorce (plain draft), amendment IA.
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
- Live edits engine-only: intake.service.test.ts +2 (compose:false skips compose; never falls back to the AI draft when blocked), routes/__tests__/drafting-engine-only-edit.test.ts +2 (only compose:false + draftNow:true skips the limiter). 55/55 in the intake suites; mutation check: reverting either service change fails its test. LiveDetailsPanel: typecheck only (web has no DOM test setup).
- Civil-suit review (2026-11-07): engine tests/service/test_civil_suit_review.py +22 (one per defect, drafted from the suite briefs via /v1/draft); goldens updated for plaint, summary_suit, ejectment, specific_performance, consumer_complaint, indigent_application (intended text only); test_plaint interest tests updated (no longer 'statutory'). Engine 1760 passed; API vitest 705 passed; tsc clean.
- 2026-11-07 - r13 fixes: engine tests/service/test_r13_competes.py +12; API intake-compose +3 (labels in order, no estimated delay, account numbers). Updated (decision change, not weakening): hrcp own-occupation tests in test_r12_civil_quality / test_phase3_coverage (no clause (g) / verify note), indigent R1/R2 string (adds parentage gap), s80 bare-ground test (no-notice facts state the ground; unknown ground stays a gap).
- 2026-11-08 - r14 fixes: engine tests/service/test_r14_competes.py +8 (1977 pass; ejectment golden updated for the schedule); API +7 (engine-field-map place/flags, intake-compose lettered grounds, dated gaps, registration, plaint count) - 726 pass, tsc clean.

## Deadline alerts (features/limitation-alerts.md, task-alerts.md) — 2026-11-08
- apps/api/src/services/__tests__/deadline-alerts.test.ts: 10 pass (limitation days 90/30/7/1/0 only; each task priority fires on exactly its days; tones + email flags; IST date at 00:30 IST; owner vs firm-admin recipients; a second run the same day sends nothing).
- Both alert SELECTs run read-only on the local dev DB (PG16): valid on the real schema (1 limitation due locally).
- 2026-11-08 - r16 checklist fixes: engine tests/service/test_r16_checklists.py 15 tests (test_<format>_<item>, one per FAIL item); goldens permanent_injunction, divorce_mutual_first, s138_notice_single_cheque regenerated (intended wording only); 2020 pass. API: test_writ_petition_dated (replaces the r10 "[day to be provided]" assertion, user's r16 decision) - 749 pass, tsc clean.
- 2026-11-08 - r17 checklist fixes: engine tests/service/test_r17_checklists.py 5 tests (test_<format>_<item>); r16 writ asserts updated to the new period wording; goldens s138_complaint, s138_complaint_tn_full regenerated (limitation para only); 2025 pass. API: r17 must-plead block +5 - 753 pass, tsc clean.
- 2026-11-08 - b1 criminal checklist fixes: engine tests/service/test_b1_checklists.py 22 tests (test_<format>_item<N>, one per FAIL; appeal item10 pins Art. 115(b)(i) for the High Court and (b)(ii) for Sessions); asserts that pinned the leftovers (him/her for a Mr. accused, 'the sureties is', 'C.C. / Crime No.', unmarked inferred quash sections) updated; 8 tn goldens regenerated (reviewed: only the b1 changes); 2048 pass incl. template drift. API: withBriefSignals +2, quash must-plead +1 - 756 pass, tsc clean.
- 2026-11-08 - b3 checklist fixes: engine tests/service/test_b3_checklists.py 14 tests (test_<format>_item<N>, one per FAIL item); goldens divorce_contested_cruelty, judicial_separation, restitution_conjugal_rights, maintenance, dv_application, mact_claim_death regenerated (intended wording only). API: b3 must-plead block +7 - 760 pass, tsc clean. Engine 2038-2040 pass; full runs show 1-2 different flaky fails in untouched formats (r17 writ item10, round6 transfer_petition affidavit, criminal_appeal arrays), each passing alone.
- 2026-11-08 - b4 checklist fixes: engine tests/service/test_b4_checklists.py 9 tests (test_<format>_item<N>); r13 batta test updated (unknown side is now a named gap, not Plaintiff - requirement changed); tn_forms copy-application asserts now expect the named rule gap; goldens general_notice, tn_coding_sheet_original/criminal, tn_copy_application, tn_summons_civil regenerated; 2035 pass. API untouched.
- 2026-11-08 - b2 civil checklist fixes: engine tests/service/test_b2_checklists.py 27 tests (test_<format>_item<N>, hrcp 6 skipped by decision); r10 condone-delay affidavit assert moved to first person (it pinned the third-person slip); goldens ejectment, indigent, o39_r2a, slp_civil, slp_criminal, specific_performance, substituted_service, adjournment regenerated (intended wording only). API: b2 block +3 (settleGaps qualified gap, whole-citation strip, must-plead) - 756 pass, tsc clean.
- 2026-11-08 - r15 fixes: engine tests/service/test_r15_competes.py +28 parametrised (every r12-r15 wording; 1996+ pass); API +7 (intake-compose r15 block, engine-field-map affidavit authority) - 733 pass, tsc clean.

## Contract Review provider — 2026-11-08
- apps/api/src/services/__tests__/review-provider.test.ts: 4 pass (default stays on Claude; openai + key calls only OpenAI and logs provider openai; openai without key fails and calls no model; REVIEW_PROVIDER beats a request asking for Anthropic). Mutation check: removing the missing-key guard fails test 3. No live API call (testing rule).
- 2026-11-08 - b1-b4 v2 checklist fixes: engine tests/service/test_b_v2_checklists.py (test_<format>_item<N>, one per FAIL item, plus the writ detenu doubling); updated by changed requirement: test_plaint contractual-without-document (needs facts stating an agreement now), test_civil_suit_review 18% (rate claimed), b2 SLP index (impugned judgment is P-1), bail-forms surety documents (joined with 'and'); goldens regenerated for the supporting affidavits, 18-month line, SLP index, MACT indemnity, s.106 wording, s.138 reply. API: correctLawSlips (s.106 month-end, interest-as-principal), settleGaps stubs, withBriefSignals backfills, must-plead lines.

## Choice fields no longer refuse a draft — 2026-11-08
- `tests/service/test_enum_tolerance.py`: 15 passed. Blank/off-list divorce basis derived from the stated places, gap when none is in the court's town, valid values kept; DV category read from the incident.
- Full engine suite 2133 + 7 passed after a test-only fix (wrong line match). API 803 passed; 1 failure is `anthropic-failover`, caused by another session's uncommitted `anthropic-client.ts`.

## Last checklist re-drafts — 2026-11-08 (Claude Code route)
- Re-drafted: divorce_contested, dv_application, counter_affidavit, s138_complaint, writ_petition. All on the engine, none on the AI fallback.
- Rechecked only the failed items, plus the added facts the reviewer listed: divorce 13, DV 14, counter 4 and 13, s138 11, writ 13 pass. No full re-score by an independent reviewer. Drafts: `benchmark-h2h/difai-v4/`.
- Counter-affidavit `stance` was a third case of the same refusal: `test_enum_tolerance.py` now 18 passed; engine service + pipelines 1405 passed; API 804 passed, 1 failure (`anthropic-failover`, another session's uncommitted edit).

## Attached formats: blanks fit their sentence — 2026-11-08
- `test_attached_format_fit.py` 14 passed, `blank-sentence.test.ts` 4 passed. Engine 2157 passed; API 808 passed, 1 failure (`anthropic-failover`, another session's uncommitted edit).
- Word formats re-run on the Claude Code route (`benchmark-h2h/attached/v2/`): all 5 drafted; figures, ordinals, typed clause numbers, subject line and demand sentence now correct. Left: RTI addressee still repeats "Public Information Officer"; compromise heading "THE DISTRICT MUNSIF COURT". Read by me, no independent re-score.
- PDF/scan NOT tested: the first of 3 permitted API reads was refused by Anthropic (400, credit balance too low on the local key), so the run stopped. Samples ready in `benchmark-h2h/attached/formats-scan/`; runner `attach-scan.mjs`.
- PDF/scan/photo now tested on the Agent SDK route, no API (`benchmark-h2h/attached/scan-v1/`): digital PDF, scanned PDF and JPG photo all drafted; facts, figures, ordinals, typed numbers correct. Not covered: the production API read path (needs key credit).
- Slip fixes re-drafted (`attached/v3/`, suite-fix1): compromise heading, RTI repeat, s138_reply capital and place, hrcp para 12, general_notice para 6 all clean; condone_delay and indigent keep their named gaps. maintenance now asks the advocate to confirm "not living in adultery" (composer's choice, varies by run). Engine 2161 passed; API 812 passed, 1 failing (`anthropic-failover`, another session's uncommitted edit).
- OpenAI backup for the format reader, real run with Anthropic refusing for no credit (`benchmark-h2h/attached/api-read-v1/`): digital PDF, scanned PDF and JPG all read on gpt-5.5, engine check ok, 0 problems. Found: letterhead read as fields; reader prompt now forbids it (not re-run on OpenAI, call limit reached). Anthropic's production read still untested (no credit; count_tokens refused too). API 816 passed, 1 failing (`anthropic-failover`, another session's uncommitted edit).
- Open drafting F1 (picker): real routing check on the Agent SDK route, 83 known briefs + 30 out-of-list briefs: 113/113 (the two recall-warrant labels name the same document and count as one). Older wrong-picks fixed: warrant of arrest, default bail, application for issue of summons. Habeas corpus and promissory-note recovery are built-ins, so test briefs corrected. Unit: `intake-keyword-guess`, `intake.service`. API 830 passed, 1 failing (`anthropic-failover`, another session's edit).
- Open drafting F2 (flow): unit `open-draft.service` 13 tests (blueprint, style model, repair, cut-off continuation, bad JSON, forgery refusal, follow-up, fill-in blanks kept). Real samples on the Agent SDK route: family settlement, partition suit, s.34 petition, NDA, minor executant, IPC-after-2024 complaint all drafted in 100 to 220s. Traps caught: old code moved to BNS with a warning; minor executes through a guardian with a warning. Bug found and fixed: markdown cleanup was removing fill-in blanks.
- Open drafting F3 (law safety): unit tests in `open-draft.service`, 20 passing: memory-recalled judgments removed even with a citation, listed ones kept unmarked, unconfirmed provisions listed with their Act, invented dates and figures sent to repair then reported, misnamed Acts sent to repair. Real-draft check is in F6.
- Open drafting F4 (Word layout): `test_compose_docx` 7 passing: deed laid out as a deed, notice closing not a heading, no kind / pleading / unknown kind keep the court layout.
- Open drafting F5 (screen): real browser run, light and dark: label and notes show after drafting and with the popup closed; preview renders the document. Unit: `open-draft-note` 4, reopen via `load` makes no model call. Web 74 passed (`e2e/landing.spec.ts` is another session's Playwright file picked up by vitest). Known limit: browser reload clears unsaved drafts, as for every format.
- Open drafting F6 (proof), `benchmark-h2h/open-drafting/`: 30 briefs for documents with no format, checklists written before any draft, marked by three reviewer agents from memory of the law. Round 1 blind against a plain one-shot AI on the same model: DifAi 243/264 (92.0%), plain 245/264 (92.8%), invented facts 32 vs 53, wrong law 16 vs 13, reads like an advocate 28 vs 26 of 30. Root causes fixed: today's date written as the document date and allowed by our own check, inferred places, computable figures bracketed, saved limitation pleaded, sub-section slips, wrong notes. Round 2, same 29 briefs, DifAi marked alone (not A/B): 240/253 (94.9%) vs plain 92.9%, invented facts 6 vs 49, invented judgments 0, wrong law 15 (mostly in advocate notes) vs 13, reads like an advocate 28 of 29. Not met: zero invented facts, zero wrong law. Picker: 1 wrong pick in round 2 (declaration suit), fixed; then 30/30 three runs and 83/83 known. declaration_suit re-drafted, not re-marked. API 853 passed, 1 failing (`anthropic-failover`, another session's edit); engine full suite passed.
- Attached formats on Anthropic with the new key, OpenAI backup off (`benchmark-h2h/attached/api-read-anthropic/`): digital PDF, scanned PDF and JPG all read on claude-sonnet-5-5 in 11 to 19s, engine check ok, 0 problems. Letterhead kept as printed text, reference pattern "SA/{{ ref_no }}/20__" kept, typed clause numbers kept. Open point: the compromise memo's terms became a list, so the printed costs clause may not be numbered 4 (the reader flagged this itself). Reads only; no draft built from them.
- Attached formats, full drafts with the latest code on the Agent SDK route (`benchmark-h2h/attached/v4/`, `scan-v2/`): all 8 drafted (5 Word, typed PDF, scanned PDF, photo) in 26 to 49s. Every fact from each brief in the right blank; figures, ordinals and typed numbers right; compromise heading and costs clause right; RTI repeat gone; letterhead kept. Left: blanks are marked three ways ("____", "[DATE TO BE CONFIRMED]", "[... to be provided]").
- Blank styles: a stand-in date now reads "[date to be provided]" (was "[DATE TO BE CONFIRMED]"), the same style as every other gap, so the screen's missing-details check catches it. "____" stays only where the format itself prints a hand-filled line. `intake.service` 54 passed; API suite as before.
- Deploy 2026-11-10: the server engine image runs Python 3.11 and failed to start on a 3.12-only f-string (backslash in an expression) in `adjournment_petition.py` from 6363125; local dev runs 3.14, so tests never saw it. Fixed, and `test_py311_syntax` now fails on any such f-string (checked failing before the fix).

## Questions in the Draft box — 2026-11-10 (Claude Code route)
- Unit: intake 64/64 (question answered, no matter; brief flagged as question still routes; "Can you draft …?" drafts; looksLikeQuestion 7 cases), open-draft 24/24 (answer: judgment removed, unconfirmed provision listed; confirmed one not), web QuestionAnswerNote 2/2.
- Live (local API, Agent SDK): 12/12 questions answered, 0 matters created (before: 0/12, 8 wrong intakes, 4 paid open drafts). Spot-checked law: BNSS s.482, CPC s.148A 90 days, A&C s.34 3 months + 30 days, TN Court-Fees Act s.37 — correct; promissory note answer hedges on the Article number.
- Regression: route-check 113/113 (83 known + 30 open). Full API 865 pass; 1 fail = anthropic-failover, caused by another session's uncommitted anthropic-client.ts. Web 76/76.
- Found during the run: the dev API was serving stale code until the stack was restarted (OneDrive tsx watch).

## Check what's missing — 2026-11-10 (Claude Code route)
- Unit: check-brief 5/5 (label kept to list, ≤6 trimmed items, question → none, no-rewrite + injection rule in prompt, non-JSON safe); BriefCheckNote 3/3.
- Live: 4 briefs (s.138, loan notice, sale deed, a question) → right document, concrete missing facts, none already given; ~12 s each.
- Regression: API 870 pass (1 known anthropic-failover fail from another session's uncommitted anthropic-client.ts); web 79/79.
- 2026-11-11 - Land Records sketch + Tamil fix: flow fixtures 12/12 on Playwright's headless shell AND full Chromium (CHROMIUM_PATH, as prod). New: single-use sketch PDF is kept byte-for-byte, served once.
- 2026-11-11 land-records e2e 13/13 (headless shell + full Chrome); new: blob-embedded sketch window -> exact PDF.
- 2026-11-11 land-records e2e 14/14 both browsers; new: trailing blank page trim (checked on a real Patta print: 2 -> 1 page).
- 2026-11-11 land-records e2e 15/15 full Chrome (14 + 1 skipped on headless shell: embed needs a PDF viewer); fixtures now page-level routes.
- 2026-11-11 ai-cost-efficiency: `intake-effort.test.ts` 7 pass (effort low for classify/phrase on CLI and API; extract and checkBrief send none; switch off sends none; pre-5 models send none; gpt-5.5 priced $5/$30). Quality gate, dev route, 12 briefs b1–b4, default×2 vs tuned: classify 12/12 same, phrase 24/24 questions; extract at medium lost `case_ref` on recall_petition (cc_no took the full ref) → extract kept at default. API 900 passed, 1 failing (`anthropic-failover`, another session's uncommitted anthropic-client edit).

## Pricing v2 phase A — 2026-11-11
- `apps/api/src/services/__tests__/pricing-v2.test.ts`, 17 tests, all pass. They cover AC1 (intake counted once; a new doc counts; gathering/refused don't; DB insert ignores a repeated key), AC2 (Solo #51 refused with reset date), AC3 (free 30), AC5 (seats 5 → add-on qty 3; seats 2 → no add-on; webhook qty 3 → seats 5 + MRR; unknown add-on keeps seats), AC6 (1, 9 and 2.5 → 400; fewer seats than members → 400) and AC8 (API prices/GST/limits; web SIGNUP_PLANS equals billingPlans()).
- `billing.test.ts`: the Practice yearly price assertion was changed from 3999 to 2399. The price changed on purpose; the test was stale.
- Full API suite: 917 pass. 1 failure, `anthropic-failover` "answers from xAI", comes from other uncommitted work in `anthropic-client.ts`, not this change. It was checked in a clean worktree (see CHANGELOG).
- Not automated: AC4 (redraft/review/ask/research never call `countIntakeDraft`; checked by grep), AC7 (the migration only lowers the floor function; the trigger only raises seats), AC9 and AC10 (UI: the meter is on /app/billing, Android shows it without buy buttons).


## Back across tabs — 2026-11-12
- Unit: `apps/web/src/hooks/__tests__/useUrlTab.test.ts` (4) — tab read from ?tab=, default when absent, unknown ignored, custom key (?mode=). Pass.
- Browser (Playwright, mocked API): Settings Account→Letterhead→Privacy, then Back ×3 → Letterhead, Account, previous page; Land Records Services→My applications, Back ×2 → Services, previous page. No page errors.
- Regression: web vitest 14 files / 83 tests pass; tsc clean.

## SEO pages (F1 prerender, F2 technical, F4 CTR rules) — 2026-11-13
- `apps/web/seo/seo.test.mjs` + `claims.test.mjs`: 79 pass. Covers title ≤60 / description 120–155 / answer 40–70 words, canonical + single h1 + JSON-LD per page, sitemap = published pages only, llms.txt, 404 noindex, every App.tsx route prefix still served the app shell, no slug swallowed by an SPA route, landing links every page, Android build skips prerender.
- Failures found: 5 descriptions over 155 chars (Google truncates) → rewritten.
- Real nginx 1.27 in Docker against a real build: 13 SPA routes 200, 8 pages 200, `/nope` and `/wp-login.php` 404, llms.txt text/plain, sitemap text/xml. Found and fixed: `/faq/` was 404 → 301 to `/faq`; the 301 used an absolute http URL (would double-hop behind TLS) → `absolute_redirect off`.
- Landing footer link → `/faq` does a full page load (not swallowed by React Router). Phone 390px: no horizontal scroll.
- Full web suite: 169/169.
- 2026-11-13 guides (F3, drafts): CTR + render tests now run on drafts too; each guide must cite India Code / eCourts sources, show Last checked + Report it, carry Article schema, and link a real DifAi page. Failure found: Section 80 and cheque bounce guides linked no DifAi page → links added. Web suite 204/204.

## Razorpay billing — 2026-11-13 (features/razorpay-billing.md)
- `razorpay-billing.test.ts` 25 tests: AC1/AC4 checkout plan + seats + GST amount, plan reuse, invalid/below-member seats, owner-only; AC5 plan change (start_at, replaces, cancel at cycle end); AC1/AC3 webhook plan/seats/MRR/renewal, first charge not a renewal, later charge renewed, AC2 redelivery no-op, unknown plan skipped; AC7 halted, cancelled keeps paid time, ended Solo back to free, old replaced sub ignored; pay page + callback signature; AC9 test key ignored in prod. All pass.
- `billing.test.ts` (Razorpay webhook signature) 5 + `pricing-v2.test.ts` 8: pass. Dodo-only tests removed with Dodo.
- Full API suite in a clean worktree: all pass (see commit).
- Test-mode run with the owner (2026-11-13), local app + tunnel: Solo ₹1,499 and Chamber 3 × ₹4,599.64 paid with UPI success@razorpay; checkout return worked. Chamber run 3: webhooks 200, firm -> Practice active, 3 seats, renews 13 Dec, MRR 3,898, one `subscription_active` event (first charge not counted as renewal).
  - Found: webhook saved without a secret -> Razorpay sends unsigned events, and its RETRIES of those stay unsigned even after a secret is added (signature fixed at event creation). Fix = set the secret when creating the webhook; stuck test subscriptions cancelled and re-bought. Added a log line saying which signature part is missing.
  - Found: two checkouts paid before the first was confirmed -> two live subscriptions. Fix: the newest wins, the other is cancelled at once (refund in dashboard); a late retry for the older one never switches the firm back. 4 tests added (razorpay-billing.test.ts now 29).
  - Run 2 (2026-11-13): Solo bought for a second practice -> active; upgrade Solo -> Chamber took a ₹5 refundable authorisation, new subscription authenticated to start 13 Dec, firm stayed on Solo until then; cancellation -> access kept to 13 Dec. Razorpay doesn't show the end-of-cycle cancel in the subscription's fields, so a safety net was added: when the new subscription activates, the replaced one is cancelled at once (test added, 30 in razorpay-billing.test.ts).
  - Failed payment could not be produced in test mode (Razorpay approved every UPI Autopay mandate whatever ID was typed); covered by unit tests only.
  - Web: "Payment received" banner tick icon was stretched into a black bar (.cm-notice > span flex:1 hit the icon); fixed.
  - Test subscriptions cancelled in Razorpay; both local test practices reset to Free.

## GST invoices — 2026-11-13 (features/gst-invoices.md)
- `gst-invoices.test.ts` 14 tests: AC3 GSTIN checksum (Sirah's valid), place of supply order, CGST+SGST vs IGST adding to the paisa, FY switch at 1 Apr IST, amount in words; AC1/AC2 numbering DIF/26-27/000007 in one transaction, redelivery no-op, lost race rolls back, out-of-state GSTIN -> IGST; webhook charged -> invoice for payment.amount; AC4 every GST field in the PDF HTML + escaping; AC5 other firm's id not found; AC6 no seller config -> nothing written. All pass.
- Real PDF rendered with Chromium from the template and checked by eye (sample in OneDrive: "DifAi Sample GST Invoice.pdf").

## Pricing v4 catalogue — 2026-11-13 (features/pricing-v4.md)
- `pricing-v4.test.ts` 28 tests: AC1 catalogue = v4 table, web SIGNUP_PLANS mirrors it; AC2 every plan × cycle × advocates (2-8) × munshi (0-3) amount, Razorpay plan created for the exact amount with Munshi seats stored, bad munshi refused; AC3 webhook takes plan/tier/advocates/Munshi from the Razorpay plan only (notes ignored), Solo tier for individual plans, pre-v4 plans skipped; AC4 seat checks (Munshi seat or spare advocate seat; invites; accept not double-counted); AC5 invoice line; AC6 onboarding: Free refused for new accounts, kept for free-launch, Vakalat 30-min window + ₹399 checkout, Associates 3+1 = ₹2,096, payments off -> 503 with no writes.
- Existing tests moved to v4 ids: razorpay-billing (+1: lapsed plan of a new account is cancelled, never free), billing, gst-invoices (webhook fixture), pricing-v2 (plan-card block superseded).
- Migration 0107 applied to the local DB: 40 free firms marked free_launch; seat-check SQL run on the real DB. Found: `invitations.id` is text, the uuid cast failed -> fixed before commit.
- Full API suite in a clean worktree: 978 passed, 0 failed; API + web typecheck clean.

## SEO /pricing page + pricing v4 switch — 2026-11-14
- seo.test.mjs: CTR rules run on both `V4_LIVE` settings; V4 prices/pages/Munshi/seat range match `apps/api/src/lib/plans.ts`; /pricing is a draft exactly while v4 is off; after v4 no page says "Free for solo advocates", "14-day" or "free trial"; pricing page shows every price, says GST-inclusive, and makes no SSO/audit-log/success-manager/SLA claims.
- Failure found: the claims check matched "As-so-ciates" as SSO (test bug, case-insensitive substring) → word boundaries. Web suite 260/260.

## AI credits — 2026-11-14 (features/ai-credits.md)
- `ai-credits.test.ts` 16 unit tests:
    - cost table (drafting ½ steps, revise, contract review), web/API cost tables match (AC9);
    - allowance per plan / free launch / unpaid sign-up / lapsed, monthly cycle on a yearly plan;
    - cutBlocks / cutText / cutRecord;
    - AC3 intake cut: one block + notice, .docx rebuilt cut, companion withheld, no .docx when it can't be rebuilt; untouched when paid;
    - stream sends only the budget, then `locked`;
    - AC4 lock notice → 409 draft_locked, guarded on draft save + eFiling upload;
    - AC1 route scan: every handler behind the AI rate limit charges credits.
- **AC1 scan, first run:** found 5 uncharged routes. Mock-argument upload is now gated on 3; turns / conclude / rerun count as included in the session; contract /extract is OCR only.
- `credits.integration.test.ts` 10 tests on real Postgres (local PG16, throwaway schema):
    - allowance once per cycle, upgrade adds the difference, free launch 25 / unpaid 0;
    - 0 credits → 402 with nothing taken;
    - failed call refunds, same ref_key charged once;
    - AC7 two concurrent ½ charges with ½ left → exactly one;
    - plan spent before a Brief Pack;
    - AC3/AC5: 6-page draft with 3 credits → 1,200 words visible, page 4+ never sent, unlock 402 until credits are added, then the full text, second unlock free;
    - re-meter free / growth charged; other firm 404.
- **Test fixes:** document-ask / draft-review tests expected the service itself to check the old quota. The check moved to the route by design, so the expectation was updated, not removed.
- Integration test data bug (identical paragraphs) fixed in the test.
- Clean worktree: API 994 passed / 0 failed, credits integration 10/10, web 260/260, API + web typecheck clean.
- 2026-11-14 diary briefing charged: `diary-briefing-credits.test.ts` 3 tests (½ once, same-day re-open free with no model call, out of credits → counts only, failed model refunded). All pass.

## Brief Packs — 2026-11-14 (features/brief-packs.md)
- `brief-packs.test.ts` 14 tests:
    - AC1: each pack's order is created for its exact paise; non-owner 403; unknown pack 400; no keys 503; the pay page uses `order_id`; HMAC(order|payment) return → pack-done, a forged one → cancelled.
    - AC2: pack_60 paid → 60 credits, 365 days, one invoice for ₹999 `one-time`, `pack_bought` logged; a redelivery adds nothing.
    - AC3: a wrong paid amount, a changed order amount, an unknown pack, or a subscription payment → no grant, no invoice.
    - AC5: the pack list.
- AC4 (plan credits before pack credits) is covered by credits.integration.test.ts.
- Migration 0109 applied to the local DB.

## Munshi role + interim sign-up + landing — 2026-11-14
- pricing-v4.test.ts 32 tests:
    - seat tests moved to the Munshi role (Paralegal now needs an advocate seat);
    - Munshi fallback has no AI;
    - an AI charge by a Munshi → 403 before credits move;
    - interim: no payment keys → a new sign-up gets the free launch (free_plan, free_launch, till 1 Jun 2027), no checkout.
  The old 503 test encoded the previous behaviour, so it was changed to the owner's new rule.
- munshi.integration.test.ts (real Postgres, migration 0110): the Munshi has matter/client/documents, no drafting.ai / mock arguments / matter intelligence / research; an advocate in the same firm keeps AI; a Munshi AI charge is refused, an advocate's is taken.
- Web seo.test.mjs with V4_LIVE = true.

## legal-pages (2026-11-14)
- legal-pages.test.tsx, 9 tests mapped to AC1–6:
    - Parts A–E present;
    - no `[placeholder]` brackets;
    - no "free" offer on /terms;
    - operator, GSTIN, address, email and Grievance Officer shown;
    - both AI providers named;
    - mic/camera disclosed;
    - /terms and /legal/terms routed, plus the nginx regex;
    - links from the landing, sign-up and settings.
- Regression: all web tests (18 files, 270 tests) and `tsc --noEmit` pass. seo.test checks the /terms SPA prefix.
- No failures found.

- 2026-11-14 refund + contact pages: `policy-pages.test.tsx` 4 tests (seller details and links; approved refund rules; Terms Part E matches with no old conflicting rule; public route + nginx + landing footer). Web suite 276/276.

- 2026-11-14 found in the first live sign-up: a paid onboarding never opened Razorpay. Saving the onboarded session routed away from /onboarding before the view's per-call onSuccess ran. Fix: the redirect moved into useCompleteOnboarding's onSuccess, before setSession. Also: the sidebar showed the retired 'AI documents' count (now AI credits); the banner called an unpaid sign-up a 'trial' (now 'payment not finished'); an empty credit box showed for unpaid accounts (now a note). `onboarding-checkout.test.ts` 2 tests; web 278/278.

## Pay per period (no Autopay) — 2026-11-14 (features/manual-renewal.md)
- `manual-renewal.test.ts` 10 tests:
    - AC2: nothing active starts now (+1 month); the same plan extends from the current end; a different plan starts today with no carry-over; a redelivered payment changes nothing; a wrong paid amount, a changed order amount or an unknown plan apply nothing; addPeriod month-end and year.
    - AC3/4: past paid-until → plan_expired (no grace); a free-launch account falls back to free.
- Existing tests moved from subscriptions to orders: razorpay-billing (an Associates order, a yearly order, buying the same plan again allowed), pricing-v4 (order amount and notes; onboarding opens the order), brief-packs (return → `paid`). policy-pages: no "renew automatically" / Autopay / mandate.
- Test-data bug: a fake order id shorter than Razorpay's format was ignored by the id check, so the test id was fixed (the code was right).

- 2026-11-14 first live ₹199 payment (Sanad, UPI): webhook 200, plan active and paid until 14 Dec, invoice DIF/26-27/000001 (CGST + SGST). Found: the November free-launch plan credits stayed alive next to the new Sanad credits (balance 50, not 25). Fix: starting a new plan period ends earlier plan grants (packs and admin grants stay). credits.integration 12/12.

- 2026-11-14 ₹1 test code: `test-coupon.test.ts` 7 tests (allow-listed account → ₹1 plan or pack order; the same code on another account / a wrong code / a code not configured → 400 with no Razorpay call; no code → normal price; a ₹1 test order activates the plan with MRR 0 and a ₹1 invoice; ₹1 on a normal order applies nothing).

## terms-consent (2026-11-14)
- **api `routes/__tests__/auth-terms.test.ts` (6 tests):**
    - AC1: the 3 sign-up endpoints refuse a missing or false `acceptTerms` with a 400 that gives the reason. A control with `true` passes the schema.
    - AC6: the API and web versions match.
    - Fixed during the run: the per-IP sign-up limiter (5/h) answered 429. The test now stubs the limiter (it isn't the subject).
- **api `terms-consent.integration.test.ts` (2 tests, local PG, throwaway schema):**
    - AC2: sign-up writes a granted row with version, IP and user agent.
    - AC3: no row → asked; an old version doesn't count; agree clears it; a later disagree asks again.
- **web `components/__tests__/terms-consent.test.tsx` (4 tests):**
    - AC4: the box is unticked and required.
    - AC4: all 4 sign-up calls send `acceptTerms` and the buttons wait for the box.
    - AC5: the gate runs before onboarding, never for superadmin or act-as.
    - Part C wording.
- **legal-pages.test AC6:** updated, because the sign-up notice line was intentionally replaced by `<TermsAgree>`.
- **Regression:**
    - api unit: 1037 passed. web: 289 passed. tsc clean for both.
    - api auth.integration: 5/6. "role=group → Practice" fails on origin/main too (pricing v4 maps group to a different tier); it predates this feature and is untouched.

## sign-in page tidy (2026-11-14)
- auth-art.test.tsx (2 tests): the card renders the faked system date and time (NOV 14, 5:05 PM, Saturday) with no fixed hearing; the plans line is gone. Web suite 291 passed, tsc clean.
