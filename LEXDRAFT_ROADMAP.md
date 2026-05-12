# LexDraft — Implementation Roadmap

**Status:** Draft · 2026-05-12
**Pairs with:** [LEXDRAFT_FEATURES_ANALYSIS.md](./LEXDRAFT_FEATURES_ANALYSIS.md) (source), [WORKFLOW_DASHBOARDS.md](./WORKFLOW_DASHBOARDS.md), [PRICING_AND_TIERS.md](./PRICING_AND_TIERS.md), [OVERVIEW.md](./OVERVIEW.md)
**Scope:** Milestones for the ~20 features deferred from the immediate "shippable now" parallel sweep. Each milestone is a coherent slice of work with explicit dependencies, T-shirt sizing, success criteria, and risks.

---

## How to read this doc

- **Order matters.** Milestones are dependency-ordered, not date-ordered. M2 cannot ship before M1.1; M3 / M4 are mostly independent of each other and can run in parallel.
- **T-shirt sizes (calendar time, one focused engineer):**
  - **S** = 1–2 weeks
  - **M** = 3–6 weeks
  - **L** = 2–3 months
  - **XL** = a full quarter or more (usually a sign the milestone needs further breakdown before kickoff)
- **Tier annotations** indicate the customer plan the feature is gated to: `cross-cutting` / `Solo` / `Practice` / `Firm` / `infrastructure`. Cross-cutting features ship to all tiers; tier-specific ones get the matching `requireFeature(...)` gate.
- **"Unblocks"** lists which downstream items become possible after this milestone lands. Use this to spot which milestones are gating others.
- **"Success criteria"** is the externally-visible signal it worked, not the engineering deliverable. If the criterion is met, the feature is shippable to a paying customer; if not, it isn't.
- **"Risks / unknowns"** is the part most likely to send the milestone back to design. Pay attention to these in kickoff.

---

## Already done (carry-over context)

These ship in the immediate parallel sweep separate from this roadmap — listed so a future implementer doesn't re-do them:

- Sanhita translator (cross-cutting)
- Court-fee / stamp-duty / vakalatnama calculators (cross-cutting)
- Statute-aware limitation engine (cross-cutting)
- Caseload health widget (Solo)
- Conflict-of-interest check (Practice)
- Hearing coverage swap board (Practice)
- Workload fairness view (Practice)
- Engagement letter automation (Firm)
- Profitability per matter — light (Practice)
- GST + expense export (Solo)

Platform foundations already in place from prior sessions: multi-tenant data plane, RBAC (3-layer), TOTP MFA (mig 0019), DPDP compliance triad — export + soft-delete-with-retention + consent ledger (mig 0020), analytics materialized views (mig 0021), webhook HMAC verification, pino-redacted logging, request-id correlation, AI drafting via Claude/Grok with retry + prompt caching, eval harness for drafting quality.

---

## Out of scope for this roadmap

Listed here so they're not silently inherited from the source analysis:

- **eCourts CNR integration** — excluded by user direction earlier; revisit only with explicit ask.
- **Payment provider** (Razorpay / Stripe / etc.) — excluded by user direction.
- **OpenTelemetry / external tracing backend** — excluded by user direction.

If any of these change, M4.3 (eCourts deep sync) and parts of M5 (governance) become more attractive.

---

# M1 — Foundation: unblock the parked work

**Theme:** Lay the infrastructure that gates a third of the remaining features. Without this milestone, M2 in its entirety is stuck.

**Tier:** infrastructure.

**Effort overall:** M.

### M1.1 · Vector store + embedding pipeline
- pgvector extension on the existing Postgres (decided two sessions ago — single datastore, tenant isolation inherits the firm_id WHERE pattern).
- Embedding column on `clauses`, `drafts`, `documents` (1024 dims for `voyage-law-2`, 768 for local BGE).
- Embedding service — pluggable provider abstraction; default Voyage AI `voyage-law-2`, fallback local BGE/Nomic via ONNX for cost / data-residency.
- pg-boss backfill job: enqueue an `embedding.compute` task on row insert; nightly re-embed for rows older than the active model version.
- Cosine-similarity search API at `POST /api/search/similar` — firm-scoped, takes `{ corpus, text | rowId, k }`, returns ids + scores.
- ANN index: `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)` on each embedded table.

