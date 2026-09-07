# LexDraft — Drafting Logic (end to end)

How the AI drafting engine works, from the advocate's words to a finished,
grounded document. Every claim below points at the actual code.

---

## 0. The one-line summary

The advocate describes a matter in plain language (typed or dictated). The engine
**decides which document to draft**, **resolves the correct BNS/BNSS sections from
a knowledge base** (never invented), **drafts it in that document's own correct
format**, and **self-audits** — blocking export on unauthorised or repealed-law
citations. Everything the model isn't sure of becomes a `[TO BE CONFIRMED]`
placeholder rather than a fabricated fact.

---

## 1. Entry points (the HTTP surface)

All under `POST /api/drafting/*` (`apps/api/src/routes/drafting.routes.ts`), gated
by `requireFeature('drafting.ai')` + quota + rate limit:

| Route | What it drives |
|---|---|
| `/auto` | **The one-input flow.** Brief only → triage → pipeline. (default UI) |
| `/pipeline` | Grounded pipeline for a pre-picked doc type |
| `/agent/stream` | Format-catalog agent (plan→draft→review→refine), streams |
| `/generate`, `/generate/stream` | Single-shot generation (legacy/fallback) |
| `/extract-fields` | Free brief → structured form fields |

The web app defaults to `/auto` via `useAutoDraft()` → `AutoDraftPanel` →
`DraftingView` ("Describe the matter" box). No tab-picking.

---

## 2. The one-input flow (`/auto`)

`draftAutoService.run()` (`apps/api/src/services/draft-auto.service.ts`) chains
two stages:

```
brief (text/voice)
   │
   ▼
STAGE 0  TRIAGE      draftTriageService.triage()
   │                 → { docType, forum, blocks, confidence }
   ▼
STAGES 1-4 PIPELINE  draftingOrchestratorService.run()
   │                 → { sections, draft, verify, blocked, advisories }
   ▼
{ triage, pipeline }  → UI renders "Detected: <doc>" + the draft + audit
```

### Stage 0 — TRIAGE (`draft-triage.service.ts`)

Reads the raw brief and decides **what document to produce**, choosing `docType`
**only from a grounded catalog** (`TRIAGE_DOC_TYPES`, all 58 web doc types) — it
cannot invent a type; an off-list answer is snapped to the nearest known type or
a safe default. Also returns the `forum` and the **block set** for that document.

Degrades safely: no LLM key / parse failure → keyword-based guess at low
confidence. Never throws.

**Block sets = each document's own correct structure.** This is the "understand
which format goes with which document" logic:

| Family | Blocks emitted |
|---|---|
| §138 Notice | header · opening · recital · **15-day §138 demand** · signature |
| Legal Notice | header · opening · recital · demand · signature |
| Bail / Anticipatory | causeTitle · facts · grounds · **undertaking** · prayer · verification |
| Plaint / Appeal / Complaint | causeTitle · facts · grounds · prayer · verification |
| Written Statement / Rejoinder | causeTitle · **preliminaryObjections** · **paraWiseReply** · prayer · verification |
| Affidavit | deponent · facts · **jurat** |
| Deed (Sale/Gift/Mortgage/…) | title · **WHEREAS recitals** · operative · schedule · **testimonium+attestation** |
| Agreement | title · recital · terms · boilerplate · **execution** |
| Will | declaration(sound mind+**revoke**) · bequests+executor · **witness attestation** |
| Power of Attorney | **KNOW ALL MEN…** appointment · powers · execution |
| Bond | **held & firmly bound** obligation · condition · execution |
| RTI / Caveat / Vakalatnama / Written Arguments | each its own addressed/cause-title structure |

### Stages 1-4 — the grounded PIPELINE (`drafting-orchestrator.service.ts`)

Runs `EXTRACT → CLASSIFY → [gate] → DRAFT → VERIFY`. Prompts live in
`apps/api/src/lib/drafting-prompts.ts`; the offence KB is
`apps/api/src/data/offence-kb.json`.

