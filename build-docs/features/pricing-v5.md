# Feature: Pricing v5 (Advocate / Chambers / Firm / Enterprise, prices + GST)

> Updated 2026-11-17 by signup-hardening.md: onboarding no longer sets the plan tier/seats before payment (Solo / 1 until the webhook); payments off → 503 `payments_disabled` (the interim free launch is withdrawn).

Status: **built 2026-11-16** (owner approved, answers below). Migration **0113** applied locally only; prod needs the owner's go. Replaces the v4 catalogue (`features/pricing-v4.md`). Keeps AI credits (`ai-credits.md`), Brief Packs (`brief-packs.md`), manual renewal (`manual-renewal.md`), the paid-only gate (`paid-signup-gate.md`), Munshi (`solo-munshi.md`) and seat enforcement (`seat-enforcement.md`).

## Owner decisions (final, 2026-11-16)
- Four plans by team size. Prices **exclude** 18% GST.
- Yearly = 11 × monthly ("1 month free").
- Existing paid accounts move to v5 **now**. Paid-until is honoured: no extra charge, no refund.
- Sign-up stays paid-only (no free plan, no trial). Manual pay per period, 7-day reminder, no grace.

### Answers to the open questions (owner, 2026-11-16)
1. **Credits 150 / 350 / 750** a month.
2. **Analytics on every plan:** `analytics.firm` (+ `reports.activity`, which its data route needs) is granted to the Solo and Practice tiers and to the Solo Advocate role (0113). Firm Admin (Managing Partner) and Partner already had it. Practice Group Lead stays without it (0013). A Munshi never gets it. The Firm plan keeps the Firm tier.
3. **Munshi:** ₹149 + GST a month, ₹1,639 + GST a year, max 4 on every paid plan.
4. **Brief Packs:** ₹179 / ₹389 / ₹799 / ₹1,899 + GST for 25 / 60 / 130 / 330 credits, 365 days (owner 2026-11-24, band C: 53–63% margin; earlier the same day ₹119 / ₹285 / ₹615 / ₹1,549 at 42–45%; first v5 ₹429 / ₹849 / ₹1,699 / ₹4,249).
5. **Terms bumped** to 1.2 (API `TERMS_VERSION` = web `LEGAL_VERSION`), so every user re-accepts. Wording is "+ GST". The refund rules are unchanged, reworded for the new plans:
    - Advocate (the entry plan, like Sanad/Vakalat): not refundable;
    - Chambers and Firm yearly (like Associates): 7 days if no more than 10 credits were used; monthly: not refundable;
    - Enterprise: as quoted.
6. **Plan ids:** `advocate` / `chambers` / `law_firm` / `enterprise`. Old ids stay readable.
7. **Move everyone now**, with paid-until honoured.
8. **Enterprise:**
    - per-firm `firms.credit_allowance` (nullable), used by `allowanceFor` while the plan is active;
    - set with the seat count in the admin console firm editor (audited `firm.plan.update` / `firm.update`);
    - a self-serve payment clears it.
9. **Wording (owner):** plans are described in **AI credits**, not pages ("150 AI credits a month"; packs "25 credits"), with "1 credit = one 400-word drafted page" where it helps. Credit costs and numbers are unchanged.

### As built: differences from the design below
- **Invoice:** still one line ("DifAi Chambers (up to 3 advocates) + 1 Munshi seat, billed monthly"), with the taxable value = plan + Munshi ex-GST. Two lines were not needed.
- **Seat-floor trigger:** the 0046/0104 trigger raised a firm to **9999 seats** whenever its tier became Firm, which would have made the Firm plan unlimited (found by the migration test). 0113 sets the Firm floor to 8. Enterprise seats are set by the admin; existing rows are unchanged.
- **Brief guard:** only an active paid **Brief** firm aborts the migration. With 750 credits, Associates 7–8 seats (525/600) now gain.
- **v4 orders and packs** opened before the switch are honoured at their v4 price:
    - plan notes without `pricing: 'v5'` with a v4 id, or a pack order without the note at the v4 price;
    - the invoice backs GST out of the total.
  New orders carry `pricing: 'v5'`.
- **Legacy Autopay subscriptions** with v4 Razorpay plans map to the v5 plan, so they're not skipped.
- **Pricing page FAQ** no longer says "starts at next renewal" or "UPI Autopay" (both stale since manual renewal).
- **Onboarding/sign-in:** no seat picker. The checkout line shows "₹699 + ₹125.82 GST (18%) = ₹824.82".

## Purpose
- v4 has five tiers priced by AI pages (Sanad / Vakalat / Brief / Associates per advocate / Partners). v5 prices by **team size**: fewer plans, one flat price per plan, no per-advocate maths.
- v4 prices include GST. v5 prices are shown and charged **+ GST**. Invoices must show the taxable value as the plan price.

