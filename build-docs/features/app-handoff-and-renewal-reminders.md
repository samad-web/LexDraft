# Feature: Pay on the website, use the Play Store app (app hand-off + renewal reminders)

Status: built 2026-11-17, NOT deployed. Owner-approved 2026-11-17. Migration 0116.

## Purpose
- The Android app is sign-in only (play-sign-in-only.md): people pay on the website. After paying they need to find the app and know which account to sign in with; before the paid period ends they need a nudge to renew on the website (no Autopay, no grace).

## Architecture
1. **Website hand-off** (`components/GetTheApp.tsx`): "Use DifAi on your Android phone too. Sign in with the same account (<email>)." + plain link "Get the DifAi app on Google Play" (`PLAY_STORE_URL` in `lib/play-policy.ts`). No Google badge artwork. Returns nothing when `isNativeApp()`.
   - Shown on Plan & Billing when back from Razorpay (`?checkout=done|paid`) and the plan is active. Onboarding payment also returns to `/app/billing?checkout=paid`, so this is the post-onboarding landing too.
2. **"Plan active" WhatsApp** (`services/plan-whatsapp.service.ts` `sendPlanActive`): runs in the existing `invoice.whatsapp` job, right after the invoice message (same job → always that order; one failing never stops the other; the job rethrows so pg-boss retries, and both are idempotent).
   - Why not one combined message: `difai_invoice` is already Meta-approved and live; changing it means a new approval and the invoice message also goes for Brief Packs and custom plans. Two short messages, invoice first, is the safe choice.
   - Only for invoices whose plan is advocate / chambers / law_firm (plan payments incl. renewals and the ₹1 test — same rule as the invoice). Not Brief Packs, admin credit sales or custom/enterprise plans.
   - Once per payment: `subscription_invoices.plan_active_wa_sent_at` is claimed atomically before sending, reset with the reason in `plan_active_wa_error` on failure.
3. **Renewal reminders** (`sendRenewalReminders`): pg-boss job `plan.renewal.reminders`, daily 10:00 IST.
   - IST calendar days to `renews_at`: 7..2 → `d7` (2-6 only if a run was missed), 1 → `d1`, 0 → `d0`.
   - One per firm + period (`renews_at`) + kind: `plan_renewal_reminders` primary key, claimed before sending, claim deleted on failure (a later run in the window retries).
   - Renewed = `renews_at` moved later = new period, nothing due yet.
   - Only `plan_status='active'`, plan advocate/chambers/law_firm, not free_plan / free_launch / is_demo, no `razorpay_subscription_id` (old Autopay renews itself), no superadmin in the firm.
4. **Landing**: footer "Product" → "Get the Android app" (Play listing). The landing never renders in the app (App.tsx).
5. **Recipient** (both messages): the firm owner (Solo Advocate / Managing Partner, oldest), only with `users.phone` AND `phone_verified_at` set, never a superadmin.
6. **Sender**: `whatsappService.sendTemplate` (Wasi Hub, named params, same as `difai_invoice`). No second sender.

## WhatsApp templates the owner must get approved (Wasi → Meta)
Category **UTILITY**, language English, named params like `difai_invoice`. Until approved, leave the env empty (feature off, logged, nothing breaks).

`difai_plan_active` (env `WHATSAPP_PLAN_ACTIVE_TEMPLATE=difai_plan_active`):
> Hi, your DifAi {{plan_name}} plan is active until {{end_date}}. Get the DifAi Android app on Google Play: {{app_link}} and sign in with {{account_email}}. Thank you for choosing DifAi.

Sample values: plan_name=Advocate, end_date=17 Dec 2026, app_link=https://play.google.com/store/apps/details?id=in.sirahdigital.difai, account_email=asha@example.in

`difai_plan_renewal` (env `WHATSAPP_RENEWAL_TEMPLATE=difai_plan_renewal`):
> Hi, your DifAi {{plan_name}} plan ends on {{end_date}}. Renew at {{renew_link}} to keep using DifAi without a break. Thank you.

Sample values: plan_name=Chambers, end_date=24 Nov 2026, renew_link=https://difai.sirahdigital.in/app/billing

## Impact map
- `jobs.service.ts`: `invoice.whatsapp` handler now also sends plan-active; new cron job. Invoice sending unchanged (still first, still idempotent).
- `invoice-whatsapp.service.ts`: `day()` exported (reused), no behaviour change.
- `env.ts`: 2 optional env vars, default empty = off.
- DB 0116 (additive): 2 columns on `subscription_invoices`, table `plan_renewal_reminders`.
- Depends on the invoice being issued (`INVOICE_SELLER_*` set, as on prod): no invoice → no plan-active message.
- Web: BillingView (return notice), LandingView footer, play-policy (URL constant). Native: nothing new shown (Play policy).

## Edge cases
- WhatsApp/Wasi down or template paused → error kept (plan-active) / logged (reminder); payment, activation and invoice unaffected.
- Duplicate webhook / job retry / two workers → atomic claims, one message.
- No or unverified number → skipped, reason on the invoice.
- d1 send fails → next day is d0, so that d1 is lost (logged); d7 retries within its window.
- Plan already ended by 10:00 on day 0 (renews_at early morning) → still "ends on <today>"; the app blocks only from the next day (plan-status uses start of day).
- Firm renews between reminders → new renews_at, no more reminders for the old period.

## Acceptance criteria
1. AC1 Website after a plan payment shows the Play link + "Sign in with the same account (<email>)"; nothing in the native app; no badge artwork.
2. AC2 One "plan active" message per plan payment to the verified owner number with plan, end date, Play link, email; not for Brief Packs; failures recorded and retried, never block payment; off when the template env is empty.
3. AC3 Reminders at 7 / 1 / 0 days, once each per period; none after renewal; none for free-launch, demo, enterprise custom, Autopay, superadmin or unverified-number firms; off when the env is empty.
4. AC4 Landing footer links to the Play listing.
