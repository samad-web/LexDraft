# Template Authoring Guide

**Audience:** whoever prepares the LexDraft `.docx` templates in Microsoft Word.

**Core rule:** *Word owns layout; code owns variables only.* You author a real,
court-correct Word document. The only thing "code" does to it is substitute
`{{ placeholders }}` with matter facts at draft time (via docxtpl). Never generate a
template from a script — that path (`build_templates.py`) is deprecated and produces
inferior output (US Letter, fake numbering, no leaders). The committed `.docx` files
are the source of truth.

The reference to copy is **`templates/gold/regular_bail.docx`**. Open it in Word and
mirror its structure. This guide gives the exact settings it uses.

---

## 1. Page setup (Layout → Page Setup)

| Setting | Value | Why |
|---|---|---|
| Paper size | **A4** (21 cm × 29.7 cm) | Indian court standard. NOT US Letter. |
| Top margin | 2.54 cm (1.0″) | |
| Bottom margin | 2.54 cm (1.0″) | |
| Right margin | 2.54 cm (1.0″) | |
| **Left margin** | **3.81 cm (1.5″)** | **Wide binding/stitching margin — court copies are bound on the left.** |
| Header from edge | 1.27 cm (0.5″) | |
| Footer from edge | 1.27 cm (0.5″) | |

In OOXML terms this is `<w:pgSz w:w="11906" w:h="16838"/>` and
`<w:pgMar w:left="2160" .../>`. The golden fidelity test (Task 5) asserts these exact
values, so a template with the wrong page size will fail CI.

---

## 2. Fonts

Use **Carlito** (body) and **Caladea** (headings). These are metric-compatible with
Calibri and Cambria and are the fonts installed in the render container — using them
means the PDF the advocate approves paginates identically in production.

> ⚠️ Do **not** use Calibri, Cambria, or Times New Roman directly. They are not present
> in the container; LibreOffice will substitute a different font and the page count
> will shift from what you saw in Word. For monospace/tabular content use **Liberation
> Mono** (Courier-compatible).

---

## 3. Named paragraph styles — use them, don't format run-by-run

Apply these styles (defined in the gold reference) instead of manually bolding /
centering each paragraph. Named styles mean a global typographic change is one edit,
and the fidelity tests key off style structure.

| Style | Use for | Look |
|---|---|---|
| `CauseTitle` | Court name, case-number line | Caladea 13pt bold, centered |
| `PartyBlock` | Party names, addresses, place/date | Carlito 12pt left |
| `SectionHeading` | PRAYER, VERIFICATION, MOST RESPECTFULLY SHOWETH | Caladea 12pt bold |
| `GroundList` | The numbered grounds/facts | Carlito 12pt, hanging (numbering owns indent) |
| `Prayer` | Prayer paragraph | Carlito 12pt |
| `Verification` | Verification clause | Carlito 12pt |
| `SignatureLine` | Dotted-leader signature lines | Carlito 12pt right |

To copy the styles into a new template: open the gold file, use **Developer →
Document Template / Organizer** (or copy a styled paragraph across), so the style
definitions travel with it.

---

## 4. Numbered paragraphs — real numbering, never typed "1."

