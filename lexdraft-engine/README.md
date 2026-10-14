# LexDraft Engine

Deterministic legal drafting engine for Tamil Nadu courts. Python + docxtpl.
No LLM in the foundation layer — all rules are explicit and tested.

This tree is the greenfield Python engine described in the project CLAUDE.md. It
is separate from the TypeScript practice-management monorepo in the parent
directory.

## Status

Foundation layer, tests-first.

| Task | Component | State |
|---|---|---|
| 1 | `src/factsheet` — Matter Fact Sheet (versioned) + Part 1.1 party model | built + tested |
| 2 | `src/rules/limitation` | built + tested |
| 2 | `src/rules/custody_computation` | built + tested |
| 2 | `src/rules/s138_windows` | built + tested |
| 3 | `src/components` — cause title, verification, affidavit, prayer engine | built + tested |
| 2.2 | `src/pipelines/s138_notice` — s.138 statutory notice (C2) | built + tested |
| — | `src/rules/dual_code_router` — BNS/BNSS/BSA ↔ IPC/CrPC/IEA | built + tested |
| — | `src/rules/bail_bar_detector` — NDPS/PMLA/UAPA/SC-ST bars | built + tested |
| 3.4 | `src/pipelines/default_bail` — default bail | built + tested |
| 3.3 | `src/pipelines/anticipatory_bail` — anticipatory bail | built + tested |
| 3.2 | `src/pipelines/regular_bail` — regular bail | built + tested |
| 2.1 | `src/pipelines/general_notice` — general demand notice | built + tested |
| 3.1 | `src/pipelines/s138_complaint` — s.138 complaint | built + tested |
| 4.2 | `src/pipelines/injunction` — temporary injunction (O39 R1&2) | built + tested |
| — | `src/rules/court_fee` — TN Court Fees Act 1955 valuation | built + tested |
| — | `src/rules/jurisdiction` — pecuniary + territorial (s.20 CPC) | built + tested |
| 4.1 | `src/pipelines/plaint` — plaint (money recovery) | built + tested |
| 4.1-O37 | `src/pipelines/summary_suit` — summary suit (Order XXXVII) | built + tested |
| — | `src/efiling/bundle` — filing bundle compilation + compliance | built + tested |
| 5.1 | `src/pipelines/writ_petition` — Article 226 writ petition | built + tested |
| 6.3 | `src/pipelines/maintenance` — maintenance (BNSS 144 / CrPC 125) | built + tested |
| 6.4 | `src/pipelines/dv_application` — DV Act s.12 application | built + tested |
| 7.1 | `src/pipelines/consumer_complaint` — consumer complaint | built + tested |
| — | `src/rules/compensation_multiplier` — Sarla Verma / Pranay Sethi | built + tested |
| 7.2 | `src/pipelines/mact_claim` — MACT claim (MV Act s.166) | built + tested |
| 6.1 | `src/pipelines/divorce_contested` — contested divorce (HMA s.13) | built + tested |
| 6.2 | `src/pipelines/divorce_mutual` — mutual consent (HMA s.13B, two motions) | built + tested |
| — | `tools/compare_matter.py` — real-matter comparison harness | built + tested |
| — | `src/components/reliability.py` — per-paragraph reliability annotation | built + tested |
| — | `src/verify/tables.py` + `verify/tables/` — VERIFY table registry | built + tested |
| — | `src/verify/averments.py` + `verify/averments/` — averment registry + Section B | built + tested |
| — | `src/verify/signoff.py` — review banner + sign-off audit trail (rule 6) | built + tested |
| — | `tools/refusal_report.py` — generated refusal report (Section C) | built + tested |
| — | `tools/build_review_pack.py` — assembled advocate review pack | built + tested |
| — | `samples/generate_samples.py` — five sample documents | built + tested |

696 tests pass.

### Comparison harness (`tools/compare_matter.py`)

A **measurement** tool (never auto-fixes): runs a real closed matter through the
engine and diffs our generated document against what was actually filed. Diffs
**by section, not by line** (cause title, party blocks, each numbered paragraph,
prayer, verification — line diffs on legal prose are noise). Classifies each
difference **MISSING** (filed, not ours — the important column: a gap in the
mandatory-averment lists), **EXTRA**, **DIFFERENT** (materially different wording),
**FORMATTING** (cosmetic only, via normalisation). Emits a per-matter summary and
a cross-matter **aggregate** so a recurring MISSING item surfaces as a pattern.
Reads filed docs as .docx (python-docx) or .pdf (pypdf, optional). CLI:
`python tools/compare_matter.py --ours gen.docx --filed filed.docx` or
`--report matters.json` to aggregate several.

