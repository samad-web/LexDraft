# Feature: Pricing v4 plan catalogue in the app (Sanad / Vakalat / Brief / Associates / Munshi)

Status: **built 2026-11-13** (approved: "1a, 2a, 3 ok"). Owner chose "update prices first" before any deploy. Migration 0107 applied locally only. Prices are the v4 DRAFT (`OneDrive/DifAi Pricing Plan v4 - Low-Entry Credit Plans.docx`): **not final**, so they live in one config.

## Purpose
- The app still sells pricing v2: Free, Solo ₹1,499, Chamber ₹2,999 + ₹899, with draft caps. v4 renames and reprices every plan and moves AI to page credits.
- This feature changes **what is sold and billed**: catalogue, checkout, Razorpay plans, seats, invoices and plan cards.
- **What is metered** (page credits, locking, top-ups) is `features/ai-credits.md` (another session, awaiting approval). This feature gives that one its per-plan allowance.

## v4 catalogue (all prices GST-inclusive; one config file `lib/plans.ts`, mirrored in web)
| Plan id | Name | Monthly | Yearly | Pages / month | Seats | Tier (permissions) |
|---|---|---|---|---|---|---|
| `sanad` | Sanad | ₹199 | ₹2,190 | 25 | 1 advocate | Solo |
| `vakalat` | Vakalat | ₹399 | ₹4,490 | 75 | 1 advocate | Solo |
| `brief` | Brief | ₹1,499 | ₹16,490 | 200 | 1 advocate | Solo |
| `associates` | Associates | ₹649 per advocate, min 2 (₹1,298 for 2) | ₹7,140 per advocate | 75 per advocate, shared pool | 2–8 advocates | Practice |
| `munshi` add-on | Munshi seat | ₹149 per seat | ₹1,590 | none | clerk / staff, no AI | (any paid plan) |
| `partners` | Partners | quote | quote | custom | 9+ | Firm |

- **Associates is a flat ₹649 per advocate.** v4 had "₹1,299 for 2 + ₹649 each", which is ₹1 off. With a flat rate, Razorpay's subscription `quantity` × one per-advocate plan works directly.
- Brief Packs (top-ups) belong to ai-credits (one-time Razorpay orders); not this feature.

## Architecture
- **`lib/plans.ts`:** the single source of truth for id, name, prices, pages, seats and tier. `billingPlans()`, checkout, MRR, the invoice description and the ai-credits allowance all read it. Web `PlanCards`/`SIGNUP_PLANS` mirrors it; the existing test keeps them in sync.
- **Migration 0107 (additive):**
    - widen the `firms.selected_plan` check to the new ids (old `solo`/`practice` stay valid for history);
    - widen the `razorpay_plans.plan` check;
    - add `razorpay_plans.munshi_seats`;
    - add `firms.munshi_seats`.
- **Checkout `{ plan, cycle, advocates?, munshi? }`:**
    - **Razorpay plan:** one per (plan, cycle, advocates, munshi, amount), created on first purchase as today, so add-ons need no Razorpay add-ons. The webhook maps it back to plan, advocates and munshi seats.
    - **Seat checks:** the advocates count must cover active advocate members plus pending invites. Munshi seats cover users with a Munshi role (Paralegal / Legal Secretary).
- **Tier mapping:** sanad/vakalat/brief → `Solo`; associates → `Practice`; partners → `Firm`. Permissions are untouched.
- **Invoices:** the description line reads "DifAi Vakalat plan, billed monthly" / "Associates, 3 advocates + 1 Munshi seat".
- **Web:**
    - plan cards with the new names;
    - a one-line meaning of each name (from the v4 glossary) on the card;
    - "pages a month" instead of "drafts";
    - advocate and Munshi pickers for Associates;
    - the billing page label.
- **Existing paying firms:** none (Razorpay is not live). Firms on the free launch keep it until 1 Jun 2027 (as promised).

## Decisions (owner, 2026-11-13): 1a, 2a, 3 ok
1. **New sign-ups after this ships:** v4 says no free plan. Options:
   - (a) Free launch only for accounts that already exist; new sign-ups must pick a paid plan. Sanad at ₹199 is the cheap way in.
   - (b) Keep offering "Free till 1 Jun 2027" to new sign-ups too.

   **Recommended: (a).** The landing page and sign-up copy would say so, and existing users keep exactly what they were promised.
2. **Munshi seat role:** the app has no "Munshi" role. Options:
   - (a) A Munshi seat = an invited **Paralegal** or **Legal Secretary**. AI features are hidden for them; they get diary, cause list, eCourts and documents.
   - (b) A new "Munshi" role.

   **Recommended: (a)**, which reuses the existing roles.
3. **Release together with ai-credits:** until page credits exist, the app can only count drafts. Recommendation: build this first (ai-credits needs the plan ids), but **deploy both together**, so "pages" are never advertised before they're metered.

