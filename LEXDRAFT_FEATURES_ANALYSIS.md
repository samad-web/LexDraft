# LexDraft — Feature Recommendations Across Tiers

**Status:** Analysis · 2026-05-12
**Pairs with:** WORKFLOW_DASHBOARDS.md, PRICING_AND_TIERS.md
**Scope:** Strategic feature recommendations to elevate the application across Solo, Practice, and Firm tiers, with cross-cutting capabilities that justify the platform's positioning.

---

## Strategic Read First

A few things stand out before getting into specific features:

- **The vector DB you're building is your unfair advantage** — but the workflow document doesn't tie any dashboard surface to retrieval-augmented features. Every tier should have at least one feature that visibly leans on it (precedent suggest, citation check, brief assist). Otherwise it's just infrastructure no one sees.
- **The Sanhita transition is a once-in-a-generation product opportunity.** Every Indian advocate is currently re-learning IPC→BNS, CrPC→BNSS, Evidence Act→BSA. A reliable cross-reference tool baked into drafting would get the product talked about in every bar room this year. Time-sensitive — the window closes once everyone internalises the new sections.
- **You're missing trust/compliance infrastructure.** Post-2023 PMLA amendments brought advocates partly under reporting obligations; Bar Council ethics rules around advertising matter for what you can show in marketing; client data is sensitive. None of this is in the doc and it's a real Firm-tier purchase driver.
- **The dashboards are passive (here's what's happening) rather than active (here's what you should do next).** A daily "next-best-action" feed beats six widgets of state.

---

## 1. Cross-Cutting Features (All Tiers)

These should be the floor, available everywhere; differentiation happens in volume, scope, and analytics on top.

- **Sanhita translator** — paste an IPC section number or old draft, get the BNS/BNSS/BSA equivalent with side-by-side text and a note on what changed substantively. Embed it into the drafting flow so old templates auto-flag stale references.
- **Citation verifier** — every AI-drafted document gets every case cite resolved against your vector DB before it's shown. Hallucinated citations are the single biggest existential risk for AI-in-law products (cf. *Mata v. Avianca*). Show a green tick or a "couldn't verify" warning inline.
- **Precedent finder with semantic search** — select any paragraph in a draft → "find me 5 similar holdings." This is the marquee use of your vector DB. Filter by court, year, judge.
- **Hearing prep packet** — one click on tomorrow's listed matter generates a brief: facts, last order, pending issues, recent precedents on the legal point, opposing counsel's last submission. Saves the 11pm prep ritual.
- **Voice-to-draft** — Indian advocates dictate constantly. Whisper-grade transcription with a "convert to formal pleading" pass should be a default input mode, not an add-on.
- **Auto-extracted matter facts** — when a user uploads a complaint or FIR PDF, parse parties / court / sections invoked / dates / amounts into structured matter metadata. Don't make people type what's already in the document.
- **Limitation engine that knows the Acts** — the existing "limitation index" appears calendar-based; make it statute-aware (Limitation Act 1963 schedules, special limitation in NI Act §138, Consumer Protection Act, etc.) and let users add a matter type to auto-compute the deadline.
- **Vakalatnama / court fee / stamp duty calculators** — small, but searched-for daily. State-wise, because court fees vary.
- **Indic-language support for pleadings** — at least Hindi, Tamil, Bengali, Marathi, Telugu, Kannada for lower-court work. Most global legal AI doesn't touch this.
- **eCourts deep sync** — beyond cause list, pull the actual order PDFs after each hearing and attach to the matter automatically.

---

## 2. Solo-Specific Features

The Solo buyer is a one-person business who needs leverage, not collaboration. Features should make them feel like they have an associate.

- **"Junior-on-demand" drafting mode** — turn rough notes or a voice memo into a first-draft pleading reviewable in 2 minutes. The AI drafts feature exists; this is about packaging it as "the junior you don't have."
- **Lead capture + simple CRM** — most solos lose business at follow-up. A pipeline view of "consultation booked → engagement → matter open" with WhatsApp/email follow-up nudges.
- **Practice-area templates marketplace** — community-curated bail apps, 138 notices, divorce petitions, RERA complaints. Solos pay for templates today via random PDF leaks; offering a vetted library is sticky.
- **GST + practice expense tracking** — solo advocates are sole proprietors; quarterly compliance is a real chore. Even a lightweight expense + invoice export to Tally/Zoho beats nothing.
- **Caseload health** — flag when their open-matter count or limitation-pressure is unhealthy. Solos burn out invisibly.
- **Referral network inside the platform** — "I got a matter in Hyderabad, anyone want to appear?" Builds network effects that retain solos against churn.

---

## 3. Practice-Specific Features

Practice (2–8 advocates) is the most underserved segment in Indian legal tech. The Firm-lite framing in the workflow doc is right; here's what specifically earns the upgrade:

- **Conflict-of-interest check at chamber level** — when a new matter is opened, scan every existing client/opposing-party across all members. Mandatory under Bar rules; manually impossible past ~50 matters.
- **Hearing coverage swap board** — "I have a clash in Madras HC on the 14th, who can cover?" Used to be a WhatsApp scramble; turn it into a board with the listed matter, brief packet, and one-click acceptance. This alone justifies the tier for many chambers.
- **Internal review/approval before filing** — junior drafts → partner reviews with redlines → filed. Right now this happens over email + Word track changes.
- **Shared chamber knowledge base** — every brief, opinion, and successful argument the chamber has produced, semantically searchable. Your vector DB indexed on *their own* documents, not just public case law. Genuinely defensible.
- **Workload + attendance view** — who's overloaded, who's bench-warming. Different from Firm-level "billable utilisation" — Practice partners care about fairness and burnout, not hours.
- **Junior onboarding flow** — assign templates, sample matters, supervision pairings. Chamber growth from 3→8 advocates is a real inflection where things break.
- **Profitability per matter (light)** — fees received vs. hours logged, without the analytics depth of Firm. Practice partners want to know which clients are unprofitable; they don't need a BI suite.

---

## 4. Firm-Specific Features

Firm (9+, sales-led, MSA) buys differently — the buyer is a managing partner or COO who needs governance, not productivity. The current Firm dashboard is performance-oriented; add a governance layer.

- **Litigation analytics** — judge tendencies, win rates by court/practice area, average disposal time. This is what the eCourts APIs you'd integrate with are uniquely positioned to surface, and it's a partner-meeting deliverable.
- **Counsel briefing portal** — Firms regularly brief external senior counsel. A portal that bundles the brief, the precedents, the QPs, and tracks turnaround beats email.
- **Matter staffing optimiser** — given a new matter's nature and value, suggest the right partner + associate + junior mix based on past matter profitability and current load.
- **Engagement letter + scope automation** — generate engagement letters from matter type, with the firm's standard scope/fee language. Saves billing disputes downstream.
- **Compliance suite** — KYC capture (PMLA), retention policies, audit log exports, DPIA artifacts. Firm-tier customers will ask for this in their procurement checklist; not having it kills the deal.
- **Trust/CA-account reconciliation** — client money tracking against matters. Surprisingly absent from Indian legal tech and a real partner pain.
- **Knowledge management with provenance** — institutional memory: who wrote which argument, which partner pioneered which structure, which matters used which precedent. When partners leave, this is what gets lost.
- **API + webhook access** — Firm-tier customers want to pipe data into Tally, Zoho, Salesforce, their custom data warehouse. Don't try to be their everything; be their best integration.
- **Multi-office / multi-bench support** — Firms often span Delhi + Mumbai + Bangalore offices with very different court ecosystems. Practice mix, members, KPIs should pivot by office.
- **Client matter portals** — corporate clients want to see their own litigation in one place. White-label, branded portals are a real procurement requirement for in-house counsel buyers.

---

## 5. Prioritisation Recommendations

If sequencing this work, two things should be pushed to the front of the queue regardless of tier:

### Priority 1 — Sanhita Translator + Citation Verifier
The cheapest, most visible "we get Indian law" feature combination that can ship in the next quarter. Every demo opens with it. Both are direct applications of the vector DB already being built. Time-sensitive given the ongoing Sanhita transition.

### Priority 2 — Conflict Check + Chamber Knowledge Base
The single feature most likely to convert Solos into Practice. Right now the Practice tier offers a chambers dashboard; that's not a strong upgrade reason on its own. *"We make sure your chamber doesn't accidentally sue an existing client and your juniors can find every brief you've ever written"* — that is.

Everything else stacks on top.

---

## 6. Summary Matrix

| Capability | Solo | Practice | Firm |
|---|---|---|---|
| Sanhita translator | ✓ | ✓ | ✓ |
| Citation verifier | ✓ | ✓ | ✓ |
| Precedent finder (vector DB) | ✓ | ✓ | ✓ |
| Hearing prep packet | ✓ | ✓ | ✓ |
| Voice-to-draft | ✓ | ✓ | ✓ |
| Limitation engine (statute-aware) | ✓ | ✓ | ✓ |
| Indic-language drafting | ✓ | ✓ | ✓ |
| Junior-on-demand drafting | ✓ | — | — |
| Lead CRM + GST tracking | ✓ | — | — |
| Templates marketplace | ✓ | — | — |
| Referral network | ✓ | — | — |
| Conflict-of-interest check | — | ✓ | ✓ |
| Hearing coverage swap board | — | ✓ | ✓ |
| Internal review/redline workflow | — | ✓ | ✓ |
| Shared chamber knowledge base | — | ✓ | ✓ |
| Workload fairness view | — | ✓ | — |
| Profitability (light) | — | ✓ | — |
| Litigation analytics (deep) | — | — | ✓ |
| Counsel briefing portal | — | — | ✓ |
| Matter staffing optimiser | — | — | ✓ |
| Compliance suite (PMLA/DPIA) | — | — | ✓ |
| Trust account reconciliation | — | — | ✓ |
| API + webhooks | — | — | ✓ |
| Multi-office support | — | — | ✓ |
| Client matter portals (white-label) | — | — | ✓ |