### Reliability annotation (`src/components/reliability.py`)

Generalises the MACT unverified marker into a per-paragraph reliability layer:
`CERTAIN` (template + rules), `LLM_SLOT` (narrative to draft), `VERIFY_DEPENDENT`
(figure/section from a VERIFY table). Renders as a margin/footer note and is
**toggleable** — `annotate_context(ctx, report, show=False)` renders the final
filed version clean. `infer_from_context` derives the report from `[to be drafted]`
markers plus a set of VERIFY-dependent paragraph numbers.

### Divorce (6.1 contested, 6.2 mutual consent)

Contested (s.13): s.14 one-year bar from the marriage date — within a year does
**not refuse**, it auto-attaches the s.14-proviso leave application. **Ground-
specific validation**: cruelty needs a dated instance; desertion needs all four
elements (≥2yr separation computed + animus + without consent + without
reasonable cause); adultery needs a specific instance and the co-respondent
joined or a non-joinder reason. No collusion/connivance/condonation all three
pleaded. Children → custody **and** maintenance position or refuse. Jurisdiction
uses its **own s.19 HMA limbs** (`Section19Basis`), not the s.20 CPC module.

Mutual consent (s.13B): **two separate documents** (`build_first_motion` /
`build_second_motion`), not one with a flag. First motion: separation ≥1 year;
settlement covers maintenance/custody/property or expressly records non-arising;
**joint affidavit by both parties** (rendered in-template, the single-deponent
affidavit component untouched). Second motion: 6–18 months from the first-motion
order — before 6 months refuses unless a waiver is attached; after 18 months
refuses; a waiver (Amardeep Singh) requires the settlement already implemented.

### compensation_multiplier + MACT (7.2)

`compensation_multiplier` computes MACT compensation with **separate death and
injury entry points** (`compute_death` / `compute_injury`) — injury is never
forced through the death formula (no personal-expenses deduction, no conventional
heads). Death = (income + Pranay Sethi future prospects) − personal-expenses
deduction, × Sarla Verma multiplier, + conventional heads. Every table
(`MULTIPLIER_BANDS`, `FUTURE_PROSPECTS`, `PERSONAL_EXPENSE_DEDUCTION`,
`CONVENTIONAL_HEADS`) is **VERIFY** (`TABLES_ARE_VERIFY = True`) — the heaviest new
legal-table module since court_fee, same review batch. Future prospects distinguish
permanent-salaried from self-employed/fixed-wage. Every result carries
`unverified=True`.

MACT (7.2): rash-and-negligent-driving pleaded expressly (jurisdictional →
refuse without); **arithmetic recomputed end to end** (claimed total ≠ computed →
refuse); **policy invalid/lapsed still generates** but the pleading addresses it
(claim proceeds against owner + driver); income asserted without proof → the
computation **says so**, not silently established; **computed figures render with a
visible unverified marker** (heading and prayer) — a wrong multiplier produces a
wrong claim that would otherwise read as authoritative. LLM slot at paragraph 2.

### Consumer complaint (7.1)

Consumer status (s.2(7)): a **commercial purpose refuses** with an explanation —
**except** goods/services for self-employment to earn a livelihood, which is not
commercial and does not refuse. The **pecuniary tier** (District/State/National)
is set by the **consideration paid**, not the compensation claimed
(`PECUNIARY_TIERS`, `TIERS_ARE_VERIFY = True` — joins the court-fee review batch).
Limitation is 2 years via the limitation module; if exceeded, the condonation
application is **auto-attached, not refused** (same pattern as the s.142(b)
proviso). Compensation with a figure needs a stated basis; both the affidavit and
the evidence affidavit are required. LLM slots at paragraphs 4 and 5.

### Writ grounds are lettered (A, B, C)

Fixed: writ petition grounds now render **lettered by code** (`A.`, `B.`, `C.`,
past Z → `AA`) when supplied as `grounds_list` — writ practice, and per the spec's
own "GROUNDS (lettered A, B, C...)". The free-text `grounds_narrative` slot remains
the fallback (the model self-letters). Template bumped to v2.

### Maintenance (6.3) and DV s.12 (6.4)

