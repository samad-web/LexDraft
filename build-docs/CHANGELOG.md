# Changelog
- DEPLOYED 2026-11-23 07:42 UTC (70527fb, api + web; no migration, engine untouched): save as case note. Backup pre-deploy-20261123-073923.dump; rollback lexdraft-api/web:prev-20261123-073923. Smoke: ready db ok, site 200, sign-in 400, case-notes 401 signed out, Google client id + "Save as case note" in build, msword in api.

- Save as case note (2026-11-23, owner): Draft page "Save as case note" saves the document's text as a separate note in each chosen case, Shared or Only me (existing POST /case-notes, no migration); Case Notes upload accepts .doc (LibreOffice -> mammoth in text-extraction). features/save-as-case-note.md.

- DEPLOYED 2026-11-23 07:02 UTC (e22a280, api + web + engine; 0122 applied with owner OK): open and edit your own document. Backup pre-0122-20261123-065249.dump; rollback lexdraft-api/web/engine:prev-20261123-065249. Smoke: ready db ok, site 200, sign-in 400, document/open + edited-file 401 signed out, live read-docx ok, Google client id + "Open a document" in build.

- Open and edit your own document (2026-11-23, owner; Option A): Draft page "Open a document" (.docx, .doc, PDF as text) for a case or no case; Case/Documents "Edit in DifAi"; the original is kept untouched as "<name> (original)" and the edited Word copy is filed in Documents (one row, replaced each save, firm-visible, shareable); "Copy to another case" makes an independent copy. Engine: /v1/read-docx, apply-edits handles added/deleted paragraphs, start/end alignment fix. Migration 0122 (drafts.source_document_id, edited_document_id). features/import-edit-document.md.

- DEPLOYED 2026-11-20 10:25 UTC (7448960, api + web; 0121 applied): daily brief. Backup pre-0121-20261120-102152.dump; rollback lexdraft-api/web:prev-20261120-102152. Smoke: ready db ok, site 200, sign-in 400, /notifications/brief 401 signed out, brief.morning 07:00 IST scheduled, Google client id in build.

- DEPLOYED 2026-11-20 09:30 UTC (e065f51, api + web; 0120 applied): reminders + Android push plumbing + c7412fd activation funnel. Backup pre-0120-20261120-092345.dump; rollback lexdraft-api/web:prev-20261120-092345. FCM not configured yet.

- Daily brief (2026-11-20, owner): 07:00 IST morning brief (today, tomorrow, tasks, reminders; quiet day names the next hearing) and an evening brief of tomorrow's hearings after the 19:00 eCourts run (eCourts + manual + diary), re-sent only if an eCourts retry changes it. Replaces the per-case evening notices. Settings switch; 0121 users.daily_brief. features/daily-brief.md.

- DEPLOYED 2026-11-19 08:22 UTC (b67ad17, api + web; no migration; engine untouched): limitation ladder fix. Live check: notice served 1995-09-29 -> 1995-10-14 / 10-15 / 11-15 (Saketh India). Backup pre-deploy-20261119-081919.dump; rollback lexdraft-api/web:prev-20261119-081919. Smoke: ready db ok, site 200, sign-in 400, calculate 401 signed out, notice-received field + Google client id in build.

- Limitation ladder fix (2026-11-19, owner): s.138 ladder now one calendar month from the cause of action (Saketh India), optional notice-received date, premature-filing warning, proviso to s.142(1)(b) instead of s.473 CrPC, national holidays flagged. features/limitation-ladder-fix.md.

- DEPLOYED 2026-11-19 07:53 UTC (8ea6e0f, api + web; engine untouched; no migration): claude-only 2704aa5 + cocounsel-guest-scope 8ea6e0f. Live env: llmProvider anthropic, REVIEW_PROVIDER default, failover off, no xAI key, claude-sonnet-5-5. 0 existing co-counsel guest accounts on prod, so nobody keeps the old free plan. Backup pre-deploy-20261119-074836.dump; rollback lexdraft-api/web:prev-20261119-074836. Smoke: ready db ok, site 200, sign-in 400, guest-cases 401 signed out, Google client id in build.

- Co-counsel guest scope (2026-11-19, owner): a new advocate accepting a handover gets an unpaid account that opens only the shared matter; the rest needs a paid plan (was: free plan till 1 Jun 2027). features/cocounsel-guest-scope.md.

- Claude only (2026-11-19, owner): env.claudeOnly drops xAI/OpenAI keys and provider settings at boot; Contract Review moves to Claude; no vendor failover. features/claude-only.md.

- DEPLOYED 2026-11-18 (a9e344f, api + web): ₹1 test code at onboarding. Allow-list unchanged (support@sirahdigital.in only). Backup pre-deploy-20261118-085223.dump; rollback prev-20261118-085223.

- ₹1 test code at onboarding (2026-11-18, owner): "Have a code?" on the onboarding plan step and Finish payment; only allow-listed emails (BILLING_TEST_EMAILS) get ₹1.

- DEPLOYED 2026-11-18 engine only (from 2b772f2): court-heading fix 2f000c8 now live. Image built, compileall on py3.11.18 ok, container recreated with same network/volume/token/restart; healthz ok. Rollback image lexdraft-engine:prev-20261118-082417.

- DEPLOYED 2026-11-18 (2b772f2, api + web; engine NOT rebuilt, so 2f000c8 court-heading fix is not live): pay-before-app + onboarding-fields. Backup pre-deploy-20261118-081930.dump; rollback lexdraft-api/web:prev-20261118-081930. Smoke: ready db ok, /onboarding 200, sign-in 400, onboarding/complete 401 signed out, Finish-payment screen in build, no logo upload.

- Pay before app (2026-11-18, owner): closing Razorpay no longer opens the dashboard. Unpaid owners stay on onboarding ("Finish your payment"); after paying, "Confirming your payment…" until the webhook opens the app. Replaces the 30-minute unpaid window. features/pay-before-app.md.

- Onboarding fields (2026-11-18, owner): logo upload removed from "Your practice" (logo stays in the Letterhead editor); with Aadhaar/PAN the enrolment number is optional (still shown; drafts/eFiling use it when given). Server already optional.

- DEPLOYED 2026-11-18 (1f38b96, api + web; engine untouched; no migration): team-join (Teams-style) + auth card flicker fix 03c0eb0. Backup pre-deploy-20261118-075042.dump; rollback lexdraft-api/web:prev-20261118-075042. Smoke: ready db ok, /auth 200, invite email/start 400 on {}, join 401 signed out, unknown invite 404, Google client id + new invite page + 44px Google slot in the build.

- Team join, Teams-style (2026-11-18, owner): one "Add member" = invite (link + WhatsApp). Invitees join with Google or email + password (WhatsApp code). Existing DifAi users sign in and confirm "Join" (account moves; old workspace stays, export offered). Direct "Add member" account creation removed (made accounts nobody could sign in to). No migration. features/team-join.md.

- Auth card flicker fixed (2026-11-18, owner screenshot): Google's button iframe grows to ~80px while loading / swapping to "Continue as <name>", so the centred card grew and jumped. The Google slot is now a fixed 44px (GoogleWhatsAppVerify WebGoogleButton + .auth-google).

- DEPLOYED 2026-11-18 (23c7102, api + web; engine untouched): Google sign-up prefill, WhatsApp forgot password, strong passwords on invite/co-counsel. Migration 0117 applied on prod (ledger). Backup pre-deploy-20261118-070236.dump; rollback lexdraft-api/web:prev-20261118-070236. Smoke: ready db ok, /auth 200, sign-in + password/forgot + password/reset 400 on {}, Google client id in build.

- Forgot password via WhatsApp (2026-11-18, owner): "Forgot password?" -> work email -> 6-digit code on the account's verified WhatsApp -> new strong password. Same reply for unknown emails; superadmins/suspended never get a code. API /auth/password/forgot + /reset; migration 0117 (additive). features/forgot-password-whatsapp.md.

- Google sign-up prefill (2026-11-18, owner): after Sign up with Google the Create-account form shows name + email from Google (email locked); only WhatsApp number + password are typed. The separate Google card is gone. features/google-signup-prefill.md.

- Google sign-up = WhatsApp + password on every path (2026-11-18, owner): self sign-up already required both. Team-invite accept and co-counsel link accept (Google + WhatsApp OTP) used to create accounts with an unusable random password; both now require a strong password (API schema + new NewPasswordField on InviteAcceptView / CoCounselAcceptView). Dead unusablePasswordHash removed.

- Password checklist removed (2026-11-18, owner: "remove this wordings"): no "8+ characters / Uppercase / …" row under the password. The strong rule is unchanged; a weak password shows the rule once as a field error (after leaving the field or pressing START), like the other fields.