**Effort:** M | **Unblocks:** M2 in full (5 features).
**Success criteria:** Searching "termination clause" against the seed firm's clause library returns the indemnity / exit / breach clauses (not just literal-keyword matches) at p95 < 200ms.
**Risks / unknowns:**
- **Provider choice** is the single biggest open question. Voyage's legal-tuned model materially beats generic embeddings on Indian legal text in our prior eval. Local BGE is free but needs ~300 MB RAM bump on the API container. Decide before kickoff.
- Cost ceiling: at ~$0.06 / 1M tokens, a single firm's clause library + drafts is sub-rupee, but a full re-embed across all tenants on a model version bump could be ₹thousands. Budget the re-embed cadence explicitly.

### M1.2 · PMLA KYC capture
- Schema: `client_kyc_documents` table (client_id, doc_type, file_url, masked_id, verified_at, verifier_user_id) with a `client_risk_tier` enum on the `clients` table.
- Aadhaar masking — store only the last 4 digits; full number never persisted (the storage service already supports redaction-on-write, reuse).
- PAN format validation server-side.
- Reportable-transaction ledger: `pmla_transactions` table with amount, parties, source-of-funds, matter linkage.
- Audit hooks — each KYC event writes to `audit_log` with `retain_until = now() + interval '7 years'` (the default the DPDP work already enabled).

**Effort:** S | **Tier:** Firm.
**Unblocks:** M5.1 compliance suite.
**Success criteria:** A Firm Admin can complete KYC for a new corporate client in < 3 minutes, and the resulting audit trail satisfies an internal compliance officer's review.
**Risks / unknowns:**
- Legal team must sign off on the masking strategy before Aadhaar bytes ever touch disk — Aadhaar regulations are strict.

---

# M2 — Retrieval-grounded AI (depends on M1.1)

**Theme:** Make the vector store visible to customers. Every demo opens with one of these features.

**Tier:** mostly cross-cutting; #2.4 is Practice-only; #2.5 is Firm-only.

**Effort overall:** M.

### M2.1 · Citation verifier
- On every draft generation, extract case citations from the AI output via regex + LLM.
- Resolve each citation against the embedded case-law corpus (build alongside this milestone — start with Indian Kanoon dump for SCC, top-3 HCs).
- Inline UI: green check next to verified cites, amber warning for "couldn't verify in our corpus," red for "looks fabricated" (no semantic neighbour above similarity threshold).

**Effort:** M | **Tier:** cross-cutting (gated by `drafting.ai`).
**Success criteria:** Every cite in a Claude-generated draft is annotated with verification status before the user sees it. The hallucinated-cite rate (cited case not in corpus) is < 2% post-verification gate.
**Risks / unknowns:**
- **Corpus licensing** — SCC OnLine is paywalled; Indian Kanoon is public but incomplete. Decide ingest sources before kickoff. This is the existential-risk feature for AI-in-law products (cf. *Mata v. Avianca*) — getting it wrong is worse than not shipping it.

### M2.2 · Precedent finder
- "Find me 5 similar holdings" affordance inside the drafting editor — select a paragraph, get k-nearest case-law neighbours.
- Filters: court level, year range, judge, practice area.
- Result cards with the holding sentence highlighted + a one-click "insert as citation" action.

**Effort:** M | **Tier:** cross-cutting (gated by `research.advanced`).
**Success criteria:** A user can go from a paragraph of argument to a citable precedent in under 30 seconds. The marquee demo feature.
**Risks / unknowns:**
- Quality of retrieval is judge-and-jury — needs a small human eval set (extend the existing AI eval harness) before claiming "ready."

### M2.3 · Hearing prep packet
- One click on tomorrow's listed matter → bundle (facts summary, last order text, pending issues, recent precedents on the legal point, opposing counsel's last submission).
- LLM-summarises the facts + issues from the matter timeline; embeds the precedents via M2.2.
- Output: a downloadable PDF + an in-app reading view.

