# LexDraft — Pricing, Tiering & Account Strategy

**Status:** Draft v1 · 2026-05-06
**Owner:** Product
**Audience:** Engineering, Design, GTM
**Scope:** Defines the four account types LexDraft will ship — **Solo**, **Practice**, **Firm**, and **SuperAdmin** — including market rationale, feature gating, account-creation flows, billing, RBAC, and India-specific compliance considerations.

---

## 1. Executive summary

LexDraft sells practice-management software to Indian advocates. The market has three natural buying units, and our pricing on the landing page already reflects them ([LandingView.tsx:160-213](apps/web/src/views/LandingView.tsx#L160-L213)):

| Plan | Price (annual / monthly) | Buyer | Decision style |
|---|---|---|---|
| **Solo** | ₹1,199 / ₹1,499 per month | Independent practitioner | Self-serve, card on file |
| **Practice** | ₹3,999 / ₹4,999 per month flat (2–8 seats) | Practice group / chamber | Founder decides, billed monthly |
| **Firm** | Custom (typically ₹X per seat with floor + add-ons) | Managing partner / COO of an established firm | Sales-led, MSA, annual contract |

Behind these three customer-facing plans sits a fourth: **SuperAdmin**, the LexDraft-internal control plane that provisions, supports, bills, and audits all tenant firms.

The rest of this document breaks down what goes into each tier, why, and how.

---

## 2. Market research

### 2.1 India-native competitors

| Vendor | Model | Pricing | Differentiator | What they teach us |
|---|---|---|---|---|
| **Provakil** | Per-user + per-contract, contact sales | Trial 14 days, then tiered subs | Auto case-tracking across 10,000+ Indian courts (SC, HC, district, NCLT, NGT, RERA, DRT, CESTAT); used by Lakshmikumaran & Sridharan, Fox & Mandal | Indian firms expect court-coverage breadth as table stakes |
| **LawSathi** | Per-user monthly | ~₹1,000/mo basic → ₹5,000–10,000/user/mo enterprise | NJDG integration, AI-first, built for litigators | The ₹1,000–₹10,000/seat band is the Indian market's anchor |
| **MyKase** | Per-user monthly | Comparable to LawSathi | Native Manupatra, CaseWatch | Citation-research integration is a paid feature, not a freebie |
| **Zoho Legal** | Per-user, low monthly | Cheap, broad ecosystem | Bundled with Zoho Books / CRM | Cross-sell into existing Zoho shops is real competition |
| **SpotDraft** | Volume + user-based | $5K–$50K/year + VerifAI add-on $5–15K/year | Contract-review AI, Bengaluru/NY HQ | High-end contract-review is a separable wedge — we should not cannibalize Practice with too much of it |

### 2.2 Global benchmarks (commonly used as reference for tier shape)

| Vendor | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| **Clio Manage** | EasyStart $39 — time, billing, trust | Essentials $79 — + portal, templates, integrations | Advanced $109 — + full-text search, e-sig, reports | Complete $139 — + AI assistant, automation, intake |
| **MyCase** | Basic $39 — case, calendar, billing, portal | Pro $89 — + eSign, doc mgmt | Advanced $109 — + Drive sync, doc automation, API | — |
| **PracticePanther** | Solo $49 — time, matters | Essential $79 — + workflow, custom fields, eSign | Business $89 — + advanced reports, native eSign, texting | — |

### 2.3 Universal gating patterns

What every mature legal-SaaS gates behind higher tiers, in order of how aggressively they upsell on it:

1. **API + webhooks** — almost always top-tier only.
2. **SSO / SAML** — top-tier or enterprise-only.
3. **Detailed audit logs (>90 days)** — top-tier.
4. **Workflow automation** — mid-tier and up.
5. **Document automation / clause libraries** — mid-tier and up.
6. **Native eSignature (unlimited)** — top-tier; mid-tier gets metered.
7. **Custom roles** — mid-tier and up.
8. **Full-text document search** — top-tier.
9. **AI assistant** — top-tier (Clio Duo, MyCase IQ).
10. **White-label / branded portals** — top-tier.
11. **On-premise / VPC deployment** — enterprise-only.
12. **Dedicated CSM, training, 24×7 support** — top-tier.

### 2.4 India-specific must-haves at every tier

These are not features to gate — they are the price of entry. Without them, LexDraft is not a credible Indian product.

- **eCourts / CNR sync** for at least the Supreme Court, all High Courts, and District Courts.
- **Indian-format templates**: vakalatnama, plaint, written statement, reply, rejoinder, miscellaneous applications.
- **Limitation Act tracker** with statutory-period warnings.
- **DPDP Act 2023 compliance** with Indian-region data residency.
- **NEFT / UPI / Razorpay** as billing rails (Stripe alone is not enough).
- **GST-compliant invoices** with HSN/SAC codes and TDS-ready totals.
- **English drafting** at minimum; **Hindi** at Practice+; regional languages at Firm.

### 2.5 DPDP Act 2023 — what it forces

Per EY / Hogan Lovells / dpdpa.com summaries, the DPDP Act and 2025 Rules require:

- Data Protection Officer (DPO) **based in India**, mandatory for entities classified as **Significant Data Fiduciaries** (most law-firm tenants on the Firm plan will qualify because they hold sensitive client data).
- Independent **data auditor** + periodic **DPIA**.
- **Data residency** in India for personal data.
- **Consent Manager** integration — a registered third-party that lets the data principal give/withdraw consent across services.
- **72-hour breach notification** to the Data Protection Board.
- Penalties up to **₹250 crore** per violation.
- Phased enforcement, full compliance expected by **13 May 2027**.

**Implication for LexDraft:** ship the consent manager + audit log + Indian-region storage at every tier. Reserve dedicated DPO assistance and DPIA tooling for Firm.

---

## 3. Plan design — Solo, Practice, Firm

### 3.1 Plan positioning

| | Solo | Practice | Firm |
|---|---|---|---|
| **Target buyer** | Independent advocate | Founding partner of a 2–8 person practice | Managing partner / COO of a 9+ seat firm |
| **Practice size** | 1 advocate | 2–8 advocates | 9+ advocates |
| **Matter volume** | < 50 active matters | < 500 active matters | Unlimited |
| **Buying motion** | Self-serve, 14-day trial | Self-serve, 14-day trial, card on file | Sales-led, demo → MSA → DPIA → provisioning |
| **Contract** | Monthly, cancel any time | Monthly or annual | Annual, MSA, DPA |
| **Time to active** | < 5 minutes | < 30 minutes | 1–5 business days |
| **Support tier** | Email + community | Email + WhatsApp + business-hours phone | Dedicated CSM + 24×7 P0 phone |

### 3.2 Detailed feature matrix

#### Drafting & AI

| Feature | Solo | Practice | Firm |
|---|:-:|:-:|:-:|
| Indian-format templates (200+) | Read-only | Editable | Editable + firm template library |
| AI drafts per month | 50 | 500 | Unlimited (fair-use) |
| Lex.AI research queries / month | 100 | 1,000 | Unlimited |
| Custom firm-style templates | — | ✓ | ✓ + version history |
| Hindi drafting | — | ✓ | ✓ |
| Regional languages (Marathi, Tamil, Bengali, Kannada) | — | — | ✓ |
| Clause library + preferred-positions | — | ✓ | ✓ + cross-matter analytics |
| AI redlining / contract risk scoring | Pay-per-doc (₹X) | 100 docs / month | Unlimited |
| Voice-to-matter capture | 5 / month | 50 / month | Unlimited |
| Multi-document compare | — | 5 active comparisons | Unlimited |

#### Cases & court integration

| Feature | Solo | Practice | Firm |
|---|:-:|:-:|:-:|
| eCourts / CNR sync | 5 matters | Unlimited | Unlimited + multi-jurisdiction |
| Cause-list auto-pull frequency | Daily | Hourly | Real-time |
| Hearing diary & calendar sync | ✓ | ✓ + shared team calendar | ✓ + court-room view |
| Limitation Act tracker (90 / 30 / 7 / 1-day) | ✓ | ✓ | ✓ + custom escalation rules |
| NCLT / DRT / consumer-forum tracking | — | ✓ | ✓ |
| eFiling integration (where state portal supports it) | — | ✓ | ✓ |
| Bulk CNR import | — | 100 / month | Unlimited |

#### Billing & accounting

| Feature | Solo | Practice | Firm |
|---|:-:|:-:|:-:|
| Time entries + invoices | ✓ | ✓ | ✓ |
| NEFT / UPI reconciliation | ✓ | ✓ | ✓ |
| Retainer / trust accounting | — | ✓ | ✓ + multi-account |
| GST-compliant invoice formats | ✓ | ✓ | ✓ |
| TDS reports (IT-return ready) | — | ✓ | ✓ |
| Split billing / multi-payer | — | ✓ | ✓ |
| Tally / Zoho Books / QuickBooks export | — | CSV export | Native sync |
| Recurring invoices / payment plans | — | ✓ | ✓ |

#### Collaboration & access

| Feature | Solo | Practice | Firm |
|---|:-:|:-:|:-:|
| Seats included | 1 | 2–8 | 9+ (unlimited) |
| Roles available | Owner only | Admin, Advocate, Paralegal, Billing | All system roles + custom roles |
| Client portal | Basic | Branded with firm name + colour | White-label (custom domain) |
| Document storage | 10 GB | 100 GB | Unlimited |
| eSignature | Pay-per-doc | 200 / month | Unlimited (native) |
| Internal chat / matter comments | — | ✓ | ✓ |
| Guest access (co-counsel, expert witness) | — | 5 active | Unlimited |

#### Security & compliance

| Feature | Solo | Practice | Firm |
|---|:-:|:-:|:-:|
| DPDP-compliant Indian-region storage | ✓ | ✓ | ✓ |
| Encrypted backups (at rest + in transit) | ✓ | ✓ | ✓ + customer-managed keys |
| 2FA | Optional | Optional | Enforced firm-wide |
| SSO / SAML | — | — | ✓ |
| Audit log retention | 30 days | 1 year | Unlimited + SIEM export |
| Role-based matter visibility | — | ✓ | ✓ + ethical walls / conflict checks |
| On-premise / VPC deployment | — | — | ✓ (optional add-on) |
| DPDP DPO assistance (DPIA, breach drafting) | — | — | ✓ |
| Consent-manager integration | ✓ | ✓ | ✓ |

#### Integrations & extensibility

| Feature | Solo | Practice | Firm |
|---|:-:|:-:|:-:|
| Google / Outlook calendar | ✓ | ✓ | ✓ |
| Drive / Dropbox / OneDrive | — | ✓ | ✓ |
| Manupatra / SCC Online citation | Read-only links | Inline citation | Bulk research export |
| Public REST API | — | Read-only | Read + write |
| Webhooks | — | — | ✓ |
| Bespoke integrations | — | — | ✓ (paid SOW) |
| Slack / Microsoft Teams notifications | — | ✓ | ✓ |

#### Support

| Feature | Solo | Practice | Firm |
|---|:-:|:-:|:-:|
| Email response SLA | 4 business hours | 2 business hours | 30 minutes (P0) |
| WhatsApp chambers liaison | — | Mon–Sat 9–21 IST | 24×7 |
| Phone | — | Business hours | 24×7 P0 hotline |
| Onboarding | Self-serve guided tour | Group session (1 hr, video) | White-glove + training day |
| Dedicated success manager | — | — | ✓ |
| Uptime SLA | Best-effort | 99.9% | 99.95% |
| Quarterly business review | — | — | ✓ |

### 3.3 Limits and overage policy

| Metric | Solo | Practice | Firm | Overage rule |
|---|---|---|---|---|
| AI drafts | 50 / mo | 500 / mo | Unlimited | Soft cap: continue at ₹X per draft, billed monthly. Hard cap available on request. |
| Lex.AI queries | 100 / mo | 1,000 / mo | Unlimited | Same as above. |
| Storage | 10 GB | 100 GB | Unlimited | At 90% usage, prompt upgrade; at 100%, block new uploads (read remains). |
| Seats | 1 | up to 8 | 9+ | Adding the 9th seat to Practice triggers an automatic Firm-conversion CTA. |
| eSignature (Practice) | — | 200 / mo | — | Same overage at ₹X per envelope. |

> **Recommendation:** soft caps + transparent overage, mirroring Clio and MyCase. Indian competitors like LawSathi use hard caps but customer feedback consistently flags this as friction.

---

## 4. SuperAdmin — internal control plane

This is **not** sold to customers. It is the LexDraft staff console for managing every tenant. Modelled after standards from WorkOS, Clerk, Frontegg, and Stripe Billing.

### 4.1 Tenant lifecycle

- Provision / suspend / reactivate / delete firm accounts.
- Plan assignment with per-tenant feature-flag overrides (e.g., enable on-prem for one Practice tenant under contract).
- Seat-count and price overrides for Firm contracts.
- Trial extension and grace-period grants (audit-logged with reason).
- Bulk import (for migrating existing customers from Provakil / spreadsheets).

### 4.2 Identity & access into tenants

- **Impersonation** with persistent banner ("You are impersonating advocate@firm.com"), immutable audit trail capturing who, when, why, ticket reference, and the actions taken during the session.
- Force logout, password reset trigger, account lock / unlock.
- View MFA / SSO state across tenants.
- IP allow-listing per tenant.
- Session inspection — list active sessions, revoke individually.

### 4.3 Billing operations

- Razorpay (INR) and Stripe (non-INR Firm contracts) subscription view + override.
- Manual invoice generation, refunds, credit notes.
- Dunning queue for failed UPI mandates / NEFT bounces.
- ARR, MRR, churn, expansion, contraction dashboards.
- Cohort retention by acquisition month.
- Coupon / promo-code engine with expiry, usage caps, and stack rules.
- Tax handling (GST, TDS) per state.

### 4.4 Usage & customer-health

- Per-tenant usage: AI drafts consumed, eCourts polls executed, storage, seats active vs. licensed.
- **Customer health score** combining login recency, feature adoption, ticket count, NPS.
- Overage alerts → automated upsell trigger.
- Adoption-stage cohorts (onboarding, activated, power user, at-risk).

### 4.5 Support tooling

- Per-tenant timeline: signups, plan changes, tickets, incidents, payments.
- Internal notes pinned to firm record.
- Linked tickets (Freshdesk / Zendesk / Linear).
- Bulk announcement / banner per tenant or per plan.
- Saved replies / macros for the support team.

### 4.6 Compliance & DPDP tooling

- **Data export request** (DSR) fulfilment portal — generates downloadable archive of all data for a given data principal.
- **Right-to-erasure** workflow with legal hold for matters in active litigation.
- Consent log per tenant (when consent given, scope, withdrawal events).
- 72-hour breach-notification draft tooling, pre-filled with affected-tenant data.
- DPIA records repository.
- Auditor-ready data-residency proof reports.

### 4.7 Platform operations

- Feature-flag rollout: percentage of tenants, by plan, by region.
- Maintenance-window scheduling with tenant notifier (email + in-app banner).
- API rate-limit overrides per Firm tenant.
- Background-job retry / replay console.
- Email / WhatsApp / SMS template editor (with preview + send-to-self test).

### 4.8 Roles inside SuperAdmin

| Role | Tenant impersonation | Billing edits | Compliance views | Notes |
|---|:-:|:-:|:-:|---|
| **Founder / Owner** | ✓ | ✓ | ✓ | Full access including financial summaries. |
| **Support engineer** | ✓ (with reason) | — | Read-only | Can take action inside a tenant for ticket resolution. |
| **Billing operations** | — | ✓ | — | Refunds, plan changes, dunning. |
| **Compliance officer** | — | — | ✓ + edit | DPDP audit, DSR fulfilment, breach drafting. |
| **Read-only auditor** | — | — | ✓ read | For external SOC2 / DPDP audits. |

All SuperAdmin actions write to a tamper-evident audit log retained indefinitely.

---

## 5. Account-creation flows

### 5.1 Solo — self-serve, < 5 minutes

1. Land on `/signup` from `LandingHeader` CTA.
2. Email + phone OTP (single-step verification).
3. Password / passkey.
4. Profile: name, Bar Council registration number, primary practice area, primary court.
5. First-run wizard: create your first matter (or skip).
6. 14-day trial, card optional. Card prompt at day 7.

### 5.2 Practice — self-serve with team, < 30 minutes

1. Same identity step as Solo.
2. **Firm details** screen: firm name, GSTIN (optional in trial), address.
3. Seat invites: bulk-paste up to 8 emails, assign role per row.
4. Domain claim (optional) — verify a TXT record to auto-add anyone with that email domain.
5. Template upload step (optional) — drop existing Word docs to seed the firm template library.
6. Card required at day 7 of trial.

### 5.3 Firm — sales-led, 1–5 business days

1. "Speak with us" CTA → Calendly / form on `/contact-firm`.
2. Discovery call → demo → procurement.
3. **MSA** + **DPA** (Data Processing Agreement) negotiated and signed.
4. **DPIA** (Data Protection Impact Assessment) completed by LexDraft DPO.
5. SuperAdmin provisions tenant with negotiated seats, custom plan, optional on-prem.
6. CSM kickoff: branded portal setup, SSO configuration, custom domain, template migration, training session.
7. Go-live email to all invited seats with a personalised welcome.

### 5.4 SuperAdmin — internal only

- LexDraft team members are provisioned via internal IdP (Google Workspace SSO).
- Mandatory hardware key (YubiKey) for any role with impersonation or billing privileges.
- Quarterly access review (any role not used in 90 days is auto-suspended).

---

## 6. Data model implications

> Sketch only — final schemas will live in code review. Captured here so engineering can flag misalignment early.

```
Tenant (firm)
  id, name, plan: 'solo' | 'practice' | 'firm'
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  region: 'in-mumbai' | 'in-chennai'   # data residency
  feature_flags: { [flag: string]: boolean }   # per-tenant overrides
  billing_provider: 'razorpay' | 'stripe'
  created_at, trial_ends_at

User
  id, tenant_id, email, phone, bar_council_number
  role: 'owner' | 'admin' | 'advocate' | 'paralegal' | 'billing' | 'guest' | 'custom:<id>'
  status: 'invited' | 'active' | 'disabled'

Subscription
  tenant_id, plan, seats, mrr_inr
  current_period_start, current_period_end
  ai_drafts_used, lex_queries_used, storage_used_bytes

AuditLog
  tenant_id (nullable for SuperAdmin actions), actor_id, actor_type
  action, resource_type, resource_id
  metadata, ip, user_agent, created_at

ImpersonationSession   # SuperAdmin only
  superadmin_id, tenant_id, target_user_id
  reason, ticket_ref, started_at, ended_at
```

Tenant isolation is enforced at the row level (every query filtered by `tenant_id`) plus periodic verification via background scan.

---

## 7. Billing & metering

### 7.1 Recommended providers

| Currency | Provider | Why |
|---|---|---|
| INR (default) | **Razorpay Subscriptions** | Native UPI mandates, NEFT, RuPay, GST-ready invoicing, India entity. |
| USD / GBP / SGD (Firm only, NRI partners) | **Stripe** | Multi-currency, global cards, tax engine for non-IN entities. |

### 7.2 Metered events to record

- `ai_draft.generated` (Solo: 50, Practice: 500)
- `lex_query.run` (Solo: 100, Practice: 1,000)
- `ecourts.poll` (no charge, but tracked for fair-use)
- `storage.bytes_used` (sampled hourly)
- `esign.envelope_sent` (Practice: 200/mo)
- `seat.active` (counted nightly for Firm true-ups)

### 7.3 Plan transitions

| From → To | Behaviour |
|---|---|
| Solo → Practice | Self-serve in app. Pro-rate the difference. Invite team. |
| Practice → Firm | Sales-led. SuperAdmin manually converts. Migration call to add SSO + custom domain. |
| Practice (8 seats) + 9th invite | Block invite, show "You're ready for Firm" sales CTA. |
| Any → cancel | 30-day data-retention window, then DPDP-compliant deletion. |
| Past due | Day 7 grace, day 14 read-only, day 30 suspended, day 60 deleted. |

---

## 8. India-specific compliance checklist

| Requirement | Solo | Practice | Firm | Status |
|---|:-:|:-:|:-:|---|
| Data stored in India | ✓ | ✓ | ✓ | Mandatory at launch |
| DPDP-aligned privacy notice + consent capture | ✓ | ✓ | ✓ | Mandatory at launch |
| Consent-manager integration | ✓ | ✓ | ✓ | Phase 1 |
| DPIA records | — | — | ✓ (firm-level) | Phase 1 for Firm |
| 72-hour breach notification tooling | — | — | ✓ | Phase 1 for Firm, internal-only earlier |
| GST-compliant invoices (CGST/SGST/IGST/UTGST) | ✓ | ✓ | ✓ | Mandatory at launch |
| TDS-ready statements | — | ✓ | ✓ | Phase 2 |
| Bar Council of India advocate verification | ✓ | ✓ | ✓ | Phase 2 (manual at launch) |
| Indian-region disaster recovery | ✓ | ✓ | ✓ | Mandatory at launch |
| Customer-managed encryption keys | — | — | ✓ | Phase 2 |

---

## 9. Phased rollout

| Phase | Window | Scope |
|---|---|---|
| **Phase 0** — foundations | now → +6 weeks | Auth, RBAC, tenant model, Solo plan + Razorpay billing, eCourts CNR sync (5 matters), basic SuperAdmin (provision, impersonate, audit) |
| **Phase 1** — Practice GA | +6 → +12 weeks | Multi-seat, Practice plan, branded portal, eSign metering, SuperAdmin billing ops, customer-health basics |
| **Phase 2** — Firm pilot | +12 → +20 weeks | SSO/SAML, custom roles, audit-log SIEM export, white-label portal, on-prem option, dedicated CSM tooling, DPIA/DPO workflow in SuperAdmin |
| **Phase 3** — Compliance hardening | +20 → +28 weeks | Full DPDP DSR portal, breach notification tooling, customer-managed keys, regional language drafting (Marathi, Tamil, Bengali, Kannada) |

---

## 10. Open questions

1. **Razorpay primary, Stripe secondary?** Default assumption above. Confirm before we wire billing.
2. **Soft vs hard caps for AI metering.** Recommendation: soft caps with transparent overage. Indian competitors lean hard, but soft caps reduce churn and increase ARPU.
3. **Should "AI redlining" be split out as a paid add-on (SpotDraft model) instead of baked into Practice/Firm?** Splitting it lets us upsell into firms that already have a practice-management tool but want our redlining only.
4. **Do we want a free Solo tier?** CaseFox uses free-up-to-2-users to seed the funnel. Tradeoff: free tier costs us AI-draft budget and support load.
5. **Bar Council verification — manual or automated?** Manual at launch is fine for trust signals; long-term we should automate via Bar Council of India APIs if/when published.
6. **On-prem deployment model — Docker-Compose, Kubernetes, or full appliance?** Affects pricing floor and engineering effort for Firm.
7. **Custom domain for Firm white-label** — cname-only or full HTTPS provisioning via Let's Encrypt automation?

---

## 11. References

### India-native vendors
- [Provakil — Capterra profile](https://www.capterra.com/p/209812/Provakil/)
- [Provakil — official](https://provakil.com/)
- [LawSathi — Top 10 Legal Practice Management India 2026](https://lawsathi.in/top-10-legal-practice-management-software-in-india-for-2026/)
- [SpotDraft — pricing](https://www.spotdraft.com/pricing)

### Global benchmarks
- [Clio Manage — pricing](https://www.clio.com/pricing/)
- [Clio Manage — Roles and Permissions](https://help.clio.com/hc/en-us/articles/9200279456667-Roles-and-Permissions-in-Clio-Manage)
- [MyCase — pricing 2026](https://www.mycase.com/pricing/)
- [PracticePanther — pricing](https://www.practicepanther.com/pricing/)
- [CaseFox — pricing](https://www.casefox.com/pricing-casefox/)

### Court integration
- [eCourts Services — official](https://services.ecourts.gov.in/)
- [Vakeel360 — Court API](https://vakeel360.com/api)

### Multi-tenant SaaS standards
- [WorkOS — User management for B2B SaaS](https://workos.com/blog/user-management-for-b2b-saas)
- [Frontegg — Audit Logs for SaaS](https://frontegg.com/blog/audit-logs-for-saas-enterprise-customers)

### DPDP Act 2023
- [EY — DPDP Act 2023 Compliance Guide](https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023)
- [DPDPA.com — DPDP compliance hub](https://www.dpdpa.com/)
- [Hogan Lovells — DPDP Act 2023 brought into force](https://www.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force-)
- [MeitY — DPDP Act 2023 (PDF)](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)