- DEPLOYED 2026-11-18 (c8ccf67, web only): NUSI-size sign-in / create-account card. Rollback lexdraft-web:prev-20261118-060332. Smoke: site 200, sign-in 400, Google client id + new CSS in the live build.

- Auth card = NUSI size (2026-11-18, owner "maintain this size" with the NUSI sign-in screenshot): fixed desktop sizes copied from NUSI at the owner's 125% scaling — card 980px wide, form column 450px, 96px mark, 32px title, 70px field rows, 140×46 button, 77px Google strip. Create account tightens (72px mark, shorter rows) only on windows under 800px tall so it still fits. Replaces the vh-scaled sizes of 9a574b1.

- Auth card fits the page (2026-11-18, owner: "make it correct fit to the page"; laptop at Windows 125% scaling = 1536×728 CSS window): every card size now follows the window height (vh), capped at the NUSI size, so it fills and fits the page at any height/scaling. Supersedes the "scrolly" variant 789d195.

- Spacious + scroll (2026-11-18, owner NUSI picture: "i need the same spacy and scrolly"): NUSI-sized card on every desktop window (1225px card, 120px mark, 38px title, ~85px field rows, 58px START); short windows scroll. Height-based compact layouts removed on desktop; phones keep the compact form.

- Spacious card fix (2026-11-18, owner: "no changes happened" on a 1080p screen = ~910px browser window): spacious layout now from 860px window height (was 940), card trimmed to 763px (Create account) / 680px (sign-in); the "By continuing you agree…" line under the card is hidden on Create account in this layout (the card has its own Terms tick box).

- Spacious auth card (2026-11-18, owner NUSI picture "like this i need as spacious"): on windows ≥ 940px tall the sign-in / create-account card is wider (1220px), form column 620px, 112px round mark, 36px title, taller 17px fields, bigger START, roomier Google strip. Windows < 940px tall get the compact card (breakpoint raised from 860, so 864–939px windows no longer scroll). CSS only.

- DEPLOYED 2026-11-18 (1c61f0d, api + web): strong passwords + Create account subtitle removed. Backup pre-deploy-20261118-044045.dump; no migration. Smoke: weak password on /auth/signup/email/complete → 400 with the rule text; ready/db ok; site 200; sign-in 400; Google client id + rule text in the live build; no API errors.

- Strong passwords + cleaner Create account (2026-11-18, owner): the "Plans from ₹699 … We send a code" line under CREATE YOUR ACCOUNT removed; every password a person sets (email + Google sign-up, admin/firm add-user) needs 8+ chars with uppercase, lowercase, number and symbol (API `lib/password.ts`, web mirror, live checklist under the field). Auto-generated passwords are now random strong ones instead of the guessable Name@123; admin reset too. Existing passwords still sign in.

- Playwright full-UI suite committed (2026-11-18, from the 2026-11-12 work): web suite (public pages, sidebar, tabs, topbar, palette, CRUD, tools, mobile layout; E2E-* cleanup) + phone suite driving the installed Play Store app over adb. `pnpm --filter web test:e2e`. Fix: Android Back now closes the search palette instead of the page behind it (CmdK listens for difai:back). Not deployed.

- DEPLOYED 2026-11-17 (865221c, web only): Create account fits one screen. Google client id and new CSS in the live build; no API change.

- Create account fits one screen (2026-11-17, owner: "page is scrolly … becoming big"): smaller round mark, tighter field spacing, the WhatsApp-code hint folded into the line under the title, slimmer Google strip. All fields and the Terms tick box unchanged.

- DEPLOYED 2026-11-17 (9ddd632, api + web): email sign-up form restored. Backup pre-signup-form-20261117-125255.dump; no migration. Smoke: /auth/signup/email/start empty → validation error (name/email/phone required); /complete without acceptTerms → Terms message; password sign-in bad creds 401; Google client id + new form text in the live build; no error logs.

- Email sign-up form restored (2026-11-17, owner: "use the old logic itself", NUSI-style picture): Create account = round mark, CREATE YOUR ACCOUNT, Your name / Work email / WhatsApp (+91) / Password, Terms tick box, START (right) → 6-digit WhatsApp code → account (unpaid; plan + payment on onboarding); "Or sign up with Google" strip at the bottom. Create account no longer opens Google by itself. The F3 protection stays: Google never joins a password account by email. Server plan feature text synced with the web card.

- DEPLOYED 2026-11-17 (839c4d5, web only): brand-panel bars removed; Continue with Google back on the sign-in card. Google client id present in the live build; no API change.

- Sign-in (2026-11-17, owner): grey line bars beside the logo on the brand panel removed; Google sign-in back on the card — "or" + full-width dark Continue with Google pill under the SIGN IN row, above "New to DifAi? Create your account".

- DEPLOYED 2026-11-17 (b048194, web only): Create account screen matches the sign-in card. Google client id and new CSS present in the live build; no API change.

- Create account screen restyled to the NUSI-style sign-in card (2026-11-17, owner: "when I click account creation it is going here, fix it"): round DifAi mark, centred CREATE YOUR ACCOUNT (one line), price line, full-width Continue with Google, steps as numbered circles, centred "Already have an account? Sign in". Same head on the WhatsApp/password step. The small wordmark header shows only on later sign-up steps (no double logo on phones).

- DEPLOYED 2026-11-17 (7f1dd6e, web only): NUSI-style sign-in card. Google client id (still used by Create account) and the new copy present in the live build; no API change.

- NUSI-style sign-in card (2026-11-17, owner: "like this i need", exactly NUSI, no Google): round black DifAi mark, SIGN IN, "Welcome back to DifAi.", email + password with icons, Forgot password left / black SIGN IN pill right, "New to DifAi? Create your account". Google is only on Create account (sign-up). "Talk to us" off the card (pricing still has "Speak with us"). Brand panel stays on the left.

- DEPLOYED 2026-11-17 (219eb05, web only): sign in with Continue with Google first. Google client id and the email-link text present in the live build; no API change.