Maintenance resolves its framework via the **dual-code router** (BNSS 144 / CrPC
125), not a caller-supplied string. Refuses on: neglect/refusal not pleaded;
petitioner's **Rajnesh** affidavit absent (both parties file one — we check the
one we control); divorced wife without a not-remarried averment; adult child
(≥18) without a physical/mental-abnormality averment; quantum without a stated
computation basis. LLM slots at paragraphs 3 and 6.

DV s.12: domestic relationship is the **jurisdictional fact** — pleaded expressly
or refuse; shared household required if a s.19 residence order is sought; **each
relief head (s.18/19/20/21/22) needs a supporting averment — unsupported relief
is refused, not flagged** (same discipline as the prayer engine); abuse incidents
dated where possible and categorised. LLM slot at paragraph 4.

### Writ petition (5.1)

Article 226. Hard checks: **writ-type ↔ relief matching** (mandamus needs legal
right + public duty + prior demand-and-refusal, all three; certiorari needs a
quasi-judicial order; quo warranto needs a public office); **alternative remedy
addressed** (refuse, not warn — the most common maintainability defect); **at
least one State / public-function respondent** (private-respondent-alone →
refuse); **impugned order by number and date, annexed**; **delay explained** where
the action is not recent, with a **configurable laches threshold** (laches has no
fixed period). Reuses `cause_title.validate` for respondent ordering (authority
first) and `verification` (writ variant) for the no-similar-petition declaration.
LLM slots at paragraphs 3 and 6.

### E-filing layer (`src/efiling/bundle.py`)

Compiles pleading + annexures into an ordered bundle with **continuous
pagination** (the index cites actual compiled page numbers, never placeholders),
per-document **bookmarks**, and per-page **OCR** of detected image-only pages
(detected, not assumed). Enforces a configurable size cap: compress, then split
with a continuation convention if still over.

The compliance core is **pure and dependency-free**; PDF merge / OCR /
compression / split are behind an injectable `PdfBackend` (a fake drives the
tests), so the legally-important checks run without Ghostscript/Tesseract. A
bundle is refused as not `filing_ready` if any narrative slot is still
`[to be drafted]`, any referenced annexure is missing, or annexure numbering has
a gap. **Annexure cross-reference integrity is bidirectional** — every "Annexure
A-3" in the text must resolve to a bundle document and every document must be
referenced; a mismatch either way refuses. **Draft state propagates**: a draft
document makes the whole bundle draft, and a draft bundle is never filing-ready.

Digital signature / eSign is deliberately **not** implemented (touches advocate
credentials — its own design pass).

### Summary suit (O37) — separate skeleton

`src/pipelines/summary_suit.py` is a **separate skeleton**, not a `plaint.Variant`.
It refuses a claim outside O37 scope (written contract / bill of exchange /
promissory note / enactment debt), and emits the O37-specific averments: filed
under Order XXXVII, no relief outside the Order's scope, summons for judgment
follows institution, and no defence without leave. It reuses the same rules as
the ordinary plaint (court_fee, jurisdiction, limitation) and imports the
article-period map from `plaint` rather than duplicating it.

### court_fee + jurisdiction (standalone rules)

`court_fee` computes ad valorem / fixed / relief-linked fees per the TN Court Fees
and Suits Valuation Act 1955 and returns both the fee **and** the valuation basis
(the plaint pleads both). Slab tables are `VERIFY` (`SLABS_ARE_VERIFY = True`).
`jurisdiction` has two independent limbs: **pecuniary** (over the forum limit →
refuse and name the correct forum) and **territorial** (s.20 CPC — ≥1 basis;
multiple fine, none refuses). Built standalone so both the plaint and the future
written-statement preliminary-objections stage can invoke either.

### Plaint (4.1)

Consumes court_fee, jurisdiction, and **reuses** limitation (article-period +
s.18 restart, not reimplemented). Refuses on: cause of action missing date or
place; jurisdiction (either limb); time-bar; principal + interest ≠ claimed total;
Government defendant without s.80 CPC notice; commercial suit without s.12A.
Contractual interest without a document reference **falls back to statutory and
says so** (does not refuse). Commercial suits carry a statement of truth alongside
verification. LLM slots at paragraphs 3/5/6/9. Variants: individual, partnership
(O30), company, Government (O27), minor (O32). **O37 summary suit is a separate
skeleton — not folded in.**

### Temporary injunction (4.2)

