# DifAi Pricing Plan v2 (proposal, 2026-11-05)

Built on [pricing-benchmark-india.md](pricing-benchmark-india.md). This is a proposal only; no code or Dodo products have been changed.

## 1. Strategy
- **We do not compete on drafting price.** The ₹399–999 drafting band is a price war, and we would lose it on research. We sell **"the advocate's whole practice in one app"**: drafting, diary, eCourts, eFiling and limitation. Our reference price is the two-app stack an advocate pays for today (DraftBotPro plus a diary app ≈ ₹1,250/mo).
- **Every plan has a published AI limit.** Each composed draft runs on Sonnet 5.5 at $2 in / $10 out per million tokens (`ai-pricing.ts`). My planning estimate is **₹8–20 per full draft**, assumed at ≈30K input + 6K output tokens with plan and repair passes. Unlimited drafting is a loss on heavy users. Competitors also cap usage (DraftBotPro by words, LawCentral by credits).
- **The free plan is the main way new users arrive.** Indian advocates try free tools first, such as Peshi and DraftBotPro's free tier. A free diary keeps them inside DifAi every day, and AI drafting is the reason to upgrade.
- **Price by seat for firms, with a cheap clerk seat.** Most Indian chambers have a clerk or junior who only runs the diary. Nobody else prices for that role.

## 2. Plan lineup

| Plan | For | Monthly | Yearly (per month) | AI limit / month | Key inclusions |
|---|---|---|---|---|---|
| **Free Diary** (forever, from 1 Jun 2027) | Any advocate | ₹0 | — | 5 drafts | Diary, cause list, eCourts sync for 25 cases, 500 MB |
| **Student** | Verified law students | ₹149 | ₹99 (₹1,188/yr) | 15 drafts | Drafting + Related law; no eCourts or eFiling |
| **Solo** | One advocate | ₹1,499 | **₹1,199** | 50 drafts | Everything: unlimited cases, eCourts, eFiling, limitation, co-counsel, analytics, 10 GB |
| **Chamber** (replaces Practice) | 2–8 advocates | ₹2,999 for 2 advocates + ₹899 per extra advocate | ₹2,399 + ₹719 per advocate | 40 drafts per advocate (not shared, see features/pricing-v2.md) | Everything in Solo, roles, firm dashboard, team chat, 25 GB, priority support |
| **Clerk seat** (Chamber/Firm add-on) | Clerk / office staff | ₹299 | ₹249 | none | Diary, cause list, documents, eCourts only |
| **Firm** | 9+ advocates | Custom | From ₹999 per advocate (yearly, min. 9) | Custom pool | SSO, audit logs, success manager, integrations |

**Add-ons**, sold to any paid plan:
- Draft pack: ₹299 for 25 extra drafts. Unused drafts expire after 90 days.
- Storage: ₹199 per month for 25 GB. This follows your rule that users who need more space pay for it, with no compression.

**GST:** Student and Solo prices **include GST**, because most solo advocates can't claim GST input credit. Chamber and Firm prices are **+18% GST**, because firms claim input credit.

**How Chamber compares at 8 advocates:**
- DifAi Chamber: ₹8,393/mo (₹6,713 on yearly), about ₹840–1,050 per advocate.
- LawCentral Teams: ₹28,000.
- DraftBotPro Chamber: ≈ ₹24,000 (inferred from the 2-seat ₹5,999 plan).

That is still the best team value in India, and a 2-advocate firm now pays ₹2,999 instead of ₹4,999.

## 3. Margin check (Solo yearly, worst case)
- ₹1,199 including GST leaves ≈ ₹1,016 after GST. After Dodo's fee (≈5% assumed; **verify on the Dodo rate card**) it is ≈ ₹965.
- An advocate who uses all 50 drafts at ₹15 each costs ₹750 in AI. That leaves a thin but positive margin.
- A typical advocate drafts 15–25 documents a month, which costs ₹225–375 and gives a **margin of about 60–75%**.
- **Before launch:** replace my ₹15-per-draft estimate with the real average from the /admin AI-cost dashboard. If real drafts cost more than ₹15, reduce Solo to 40 drafts instead of raising the price.

## 4. Moving from the free launch period
- **Now until 1 Jun 2027:** the free launch continues, but capped at **30 drafts/month** under fair use (the current plan is unlimited). Diary and eCourts stay unlimited.
- **Founder offer from Jan to May 2027:** free users who pay yearly before 1 Jun 2027 get **Solo at ₹999/mo (₹11,988/yr), locked for 2 years**. This sets a deadline and rewards early users.
- **From 1 Jun 2027:** free users who haven't paid move to **Free Diary** rather than being blocked. Their data stays and they can still use the diary, so they keep coming back. This replaces the current behaviour of blocking expired accounts, and you had already agreed read-only access should be built.
- **Existing Practice customers** keep ₹4,999 for 8 seats until their renewal, then move to Chamber at the rate they choose.

## 5. Go-to-market (India)
- **Channels:**
  - Bar association tie-ups: 20% off yearly for members, offered district by district, starting in Tamil Nadu, where the TN nomenclature templates and land records give us an edge.
  - Law college ambassadors for the Student plan.
  - Telling advocates who ask for referrals that we now offer WhatsApp sign-up.
- **Referral:** one free month of Solo for both advocates when the person invited pays.
- **Messages:**
  - "One app instead of three: drafting, diary and eCourts for ₹1,199."
  - "Your whole chamber from ₹2,399, plus clerks at ₹249."
- **Comparison page:** DifAi vs DraftBotPro, compared feature by feature, without naming prices we can't verify.
- **Don't** launch a drafting-only plan or a ₹9.99 first-month offer. Both would split our bundle and anchor us in the budget band.

## 6. Conditions before this goes live
1. Get the real cost per draft from the /admin AI-cost dashboard (see §3).
2. Build the drafting limits and add-ons: monthly draft counting, Free Diary limits, the clerk seat role and per-seat Chamber billing in Dodo. This is a feature build with its own design doc, and it **needs your approval** plus a migration.
3. Re-check competitor prices on their live pages before publishing the comparison page.