**Effort:** S | **Tier:** cross-cutting (gated by `hearing.prep`).
**Success criteria:** An advocate stops doing the 11pm prep ritual manually. Measured by: feature is used by > 40% of active users with a hearing the next day.
**Risks / unknowns:**
- Depends on the timeline service being usable — confirm at kickoff that `cases.events` has enough structure to summarise.

### M2.4 · Chamber knowledge base
- Embed all of a chamber's briefs, opinions, internal memos, and successful arguments into a private per-tenant vector index.
- Semantic search UI scoped to the chamber's own documents — *not* public case law (that's M2.2).
- The genuinely-defensible feature: no competitor has a chamber's institutional memory.

**Effort:** M | **Tier:** Practice (gated by `knowledge.chamber`).
**Success criteria:** Chamber lead can find "the argument we used in the Patel matter on Section 138" without remembering the matter id.
**Risks / unknowns:**
- Data-classification UX — not every document a chamber produces should be searchable (privileged communication, ongoing matters with strict need-to-know). Need a "exclude from KB" flag at upload time.

### M2.5 · Knowledge management with provenance
- Firm-tier extension of M2.4: surface *who* wrote a given argument, *which matter* it succeeded in, *which partner* pioneered a structure.
- Author + matter attribution captured at draft-save time, displayed alongside KB search results.
- "When partners leave, this is what gets lost" — the buyer-visible framing.

**Effort:** S (on top of M2.4) | **Tier:** Firm (gated by `knowledge.provenance`).
**Success criteria:** A managing partner can audit "what we know about RERA" with the contributor names attached, ready for an internal knowledge-share session.
**Risks / unknowns:**
- Author-attribution needs to honour the DPDP user-deletion path: if an author requests deletion, attribution should anonymise rather than break the provenance chain.

---

# M3 — Collaboration & workflow (mostly independent of M1/M2)

**Theme:** The things firms currently do over WhatsApp, email, and Word track-changes. Replace each with an in-app flow.

**Tier:** mixed.

**Effort overall:** L.

### M3.1 · Internal review / redline workflow
- Draft → "Send for review" → assigned reviewer gets it with redline tooling.
- Track changes server-side (CRDTs preferred but operational-transform is acceptable v1).
- Approval gate before "File this" or "Send to client" actions.
- Audit trail of who-changed-what.

**Effort:** L | **Tier:** Practice + Firm (gated by `review.workflow`).
**Success criteria:** A junior's first draft can go to a partner, accumulate redlines, and land on the client's desk without anyone leaving the app or opening Word.
**Risks / unknowns:**
- **Real-time collab is hard.** Decide v1 stance: simultaneous editing (CRDT) vs check-out/check-in (lock-based). The latter is 10× less work and is what most chambers actually do today.
- The existing `RichTextEditor` (`apps/web/src/components/RichTextEditor.tsx`) doesn't have track-changes; either extend it or pull in TipTap's collab extension.

### M3.2 · Counsel briefing portal
- Firms regularly brief external senior counsel. Currently done over email.
- Bundle: matter brief + precedents + question paper + deadline. One link.
- Senior counsel accesses via a portal-style magic-link auth (reuse the client portal pattern but with a different role).
- Turnaround tracker visible to the firm.

**Effort:** M | **Tier:** Firm (gated by `external.counsel`).
**Success criteria:** A firm can brief a senior advocate and receive a written opinion entirely through the platform.
**Risks / unknowns:**
- Senior counsel rarely want yet-another-login. The UX has to be one link, zero friction — model on the existing client portal magic-link flow.

### M3.3 · Junior onboarding flow
- Chamber growth from 3 → 8 advocates is a real inflection point where things break.
- Onboarding checklist per role: assigned templates, sample matters, supervision pairing, week-1 / week-2 / week-4 check-ins.
- Read-receipt + progress tracking for the Firm Admin.

**Effort:** S | **Tier:** Practice (gated by `onboarding.junior`).
**Success criteria:** A new junior's first week is fully visible to the chamber lead; nothing important slips because "no one told them."
**Risks / unknowns:**
- Risk of over-engineering. v1 should be a single configurable checklist per role, not a multi-stage workflow engine.