## Cost basis (from v4 pricing doc + razorpay-billing.md)
- AI cost per credit: **₹1.6 measured**, **₹2.5 planned** (adds 50% for redrafts). All Sonnet 5.5; Contract Review on GPT-5.5 is 6 credits = ₹15 budget a review.
- Razorpay fee: 2% + 18% GST on the fee = **2.36% of the amount charged** (price × 1.18), so **2.785% of the ex-GST price**. No fixed fee. Verified on razorpay.com/pricing on 2026-11-16 (2% UPI / cards / netbanking, GST on the fee only).
- Server: **₹50 per seat per month** (placeholder from v4; holds from about 25 paying users).
- GST is not revenue. Revenue = the ex-GST price.
- **Margin floor (owner, 2026-11-16): ≥ 30% at full use** (every credit spent, every seat filled), on ex-GST revenue net of Razorpay fees, for every plan and add-on. Credits are set to the **maximum that keeps the floor** (see "Margin check").

## 1. Plans (recommended)
| Plan id | Name | Advocates | Credits / month (shared pool) | Tier | Monthly ex-GST | Monthly incl. GST | Yearly ex-GST | Yearly incl. GST |
|---|---|---|---|---|---|---|---|---|
| `advocate` | Advocate | 1 | **150** | Solo | ₹699 | ₹824.82 | ₹7,689 | ₹9,073.02 |
| `chambers` | Chambers | up to 3 | **350** | Practice | ₹1,699 | ₹2,004.82 | ₹18,689 | ₹22,053.02 |
| `law_firm` | Firm | up to 8 | **750** | Firm | ₹3,699 | ₹4,364.82 | ₹40,689 | ₹48,013.02 |
| `enterprise` | Enterprise | 9+ | custom | Firm | quote | quote | quote | quote |

- **Seats are a fixed cap, not a picker.** `firms.seats` = 1 / 3 / 8. The price is flat, so there is no advocate count at checkout. Munshi seats are on top (see add-ons).
- **Tier:**
    - Advocate → Solo: same as Sanad/Vakalat/Brief today; the owner may invite a Munshi only (`requireMemberAdmin`).
    - Chambers → Practice: same as Associates today, incl. the firm dashboard (0112).
    - Firm → **Firm** tier: every non-baseline feature, incl. `analytics.firm`. Reason: ₹3,699 is above v4 Associates for 8 (₹5,193 incl. = ₹4,401 ex), and the card can then list firm analytics. The card lists only built features (2026-11-16 rule).