- Sign in: Continue with Google first (2026-11-17, owner): the sign-in card shows a full-width dark "Continue with Google" pill (Google's button, logo + text centred) under "Sign in / Welcome back."; email + password is behind "Sign in with email instead" (kept for the password accounts and the Play review account; opens by itself when Google says the email has a DifAi password). Create account / Talk to us rows unchanged.

- DEPLOYED 2026-11-17 (546d3ca, web only): sign-in alignment polish. Google client id and new CSS present in the live build; no API change.

- Sign-in alignment polish (2026-11-17, owner: "alignment is not looking … Create account and Talk to us"): form column 400 px so the Google button is exactly as wide as Sign in; Google button white outline (secondary) under a solid black Sign in (no shadow, 44 px); Forgot password right-aligned under the password; "New to DifAi? — Create your account →" and "Nine or more advocates? — Talk to us →" as two rows under a divider. GoogleButton gets an optional theme (default unchanged).

- DEPLOYED 2026-11-17 (e476b0a, web only): sign-in right side matches the brand panel + plan pre-pick only from a fresh pricing click (f29af76). Google client id, plan-pick code and new CSS present in the live build; no API change.

- Sign-in right side redesigned to match the brand panel (2026-11-17, owner): left-aligned, "Sign in" in the panel's bold sentence-case style, full-width solid dark Sign in button, Forgot password under it, "or" divider and Google inside the form (no grey bottom strip), links left-aligned; the duplicate DifAi logo is hidden on desktop (kept on phones). Create-account screens use the same style.

- Plan pre-pick fixed (2026-11-17, owner: "plan choosing is not updated"): onboarding pre-selects a plan only from a "Start with …" click on pricing in the last 2 hours (difai-plan-pick), cleared when setup finishes. Old remembered answers (old sign-in tabs, landing size question) no longer pick a new account's plan; otherwise "Choose your plan" with all three.

- DEPLOYED 2026-11-17 (4bbfd78, web only): sign-in brand panel. Google client id and the new headline present in the live build; no API change.

- Sign-in brand panel (2026-11-17, owner): the card's left panel shows the Play Store feature graphic built in HTML (DifAi wordmark with line bars, "Drafting that defies the clock.", "AI drafting, case diary and eCourts for Indian advocates") instead of the illustration; sign-in form stays on the right. AuthArt component kept in the repo, no longer used.

- DEPLOYED 2026-11-17 (4ada924, web only): sign-in back to the card layout. Full-page CSS absent from the live build; Google client id present.

- Sign-in back to the card layout (2026-11-17, owner: "no need of full screen"): full-page CSS from 517677f removed; kept only the hide of the phone-only "Firm with 9+ lawyers? Book a demo" link (duplicate of "Nine or more advocates? Talk to us").

- DEPLOYED 2026-11-17 (517677f, web only): full-page sign-in. Google client id and the new CSS present in the live build; no API change.

- Full-page sign-in (2026-11-17, owner): the sign-in card fills the window (no outer margin, border, radius or shadow); Terms line + trust strip in a thin bottom strip; the old phone-only "Firm with 9+ lawyers? Book a demo" link hidden (the card has "Nine or more advocates? Talk to us").

- DEPLOYED 2026-11-17 (23ac89f, web only): one sign-in card, plan chosen on the plan page. Google client id and the new tagline present in the live build; no API change.

- One sign-in card (2026-11-17, owner approved Claude's recommendation): the Advocate / Chambers / Firm tabs are gone from the sign-in page. One card: email + password, Google, "New to DifAi? Create your account" (opens Google at once), "Nine or more advocates? Talk to us". The plan is chosen only on the plan page after sign-up (or pre-picked by "Start with …" on pricing and confirmed there).

- DEPLOYED 2026-11-17 (77e18af, web only): plan chosen once. Google client id and the new "Not the right plan?" text present in the live build; no API change.

- Plan chosen once (2026-11-17, owner: "we give the option to choose twice"): the plan is picked on the sign-in tab (Create account on Advocate / Chambers / Firm) or by "Start with …" on pricing; onboarding step 1 then shows "Your plan" (that card, monthly/yearly, Munshi seats, price) with "Change plan" instead of the three-plan grid. Left rail shows the chosen plan's price. Removed leftover "1 credit = one 400-word page" and the "payment opens soon, free until then" note; Advocate card says "Practice analytics".

- DEPLOYED 2026-11-17 (c080b5f, web only): sign-up starts in Google. Google client id, new steps text and the FedCM prompt code present in the live build; no API change.

- Sign-up starts in Google (2026-11-17, owner: "by tapping create account it should go"): tapping Create account opens Google's account chooser at once (One Tap / FedCM); the sign-up card now has a large "Continue with Google" button in the middle (no longer only in the footer), the four steps, and the right price per tab.

- DEPLOYED 2026-11-17 (0274d44, web only): Firm tab sign-up fix 5e90e75, plus another session's mobile-responsive commits a57fee7, e7176a1, 0274d44. Google client id present in the build; no API changes; no migration.

- Mobile responsive (2026-11-17, features/mobile-responsive.md; not deployed): audited ~70 screens/overlays at 360, 390, 768, 1024 and 1366. Touch screens (phones, tablets, Android app) now get 44px tap targets (buttons, small buttons, chips, tabs, toggles, top-bar icons, selects, stand-alone links) and 16px form text (no iOS zoom); the closed phone drawer no longer draws a grey strip down the left edge or sits in the tab order; long screen titles wrap to two lines; field hints and stacked invoice due dates no longer get cut; opening the drawer on a tablet no longer squeezes the page to 16px; admin Users table scrolls in its own box at 1024; calculator basis amount no longer squeezed at 1024. Mouse/desktop layout unchanged. New local audit tool apps/web/scripts/mobile-audit.mjs.
- Firm tab sign-up (2026-11-17, owner: "for firm I am not able to create the account"): on /auth the Firm tab only offered the Enterprise "Talk to us" enquiry, and "No DifAi account uses this email → Create your account" opened it too — left over from before the self-serve Firm plan. Now: "New firm on DifAi? Create your firm account" (team sign-up; onboarding pre-selects Firm) and "Nine or more advocates? Talk to us".

- DEPLOYED 2026-11-17 (953a86d): sign-up hardening F1-F7 (Google-only sign-up, paid-only firms/invites, server Terms gate, no free fallback). Backup pre-signup-fix-20261117-095751.dump; no migration. Smoke: password sign-in 401 on bad creds, email sign-up 404, Google connect needs auth (401), Google sign-in bad token 400; Google client id present in the web build.

- Sign-up hardening (2026-11-17, features/signup-hardening.md, branch fix/signup-flow, NOT deployed): new accounts are Google only (email + password sign-up removed; Google never links a password account by email — 409 google_link_required, connect Google in Settings); every new firm is Solo / 1 seat / no trial until a plan is paid; members (invite, accept, Add member) only on a set-up, paid firm (402 plan_required); unfinished accounts sign in and go to onboarding, a payment opens the app and onboarding never resets a paid plan or charges twice; parallel webhook deliveries apply a payment once; payments off → 503 instead of a free plan; the API enforces Terms consent (403 terms_required); "free" wording removed; invoice WhatsApp only to a verified number. No migration.

- Analytics name by plan (2026-11-17, owner): the analytics page stays on every plan (16 Nov decision) but is named "My Practice Analytics" on Advocate, "Chambers Analytics" on Chambers and "Firm Analytics" on Firm — menu, page title, search and the dashboard link.

- Stale code files after a deploy (2026-11-17): a page or the Android app opened before a deploy no longer shows "Failed to fetch dynamically imported module"; it reloads once to pick up the new files (lib/stale-chunk.ts; vite:preloadError, unhandled rejections, ErrorBoundary), with a 30 s guard so it never loops. Server: /opt/lexdraft/.env (gitignored) now holds VITE_GOOGLE_CLIENT_ID so every `docker compose build web` keeps Google sign-in.

- DEPLOYED 2026-11-17 (6adc078): credits-not-pages + admin credit pricing + app-handoff (bd6dd8e). Backup pre-credits-20261117-084225.dump; 0116 was already applied; counts unchanged. WHATSAPP_CREDITS_TEMPLATE=difai_credits_low set (Meta-approved). WHATSAPP_PLAN_ACTIVE_TEMPLATE / WHATSAPP_RENEWAL_TEMPLATE still empty (plan WhatsApp messages off).

- Credits, not pages (2026-11-17, features/credits-not-pages.md, owner): drafts are never cut into locked pages any more. Before drafting, DifAi checks the credits that kind of document usually needs (median of recent drafts of that type, else 2) and stops with "Your AI credits are over / Buy credits" if short — nothing drafted or charged. A new draft that runs longer than the credits left is delivered whole; the balance goes to 0 and DifAi absorbs the rest (logged), if at least half was there; streamed drafts are always delivered. Growing re-renders without credits are refused. Low-credit warnings at ≤ 20% and at 0: app banner + bell + WhatsApp (template difai_credits_low, pending Meta; env WHATSAPP_CREDITS_TEMPLATE). "Page" removed from credit wording.

- Admin AI credits priced (2026-11-17, owner: "it should calculate the amount"): the add-credits form calculates the amount = credits × price per credit (default = best Brief Pack rate ₹12.88 ex-GST, sent by the server), shows GST and the total to collect; rate and amount stay editable; "Free (goodwill)" tick for no payment/no invoice; the form lists what is missing instead of a silent grey button.
- App hand-off + renewal reminders (2026-11-17, features/app-handoff-and-renewal-reminders.md, NOT deployed): website-only "Get the DifAi app on Google Play" + "Sign in with the same account (<email>)" after a plan payment (Plan & Billing return, incl. onboarding) and a "Get the Android app" landing footer link; "plan active" WhatsApp (template `difai_plan_active`) sent right after the invoice message in the same job, once per plan payment; renewal reminders on WhatsApp (`difai_plan_renewal`) 7 / 1 / 0 days before renews_at, daily 10:00 IST job `plan.renewal.reminders`, once per firm+period+kind. Both off until `WHATSAPP_PLAN_ACTIVE_TEMPLATE` / `WHATSAPP_RENEWAL_TEMPLATE` are set. Migration 0116 (plan_active_wa_* on subscription_invoices, plan_renewal_reminders).

- DEPLOYED 2026-11-17 (578fc3d): invoice on WhatsApp. Live migration 0115 after backup pre-invoice-wa-20261117-064417.dump (counts unchanged); WHATSAPP_INVOICE_TEMPLATE=difai_invoice set in prod .env.docker (backup env.docker.pre-invoice-wa-*).

- Invoice on WhatsApp (2026-11-17, features/invoice-whatsapp.md): after any payment (Razorpay plan, Brief Pack, custom plan, paid credits) DifAi sends the GST invoice to the account owner's verified WhatsApp number through Wasi Hub (same sender as the OTP), template `difai_invoice`, with a 7-day private link to the PDF (`/api/i/<token>`). Sent by a background job (3 retries); the payment never waits on WhatsApp. Admin firm page shows sent / not sent (reason) per invoice with "Send on WhatsApp". Migration 0115 (invoice WhatsApp columns, invoice_links). Off until `WHATSAPP_INVOICE_TEMPLATE=difai_invoice` is set.

- DEPLOYED 2026-11-17 (7c889c2): superadmin console v2 (spend guard, custom plan, per-user caps, Firm 360, Land Records TN gate) + main's logo/Android web commits. Live migration 0114 applied after a pg_dump backup (/var/backups/lexdraft/pre-admin-v2-20261117-061845.dump); row counts unchanged. ANTHROPIC_ADMIN_KEY not set yet (spend shows DifAi estimate). SMTP blank on prod: budget alerts reach the bell only.

- Land Records for Tamil Nadu advocates only (2026-11-17, features/land-records-tn-gate.md): superadmin on/off switch (Overview) and per-firm override (Firm page: follow rules / always on / off). Advocates with no state are asked once; Tamil Nadu gets the services, other states see "Land Records for <state> coming soon" (menu badge SOON + screen), switched off = hidden. Every /land-records API call is refused (403) unless allowed. Menu label "TN Land Records" → "Land Records".

- Admin Firm 360 (2026-11-17, features/admin-firm-360.md): Overview shows plans by current plan name (firms, paid now, MRR), MRR + ARR ex-GST, plans ending in 7 days and sign-ups that never paid. MRR now counts only plans paid for and still running (it counted every non-suspended firm, incl. expired and free). Firms list: plan name, credits left, paid until, filters. Firm page: AI use per member with caps, payments (online + manual) and GST invoice PDFs, credit history (50 a page), extend plan by whole months at no charge (audited). Sidebar "Free plan" → "Free launch".

- Admin per-user AI usage (2026-11-17, features/admin-per-user-usage.md): /admin → AI usage lists each user's calls, tokens, estimated ₹ cost, credits used and top feature, with a monthly credit cap DifAi can set per user (users.credit_cap_month, 0114). A capped user gets 402 `user_cap_reached` (charge, availability check, draft pages and unlock), nothing taken; the firm's pool and other users are unaffected; refunds don't count; resets with the plan month.

- Admin custom plan (2026-11-17, features/admin-custom-plan.md): Firm detail → "Custom plan": plan name, advocate + Munshi seats, AI credits a month, price ex-GST (GST + total shown), month / year / custom end date, and the offline payment (UPI / bank transfer / cheque / cash, reference, date). Saves the plan, logs a `manual` billing event and issues DifAi's GST invoice (plan name on the line, payment on the footer); ₹0 = complimentary, no invoice. Add-credits now goes to 100,000 credits / 730 days and can record a paid top-up with an invoice. An owner on an active custom plan can't overwrite it by checkout (409 custom_plan_active) and counts as subscribed. Migration 0114 adds billing_events.note, subscription_invoices.line_label/payment_note.

- Admin AI spend guard (2026-11-17, features/admin-ai-spend-guard.md): /admin shows AI spend this month (Anthropic's own bill via ANTHROPIC_ADMIN_KEY, else DifAi's estimate), a monthly budget with alerts (bell + email to superadmins, once per threshold per month, hourly job `ai.budget.check`), optional auto-pause at 100%, a "Pause AI for everyone" switch and a per-firm AI pause. Paused calls are refused on the credit path (503 `ai_paused`, nothing charged) with a provider-client backstop. Migration 0114 (platform_settings, firms.ai_paused, firms.custom_plan_name, users.credit_cap_month).
- Play: Android app is sign-in only (2026-11-17, owner; features/play-sign-in-only.md): in the app there is no sign-up (/signup -> welcome, ?signup=1 -> Sign in, sign-up/demo links hidden), no onboarding plan picker (neutral "Your account setup isn't complete." + Sign out), no renew plan picker at sign-in ("Your plan isn't active."), and no prices, buy/upgrade/renew prompts or "manage on the website" text (welcome, cap modal, locked draft, free-plan lock, banners, Plan & Billing invoices/notes, Munshi, Members, Settings, credit meter, server error messages). One copy module: lib/play-policy.ts. Website unchanged.

- Android 2.3 (versionCode 14, 2026-11-17, features/new-logo.md): new DifAi logo as launcher, adaptive, round, themed and splash icons; only native change. On Play internal testing; production not released.

- New logo v2 (2026-11-17, owner): the symbol is now the D of the word, so the lockup reads "DifAi" (was "D DifAi"). Symbol at cap height on the baseline, "ifAi" kerned 9 units after it; one lockup at every size (compact = same). Updated everywhere the lockup appears (landing, sign-in, splash, welcome, sidebar, SEO header, offline page, invoice, og-image) and in the owner's final logo folder (v1 files backed up).

- New logo (2026-11-17, features/new-logo.md): the owner's approved "Draft Lines" logo replaces the old wordmark across the web app (sidebar, rail, landing header, sign-in, sign-up, onboarding, dialogs, legal/share pages, splash, route + boot loaders, SEO pages, offline page, favicon, apple-touch-icon, og:image, JSON-LD logo, GST invoice header). One component set in brand/Logo.tsx, currentColor for light/dark; loaders and splash use the logo's signature motion. Android app icons not changed (parked).

- Pricing cards on the landing page (2026-11-16, owner): Pricing (desktop tab, phone button, footer link) scrolls to a pricing section on the landing page itself, in the original card design (schedule label, big price, Monthly / Yearly switch, highlighted first card, Included list), fed from the shared plan catalogue (pricing v5, + GST). No sign-in, no other page.

- Pricing on phones (2026-11-16): phones and tablets get a Pricing link in the landing header (the tab bar is hidden there) that opens /pricing without sign-in. Paid-only wording: landing "No card required" -> "Plans from ₹699 a month + GST"; public pages' "Start free" -> "Get started".

- Pricing without sign-in (2026-11-16): the landing page Pricing menu (and /#pricing links) open the public /pricing page instead of the sign-in screen.

- Pricing v5 (2026-11-16, features/pricing-v5.md): new plans by team size, prices + 18% GST:
    - Advocate ₹699 (150 AI credits), Chambers ₹1,699 (up to 3 advocates, 350), Firm ₹3,699 (up to 8, 750), Enterprise quote;
    - Munshi ₹149 + GST; Brief Packs ₹429–4,249 + GST.
  - Checkout charges price × 1.18 to the paisa. Invoices show the price as the taxable value with CGST/SGST or IGST.
  - Migration 0113:
    - moves every v4 firm, keeping paid-until;
    - analytics on every plan;
    - Enterprise credit allowance (admin editor);
    - exact paise on billing events;
    - Firm seat floor 8.
  - v4 checkouts paid after the switch are still honoured.
  - Terms 1.2. Plan cards, onboarding, billing, sign-in, landing, /pricing and the legal pages say "+ GST" and "AI credits".
- Munshi on solo plans (2026-11-16, features/solo-munshi.md): Sanad, Vakalat and Brief owners get a "Your Munshi" box on Plan & Billing to invite, see and remove their Munshi, within the Munshi seats paid for. Seat-limit errors now reach the web app with their code.
- Translation price + s.138 dates (2026-11-16): translating a draft costs ½ credit a page (Draft button shows 1½ credits a page for another language); s.138 complaints no longer refused over stand-in dates (dispatch = notice date; memo receipt before the notice); the dishonour date is read as the memo date; the composed body no longer adds a second list of documents.

- Seat enforcement (2026-11-16, features/seat-enforcement.md): Roles & Access "Add member", role changes between advocate and Munshi, and re-activation now respect the advocate and Munshi seats paid for.

- Paid-only sign-up gate (2026-11-16, features/paid-signup-gate.md): the server keeps the app closed (403 onboarding_required) until a new account finishes onboarding and payment; a sign-up can no longer skip onboarding or start as "paid"; the free interactive demo account is gone ("Book a demo" = contact form only).

- Regional languages (2026-11-16, features/regional-languages.md): drafts in Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Bengali, Punjabi, Odia and Assamese. Drafted and checked in English, then translated as the last step with a figures/placeholder check per line; layout and tables kept; language saved with the matter; High Court / Supreme Court documents stay English (Art. 348). Fonts for all these scripts added to the API image.

- Share several files on WhatsApp (2026-11-16, features/multi-share.md): case Documents tab gets a tick box per file, Select all, and "Share N on WhatsApp" (up to 10). Password ON by default (random PIN); turning it off needs two ticks. Secure link (default, any file type, one message with a link per file) or Attach files (PDFs locked with the PIN; Word/images blocked while a password is on). Two steps (Prepare, then Send) so the share window is never blocked. PIN shown with Copy to send separately.

- Client portal + client messages removed (2026-11-16, features/remove-client-portal.md): owner decision, only advocates use DifAi. Gone: /portal sign-in and screens, Client Messages inbox + nav, dashboard client-message tile, Clients "Portal" column + tile, "Visible to client" (case), "Shared"/"Ack req'd" (documents), "Visible on client portal" (applications), client emails on new hearing/invoice. Old /portal links go to the home page. No database change (columns/tables kept, unused). Also ends the guessable firstname@123 portal passwords.

- Plan cards match the app (2026-11-16): Associates plan now includes the firm dashboard (migration 0112, Practice tier; owner/partner/lead roles only, not Associates or Munshi). Partners card no longer claims SSO (not built): "Audit logs and firm analytics".

- Secure share link (2026-11-16, features/secure-share-link.md): "Send secure link on WhatsApp" on the Draft Share card and in the document viewer. The client gets a DifAi link that expires (1/7/30 days), can need a password, counts views and can be cancelled ("Manage secure links"). Each link keeps its own encrypted file copy; a nightly job deletes copies of expired links. Token stays after # so no server log records it. Migration 0111 (new table share_links).

- Evidence tables part 2 (2026-11-14): built-in formats (s.138 complaint, counter affidavit, call-for memo, appeal record cost schedule, SLP list of dates + index of annexures) print their lists as ruled tables; table dates/amounts tidied; columns sized by content; editor plain text keeps paragraphs and tables; Copy text pastes into Word as a table.

- Password-protected PDF (2026-11-14, features/protected-pdf.md): "Lock PDF with password" on the Draft Share card and in the document viewer. The server stamps "Confidential - for <client> - <date>" on every page and locks the PDF with AES-256 (qpdf, new in the api image). A random 6-digit PIN is suggested; the password is never stored or logged and the WhatsApp note says it comes separately. If locking fails, nothing unlocked is sent.


- eFiling fits the page (2026-11-14): the eFiling sign-in card and the eFiling screens use the full content width. Before, the card was capped at 760 px and centred, and the page at 1240 px.

- Website sign-in animation = 2.4 s (2026-11-14): matches the Android app's launch animation at its normal pace; the app keeps 4 s after sign-in.
- Key lockdown (2026-11-14, features/key-lockdown.md): FIELD_ENCRYPTION_KEY moved out of the app folder into root-only /etc/lexdraft/secrets.env (loaded via the server's docker-compose.apiport.yml); env files and DB dumps made root-only (were readable by the `ubuntu` login); .dockerignore no longer lets apps/api/.env.docker into image builds.


- Sign-in animation on computers (2026-11-14): larger wordmark/tagline and a taller courtroom from 900 px wide (phones unchanged); for the 4 s sign-in the moves are stretched 1.6x so it finishes at ~3.2 s instead of sitting still after 2 s. Chrome's "Change your password" box is the browser's own breach warning, not DifAi.

- Sign-in animation on the website (2026-11-14): the 4 s DifAi animation now plays after sign-in (or after "I agree" on the Terms screen) on the website as well as the Android app. The cold-start launch animation stays app-only.

- Splash before the dashboard (2026-11-14): when the new Terms must be accepted, the 4 s app animation now plays after "I agree", not hidden behind the Terms screen; otherwise right after sign-in as before.
- Evidence tables (2026-11-14, features/evidence-tables.md): a list of documents, index of annexures, list of dates or summary of admissions in a draft is now a ruled table in the preview, the editor, Word and PDF, only where the content calls for one. Engine: tables.py, compose.py table blocks, blocks/edits/splices read and write table rows. API: both drafting prompts, Markdown tables kept as rows and never numbered. Web: preview and editor show the table and map edits back row by row.


- Loading screen everywhere (2026-11-14):
  - A DifAi wordmark with a thin moving bar shows from the first paint (index.html) until the app starts.
  - The same screen shows whenever a page is loading: the landing page, sign-in, legal pages, onboarding, admin, the client portal, and each in-app page (inside the content column).
  - Replaces the plain "Loading…" text.

- Splash after sign-in (2026-11-14): in the Android app the launch animation now also plays for 4 s right after every sign-in (Google, password, new account, MFA), so the dashboard no longer just appears. Cold start unchanged (2.4 s); tap skips; a restored session doesn't trigger it.
- Document encryption at rest (2026-11-14, features/document-encryption.md): uploaded documents are AES-256-GCM encrypted on the server disk (same FIELD_ENCRYPTION_KEY as PII fields) and decrypted only when the API serves a signed download. Old plaintext files still open. Production refuses an upload if the key is missing. One-time backfill: `scripts/encrypt-existing-uploads.ts` (dry run, then `--apply`).

- Sign-in page (2026-11-14):
  - The plans line under "Create your account" is removed.
  - The art card shows today's live date and time instead of a fixed "Next hearing, Oct 27, 10:30, Court 4". It is labelled "Hearing today" with "Court 4 · Arguments" (owner wanted the hearing wording back).

- Sign-in tabs follow the plans (2026-11-14): Advocate · Chambers · Firm (Law student removed, no price on the page). Chambers = Associates 2-8 (14-day trial, team sign-up); Firm = Partners 9+ ("Talk to us" enquiry). The pick pre-selects the plan in onboarding.

- Landing without prices (2026-11-14): Pricing section and price list in the FAQ removed from the landing page; the Pricing tab and /#pricing links open sign-in; Settings' "See plans & upgrade" opens /app/billing. Public /pricing page kept (Razorpay).
- Share on WhatsApp (2026-11-14, features/whatsapp-share.md): case documents (the file itself via the share sheet, else download + WhatsApp note; drafts as text), matter update from the case page's More menu (case no., court, stage, next hearing only), hearing reminder on each diary hearing, invoice details. Draft screen's PDF share now uses the same helper.


- Owner's ₹1 test code (2026-11-14): a Code field on Plan & Billing; the owner's code makes a plan or Brief Pack ₹1 for allow-listed test accounts only.

- Pay per period, no Autopay (2026-11-14): plans are bought for one month or one year as a single payment (any UPI app, card or netbanking); nothing renews automatically. A reminder appears in the last 7 days, and access ends on the paid-until date. Paying for the same plan early adds the time after the current end; a different plan starts today. Terms and refund page updated.

- Refund & cancellation and Contact pages (2026-11-14): /refund-policy and /contact with Sirah Digital's details; the Terms' refund part now matches the approved rules; the landing footer's old contact links are fixed.

- Terms + Privacy pages v1.1 (2026-11-14), not deployed:
  - New /terms page: Terms of Service, Cookie and Device Permissions Notice, and Subscription and Refund Policy.
  - /privacy now holds the full Privacy Policy and DPDP Notice: OpenAI named, Grievance Officer published, operator details from the GST certificate.
  - Linked from the landing page, sign-up and Settings. The old dead `mailto:legal@lexdraft.in` and `/legal/terms` links are fixed.

- Munshi role + landing v4 (2026-11-14):
  - A real **Munshi** (clerk) role: diary, cause list, hearings, eCourts, eFiling and documents, no AI. A Munshi seat (₹149) covers it.
  - The landing page and SEO pages show the v4 plans.
  - Until live online payment is switched on, new sign-ups start on the free launch.

- Brief Packs (2026-11-14), not deployed: buy 25 / 60 / 130 / 330 AI credits (₹499 / ₹999 / ₹1,999 / ₹4,999, GST incl., valid 12 months) on Plan & Billing. One-time Razorpay payment, credits added by the payment webhook, a GST invoice for each. Not shown in the Android app.

- AI credits (2026-11-14), not deployed, ships with pricing v4:
  - Every AI feature costs credits: 1 credit = one 400-word drafted page, small actions ½ to 3, contract review 6+. One shared pool per firm, monthly.
  - Pages past the balance are drafted but locked: cut on the server, unlocked with credits; a locked draft can't be saved, downloaded or e-filed.
  - Credit meter in the composer and Plan & Billing; "not enough credits" sheet; admin can see a firm's credits and add an audited grant.
  - Free-launch accounts: 25 credits a month till 1 Jun 2027.

- feat(seo-pricing) 2026-11-14: /pricing page with v4 prices (unpublished) and one `V4_LIVE` switch that also swaps the free-launch line on every SEO page, CTA, footer and llms.txt.
- Pricing v4 plan catalogue (2026-11-13), not deployed, release together with ai-credits:
  - Plans on sale: Sanad ₹199 (25 pages), Vakalat ₹399 (75), Brief ₹1,499 (200), Associates ₹649 per advocate (2-8, shared pages), Munshi seat ₹149, Partners on quote. Yearly ₹2,190 / ₹4,490 / ₹16,490 / ₹7,140 per advocate / ₹1,590. All GST-inclusive; one config file `apps/api/src/lib/plans.ts`. DRAFT prices.
  - No free plan for new sign-ups: onboarding opens Razorpay at once. Existing free-launch accounts keep free till 1 Jun 2027 (migration 0107 `free_launch`).
  - Munshi seats for Paralegal / Legal Secretary, at checkout, invite and accept. Invoices name advocates and Munshi seats.
  - Fix: accepting an invite no longer counts that invite twice against the seat cap.

- Full UI test suite (2026-11-12): Playwright tests for every web screen (public pages, sidebar, tabs, topbar, palette, CRUD, tools, mobile layout) on the local DB with E2E-* cleanup; and a phone suite that drives the installed Play Store app over adb (dock, every sidebar screen, topbar, Back, resume, task + diary write/delete on live with a cleanup sweep). Fix: Android Back now closes the search palette instead of the page behind it (not deployed).

- Draft PDF on WhatsApp (2026-11-12): the Share card has "Share PDF on WhatsApp", which sends the draft as a PDF file (same PDF as Download PDF: preview filing PDF, else engine .docx with edits via LibreOffice, else rasterised copy) with a short covering note. Android app: native share sheet. Chrome/Edge/phones: Web Share with files. Other browsers (no file sharing): the PDF downloads and WhatsApp opens with the note so the advocate attaches it. The text button is now "Send as text on WhatsApp".

- Draft share on WhatsApp (2026-11-12): the draft's Share card has "Send on WhatsApp for review" next to Email. It sends the same covering note and plain-text draft through wa.me. Drafts over 65,000 characters are cut, with a note asking the client to get the full copy by email.

- Bar Council verification off (2026-11-12): sign-up no longer asks for the State Bar Council or runs any enrolment check; advocates still enter their ID/enrolment number. Monthly roll import retired. Verification code left in the repo, unused.

- Pricing v2 phase A (2026-11-11), not yet deployed:
  - Drafts made through intake now count toward the monthly limit, once per matter and document.
  - New limits per advocate: Free 30, Solo 50, Chamber 40.
  - Practice is now sold as **Chamber**: ₹2,999 for 2 advocates plus ₹899 per extra advocate, up to 8, with a seat picker at checkout and on the renew screen. Seats are set only from Dodo's add-on quantity in the webhook.
  - Solo shows "incl. GST" and Chamber "+18% GST".
  - The billing page has a drafts meter with a notice at 80%.
  - The limit-reached modal names the renewal date and links to /app/billing.
  - New env vars `DODO_ADDON_CHAMBER_SEAT_{MONTHLY,ANNUAL}`. Migration 0104.

- AI cost efficiency (2026-11-11): intake document-type pick and question wording run Sonnet 5.5 at `low` effort (less hidden thinking billed as output). Fact extraction, drafting and every other feature unchanged. Quality gate on 12 benchmark briefs: same results as before; extraction at `medium` failed the gate and was not shipped. Admin AI-usage now prices gpt-5.5 at $5/$30 (was shown at about half). `INTAKE_EFFORT_TUNED=false` turns it off.

- Bar Council verification, phase 3 (2026-11-11): Punjab & Haryana and J&K advocates are checked against the councils' published roll PDFs, imported monthly (1st, 02:30 IST; only enrolment no. + name kept). Uttarakhand and Rajasthan checked live against their recent-enrolment lists (older enrolments not published by those councils). Migration 0103.

- Bar Council verification, phase 2 (2026-11-11): automatic roll check for Karnataka, Andhra Pradesh and Gujarat ("Check with the Bar Council" in onboarding, and again when onboarding finishes). New "inactive" outcome for advocates the roll lists as died, retired, suspended or transferred. Kerala and MP block automated checks; UP not built (result layout unconfirmed).

- Bar Council verification, phase 1 (2026-11-11): onboarding asks advocates for their State Bar Council (all 24 listed). Tamil Nadu & Puducherry advocates can verify on the spot: DifAi runs the council's own search, the council SMSes them an OTP, and the record (name, enrolment no./date, status) must match their number and name. Other councils are saved as "no automatic check" for now. Admin → Users shows BAR VERIFIED / UNVERIFIED. Migration 0102 (applied locally only).

- Co-Counsel lockdown (2026-11-10): an outside advocate gets exactly one case. Share link/QR is bound to their WhatsApp number (a forwarded link is refused); existing DifAi users accept from the link (was a dead end); "Remove access" on the Co-counsel tab and "Leave this matter" for the guest; guests see the matter chat only from the day they joined; expired links show Expired. Removed the unused email-invite and cross-firm-user API paths. Migration 0101.

- Draft box "Check what's missing" (2026-11-10): lists up to 6 facts the detected document still needs; the advocate's text is never rewritten.
- Draft box answers questions (2026-11-10): a legal question gets a short answer (one call, grounded on our law sources, unconfirmed sections listed to verify, recalled judgments removed) instead of starting a wrong format or a paid open draft. No matter is created.
- Android app 2.2 (code 13) loads https://difai.sirahdigital.in, so web deploys update the app on next open; offline/unreachable shows a bundled "Try again" page.
- Dictate works in the Android app (device speech recogniser via Capacitor plugin; website unchanged). 2.1-preview.3.

- Mobile fixes (2.1-preview.2, not committed: no git): notifications sheet portalled to body on phones + closes on Android back/Esc (was stuck under the blurred top bar); Draft composer no autofocus on touch; dock + FABs hide while the keyboard is open (lib/native.ts kb-open); no purchase UI in the Android app (Play policy); fontScale in configChanges so a font change no longer restarts the app.
- Launch splash (not committed: no git): Di grows into DifAi, "Powered by Sirah Digital", over an ink courtroom line drawing (fans turning, scales swaying, gavel tap); ~2.4 s, tap to skip, reduced motion respected; app lock prompt waits for it.
- Mobile app lock (not committed yet, no git): fingerprint/face/phone PIN on cold start and after 60 s away (Android build only); Settings → App lock (turning off needs an unlock); back on the lock screen exits; recents thumbnail hidden on Android 13+. Plugin @aparajita/capacitor-biometric-auth 10.
- Drafting (not committed yet): plaint and summary suit no longer crash with a 500 on a bad territorial basis. The jurisdiction clause now uses the s.20 CPC wording, not raw codes. A splice no longer fails on multi-line paragraphs. Ejectment-style composes are no longer lost to a filled gap or a "Rs. 0". The fallback draft gets the per-format guide and authorities. Mutual-consent briefs are classified correctly.
- eFiling Sign In: compact two-column card that fits one screen; State list retries a failed load instead of staying empty.
- eFiling redesign step 1: DifAi PageHeader (connected-as meta, Sync / Profile / Log out / New filing), 8 sections in a PillNav with a screen chip row; old `?m=` links still open the same screen; Sign In as a DifAi card (chips for user type, Listen / New code); portal header, menus and efiling-portal.css no longer used by the page. PillNav wrap: square corners so wrapped pills are not clipped.
- eFiling Sign In: the portal one-step Sign In (captcha shown on load, audio captcha, Register / Forgot Password); a new Sign In never ends a live session; unused Sign In pages close after 3 min.
- Land Records results: the result is shown as the government's own document (the site's page printed with its screen styles, or the PDF it served - Patta extract, FMB sketch, etc.) drawn in the panel; the parsed table is only a fallback when there is no document.
- Drafting r7 (2026-11-05): "Draft now" re-drafts on the engine after filling its own gaps; motion/reply dates default to today, an s.106 quit date to notice + 16 days; BNSS defaults apply to any format with a fresh-proceeding field (maintenance); a WS/counter pleads unanswered paragraphs "not admitted"; the extractor derives period counts, place of signing, jurisdiction basis and obvious categories. Suite runs 6 at a time.
- Drafting (2026-11-06): MACT pleads the computed compensation when the advocate's total differs, and says so in the chat; the dev Claude Code route survives extension updates.
- Drafting (2026-11-06): no stray "[to be drafted]" left in a composed draft (filled from the brief or named); prayers read cleanly ("pleased to dismiss...", not "pleased to To dismiss...,"); bail drafts no longer print "Crime No. Crime No.".
- Drafting efficiency (2026-11-07): the drafting progress poll no longer counts toward the 600-per-15-min IP limit, so a whole office drafting behind one IP no longer hits 429s.
- Drafting (2026-11-07): stand-in dates show as "[DATE TO BE CONFIRMED]" in the TN dot format and never equal a real date; notice, lease-expiry and cause-of-action dates are derived from the record; compose fills a placeholder the brief states; the extractor derives the district and the deponent.
- Drafting efficiency (2026-11-07): typing in the "Missing details" panel re-drafts on the engine only (no model call, does not use the hourly drafting limit or AI quota); "Update document" applies the full wording polish.
- Drafting (2026-11-07): a bail petition left without an application date is dated today, not with the offence date.
- Drafting (2026-11-07): civil suits per senior review — plaint (firms' place of business, agreed interest, cause of action from invoice/notice dates, Art. 14), summary suit (Art. 35, City Civil Court below Rs. 1 crore), ejectment (vacant site outside TN 2017 Act, s.50 valuation), specific performance (Art. 54, s.45(a), refund interest), consumer complaint (CPA ss.34/69 in the skeleton, full money prayer), Rent Court eviction (notice date with service gap), indigent application (all defendants, s.37(1) share valuation).
- Drafting (2026-11-07, r13): 11 Close formats - descriptive defendants as name gaps (amendment_ia), unknown batta side = Plaintiff, call-for-records case from the purpose, s256 affidavit opener not repeated, no 'intestate succession' as a personal law, writ respondent addresses + in-order para labels, own-occupation ground pleaded by its words with no clause letter / verify note (hrcp_eviction), opposite parties split + account numbers allowed + COA-date extraction rule (consumer_complaint regression), I.A. in A.S. header + computed delay only (condone_delay_petition), indigent parentage gaps + pleaded plaint facts/heirship, s80 plaintiff from client + no-notice illegality.
- Drafting (2026-11-08, r14): 12 formats made deterministic - empty place fields from the court/party town (API), lettered grounds and (a) sub-items re-lettered with no empty "9. D.", sale-deed payment mode cut to its instrument, call-for-records case from case_ref when cc_no is the own case, hrcp prose own-occupation ground classified, ejectment schedule always printed, affidavit_kind optional, unstated "not registered" / case_dismissed dropped, succession age + no-nominee, condone-delay unexplained stretches named and restored, indigent plaint cause noun phrase + own verification count.
- Deadline alerts (2026-11-08): limitation deadlines notify at 90, 30, 7 and 1 day before and on the day; open tasks notify by priority (very high from 3 days before to 1 day overdue, low on the day only). Bell for all, email for the urgent ones.
- Drafting (2026-11-08, r15): 6 formats held deterministic across runs - substituted_service role-string plaintiffs ("(client in ...)", "my client") become a name gap; indigent descriptive respondents ("Brothers of her late husband (names not stated)" etc.) become numbered R1/R2 gaps; dv_application respondents joined by ";"/"and"/"," split + de-duplicated, MUST_PLEAD s.3/s.17/s.27; affidavit authority (Tahsildar) derived from proceeding/body/brief, deponent = applicant, request derived; condone_delay gap markers kept even when the narrative slot is filled, appeal petitioner = Petitioner/Appellant, sub-items re-lettered from any start and keep content after a cut opener; criminal_revision para 1 names the impugned appellate judgment (engine) and is re-anchored after compose (API), a ground left with only a back-referring fragment goes.
- Drafting (2026-11-08, r16): the 16 benchmark checklist FAILs fixed in engine/API code - s138 notice invokes proviso (b) and states RPAD; bail cause titles print "S/o"; injunction plaint has age/occupation, a pecuniary averment and a clean "restraining the defendant, his men ... from" prayer; WS cites the Limitation Article and explains an Order VIII Rule 1 delay; mutual divorce has Hindu/age/address cause title, HMA averment and Section 19; pension writ cites the TN Pension Rules, dates the representation and is dated today; deeds have two witness slots.
- Drafting (2026-11-08, r17): 5 v2 checklist items the compose step lost now come from the engine skeleton + MUST_PLEAD - s138 complaint s.141(1) averment per officer-accused "at the time the offence was committed" and s.142(1)(b) one-month limitation with the cause-of-action and last dates; injunction defendant relationship (defendant_relationships) in cause title and para 1; WS denies a claimed interest rate as excessive and not agreed (plaint_claims or a reply quoting it); mandamus prayer "within a period of eight weeks from the date of receipt of a copy of this order" (compliance_period).
- Drafting (2026-11-08, b1 criminal): the 22 b1 checklist FAILs across 13 criminal formats fixed in the engine - appeal cites Art. 115(b)(i) with its meaning; revision pleads s.138 NI Act from a cheque conviction, sets aside both judgments and acquits, suspension affidavit; quash marks inferred sections "[to be confirmed against the FIR]" and drafts the affidavit and the stay Crl.M.P. in full; him/her, he/she, "C.C. / Crime No." and the surety-history alternative resolved; recall_warrant and s317 affidavits; s317 date line; surety memo cause title and grammar; memorandum files the surety affidavits and prays to accept and release; surety affidavit Rule 14(4)/(6); call-for-records clean C.C. line and the complainant as filer; s256 restore prayer only on restore_sought/case_dismissed with an advocate note. API: withBriefSignals (restore_sought, quash section marker) + quash MUST_PLEAD.
- Drafting (2026-11-08, b3): 14 family/MACT checklist FAILs fixed in the engine skeleton (+ MUST_PLEAD where wording matters) - HMA averment in contested divorce, judicial separation and RCR; JS/RCR petitioner age + occupation in the cause title; JS s.10 read with s.13(1)(ia); RCR respondent residence from the facts; maintenance s.145 BNSS, no stub para, verification; DV s.17 right to reside + s.27; MACT Tribunal name as briefed, verification + claimant's affidavit.
- Drafting (2026-11-08, b4): batch-4 engine checklist FAILs - general_notice Sub: line (subject field, else derived from act_required); appeal record row pages "(120 pages)"; batta_witness unknown side -> "[Plaintiff / Defendant]" gap; coding_sheet Place/Date/counsel signature; copy_application rule -> named gap "[rule under the Civil Rules of Practice]" + documents named in the body; POA executed abroad -> foreign place (from executant description) or a named gap; civil summons O.VIII R.1A documents direction (Form 1 App. B wording); urgent_petition prejudice plea (prejudice field, else derived from construction grounds) and Dated always printed (filing_date fallback).
- Drafting (2026-11-08, b2): 29 civil-batch checklist FAILs fixed in engine output (+ compose guards) - plaint firm "rep. by its Managing Partner"; summary suit pecuniary reason for the City Civil Court and the agreed rate cites the loan agreement; ejectment s.106 TPA as amended in 2002; specific performance schedule; injunction prayer without "till the suit is disposed of" and no "[to be drafted: ...]"; indigent age, O.XXXIII R.5(e), co-heirs' shares; condone-delay affidavit in the first person; adjournment suit nature, date line, deponent age; substituted-service affidavit prayer; execution salary bank + s.60(1) CPC limits; civil revision prayer allows the I.A., Art. 227 limitation, stay-CMP affidavit; first appeal s.52 valuation basis + O.XXVI R.10 ground; SLP list of dates and annexure index derived from the facts; transfer deponent age; O.39 R.2-A property set out or named; counter affidavit blank reply answered from the respondent's own case, prayer with costs; sentence splitter keeps an all-caps case title ("REP. BY LRS.") whole.
- Contract Review provider (2026-11-08): REVIEW_PROVIDER=openai runs Contract Review on OpenAI (gpt-5.5) while drafting stays on Claude Sonnet 5.5; a missing OpenAI key fails the review instead of switching providers.
- Redraft (2026-11-08): exact corrections ("change X to Y", "X should be Y", "delete para 5", "add para after 7: ...") are applied by code with no AI call, no quota and no hourly limit; anything else still goes to the AI.
- Drafting (2026-11-08, b1-b4 v2): last 22 checklist FAILs fixed in the skeleton, tail or prayer so compose cannot lose them (criminal appeal title particulars; s.138 reply return period; surety memo documents; plaint rate claimed vs agreed; summary-suit article never a gap; HRCP arrears months x rent in the prayer; registered agreement; indigent valuation/jurisdiction/co-heirs named gap; condone-delay decree ref; SLP index with the impugned judgment; supporting affidavits for divorce, judicial separation, RCR, succession; second-motion 18-month statement; MACT next friend and s.147/149 indemnity; demand notice principal vs interest; s.106 month-end rule guard). Bracket stubs dropped from composed bodies.

## fix(engine-choice-fields) — 2026-11-08
- An optional choice field the brief reading left blank or off-list no longer sends the whole draft to the AI fallback.
- Contested divorce: s.19 limb derived from the stated places; named gap when none is in the court's town. DV: incident category read from its description.
- Compose (2026-11-08): s.138 complaint's territorial-jurisdiction para restored by code if dropped; counter-affidavit documents and writ delay rules; counter stance tolerant; affidavit jurat dated today.
- Attached formats (2026-11-08): each blank is read with its sentence so the value fits; typed clause numbers kept; hints beside blanks dropped; "Rs. 110000," grouped (bug hit every format); "the 5" -> "the 5th"; "1 month(s)" resolved.
- Attached formats (2026-11-08): a failed PDF/photo read shows a plain message; the provider's billing or key text only goes to the log.
- fix(attached-formats): in dev, PDFs and photos are read through the Claude Code route (`attachments` via stream-json), not the API. Court heading no longer doubles "COURT"; a blank opening its line sees the line above; s138_reply cheques read mid-sentence; composer no longer writes sentences or end tags only to hold a gap.
- fix(attached-formats): when the Anthropic read of an attached format fails, the same read runs on OpenAI (`OPENAI_API_KEY`, `OPENAI_MODEL`); if both fail the advocate sees the plain message. A firm's letterhead stays fixed text.
- feat(open-drafting): F1. The format picker can say a document is not on the list, instead of forcing a related format. Only the document's name, not facts after it, can pick a format. Until F2 lands the advocate is told to attach a format.
- feat(open-drafting): F2. A document with no format here is drafted by blueprint, draft, review and repair, modelled on the firm's formats or the closest built-in. No database change.
- feat(open-drafting): F3. Judgments from memory are removed; provisions our sources cannot confirm are listed to verify; invented dates and figures and misnamed Acts go back for repair.
- feat(open-drafting): F4. Word layout follows the kind of document; court layout stays the default.
- feat(open-drafting): F5. The screen says when a draft had no verified format and shows the points to confirm and citations to verify.
- fix(open-drafting): F6 findings. Today's date is never the document date; inferred places bracketed; computable figures worked out; no saved limitation unless stated; section cited alone unless certain; review drops notes that misstate the law; picker judges by the main relief.
- fix(drafting): stand-in dates read "[date to be provided]", one gap style the missing-details panel recognises.
- fix(engine): adjournment petition f-string broke the Python 3.11 server image; guard test added.
- Land Records fixes: Tamil extracts (Patta) printed as boxes on the server - Tamil/Devanagari Noto fonts added to the API image; FMB/TSLR sketch kept as the PDF the site sent (its link is single-use) instead of a print of Chromium's PDF viewer.
- 2026-11-11 fix(land-records): FMB sketch shown in a viewer/iframe (blob or embed) is fetched as the PDF, never printed; Download PDF also at the top; nav label "TN Land Records".
- 2026-11-11 fix(land-records): OTP mobile number no longer remembered in the browser (was shown to every account on that browser).
- 2026-11-11 fix(land-records): result print drops trailing blank pages (Patta came out as 2 pages, 2nd blank).
- 2026-11-11 fix(land-records): Patta result = extract + the FMB sketch the site embeds under it (kept as it arrives, single-use), as page 2; viewer frame no longer prints blank.
- 2026-11-12 fix(navigation): Back returns to the previous tab instead of leaving the page. Tabs on the case page, Settings, People & Roles, Workload & Profitability, Calculators and Research now live in the URL as history entries (useUrlTab); Land Records keeps the open service while on My applications and adds a back button to it.

## feat(seo-pages) — 2026-11-13
- 8 prerendered public pages (6 feature pages, FAQ, About) from `apps/web/seo/pages.mjs`; static HTML, no JS, per-page canonical/OG/JSON-LD (WebPage, BreadcrumbList, FAQPage).
- Build writes `404.html`, `sitemap.xml`, `llms.txt` (`node seo/prerender.mjs` after `vite build`; not in the Android build).
- nginx: real 404 for unknown paths, SPA prefixes keep the app shell, trailing slash 301.
- robots.txt allows search and AI bots; landing links all pages.

## feat(seo-guides) — 2026-11-13
- Published: user approved all 5; `draft` removed, linked from index.html. 13 pages prerendered, sitemap 14 URLs. Web suite 204/204.
- 5 source-cited answer guides in `apps/web/seo/pages.mjs`, all `draft: true` (not in build, sitemap or llms.txt) until approved. Tests extend to drafts.

## fix(landing-claims) — 2026-11-13
- Landing states 84 formats, eFiling hand-off, English drafting, data in Mumbai, District/High Court tracking.

## feat(razorpay-billing) — 2026-11-13
- Razorpay replaces Dodo Payments (Dodo never went live). Checkout = Razorpay subscription + `/api/billing/pay/:id` page (Razorpay Checkout, redirect back via `/api/billing/callback`); plan changes only on the signed webhook `/api/billing/webhook` (X-Razorpay-Signature, event id idempotent).
- Migration 0105 (additive, local only): `firms.razorpay_*`, `razorpay_plans` (one Razorpay plan per plan/cycle/advocates/price, created on first purchase).
- Plan change = new subscription from the renewal date; old one cancelled at cycle end once the new one is authorised (no double charge, works with UPI Autopay).
- Kept from the Dodo test run: Solo refused for a practice with members; first charge not logged as a renewal.
- Test keys ignored in production. Billing, admin and privacy text say Razorpay. `DODO_*` env removed.

## fix(razorpay-billing) — 2026-11-13
- Two paid checkouts no longer leave two live subscriptions: the newest wins, the other is cancelled at once (refund from the dashboard); stale retries can't switch the plan back.
- Webhook signature failures log which part is missing (no secret values).

## fix(razorpay-billing) — 2026-11-13 (2)
- Plan change: when the new subscription starts, the replaced one is cancelled at once (safety net if the end-of-cycle cancel didn't take).
- Billing banner tick icon no longer stretches across the row.

## feat(gst-invoices) — 2026-11-13
- Every successful Razorpay subscription charge gets a GST tax invoice from Sirah Digital (DIF/FY/serial, gapless), CGST+SGST in Tamil Nadu else IGST, PDF in DifAi format.
- Owners: Invoices list + PDF on Plan & Billing. Superadmin: GST invoices list in /admin/billing. Migration 0106 (additive).

## fix(engine-court-heading) — 2026-11-18
- New `bare_designation()` in pipelines/_court.py strips a leading "(In) (the) Court of (the)" / "The"; used by s138_complaint and cause_title so headings never read "COURT OF THE THE".

## test-payment (2026-11-18)
- Test code on allow-listed accounts = simulated payment: no Razorpay, plan applied after 10 s, no GST invoice (owner). Brief Packs keep ₹1.
- DEPLOYED 03b159a 2026-11-18 (api only; backup pre-deploy-20261118-114318.dump; rollback image lexdraft-api:prev-20261118-114318).

## formats-page (2026-11-18)
- Sidebar "Formats": the 54 LAWE forms on their own page; view in-app, download blank PDF/Word (web only).
- DEPLOYED e0db362 2026-11-18 (web only; rollback image lexdraft-web:prev-20261118-170725).

## solo-wording (2026-11-18)
- Solo accounts: org section/breadcrumbs "Practice" (Chambers/Firm on those plans); Team Chat hidden without a Munshi seat; Settings wording by plan.

## coming-soon (2026-11-18)
- eFiling, Clause Bank, Matter Intelligence, Title Reports, Mock Arguments marked Coming soon; co-counsel "Send on WhatsApp". Anantha test account switched to Firm (DB, owner request).
- DEPLOYED efaa029 2026-11-18 (web only; rollback lexdraft-web:prev-20261118-172451). Includes solo-wording 71b09e7.

## team-work (2026-11-18)
- Teams-style work assignment: member workload cards, Assign task/case, member picker for tasks, board filters, assignee notifications (+ WhatsApp once a template is approved). Migration 0118 (additive).

## hearing-reminders (2026-11-18)
- Checked eCourts sync on prod (working). Hearing reminders now go to the case lead; day-before WhatsApp once an approved template is set (WHATSAPP_HEARING_TEMPLATE).
- DEPLOYED 25ac53b + 7add287 2026-11-18 (api+web; 0118 applied after backup pre-deploy-20261118-175709.dump; rollback images prev-20261118-175709).

## web-push (2026-11-19)
- Phone notification bar for every in-app notice (web push, VAPID). Settings → Phone notifications. Migration 0119 (additive). Email reminders dropped (owner).
- DEPLOYED e5dd534 2026-11-19 (api+web; 0119 applied after backup pre-deploy-20261119-044726.dump; VAPID keys in prod .env.docker, backup env.docker.pre-vapid-*; rollback images prev-20261119-044726).
- 2026-11-20 feat(draft-loader): while a draft is written the prompt box shows the DifAi "Draft Lines" loader (lines type in, cursor blinks) with the live stage; the "Draft in BNS / BNSS" switch is removed (drafting already follows BNS/BNSS/BSA and maps IPC/CrPC sections); the credits meter takes its place beside Language.

- 2026-11-20 feat(activation-funnel): admin dashboard "Sign-up funnel" — last 8 sign-up weeks (IST): signed up → paid → first draft → active in week 2 → paid again; test/admin/free-launch firms left out. GET /admin/business/funnel (read-only, no migration). Not deployed.
- 2026-11-20 feat(reminders): Remind me on hearings (automatic, or also at a picked time); Reminders card + Set a reminder on the case page; reminders.due job every 5 min; 19:00 "Hearing tomorrow"; Court Diary "remind N days before" now fires (was saved, never sent); Turn-on-notifications banner + bell row; Android app push via FCM (@capacitor/push-notifications, lib/fcm.ts, /notifications/push/native). Migration 0120 (reminders, push_subscriptions.kind), additive.
