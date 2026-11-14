# Feature: Terms of Service + Privacy Policy pages (v1.1)

Status: built 2026-11-14. Source: owner's `DifAi_Terms_Privacy_DPDP_v1.1.pdf` (Parts A–E) + GST certificate (operator details).

## Purpose
- The app has no Terms page: the landing "Terms" link mails a dead lexdraft.in address, and Settings links `/legal/terms` (no such route).
- The current `/privacy` names only Anthropic; Contract Review uses OpenAI.

## Owner decisions (2026-11-14)
- Layout: `/terms` = Part A (Terms) + D (cookies/device permissions) + E (subscriptions/refunds). `/privacy` = Part B (Privacy + data processing terms) + C (DPDP notice). The Play Store privacy URL is unchanged.
- Lines describing features the app lacks are reworded to match the app. Removed or changed: the 4 consent tick boxes, consent records with IP/version, the "Cookie settings" link, analytics, the in-app billing cancel, the dormant-account deletion and "Settings > Privacy".
- No "free" wording (v4 pricing, 9118293): Terms 6.1 and Part E describe paid plans only.
- Operator, from the GST certificate: Sirah Digital, a sole proprietorship of M Mohamed Riyaz, GSTIN 33CVVPM9805M1ZO, Zamin Pallavaram, Chennai 600044. Arbitration seat Chennai; Madras High Court under s.11.

## Facts checked against code (2026-11-14)
- Android manifest + plugins: INTERNET, CAMERA (document photos, eCourts QR), USE_BIOMETRIC (app lock), RECORD_AUDIO via speech-recognition plugin (dictation). No push plugin.
- Dictation = device/browser speech service (Web Speech API / Android recogniser); audio never reaches our servers.
- No analytics or crash SDK, and no cookies set by the app (session in browser storage).
- No in-app subscription cancel → cancel by email. Prices are GST-inclusive (pricing-v4).
- Limitation alerts at 90/30/7/1 days (limitation-alerts.md).

## Architecture
- `apps/web/src/views/LegalView.tsx`: shared `LegalPage` shell; `TermsView`, `PrivacyPolicyView` and `DeleteAccountView`. Operator details live in one `OPERATOR` constant.
- Route `/terms` (public); `/legal/terms` redirects to it. nginx SPA regex gets `terms`.
- Links: landing footer Terms/DPA, sign-up consent line, Settings › Privacy & Data, and the prerendered SEO footer.

## Impact map
| Area | File | Risk |
|---|---|---|
| Routing | App.tsx, nginx.conf | /terms 404 in prod if the regex is missed → covered by seo.test |
| Sign-up | AuthView.tsx | links open in a new tab so the form state isn't lost |
| SEO pages | seo/render.mjs footer | snapshot/content tests |
| Play Store | /privacy URL unchanged | none |

## Acceptance criteria
1. `/terms` and `/privacy` render without sign-in and contain every Part (A–E) heading.
2. No `[` placeholder brackets in either page, and no "free" wording on `/terms`.
3. Both pages name the operator, GSTIN, address, Grievance Officer and contact email.
4. `/privacy` names both AI providers (Anthropic, OpenAI).
5. `/terms` and `/legal/terms` get the SPA shell from nginx.
6. Landing, sign-up and Settings link to `/terms` and `/privacy`.

## Open (owner to confirm)
- Grievance Officer = the proprietor; no phone number published.
- Refund "normal usage" defined as ≤ ¼ of the period's page credits.
- Hosting region (Hostinger VPS) is not stated.
- AI provider retention ("up to 30 days") is taken from the providers' standard API terms.

## Refund page, contact page, approved refund rules (2026-11-14)
- Razorpay's website review needs a standalone refund/cancellation page and a contact page: **/refund-policy** and **/contact** (public, in nginx's SPA list, landing footer + static index links).
- Owner-approved refund rules:
    - Sanad and Vakalat: no refunds.
    - Brief and Associates yearly: within 7 days if no more than 10 AI credits were used; monthly: no refunds.
    - Munshi seats follow their plan.
    - Brief Packs: within 7 days if none of the pack's credits were used.
    - Errors, including a charge after cancelling: refunded in full.
    - Cancel by email (confirmed within 2 working days); access runs to the period end.
- Part E of the Terms now states the same rules (the older "first purchase / quarter of credits / 48 h renewal" rules were replaced) and links to /refund-policy. Its 30-day price-change notice and 72-hour outage credit stay. Refund timeline: 7–10 working days on both pages.
- Landing footer: the old lexdraft.in emails, the placeholder WhatsApp number and the status link are replaced with support@sirahdigital.in, /contact, /pricing and /faq.