The O39 triad — prima facie case, balance of convenience, irreparable injury —
must each be a **separately headed, non-empty** paragraph; any one missing or
empty **refuses** (a triad limb never falls back to the `[to be drafted]`
placeholder). Prayer specificity is enforced: the act to be restrained must be
named — a bare "restrain the defendant" refuses. Ex-parte relief requires the
O39 R3-proviso urgency + notice-futility paragraph. Undertaking as to damages
required. Brief facts (para 2) is an ordinary named slot.

**Not built** (own passes, per user): 4.1 plaint (after `court_fee` + `jurisdiction`
rules), 4.3 written statement / C3 alignment pipeline (dedicated pass — the first
place model output quality gates the product).

### General notice (2.1) and s.138 complaint (3.1)

General notice: LLM slots at paragraphs 4/6/7/8 only; demand and consequence are
rule-driven. Refuses if the compliance period is below the statutory minimum
where one applies; amount renders in figures and words (`amount_words`).

s.138 complaint: **s.141 is a hard refusal** — a company accused without the
"in charge of and responsible for the conduct of the business at the relevant
time" averment gets no document. Deemed service (refused/unclaimed notice)
requires an explicit averment AND still computes the cause of action from the
deemed delivery date — the flag never skips the date. Filing window is one
calendar month via `s138_windows`; if exceeded, the s.142(b)-proviso condonation
application is auto-attached (does not refuse). Paragraph 3's
legally-enforceable-debt slot is shared with 2.2 paragraph 2.

### bail_bar_detector — each bar has its own test

NDPS s.37 and PMLA s.45 are **twin-condition** tests; UAPA s.43D(5) is a
**different** test (no bail if the accusation is prima facie true). The detector
carries a per-bar `test_kind` and `paragraph_text` so the pleading recites the
correct test — a shared paragraph would address the wrong test for UAPA.

### Dual-code router

`src/rules/dual_code_router.py` resolves two axes from three inputs
(`offence_date`, `proceeding_start_date`, `is_fresh_action`): **substantive**
(IPC/BNS, by offence date — Art. 20(1)) and **procedural** (CrPC/BNSS — pending
proceedings keep old procedure per BNSS s.531(2)(a); fresh actions take BNSS even
on old facts). No default: a pending proceeding with an unknown start date
**refuses** (unknown provenance is a real state for inherited matters). Bail is
procedural, so `code_framework` tracks the procedural axis. **All three bail
pipelines take the router's three inputs directly** and cite the section it
resolves — a caller can no longer pass a framework inconsistent with the dates.

`src/rules/bail_bar_detector.py` is the single source of truth for the NDPS s.37,
PMLA s.45, UAPA s.43D(5) (regular-bail thresholds → mandatory paragraph) and
SC/ST s.18/18A (outright anticipatory bar) checks; the 3.3 pipeline's SC/ST check
delegates to it.

The router and detector section tables are marked `VERIFY` and reviewed as a unit
with the existing custody-computation markers.

### Bail documents (spec 3.3, 3.4)

Both delegate to `src/rules/custody_computation`. Default bail (3.4) recomputes
custody at generation time and refuses with a **distinct reason code** —
`SURVIVES` / `EXTINGUISHED` / `INDETERMINATE` (equal or missing timestamps) /
`NO_READINESS` — never collapsing indeterminate into extinguished. Anticipatory
bail (3.3) requires a stated reasonable apprehension, refuses on the SC/ST
s.18/18A bar, routes an already-arrested applicant to regular bail, and adds a
jurisdiction paragraph for transit petitions. The `[LLM]` prosecution-case
paragraph renders as the named slot `[to be drafted]` — no LLM is called.

Regular bail (3.2) consumes both the router (supplies `code_framework`) and the
detector (special statute → mandatory bail-bar paragraph, block if unaddressed).
It also enforces: custody recomputed from `custody_since`; successive → prior
order reference **and** change-of-circumstance both mandatory; parity claims →
order reference or refused.

### s.138 statutory notice (spec 2.2)

`src/pipelines/s138_notice.py` assembles the highest-risk template. All window /
amount hard stops are **delegated** to `src/rules/s138_windows` (already
boundary-tested); the pipeline layers the 2.2-specific requirements
(exactly-15-day compliance, verbatim dishonour reason, memo-receipt-date anchor,
mandatory dispatch placeholder, multi-cheque itemisation with a consolidated
demand) and refuses — no partial output — on any defect, showing the computation.
Amounts render in figures and words via `src/components/amount_words.py`
(Indian lakh/crore numbering). Shared-component `.docx` templates are generated by
`templates/build_templates.py` from the spec 1.x skeletons and committed under
`templates/shared/`; golden text snapshots live in `tests/documents/golden/`.