### M3.4 · Lead CRM (Solo)
- Consultation booked → engagement letter sent → matter open. Three states, one pipeline view.
- WhatsApp / email follow-up nudges at configurable intervals.
- Conversion analytics (top of funnel → matter open rate).

**Effort:** S | **Tier:** Solo (gated by `lead.crm`).
**Success criteria:** A Solo advocate doesn't lose a consultation at the 7-day follow-up because the platform reminded them.
**Risks / unknowns:**
- WhatsApp Business API has its own approval flow + per-message cost. Make the integration optional v1 — email-only at first.

### M3.5 · Junior-on-demand drafting (UX repackaging)
- Existing AI drafting feature, but framed and onboarded as *"the junior you don't have."*
- Inputs: rough handwritten notes (image upload + OCR), a voice memo (depends on M4.1), or a 2-line brief.
- Output: a reviewable first draft in under 2 minutes.

**Effort:** S | **Tier:** Solo (gated by `drafting.ai`).
**Success criteria:** Solo onboarding conversion lifts measurably (the feature is the second-funnel-step after sign-up).
**Risks / unknowns:**
- This is primarily a marketing / IA reframe of existing functionality, not net-new engineering. Don't over-scope it.

---

# M4 — Data ingestion (per-feature independence; each can be its own slice)

**Theme:** Reduce typing. Indian advocates dictate, photograph, and forward documents constantly — the platform should accept all three.

**Tier:** cross-cutting.

**Effort overall:** L (each sub-feature can ship independently).

### M4.1 · Voice-to-draft
- Whisper-grade transcription as a first-class input mode in the drafting flow.
- Indian-English + Hindi + Tamil + Bengali + Marathi at minimum (other Indic languages stretch).
- "Convert to formal pleading" LLM pass after transcription cleans up filler words and applies pleading conventions.

**Effort:** M | **Tier:** cross-cutting (gated by `drafting.voice`).
**Success criteria:** An advocate can dictate a 2-minute description of a matter in a car and get a first-draft notice when they arrive at the office.
**Risks / unknowns:**
- Whisper API costs scale with audio length and language. Budget per user per month — implement same per-user-hourly limiter pattern as the existing LLM generation limiter.
- On-device Whisper (CoreML / Web) is technically possible but ships much later.

### M4.2 · Auto-extracted matter facts
- User uploads complaint / FIR / police chargesheet PDF.
- OCR (Tesseract or Google Vision) + LLM extraction → structured matter metadata: parties, court, sections invoked, dates, amounts, key relief sought.
- Pre-fills the New Case modal; user reviews + confirms.

**Effort:** M | **Tier:** cross-cutting (gated by `matter.autofact`).
**Success criteria:** Matter creation time drops from ~5 minutes of typing to ~30 seconds of confirming.
**Risks / unknowns:**
- Indian legal documents have wildly inconsistent structure (handwritten, printed, scanned, photographed). v1 should target printed/digital PDFs only; handwritten is M4.3 territory.
- LLM extraction needs the eval harness extended with golden complaints to detect quality regressions.

### M4.3 · eCourts deep sync (revisit only with user approval)
- Beyond cause-list: pull order PDFs after each hearing, attach to the matter automatically.
- Currently excluded by user direction; revisit only if priorities change.

**Effort:** L | **Tier:** cross-cutting.
**Status:** OUT until explicitly re-enabled.

---

# M5 — Firm-grade governance

**Theme:** What a Firm-tier buyer (managing partner / COO) asks for in their procurement checklist. Each item by itself doesn't sell the tier; the bundle does.

**Tier:** Firm.

**Effort overall:** L.

### M5.1 · Compliance suite (extends M1.2)
- KYC capture (already in M1.2) + retention policies + audit log exports + DPIA artifacts on demand.
- "Generate a compliance pack for procurement" — a single bundled PDF/zip of all DPDP + PMLA artifacts for an enterprise client to review.

**Effort:** S (on top of M1.2) | **Tier:** Firm.
**Success criteria:** A corporate buyer's legal team accepts the bundled pack and procurement moves forward without separate questionnaires.
**Risks / unknowns:**
- Regulations evolve; the bundle generator needs to be configuration-driven, not hard-coded.