- **Credits per advocate:** Advocate 150, Chambers ~117, Firm ~94. Bigger teams pay less per seat, so they get fewer credits per seat at the same floor.
- **One allowance for monthly and yearly.** The yearly plan (11 months' money for 12 months of credits) is the binding case.
- A solo heavy drafter can buy Chambers (350 credits) for one advocate. That's the upgrade path, since there is no "Brief" plan any more.
- **Credit costs per action stay as they are** (`lib/credit-costs.ts`: 1 credit = one 400-word page, ½ steps, translation ½ a page). There's no reason to change them; the change is in the plans.

## Margin check (floor ≥ 30% at full use)
**Formula:**
- profit = revenue (ex-GST) − Razorpay fee (2.36% × price × 1.18) − server (₹50 × max seats × months) − AI (credits × ₹2.5 × months);
- margin = profit ÷ revenue;
- max credits = (revenue × (1 − 0.30 − 0.02785) − server) ÷ months ÷ ₹2.5.

The AI cost is the planned ₹2.5 a credit (measured ₹1.6 + 50% for redrafts), so full use is the worst case twice over.

### Maximum credits that keep 30%
| Plan | Max credits / month (monthly billing) | Max (yearly billing) | Set to |
|---|---|---|---|
| Advocate | 167.9 | 152.3 | **150** |
| Chambers | 396.8 | 358.7 | **350** |
| Firm | 834.5 | 751.6 | **750** |

### Margins at the chosen credits
| Plan | Cycle | Revenue ₹ | Fee ₹ | Server ₹ | AI ₹ | Profit ₹ | Margin @ ₹2.5 | @ ₹1.6 (measured) | @ 3% card fee |
|---|---|---|---|---|---|---|---|---|---|
| Advocate (150) | month | 699 | 19.5 | 50 | 375 | 254.5 | **36.4%** | 55.7% | 35.0% |
| Advocate | year | 7,689 | 214.1 | 600 | 4,500 | 2,374.9 | **30.9%** | 52.0% | 29.5% |
| Chambers (350) | month | 1,699 | 47.3 | 150 | 875 | 626.7 | **36.9%** | 55.4% | 35.5% |
| Chambers | year | 18,689 | 520.5 | 1,800 | 10,500 | 5,868.5 | **31.4%** | 51.6% | 30.0% |
| Firm (750) | month | 3,699 | 103.0 | 400 | 1,875 | 1,321.0 | **35.7%** | 54.0% | 34.3% |
| Firm | year | 40,689 | 1,133.1 | 4,800 | 22,500 | 12,255.9 | **30.1%** | 50.0% | 28.7% |

- **All six pass the floor** at Razorpay's standard 2% fee.
- **Fee risk:** if the payment goes on a 3% card (Amex / Diners / international), yearly Advocate and Firm dip to 29.5% and 28.7%. These cards are rare for Indian advocates. If the owner wants the floor even then: 145 / 345 / 740 credits.
- Revenue per credit (whole plan): Advocate ₹4.66, Chambers ₹4.85, Firm ₹4.93 ex-GST (₹5.50 / ₹5.73 / ₹5.82 incl.).

### Add-ons
| Add-on | Revenue ₹ (ex-GST) | Fee ₹ | Server ₹ | AI ₹ (full use) | Margin | Max credits at 30% |
|---|---|---|---|---|---|---|
| Munshi seat, month | 149 | 4.1 | 50 | 0 (no AI) | **63.7%** | n/a |
| Munshi seat, year (₹1,639) | 1,639 | 45.6 | 600 | 0 | **60.6%** | n/a |
| Brief Pack 25 (₹179) | 179 | 5.0 | 0 | 62.5 | **62.3%** | 48 |
| Brief Pack 60 (₹389) | 389 | 10.8 | 0 | 150 | **58.7%** | 104 |
| Brief Pack 130 (₹799) | 799 | 22.3 | 0 | 325 | **56.5%** | 213 |
| Brief Pack 330 (₹1,899) | 1,899 | 52.9 | 0 | 825 | **53.8%** | 510 |
- **All add-ons pass.**
- **Owner 2026-11-24 (band C, replaces the 42–45% set the same day):** packs at **53–63%** margin at full use, ₹5.75–7.16 a credit (+23% to +54% over the Advocate plan rate ₹4.66). Why:
    - at 42–45% packs sold at ₹4.69–4.76 a credit, below the Chambers (₹4.85) and Firm (₹4.93) rates, and pack credits last 12 months, not 30 days, so topping up beat upgrading (Advocate + 130 + 60 packs = ₹1,599 for 340 credits vs Chambers ₹1,699 for 350; Chambers + 330 + 60 + 25 = ₹3,652 vs Firm ₹3,699);
    - packs are bought at the moment of need, so a top-up premium is normal; bigger packs are cheaper per credit but never below any plan rate.
    - Upgrade check now: Advocate → Chambers credits by packs costs ₹2,066 (vs ₹1,699); Chambers → Firm ₹4,166 (vs ₹3,699).
    - At the measured ₹1.6 AI cost the margin is 69–75%. Admin hand-sale default (best pack rate) becomes ₹5.75. `brief-pack-margin.test.ts` pins the 53–63% band and the upgrade check.
    - Orders opened at an earlier v5 price and paid after the change are honoured at that price (`PRIOR_V5_PACK_PRICES`).

## Competitors (checked 2026-11-16 unless stated)
"Like-for-like" = AI drafting **plus** practice tools (case diary / cause list / eCourts, limitation, clients, billing), which every DifAi plan includes. Drafting-only tools are listed separately, because they cover only part of what DifAi does.

### Tier 1: one advocate
| Product | Plan | ₹ / month | GST | Seats | What's included |
|---|---|---|---|---|---|
| **DifAi** | **Advocate** | **₹699 + GST (₹824.82)**; yearly ₹641 + GST/mo | excl. | 1 (+ Munshi add-on) | 150 pages AI drafting (~40–50 drafts), diary, eCourts, eFiling help, limitation, land records, clients, billing |
| Lawgger [1] | Advocate / Counsel | ₹1,999; yearly ₹1,667 | not stated | 1 | AI drafting agent (limits not stated), research, cause lists, CNR tracking, limitation, practice management |
| Legalspace [2] | Starter | ₹1,899 + GST (₹2,241) | excl. | not stated | AI assistant 50 msgs/day, 10 uploads/day, practice management |
| DraftBotPro + Advocate Diary [3][8] | Infinity + diary | ₹999 + ₹417 = ₹1,416 | not stated | 1 | near-unlimited words (fair use) + separate diary app |
| *Drafting-only:* LawCentral AI [4] | Starter / Practice / Pro | ₹1,000 / ₹2,499 / ₹4,900 | incl. | 1 | 12,000 / 20,000 / 40,000 credits (~110 / 180 / 360 drafts) |
| *Drafting-only:* DraftBotPro [3] | Infinity | ₹999 | not stated | 1 | near-unlimited words, fair use |
| *Drafting-only:* Bharat.law [5] | Plus / Pro | ₹899 / ₹1,499; yearly ₹599 / ₹1,099 | not stated | 1 | 5,000 / 10,000 AI credits (credit not mapped to pages) |
| *Drafting-only:* Juristbot AI [6] | Standard | ₹700 | not stated | 1 | drafting + research credits (listing; vendor page not reachable) |
| *Drafting-only:* Niyam [7] | Advocate | ₹1,500; yearly ₹1,250 | not stated | not stated | 1,800 credits (not mapped to tasks) |
| *Drafting-only:* Legal Desk AI, Kanoon-AI [8] | entry | ₹399–799; ₹499 | as listed 5 Nov | 1 | 125K–300K words; drafts (from repo benchmark, not rechecked) |

### Tier 2: up to 3 advocates
| Product | Plan | ₹ / month for 3 | GST | What's included |
|---|---|---|---|---|
| **DifAi** | **Chambers** | **₹1,699 + GST (₹2,004.82)**; yearly ₹1,557 + GST/mo | excl. | 350 pages shared, firm dashboard, roles, full practice app |
| Bharat.law [5] | Teams (3 Pro seats) | ₹3,999; yearly ₹2,999 | not stated | shared credits (number not stated); drafting/research only |
| Lawgger [1] | Advocate × 3 | ₹5,997 | not stated | per-user; Chambers tier price on request |
| LawCentral AI [4] | Team (min 2) | ₹3,500 × 3 = ₹10,500 | incl. | 30,000 credits per lawyer; drafting only |
| DraftBotPro [3][8] | Team / Chamber | custom now (was ₹5,999 for 2 on 5 Nov) | not stated | drafting only |
| Niyam [7] | Professional | ₹3,000 | not stated | 4,600 credits; seats not stated |

### Tier 3: up to 8 advocates
| Product | Plan | ₹ / month for 8 | GST | What's included |
|---|---|---|---|---|
| **DifAi** | **Firm** | **₹3,699 + GST (₹4,364.82)**; yearly ₹3,391 + GST/mo | excl. | 750 pages shared, Firm tier (firm analytics, audit), full practice app |
| Niyam [7] | Firm | ₹5,000 | not stated | 10,000 credits; seats not stated |
| Lawgger [1] | Advocate × 8 | ₹15,992 | not stated | per-user |
| LawCentral AI [4] | Team × 8 | ₹28,000 | incl. | drafting only |
| Bharat.law / DraftBotPro [5][3] | Enterprise / Team | custom | | |

### Enterprise (9+)
- Every competitor quotes custom: Bharat.law, DraftBotPro, Lawgger Chambers, Provakil, Legistify. Research suites are far above: SCC Online + AI Pro ₹4,290–5,625 + GST a user, Lucio ≈ ₹14,000 a user (repo benchmark, 5 Nov). No action needed.

### Verdict
- **Like-for-like (AI drafting + practice app), DifAi is the cheapest at every tier**, with no change:
    - Advocate ₹824.82 incl. against Lawgger ₹1,999, Legalspace ₹2,241 and DraftBotPro + diary ₹1,416;
    - Chambers ₹2,004.82 against Bharat.law Teams ₹3,999 (₹2,999 yearly, drafting only), Lawgger ₹5,997 and LawCentral ₹10,500;
    - Firm ₹4,364.82 against Niyam ₹5,000 (seats not stated), Lawgger ₹15,992 and LawCentral ₹28,000.
- **Drafting-only tools that are cheaper on headline price at the one-advocate tier:**
    - Juristbot ₹700, Bharat.law Plus yearly ₹599, Legal Desk AI ₹399–799, Kanoon-AI ₹499 (GST not stated for any of them);
    - DraftBotPro ₹999 offers "near-unlimited" words, and LawCentral Starter ~110 drafts for ₹1,000 incl.
  - **Plainly:** DifAi can't beat these per drafted page within the 30% floor. Advocate credits are already at the floor maximum (150), and "unlimited" can't be matched at any margin.
  - Matching Bharat.law's ₹599 yearly would need about a 20% cut, to ~₹559 + GST/mo yearly, which breaks the floor at 150 credits.
  - **Recommendation:** no price change. Compete on "one app instead of two or three" (DraftBotPro + a diary app costs ₹1,416 against ₹825), not on drafting volume.
- **Per-unit, team tiers:** DifAi gives ₹5.7–5.8 a page incl. with the practice app included; no team competitor publishes a per-page figure.

### Sources
1. Lawgger, via freedom251.com/apps/lawgger (listing dated 11 Oct 2026), checked 2026-11-16.
2. Legalspace, techjockey.com/detail/legalspace, checked 2026-11-16.
3. DraftBotPro, draftbotpro.com/pricing, checked 2026-11-16.
4. LawCentral AI, lawcentral.ai/pricing ("All prices shown include GST"), checked 2026-11-16.
5. Bharat.law, bharat.law/pricing, checked 2026-11-16.
6. Juristbot AI, Capterra / GetApp listings via web search, 2026-11-16 (vendor page returned 403).
7. Niyam, itechguides.com/products/niyam (listing dated 24 Sep 2026), checked 2026-11-16.
8. Repo benchmark `build-docs/market/pricing-benchmark-india.md` (5 Nov 2026): Advocate Diary ₹4,999/yr, Legal Desk AI, Kanoon-AI, SCC Online, Lucio. Not rechecked; recheck before quoting.
- Not found publicly: CaseMine AMICUS (demo only; old LawNext listing US$149.99/mo), Jurixa (no source found), Manupatra AI add-on.

## 2. Add-ons (recommended)
| Add-on | Today (incl. GST) | v5 (ex-GST) | Incl. GST | Reason |
|---|---|---|---|---|
| Munshi seat | ₹149 / mo, ₹1,590 / yr, max 4 | **₹149 + GST / mo, ₹1,639 + GST / yr (11×), max 4** | ₹175.82 / ₹1,934.02 | No AI cost. Margin 63.7% (149 − 4.1 fee − 50 server). Same headline number, consistent "+ GST", yearly follows the 11× rule. |
| Brief Pack 25 | ₹499 | **₹429 + GST** | ₹506.22 | Keeps today's total within ~1.5%; margin 82.6% |
| Brief Pack 60 | ₹999 | **₹849 + GST** | ₹1,001.82 | margin 79.5% |
| Brief Pack 130 | ₹1,999 | **₹1,699 + GST** | ₹2,004.82 | margin 78.1% |
| Brief Pack 330 | ₹4,999 | **₹4,249 + GST** | ₹5,013.82 | margin 77.8% |

- **Keep both.** Munshi is a selling point (no competitor has it) and costs nothing in AI. Packs are the only top-up now that the Brief plan is gone.
- Packs stay 365 days, used after plan credits (spend order unchanged).
- Price per credit in packs (₹12.9–17.2 ex) stays above any plan's (₹4.66–4.93), so moving up a plan is always cheaper than living on packs.

## 3. GST-exclusive mechanics
- **Amount charged (paise) = ex-GST rupees × 118**, in integer arithmetic. Every v5 price is whole rupees, so the total is always whole paise (₹699 → 82,482 paise = ₹824.82). **No rounding.** If a non-whole price is ever added: round half up to the paise, and set taxable = total − GST.
- **Display:**
    - cards and public pages: "₹699 + GST a month";
    - yearly: "₹7,689 + GST a year · 1 month free";
    - checkout / plan summary before Pay: "₹699 + ₹125.82 GST (18%) = **₹824.82**", with Munshi seats as a separate line.
- **Invoice today:** `splitTax(totalPaise)` backs the taxable value out of a GST-inclusive total (`Math.round(total / 1.18)`). It prints one line and CGST 9% + SGST 9% (TN buyer) or IGST 18% (place of supply from the buyer's GSTIN, else their profile state, else seller TN).
- **Invoice change:**
    - `issueForPayment` takes an optional `taxablePaise` (plan + Munshi ex-GST × 100, from our own catalogue).
    - When given: taxable = it, GST = total − taxable, and it must equal `taxable × 18 / 100` exactly. A mismatch → error logged, no invoice, alert (never a wrong invoice).
    - CGST = floor(GST / 2), SGST = rest (unchanged rule).
    - Without it (₹1 test code, legacy orders): the old `splitTax` back-out. ₹1 → taxable ₹0.85, GST ₹0.15.
- **Invoice line:** one line naming the plan and Munshi seats (as built). Taxable values now equal the advertised prices, which reads correctly for a GST-registered firm claiming ITC.
- **`billing_events.amount_inr` is integer** and can't hold ₹824.82. Add `amount_paise bigint` (the exact total). `amount_inr` = round(total) for old readers.
- **MRR (`firms.mrr_inr`) becomes ex-GST** (GST isn't revenue): monthly = price; yearly = round(11 × price / 12). The admin label says "ex-GST". Migrated firms are recomputed (see 4).
- **Order notes** carry `price_paise` and `taxable_paise`. The webhook re-checks both against the catalogue (or the legacy catalogue, see edge cases); the browser never sends an amount.

## 4. Migration of existing firms
Prod has 4 users. Only the owner's own firm pays: Sanad ₹199 monthly, paid until ~2026-12-14. Other firms are free-launch or unpaid.

### Mapping
| Old `selected_plan` (state) | New plan | `seats` | Tier | Credits this cycle | Paid until |
|---|---|---|---|---|---|
| `sanad`, `vakalat`, `brief` | `advocate` | 1 | Solo | raised to 150 now (Sanad 25 → 150, Vakalat 75 → 150); Brief 200 kept this cycle, then 150 (loss guard) | unchanged |
| `associates`, seats 2–3 | `chambers` | 3 | Practice | 150/225 → 350 now | unchanged |
| `associates`, seats 4–8 | `law_firm` | 8 | Firm | 300–600 → 750 now | unchanged |
| `partners` / custom | `enterprise` | unchanged | Firm | unchanged (fallback rule) | unchanged |
| `free` + `free_launch` | unchanged (free till 1 Jun 2027, 25 credits) | | | | |
| unpaid v4 sign-up (`trial`, 30-min window) | same mapping, preselection only | | | 0 | |
| pre-v4 `solo` / `practice` / `firm` | unchanged; fallback allowance uses v5 numbers (Solo 150, Practice 350, Firm 750) | | | | |

- **`munshi_seats`, `billing_cycle`, `renews_at`, `plan_status`: untouched.** The next payment is at the v5 price.
- **Credits need no SQL.** `ensurePlanGrant` upserts this cycle's grant by ref `plan:<firm>:<cycle start>`. The cycle start comes from `renews_at`, which is unchanged, so the next balance call adds the difference when the new allowance is bigger. When it's smaller, the bigger grant is kept until the cycle ends.
- **Loss guard:** only v4 Brief (200 → 150) gets fewer monthly credits after this cycle; every other plan gains. The migration **aborts** if any *active paid* firm would lose monthly credits, so the owner decides (e.g. an admin goodwill grant to paid-until). None is expected on prod.
- **Price-notice rule:** Terms Part E says price changes apply only to periods bought after 30 days' notice. Only the owner's firm pays today. The migration lists any other active paid firm; if one exists, it keeps renewing at its v4 total until 30 days after the notice (open question 6).

### Migration 0113 shape (additive; backup first; local, then prod only on the owner's go)
```sql
-- 0. Run pg_dump of firms, credit_grants, billing_events before applying (deploy step).
-- 1. New ids beside the old ones (old rows/invoices keep rendering).
alter table firms drop constraint if exists firms_selected_plan_check;
alter table firms add constraint firms_selected_plan_check check (selected_plan in
  ('free','advocate','chambers','law_firm','enterprise',
   'sanad','vakalat','brief','associates','partners','solo','practice','firm'));
-- 2. Exact paise on events (₹824.82 doesn't fit amount_inr integer).
alter table billing_events add column if not exists amount_paise bigint;
-- 3. Record of every move (audit + manual rollback).
create table if not exists pricing_v5_moves (
  firm_id uuid primary key references firms(id), old_plan text, old_seats int,
  old_tier firm_plan_tier, old_mrr_inr int, moved_at timestamptz not null default now());
-- 4. Abort if an active paid firm would lose monthly credits.
do $$ begin
  if exists (select 1 from firms where plan_status = 'active' and not coalesce(free_plan,false)
             and renews_at > now() and selected_plan = 'brief')
  then raise exception 'pricing v5: paid firms would lose credits, decide first'; end if;
end $$;
-- 5. Move (idempotent: only v4 ids are touched).
insert into pricing_v5_moves (firm_id, old_plan, old_seats, old_tier, old_mrr_inr)
  select id, selected_plan, seats, plan_tier, mrr_inr from firms
  where selected_plan in ('sanad','vakalat','brief','associates','partners')
  on conflict do nothing;
update firms set
  selected_plan = case when selected_plan in ('sanad','vakalat','brief') then 'advocate'
                       when selected_plan = 'associates' and coalesce(seats,2) <= 3 then 'chambers'
                       when selected_plan = 'associates' then 'law_firm'
                       else 'enterprise' end,
  seats = case when selected_plan in ('sanad','vakalat','brief') then 1
               when selected_plan = 'associates' and coalesce(seats,2) <= 3 then 3
               when selected_plan = 'associates' then 8 else seats end,
  plan_tier = case when selected_plan in ('sanad','vakalat','brief') then 'Solo'
                   when selected_plan = 'associates' and coalesce(seats,2) <= 3 then 'Practice'
                   else 'Firm' end::firm_plan_tier,
  mrr_inr = round(mrr_inr / 1.18)   -- ex-GST of what they paid
where selected_plan in ('sanad','vakalat','brief','associates','partners');
```
- The `razorpay_plans` check is left alone: Subscriptions aren't used for new purchases (manual-renewal).
- Permission caches: the deploy restarts the API, so tier caches start empty.

## 5. Code changes
| Area | File(s) | Change |
|---|---|---|
| Catalogue | `apps/api/src/lib/plans.ts` | `PLANS` = advocate/chambers/law_firm with `priceExGst {monthly, annual}`, `credits`, `seats`, `tier`; drop `perAdvocate`. `MUNSHI` and `BRIEF_PACKS` ex-GST. New `LEGACY_PLANS` (v4 rows, incl.-GST prices, for orders made before cut-over + labels). `periodTaxableInr`, `periodTotalPaise = taxable × 118`. `PLAN_NAMES` adds the new ids and keeps all old ones. `planLabel`: "Chambers (up to 3 advocates)". |
| Types | `packages/types/src/index.ts` | `PaidPlanId = 'advocate'\|'chambers'\|'law_firm'`; `BillingPlanId` adds the new ids and `enterprise`, keeps the old ones; `BillingPlan.gst: 'exclusive'`, add `seatsIncluded`, `creditsPerMonth` (rename of `pagesPerMonth`, kept as alias for one release). |
| Checkout / webhook | `billing.service.ts`, `billing.routes.ts`, `onboarding.routes.ts` | zod plan enum → new ids; `seats` dropped from input (fixed by plan); amount = `periodTotalPaise`; notes carry `price_paise`, `taxable_paise`; `applyPlanPayment` sets `seats` from the plan; `billingPlans()` cards/notes ("+ GST"); Enterprise card replaces Partners (not purchasable). Seat check uses the plan's cap: refuse when advocate members + invites > cap (`seats_below_members`). |
| Invoice | `subscription-invoice.service.ts` | `taxablePaise` path + two lines (plan, Munshi); old back-out kept for ₹1 / legacy. |
| Credits | `credit.service.ts` `allowanceFor` | `PLANS[plan].credits` (flat pool, not × seats); legacy-tier fallback Solo 150 / Practice 350 / Firm 750. `credit-costs.ts` unchanged. |
| Onboarding / sign-up | `onboarding.service.ts`, `auth.service.ts` | team = plan in (chambers, law_firm): firm name required, role Managing Partner; `plan_tier = PLANS[plan].tier` (not hard-coded 'Practice'); default plan for `role=group` → `chambers`, else `advocate`. No seat count asked. |
| Seats | `invitations.service.ts` `assertSeatCapNotExceeded`, `firmAdminService` | no logic change: reads `firms.seats` (now 1/3/8) + `munshi_seats`. Message text: "Chambers has 3 advocate seats. Move to Firm for up to 8." |
| Munshi gate | `middleware/requireMemberAdmin.ts`, `MunshiPanel`, `InviteMemberModal` | comments/copy "Advocate plan owner"; logic unchanged (Solo tier). |
| Web plans | `components/PlanCards.tsx` (`SIGNUP_PLANS`, `planPrice`, `planTotal`), `views/BillingView.tsx` (`PAID_IDS`, label, invoice column "Amount (incl. GST)" stays), `views/OnboardingView.tsx` (icons, default plan, "From ₹699 + GST", `practice` test), `components/TrialBanner.tsx` (`PAID` list), `components/BriefPacks.tsx` ("+ GST"), `hooks/useBilling.ts` | new cards; `SeatPicker` removed from use (kept only if Enterprise ever self-serves: delete); checkout total line with GST. |
| Sign-in | `views/AuthView.tsx`, `views/SignupView.tsx` | tabs stay Advocate · Chambers · Firm; taglines "One advocate" / "Up to 3 advocates" / "Up to 8 advocates; 9+ Enterprise"; renew picker default `advocate`, no seats. Copy "Plans from ₹699 + GST a month". |
| Legal | `views/LegalView.tsx` | Terms 6.1 "exclusive of GST; 18% GST added at checkout and shown on the invoice"; Part E line 255 same; refund rules renamed (open question 5); /refund-policy "All prices include 18% GST" → "Prices are plus 18% GST". `LEGAL_VERSION` bump = open question 6. |
| Public pages | `apps/web/seo/pages.mjs` (`V4` → `V5`, /pricing table, titles, FAQ "Do prices include GST?" → "No, + 18% GST"), `apps/web/index.html` (JSON-LD offer `price: "699"` + `valueAddedTaxIncluded: false`, noscript text), `views/LandingView.tsx` ("From ₹699 + GST a month", FAQ GST line) | seo/claims tests updated for the new copy. |
| Admin | `admin/views/BillingView.tsx`, `FirmsView.tsx` | MRR labelled ex-GST; invoice table unchanged. |
| DB | `migrations/0113_pricing_v5.sql` | as above. |
| Docs | `pricing-v4.md` (superseded note), `brief-packs.md`, `ai-credits.md` (allowance), `MEMORY.md`, `TESTING.md`, `CHANGELOG.md` | |

## 6. Impact map
| Touches | What could break |
|---|---|
| `lib/plans.ts` (read by billing, credits, onboarding, invoices, MRR) | wrong price → wrong charge or a refused payment; asserted per plan × cycle × Munshi 0–4 |
| `billing.service` amount check | v4 order paid after deploy fails the check → money taken, plan not applied (handled by `LEGACY_PLANS`) |
| `subscription-invoice.service` | wrong taxable/GST split on a legal document; ₹1 coupon invoice |
| `credit.service.allowanceFor` | team pools multiplied by seats by mistake (×3 / ×8 credits) |
| `firms.seats` semantics (cap, not bought count) | seat check, MembersView "x of y", admin views |
| permissions (`plan_tier`) | Firm plan unlocks Firm-tier features; Chambers keeps Practice; an Advocate owner keeps Munshi-only invites |
| onboarding / auth | sign-up stuck without a plan; known failing test "role=group creates a Practice-tier firm" (MEMORY known issues): fixed here, since `chambers` → Practice |
| `billing_events`, `subscription_invoices`, `firms` | migration on live DB (backup, additive only) |
| web cards, onboarding, renew screen, billing | stale v4 ids in `PAID_IDS`/`PAID`/zod enums → plan treated as unpaid |
| legal + SEO + landing | public price claims wrong or "GST included" left anywhere (grep `GST included`, `incl. GST`, `₹199`) |
| tests | `pricing-v4.test`, `billing.test`, `razorpay-billing.test`, `gst-invoices.test`, `ai-credits.test`, `credits.integration`, `munshi.integration`, `solo-munshi.integration`, `seat-enforcement.integration`, web `onboarding-checkout.test`, `seo.test.mjs`, `claims.test.mjs` |
| Android app | must still show no buy UI (`isNativeApp()`); text-only credits sheet |

## Edge cases
- **v4 order paid after deploy** (checkout opened before cut-over): accept when `notes.plan` is a v4 id and the amount equals that v4 price; apply as the mapped v5 plan with the v4 period; invoice by back-out (it was a GST-inclusive price). Same for v4 pack prices (credits as in the order). Only for orders created before `PRICING_V5_AT`.
- **Switching plan mid-period:** unchanged rule. A different plan starts today with no carry-over (shown before Pay); the same plan extends from the end. Advocate → Chambers is a different plan.
- **Downgrade with more members than the new cap** (Firm with 5 → Chambers): refused at checkout, `seats_below_members`, as today.
- **Migrated Associates firm with 3 members → Chambers cap 3:** fits. 4–8 → Firm cap 8: fits. More than 8 active members can't exist (old max 8).
- **Seats above cap through old invites:** pending invites count as seats (existing rule); legacy over-cap firms can still edit roles that don't cross advocate/Munshi.
- **Munshi seats beyond 4** on migrated firms: none possible (old max 4).
- **₹1 test code** (`BILLING_TEST_COUPON` + `BILLING_TEST_EMAILS`): order 100 paise for any plan or pack; the webhook accepts it via `coupon: 'test'`; the invoice backs out (₹0.85 + ₹0.15); MRR 0; `amount_paise` 100.
- **Webhook redelivery:** one activation, one invoice (unique payment id; unchanged).
- **Invoice arithmetic mismatch** (catalogue changed between order and payment): the amount check refuses first; the invoice guard is a second line of defence.
- **Enterprise:** not purchasable; "Talk to us" (support@sirahdigital.in). Existing custom Firm-tier firms are untouched.
- **Free-launch firm at 1 Jun 2027:** gate shows v5 cards.
- **Android:** no plan cards, packs, code field or Pay; Plan & Billing is status-only. Prices aren't shown there, so "+ GST" text isn't needed.
- **Buyer state unknown:** place of supply = seller state (TN) → CGST + SGST, as today.

## Acceptance criteria
1. `billingPlans()` returns exactly Advocate / Chambers / Firm (purchasable) + Enterprise (not purchasable) with the prices, seats, credits and tier in table 1; web `SIGNUP_PLANS` matches (test).
2. For every plan × cycle × Munshi 0–4, the order amount (paise) = (plan + Munshi ex-GST) × 118, e.g. Advocate monthly 82,482; Firm yearly + 2 Munshi yearly = (40,689 + 3,278) × 118 = 5,188,106.
3. The webhook sets `selected_plan`, `plan_tier`, `seats` (1/3/8) and `munshi_seats` from our own order only; a payment of any other amount is not applied.
4. The invoice shows taxable = the ex-GST price, CGST 9% + SGST 9% for a TN buyer or IGST 18% otherwise, and total = the amount paid; Munshi on its own line.
5. A ₹1 test-code payment activates the plan, issues a ₹1 invoice (₹0.85 + ₹0.15), records MRR 0; a non-listed email gets "not valid".
6. Monthly credits: Advocate 150, Chambers 350, Firm 750, the same for every seat count; Munshi seats add 0.
7. Inviting a 2nd advocate on Advocate, a 4th on Chambers or a 9th on Firm → 402 `seat_cap_exceeded`; a Munshi within `munshi_seats` passes.
8. Checkout of a smaller plan with more advocates than its cap → 400 `seats_below_members`.
9. Migration on a copy of prod data: Sanad firm → `advocate`, seats 1, Solo, same `renews_at`/`billing_cycle`/`munshi_seats`; its next balance call shows 150 credits this cycle; a `pricing_v5_moves` row exists; re-running changes nothing.
10. Migration aborts (no change) when an active paid Brief firm exists.
11. A v4 order created before cut-over and paid after is applied as the mapped v5 plan.
12. Old invoices and events with `sanad`/`associates` still render their names.
13. No public page, legal page or app screen says prices "include GST"; cards read "₹699 + GST"; checkout shows the GST line and the total.
14. Android shows no buy UI (existing test still green).
15. All tests in the impact map green; seo + claims tests green.
16. Enterprise: a firm's `credit_allowance` overrides the plan's monthly credits while active; null falls back; a self-serve payment clears it.
17. Analytics: the Advocate and Chambers owners see Firm Analytics (analytics.firm + reports.activity); a Munshi never does.

## Build order
1. `lib/plans.ts` + types + `LEGACY_PLANS`; catalogue tests (AC1, AC2).
2. Billing: checkout, webhook apply, legacy orders, `amount_paise`, MRR ex-GST; invoice taxable path (AC3–5, AC11, AC12).
3. Credits allowance; onboarding/auth tier + default plan; seat-cap messages (AC6–8; fixes the known role=group test).
4. Migration 0113: write, run locally on a prod-shaped copy (AC9, AC10).
5. Web: PlanCards, Billing, Onboarding, Auth/Signup, TrialBanner, BriefPacks, checkout GST line (AC13, AC14).
6. Legal, SEO /pricing, index.html, landing (AC13); seo/claims tests.
7. Regression run of every test in the impact map; docs; commit per step; deploy only on "deploy" and only after the owner approves the live migration (backup first).

## Open questions for the owner (answered 2026-11-16, see the top)
1. **Credits:** 150 / 350 / 750 a month (recommended: the maximum within the 30% floor, yearly 30.1–31.4%), or 145 / 345 / 740 to hold 30% even on 3% card fees? Or fewer credits for more headroom?
2. **Firm plan tier:** Firm tier (recommended; adds firm analytics) or Practice like Chambers?
3. **Munshi seat:** ₹149 + GST a month / ₹1,639 + GST a year, max 4 on every plan (recommended)? Or allow more on Firm?
4. **Brief Packs:** ₹429 / ₹849 / ₹1,699 / ₹4,249 + GST (recommended; customer total stays about the same) or ₹499 / ₹999 / ₹1,999 / ₹4,999 + GST (18% rise)?
5. **Refund rules** (today: Sanad/Vakalat none; Brief/Associates yearly 7 days if ≤10 credits used). Recommended: monthly plans not refundable; any yearly plan refundable within 7 days if ≤10 credits used; packs unchanged.
6. **Terms:** bump `LEGAL_VERSION` (every user re-accepts) for the "+ GST" wording, or treat it as non-material? And confirm only your own firm pays today, so the 30-day price notice affects no one else.
7. **Plan ids:** `advocate` / `chambers` / `law_firm` / `enterprise` (`firm` is taken by an old pre-v4 id and the `firm_type` enum). OK?