### Regenerating templates / goldens

```
python templates/build_templates.py                 # rebuild .docx templates
LEXDRAFT_UPDATE_GOLDEN=1 python -m pytest tests/documents   # rewrite goldens
```

Template versions and effective dates are registered in `templates/versions.json`
(CLAUDE.md rule #4 — never mutate a template in place; bump the version).

## VERIFY registries (advocate review)

Legal reference data that an advocate must sign off is **externalised out of the
Python modules into JSON registries**, one file per item, each carrying its values,
its source (Act + section), and a `verified` flag with `reviewed_by` / `reviewed_on`.
The modules load from these files; nothing settled lives as a literal in code.

### `verify/tables/` — VERIFY reference tables (13 files)

Court-fee slabs and fixed fees, civil pecuniary limits, consumer tiers, the
BNSS↔CrPC section mappings, the appointed day, default-bail/custody periods, the
bail-bar provenance, the limitation-article periods, and the four MACT compensation
tables (Sarla Verma / Pranay Sethi). Loaded by `src/verify/tables.py`; the module
attributes the tests pin (`AD_VALOREM_SLABS`, `MULTIPLIER_BANDS`, `PECUNIARY_LIMITS`,
…) are now populated from these files, and the `*_ARE_VERIFY` flags are **derived**
from the files' `verified` state.

**Generalised unverified marker.** `tables.marker_for(*names)` returns the visible
marker string while any named table is unverified, and `""` once all are signed
off. Every document that consumes a VERIFY table sets `context["unverified_marker"]`
from it, and the template renders a banner (`_verify_banner`) that shows the marker
or nothing. This generalises the MACT inline marker to court fee, pecuniary limits,
custody periods, bail bars, section mappings and consumer tiers. **Flipping
`verified: true` in a JSON file removes the marker with no other code change** —
proven end-to-end in `tests/verify/test_marker_generalisation.py`.

### `verify/averments/` — mandatory-averment registry (one file per document)

Each document type's mandatory / advisory averments, with each averment's text,
kind, and source (statute / case law / local practice), plus the `verified` /
reviewer fields. Loaded by `src/verify/averments.py`.
`averments.section_b()` renders **Section B of the review pack from these files**,
so the advocate always reviews the current state.

### Two signals on a document (both can appear; neither replaces the other)

`src/verify/signoff.py` adds the **mandatory advocate-review banner** (CLAUDE.md
rule 6) as a signal DISTINCT from the table marker:

- **table marker** (`unverified_marker`) — "this *figure* came from a table the
  advocate has not verified"; conditional on which VERIFY tables the document
  consumes.
- **review banner** (`review_banner`) — "an advocate must *review this whole
  document* before it is filed"; on **every** generated draft regardless of tables.

Both render on one document when both apply (e.g. the plaint shows the banner *and*
the figure marker). The review banner is suppressed **only** by an explicit
`sign_off(...)` action — never a config toggle.

**Matter id and version come from the fact sheet, not the caller.** `sign_off`,
`banner_for`, `resolve_context` and `render_document` take a `MatterFactSheet` — the
same versioned source the document's facts come from — and derive both the matter id
and the version from it. Each sign-off **records who signed off, when, and against
which fact-sheet version** in an append-only audit trail
(`verify/signoff_audit.jsonl`, gitignored).

**Stale sign-off restores the banner.** Lookup stays keyed on
`(document, matter_id)` so it is stable across revisions, but `banner_for` compares
the recorded version against the fact sheet's current version: if the facts were
revised after sign-off, the signed document no longer corresponds to current facts,
so the banner comes back (same discipline as the unfilled-slot re-check). Re-signing
the revised version clears it again.

**Hard rule:** a document with any unfilled narrative slot (`[to be drafted]`)
always carries the banner and **cannot be marked final at all** — `sign_off` refuses
it. `render_document(...)` is the rule-6 entry point; the golden tests and the sample
generator both render through it. (`tests/verify/test_signoff*.py`.)

### API layer (`src/service/`) — FastAPI wrapper for the frontend

The engine is fronted by a co-located FastAPI service (`pip install -e ".[service]"`;
`uvicorn src.service.app:app`). It is the connective tissue for routing the TS Draft
page through the engine (see `docs/api-layer-plan.md`). Endpoints:

- `POST /v1/draft/{doc_type}` — validate → build → **refuse (200) | generate (200)**.
  Generated documents return **structured blocks AND a base64 `.docx`**, both
  carrying the review banner and any table marker (not a rendering detail).
- `POST /v1/route-code` — `dual_code_router` only (the clarify loop).
- `POST /v1/sign-off` — mark final (records who/when/version; 409 if a slot is unfilled).
- `GET /v1/doc-types` — the field/slot contract the frontend renders forms from.
- `GET /healthz`.

**Adapters (`src/service/adapters/`)** map the inbound JSON contract ↔ engine
kwargs, and enforce the two hard rules:

1. **422 is a different channel from a refusal.** Missing/blank required fields and
   malformed values are validated and coerced BEFORE the pipeline is called, so an
   incomplete form is a 422 (`{error:"validation", issues:[…]}`), never surfaced as
   a legal refusal. A missing `memo_received_date` is "the form is incomplete", not
   "the law blocks you".
2. **`fields_implicated` survives the mapping (bidirectional).** A refusal names
   engine kwargs; the adapter translates them to the inbound keys the frontend
   highlights — including nested paths (the cheque-validity refusal points at
   `cheques[].date`, not the whole cheque list).

Engine calls run in a threadpool (sync CPU work off the event loop). The Node API
stays the only public surface; this service trusts a shared token
(`LEXDRAFT_SERVICE_TOKEN`, open when unset for dev/test).

**Shadow mode** (`tools/shadow_s138.py`) runs a matter through the engine and diffs
it against a recorded TS-pipeline response — structurally, nothing user-visible —
so every engine-vs-model divergence is understood before the flag flips. It already
flags the key case: the engine refuses a cheque presented after validity where the
model would have drafted a defective notice.

### Structured refusals (typed codes for the API layer)

`src/verify/refusals.py` gives every refusal a `Refusal` — a stable, specific
`code`, a `severity` (`hard`), the exact `reason` and `computation`, and the
`fields_implicated`. A refusal is a legal finding, not an error: the API layer
serialises it as HTTP 200 `outcome:"refused"` (see `docs/api-layer-plan.md`), and
the frontend branches on the **code** (`s138_notice_cheque_presented_after_validity`,
not a generic `validation_failed`). 93 codes across all pipelines and rules; the
`Refusal` rides alongside the unchanged `reason`/`computation`, so it is additive.

Two gates keep this honest:
- `tests/verify/test_refusal_codes_static.py` — an AST scan asserting **no
  `_refuse(...)` call anywhere omits `code=`**.
- `tests/verify/test_refusal_codes_all.py` — drives the generated catalogue and
  asserts every refusal yields a complete, unique, specific code.

`tools/refusal_report.py` now emits the **typed catalogue** (code · severity ·
fields · message), captured by running the pipelines — the frontend's contract.

### Review pack + refusal report (generated, never hand-maintained)

- `tools/refusal_report.py` — **Section C**: every refusal condition across all
  pipelines, with the exact advocate-facing message, captured by *driving each
  pipeline into the refusal and reading back its message* (so it cannot drift from
  the code). `--docx` writes a Word document.
- `tools/build_review_pack.py` — assembles **Section A** (tables) + **Section B**
  (averments) + **Section C** (refusals) into the single advocate-session document.
- Committed snapshots: `verify/refusal_report.{md,docx}`, `verify/review_pack.{md,docx}`.
  Regenerate any time with the tools above.

Two rules additionally carry `VERIFY` provenance notes (they are rules, not tables,
so they are reviewed as prose, not registry values):

- `custody_computation.assess_default_bail` — the application-vs-chargesheet
  sequence rule and the same-instant tie-break.
- `dual_code_router` / `bail_bar_detector` — the substantive/procedural split and
  the SC/ST bar's post-*Prathvi Raj Chauhan* exceptions.

## Sample documents

`samples/generate_samples.py` renders the five session exhibits with realistic
Tamil Nadu facts to `samples/*.docx`: s.138 notice, regular bail, plaint (money
recovery), writ petition, MACT claim. The plaint and MACT carry the unverified
banner (they consume VERIFY tables); the s.138 notice and writ do not (they consume
none). Smoke-tested in `tests/test_samples.py`.

## Run the tests

```
python -m venv .venv
.venv/Scripts/pip install pytest python-dateutil   # or: pip install -e ".[dev]"
.venv/Scripts/python -m pytest -q
```