**Stage 1 EXTRACT** — brief → structured facts (parties, case refs, dates,
`alleged_offences` in the advocate's own words, `needs_clarification`). Never
invents particulars.

**Retrieval** — `offenceKbService.candidatesFor(alleged_offences)` pulls candidate
BNS offences from the KB (lexical alias/keyword match).

**Stage 2 CLASSIFY** — picks the applicable offence ids **only from the retrieved
KB candidates**. A hard guard drops any id the model invents that isn't a real
candidate. This is the anti-hallucination core — a section that isn't in the KB
cannot be cited.

**Gate** — each chosen offence is marked **VERIFIED** (counsel-checked, may be
asserted as a hard citation) or **SUGGESTED** (hedged, advocate must confirm)
based on the KB entry's `verification` field.

**Stage 3 DRAFT** — writes the requested blocks (from Stage 0) using **only** the
cleared sections. GAPs become `[TO BE CONFIRMED: …]`, never fabricated.

**Stage 4 VERIFY** — audits the draft against the allowed-citation set. Sets
`blocked = true` (disables export) on **unauthorised citations** or **repealed-law
(IPC/CrPC/IEA) references**. Unsupported facts / placeholders surface as
non-blocking advisories.

> **Allowed-citation set** = the KB-backed sections CLASSIFY resolved **PLUS the
> document type's own inherent governing statute** (`DOC_TYPE_STATUTES`). The
> latter is why a §138 notice can cite "Section 138 NI Act" without being flagged
> as unauthorised (that statute isn't a BNS offence in the KB, so without this it
> would wrongly block export — fixed).

---

## 3. Grounding data (what keeps it honest)

| File | Holds | Size |
|---|---|---|
| `data/offence-kb.json` | 39 BNS offences w/ ingredients, bailable/cognizable/triable/punishment, verification status | ~40 entries |
| `data/sanhita-map.json` | 165 old→new mappings (IPC→BNS 88, CrPC→BNSS 38, IEA→BSA 39) | corroborates KB oldRefs |
| `lib/draft-format-catalog.ts` | per-doc required sections + statutory ingredients (specific overrides for §138, Bail, Anti-bail, Plaint, WS) | catalog |
| `data/procedure-kb.json` | 7 BNSS procedural sections | — |

**Verification discipline**: a KB entry is asserted as a hard citation **only** when
`verification === 'verified'`. New entries added at plausibility-grade are
`needs-review` and cite as SUGGESTED until counsel confirms. Section numbers are
corroborated against `sanhita-map.json`; bail/punishment attributes still need
counsel review (noted per entry).

---

## 4. Safety ladder (never fails badly)

| If this fails | The engine does |
|---|---|
| No LLM key | TRIAGE keyword-guess; pipeline degrades to manual shell |
| EXTRACT | continues with empty facts + advisory |
| CLASSIFY | no sections; advocate adds manually |
| DRAFT | skeleton returned for manual completion |
| VERIFY can't run | warn, do **not** hard-block |
| Invented section id | dropped by the grounding guard |
| Foreign caseId | resolves to null (tenant isolation) |
| Doc-type's own statute | pre-authorised so it isn't mis-flagged |

---

## 5. Verified behaviour (this repo, live)

- TRIAGE: correct doc type from plain briefs (bail, §138, plaint, anti-bail, appeal).
- Format-per-document: 15 families validated — each emits its own correct structure.
- BNS grounding: cheating→318(4), hurt→118(1), extortion→308(1), defamation→356(1)
  (routed to *Complaint*), stalking→78.
- Browser (Playwright/Chromium): `/app/draft` renders the single "Describe the
  matter" box; a §138 brief produces the full letter format and, after the
  allowed-citation fix, is **not** blocked and "Use this draft" is enabled.

---

## 6. Known limitations (honest)

- Offence KB = 39 offences; a matter outside them returns "add sections manually".
- 20/39 KB entries `verified` (section-number corroborated); rest `needs-review`.
- Review is the same model grading its own draft — catches structure/limb gaps,
  not whether the cited law is substantively correct.
- Format overrides are deep for the top docs; others use category-level structure.
- The model writes the prose — every draft needs advocate review before filing.