### M5.2 · Trust / CA-account reconciliation
- Client-money tracking against matters: receipts, disbursements, current ledger balance.
- Reconciliation against the firm's bank statement (CSV import v1; bank-API integration in M5.6).
- Surprisingly absent from Indian legal tech.

**Effort:** M | **Tier:** Firm (gated by `trust.account`).
**Success criteria:** Monthly trust-account reconciliation that used to take a partner half a day completes in 30 minutes with the same accuracy.
**Risks / unknowns:**
- Bar Council rules on trust-account handling vary by state. Get sign-off from a practising chartered accountant before claiming the feature is "compliance-ready."

### M5.3 · Matter staffing optimiser
- Given a new matter's nature + value, suggest a partner + associate + junior mix based on past matter profitability and current load.
- Depends on the M5.4 analytics depth.

**Effort:** M | **Tier:** Firm (gated by `staffing.optimiser`).
**Success criteria:** Senior partners stop allocating by gut feel; staffing decisions reference the suggestion 50%+ of the time.
**Risks / unknowns:**
- Trust in the suggestion engine is everything. v1 should expose the *reasoning* (past similar matters, current load) not just a name.

### M5.4 · Litigation analytics (deep)
- Judge tendencies (disposal time, grant rate on common applications, adjournment patterns).
- Win rates by court / practice area / opposing counsel.
- Average disposal time, comparative to peers (anonymised).
- Powered by eCourts data + the firm's own matter outcomes.

**Effort:** L | **Tier:** Firm (gated by `analytics.deep`).
**Success criteria:** Firm partner-meeting decks pull a chart from LexDraft directly.
**Risks / unknowns:**
- Quality depends on **eCourts deep sync (M4.3) being unblocked.** Without it, this feature is firm-data-only and much weaker.
- Judge-tendency reporting has ethical considerations — the Bar Council's rules on the limits of judicial profiling. Get a sanity check from counsel.

### M5.5 · Multi-office / multi-bench support
- Firms span Delhi + Mumbai + Bangalore offices with different court ecosystems, practice mixes, and KPIs.
- Office-as-an-org-unit data model: every matter, member, KPI optionally tagged with an office_id.
- Per-office dashboard pivot.

**Effort:** L | **Tier:** Firm (gated by `multi.office`).
**Success criteria:** A two-office firm can run separate office dashboards and a consolidated firm dashboard from the same data.
**Risks / unknowns:**
- **Data-model overhaul.** Adding `office_id` to existing tables is migration-heavy and touches every domain query. Plan the migration as its own sub-milestone.

### M5.6 · API + webhooks (governance surface)
- Outbound webhooks on matter / invoice / document events.
- Read-only REST API for the firm's own data — partner-keyed auth, scoped to the firm.
- Use cases: pipe matters into Tally, sync invoices to Zoho, push to a custom data warehouse.

**Effort:** M | **Tier:** Firm (gated by `api.access`).
**Success criteria:** A firm with an internal data team integrates LexDraft into their existing Tally + Salesforce stack in under a week.
**Risks / unknowns:**
- Public-facing API surface needs versioning, deprecation policy, and rate limiting from day one. The current internal API is none of those.

### M5.7 · White-label client matter portals
- The existing client portal, but rebrandable per firm: logo, primary colour, custom domain.
- Corporate in-house counsel buyers ask for this in procurement.