Select the grounds/facts paragraphs and apply **Home → Multilevel List → the
1. / (a) / (i) list** (the gold file's list). Word then auto-numbers them.

**Never type the number yourself** (`1.` `2.` …). Typed numbers don't renumber when a
ground is inserted/deleted, don't hang correctly, and the fidelity test fails a
template that has literal number runs where numbering is expected.

Levels in the reference list:
- Level 1 → `1.` `2.` `3.`
- Level 2 → `(a)` `(b)` (press Tab to demote)
- Level 3 → `(i)` `(ii)`

---

## 5. Dotted-leader signature lines

For `.................................. Applicant`:

1. Type a Tab then the label (e.g. `⇥Advocate for the Applicant`).
2. Set a **right-aligned tab stop** at the right margin (Home → Paragraph → Tabs…):
   position ≈ 8.26 cm (the text width), alignment **Right**, leader **2 …… (dotted)**.

Do **not** type a row of periods (`......`). A literal dot run doesn't align, breaks on
edit, and reads as content to the fidelity checks. The gold file uses `SignatureLine`
paragraphs that already carry this tab stop — reuse them.

---

## 6. Header with page numbers

Insert → Header. Right-align. Type `Page `, then **Insert → Field → Page**, type ` of `,
then **Insert → Field → NumPages**. Result: `Page X of Y`. Court copies need page
numbers.

---

## 7. Placeholders — insert them so they DON'T split across runs

This is the single most important mechanical rule. When you type `{{ accused.name }}`
directly, Word often splits it across several internal runs (spell-check, autocorrect,
revision marks), and docxtpl then **silently fails to substitute it** — the raw
`{{ accused.name }}` ships into the filed document. The CI `placeholder-integrity`
check fails the build if this happens, but you should avoid it at authoring time:

**Reliable method — Find & Replace:**
1. Type a plain marker where the value goes, e.g. `XACCUSEDNAMEX`.
2. Open **Find & Replace** (Ctrl+H).
3. Find `XACCUSEDNAMEX`, Replace with `{{ accused.name }}`.
4. Replace All. Find & Replace writes the replacement as a **single run**.

Do this for every placeholder. Turn **off** "Check spelling as you type" while
authoring (File → Options → Proofing) to reduce run-splitting further.

**Field vocabulary:** use the EXACT field names the engine emits for that doc type. Do
not invent names — a name the engine doesn't provide stays unsubstituted, and a renamed
field breaks the ~66 passthrough doc types. Get the field list from the engine:
`GET /v1/doc-types` (each adapter's `describe()`), or copy the placeholders from the
gold `regular_bail.docx` for the shared blocks (banners, cause title, verification).

**Conditionals** (`{% if ... %}…{% endif %}`) must also each sit in a single run — the
same Find & Replace method applies. Keep the `{% if %}` and its `{% endif %}` in the
same paragraph where possible.

---

## 8. Run the CI checks locally BEFORE committing

From the `lexdraft-engine/` directory, with the dev deps installed
(`pip install -e ".[dev]"`):

```bash
# 1. No placeholder is split across runs (the critical one for authored templates).
python tools/check_placeholder_integrity.py

# 2. Your committed template is authoritative and not silently clobberable.
python tools/check_template_drift.py

# 3. Full gate (both of the above + golden fidelity tests) — exactly what CI runs.
python -m pytest -q
```

All three must print OK / pass before you commit. If `placeholder-integrity` fails, it
prints the offending file and the text around the split — fix it with Find & Replace
(§7) and re-run.

When you add a genuinely new doc type, register its template in `AUTHORED` in
`tools/check_template_drift.py` so the drift check asserts your hand-authored file was
actually committed (not left as raw generator output).

---

## 9. The affidavit block is YOUR responsibility (per host template)

There is a shared affidavit *component* (`src/components/affidavit.py`,
`affidavit.docx`), but **the engine does not compose it into any pleading** — the
renderer produces one template per document with no sub-document insertion. So an
affidavit is **not** something a shared component adds for you.

**If the pleading you are authoring requires a supporting affidavit, you must author the
affidavit block directly into that template** — the deponent-competence clause, the
numbered averments, the source-of-knowledge averment for a third-party deponent, and the
attestation block. Use `affidavit.docx` as the *pattern* to copy the language and the
numbering, but write it into your host template.

The host's golden fidelity test must then assert the affidavit block is present and its
fields populate (mirror how `test_golden_regular_bail.py` asserts prayer/verification).

Which doc-types need an affidavit — and where the current templates are inconsistent or
missing one — is recorded in
[docs/affidavit-coverage-for-advocate-review.md](affidavit-coverage-for-advocate-review.md).
That is a legal-completeness question for the advocate; confirm it for your doc-type
before authoring.

### 9.1 Revisit threshold — when to stop inlining and build shared composition

Inlining the affidavit block per host is the deliberate default (the engine has no
sub-document composition today, and `docxtpl.new_subdoc()` — which could provide it — is
used nowhere). This is correct while few hosts need it.

**Decision rule (not a matter of drift): once MORE THAN 8 hosts carry a substantively
identical affidavit block, build `new_subdoc()` composition and factor the block out
into one shared sub-template.** Below 8, keep inlining.

"Substantively identical" means the same competence clause + attestation structure with
only field values differing — NOT a host with a materially different affidavit (e.g. a
Rajnesh assets affidavit vs a plain supporting affidavit), which stays inline regardless.

When the threshold is crossed, factoring out is a medium engine change: wire
`render_to_docx` to build the affidavit subdoc from the shared template + the host's
affidavit context and inject it at a `{{ affidavit_block }}` placeholder, with its own
tests. Do it as a deliberate refactor, not opportunistically.

### 9.2 Validation rules are the correctness reference — assert them per host

`src/components/affidavit.py` is imported by nothing at runtime, but its **validation
rules are the correctness reference** for every hand-authored affidavit block. Do not let
that logic die with the unused component. The rules:

- **Corporate deponent → requires an authority reference** (board resolution / power of
  attorney): if `is_corporate`, `authority_ref` must be present.
- **Third-party deponent → requires an explicit source-of-knowledge averment**: if
  `is_third_party`, `source_of_knowledge` must be present.
- **Competence clause (para 1) is always present**; the attestation block ("BEFORE ME"
  / attestor) must be present and the unfilled attestor flagged.

**Each host's golden test must assert these SAME rules on its affidavit block** — e.g.
render a corporate-deponent fixture and assert the authority reference appears; render a
third-party fixture and assert the source-of-knowledge averment appears. Mirror the rule
set in `affidavit.py::validate()` so the correctness logic is enforced at every host even
though the component itself is not called.

---

## 10. Checklist before committing a template

- [ ] A4, left margin 1.5″ (§1)
- [ ] Carlito / Caladea / Liberation Mono only (§2)
- [ ] Named styles applied, no run-by-run bold/center (§3)
- [ ] Numbered items use the multilevel list, no typed numbers (§4)
- [ ] Signature lines use right tab + dotted leader, no typed dots (§5)
- [ ] Header has `Page X of Y` (§6)
- [ ] Every placeholder inserted via Find & Replace; correct engine field names (§7)
- [ ] Affidavit block authored in-template if the pleading needs one (§9)
- [ ] Affidavit validation rules asserted in the host's golden test — corporate→authority_ref, third_party→source_of_knowledge, competence + attestation present (§9.2)
- [ ] `python -m pytest -q` passes locally (§8)