## Impact map
| Area | Files | Risk |
|---|---|---|
| Catalogue | new `lib/plans.ts`; `billing.service.ts` (PAID, CHAMBER_SEATS, DRAFTS replaced) | wrong price → wrong charge: amounts asserted in tests per plan × cycle |
| Checkout / webhook | `billing.service.ts`, `billing.routes.ts` (schema: plan enum, advocates, munshi) | seats from Razorpay plan mapping only, never the browser |
| DB | migration 0107 | live change → approval at deploy |
| Permissions | tier mapping only | none if mapping is right; tested |
| Invoices | `subscription-invoice.service.ts` description | none |
| Sign-up / onboarding | `PlanCards.tsx`, `AuthView.tsx`, `OnboardingView.tsx`, `onboarding.service.ts` (Free option per decision 1) | users stuck without a plan → covered by tests |
| Web billing | `BillingView.tsx`, `DraftMeter` copy, admin billing labels | layout |
| Landing / SEO | pricing text on the landing, if any | stale prices public: grep and update |
| ai-credits | its `plan_credit_allowance` reads `lib/plans.ts` | coordinate: ai-credits takes migration 0108 |

## Edge cases
- Plan change between individual plans (Sanad → Vakalat): the new subscription starts at renewal, as built.
- Individual → Associates with existing members: the advocates count is ≥ members.
- Associates → individual with members > 1: refused (`seats_below_members`).
- Munshi seats with no Munshi users: allowed (pre-buy). Fewer seats than Munshi users: refused.
- Old ids (`solo`, `practice`) on old rows and events: still rendered (label map), never sold again.

## Acceptance criteria
1. `billingPlans()` returns exactly the v4 table, and web `SIGNUP_PLANS` matches it (test).
2. Checkout charges the right amount for every plan × cycle × advocates (2–8) × munshi (0–3): computed, and asserted in tests.
3. The webhook sets selected plan, tier, advocate seats and Munshi seats from the Razorpay plan only.
4. Seat checks refuse fewer advocates or Munshi seats than people using them.
5. The invoice line names the v4 plan, advocates and Munshi seats.
6. New sign-up behaves per decision 1; existing free-launch users are unchanged.

## As built (2026-11-13)
- **New sign-ups (1a):** onboarding offers only paid plans and opens Razorpay at once. The firm gets a **30-minute payment window** (`PAYMENT_WINDOW_MS`, plan_status trial, not free); after it, sign-in returns 402 + renew token → plan cards. Associates has **no 14-day trial** any more (consequence of 1a).
- **Payments must be on:** without Razorpay keys a paid onboarding is refused (503) with no changes, so new users are never half set up. Keys go in before this ships.
- **Free launch:** migration 0107 sets `firms.free_launch` for every firm that has `free_plan` today. Only those can pick Free at onboarding, and a lapsed one-advocate plan goes back to free only for them.
- **Munshi seat (2a):** counts users / pending invites with role Paralegal or Legal Secretary (custom "Other" roles count as advocates). A Munshi may also use a spare advocate seat. Checked at checkout and at invite + accept.
- **Not done (needs a decision):** "AI hidden for Munshi". Paralegal / Legal Secretary already lack `drafting.ai`, but keep `drafting.basic` and `mock_arguments.use`. Removing them changes existing firms' permissions; AI pages come from the firm's shared pool anyway, so permissions were left untouched.
- **Fixed on the way:** accepting an invite counted that invite twice, so a firm exactly at its seat count could not accept (e.g. Chamber 2 seats: owner + 1 invite).
- **Not changed:** the landing page's pricing section (already stale pre-v2 prices; landing claims on hold). Draft meter still counts drafts until ai-credits ships (decision 3: release together).

## Change 2026-11-14 (owner): a real Munshi role, interim free sign-up
- **Munshi = the advocate's clerk**, as in practice:
    - **What a munshi does:** keeps the diary and cause list, tracks hearings and next dates, files papers (eFiling), pays court fees, keeps the case files. No drafting, no AI.
    - **The role:** new system role **Munshi** (migration 0110): matter view/create (diary, hearings, eFiling), client view, documents (drafting.basic for uploads), calculators, members list. No AI drafting, mock arguments, research or matter intelligence. The baseline matter-intelligence key is removed for Munshi in permissions.service. Any AI credit charge by a Munshi is refused (403 `munshi_no_ai`).
    - **Seats:** a Munshi seat covers role `Munshi` only. **Paralegal and Legal Secretary now count as advocate seats.** This replaces decision 2a.
- **Interim:** while production has no live Razorpay key, a new sign-up gets the free launch (25 credits a month, `free_launch` set) instead of a 503. Paid-only sign-up starts by itself once the key is set.
- **Landing page + SEO pages** show the v4 plans (`V4_LIVE = true`). The "free account", "14-day trial" and "never charge per AI generation" claims are removed.