**Effort:** S | **Tier:** Firm (gated by `portal.white_label`).
**Success criteria:** A Firm Admin can deploy a portal at `clients.{firm-domain}.com` with their logo and colour scheme in under 30 minutes.
**Risks / unknowns:**
- Custom-domain provisioning needs DNS-cert automation (Let's Encrypt + DNS-01). Use Caddy or similar; don't roll your own.

---

# M6 — Reach & community (purely additive)

**Theme:** Once the product is solid, these expand surface and retention without adding core complexity.

**Tier:** mixed.

**Effort overall:** M.

### M6.1 · Indic-language expansion
- Existing drafting supports EN / HI / TA. Add Bengali, Marathi, Telugu, Kannada.
- Per-language: prompt-engineering pass, golden brief set in the eval harness, Devanagari/Bengali/Tamil/Kannada/Telugu font verification across the editor.

**Effort:** S per language (parallelizable) | **Tier:** cross-cutting.
**Success criteria:** A Bengali advocate can draft a lower-court pleading in Bengali end-to-end without leaving the app.
**Risks / unknowns:**
- Lower-court Bengali/Marathi/Telugu has regional terminology variation. Quality eval needs native-speaker reviewers, not auto-rubric only.

### M6.2 · Templates marketplace
- Community-curated bail apps, 138 notices, divorce petitions, RERA complaints.
- Submission flow with vetting (a small editorial committee), version control, attribution.
- Free + paid templates (revenue share with contributors).

**Effort:** L | **Tier:** cross-cutting (gated by `templates.marketplace`).
**Success criteria:** A new Solo user finds a usable bail-application template in under 2 minutes; the marketplace has 100+ vetted templates within 6 months of launch.
**Risks / unknowns:**
- **Trust + liability.** A template that mis-states procedure could harm the user. Need clear "this is a template, you remain responsible" disclaimers + a quality bar.
- Revenue-share is product-tax-and-legal complexity — start with free-only, monetize later.

### M6.3 · Referral network
- "I have a matter in Hyderabad, anyone want to appear?" board, scoped to the user's plan tier or higher.
- Lightweight matching: practice area, court, urgency.
- Builds network effects that retain solos against churn.

**Effort:** M | **Tier:** cross-cutting (gated by `referral.network`).
**Success criteria:** A Solo in Delhi can find a Solo in Hyderabad to cover a one-day matter; both retain accounts because of the network.
**Risks / unknowns:**
- Two-sided market — needs both supply (advocates willing to take referrals) and demand (matters being posted). Bootstrap one side first; consider seeding with synthetic posts.
- Bar Council ethics rules on solicitation — clarify what's allowed before going live.

---

# Cross-milestone notes

## What the immediate sweep set up that this roadmap inherits
- **Eval harness** ([apps/api/eval/](./apps/api/eval/)) — extend with new golden sets for every M2 / M4 AI feature. The diff-against-baseline pattern catches model regressions early.
- **DPDP audit retention** — every new feature's user-facing actions should write `audit_log` rows with `retain_until = now() + interval '7 years'`. The default is already set in `audit.service.ts`; don't override it.
- **firmIdForUser cache** — every new tenant-scoped service must call `invalidateTenantCache(userId)` on user mutations. The pattern is in place; new code just has to follow it.
- **HttpError taxonomy** — use `NotFoundError` / `ForbiddenError` / `ConflictError` etc. from `apps/api/src/lib/errors.ts`. The old `Object.assign(new Error(), {status})` pattern is deprecated.

## Sequencing principles
1. **Don't start M2 without M1.1 complete.** A vector-DB feature without retrieval is a UI without a backend.
2. **M3 / M4 / M5 are mostly independent of each other.** A staffed-up team can run all three in parallel.
3. **M5.4 (deep analytics) is the only milestone that *requires* re-enabling an out-of-scope item (eCourts).** If eCourts stays excluded, downgrade M5.4 to "firm-data-only analytics."
4. **Inside M5, prioritise M5.1 (compliance) first.** It's the one most likely to be a hard procurement gate for the buyer.

## Milestone-by-milestone effort summary

| Milestone | Theme | Tier focus | Effort | Gates |
|---|---|---|---|---|
| M1 | Foundation | infra | M | M2 |
| M2 | Retrieval AI | mostly cross-cutting | M | — |
| M3 | Collaboration / workflow | mixed | L | — |
| M4 | Data ingestion | cross-cutting | L | — |
| M5 | Firm governance | Firm | L | partly on M4.3 |
| M6 | Reach / community | mixed | M | — |

Total roadmap effort: **roughly two engineering quarters with one focused team**, less if parts run in parallel. Sequencing M1 → (M2 ∥ M3 ∥ M4 ∥ M5.1) → (M5.{2..7} ∥ M6) is the fastest realistic path.

---

## Revision history

- **2026-05-12** — Initial draft. Carved out of [LEXDRAFT_FEATURES_ANALYSIS.md](./LEXDRAFT_FEATURES_ANALYSIS.md) §1–§4 minus the ~10 features handled in the immediate parallel sweep.
