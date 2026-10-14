# Comparison Harness — Intake Runbook

How to pull a closed matter from the firm's files, redact it, and hand it to the
engine so we can measure what our drafts miss against what was actually filed.

**These are real client matters and privileged. Redaction is not optional.** The
harness is designed to work on redacted documents — do not send anything
un-redacted.

---

## 1. Pick the matters

- Choose **3–4 closed matters per document type** (regular bail, plaint, s.138
  complaint to start). More matters make a recurring gap easier to see.
- Pick matters where the filed document is **final and complete** — the version
  that actually went to court, not a working draft.
- Vary them a little (different courts, different fact patterns). Identical matters
  won't reveal much.

## 2. What to pull from the file

For each matter, two things:

1. **The facts**, to hand-fill the fact-sheet template for that document type
   (`intake/templates/factsheet-<type>.md`). Copy the template, fill it in.
2. **The actually-filed document** — the pleading/application as filed, as `.docx`
   (preferred) or `.pdf`.

## 3. Redaction — what to strip, and how

Replace every real identifier with a **consistent placeholder** — the same real
value always maps to the same placeholder, so the diff still aligns. Do this in
**both** the fact sheet and the filed document, using the same mapping.

| Strip this | Replace with |
|---|---|
| Client / party names (all sides) | `PLAINTIFF-1`, `DEFENDANT-1`, `ACCUSED-1`, `COMPLAINANT-1`, … |
| Advocate names | `ADVOCATE-1` |
| Street addresses | `ADDRESS-1`, `ADDRESS-2` |
| Phone numbers, emails | `PHONE-1`, `EMAIL-1` |
| Case / FIR / crime numbers | `FIR-1`, `CASE-1`, `CRLMP-1` |
| Cheque numbers, account numbers, policy numbers | `CHEQUE-1`, `ACCOUNT-1`, `POLICY-1` |
| Enrolment numbers | `ENROL-1` |
| PAN / Aadhaar / CIN and other IDs | `ID-1` |

**Keep** (these carry no privilege and the diff needs them):

- **Dates** — they drive the rules and the comparison. Keep them real. (If a date
  is itself sensitive, shift ALL dates in the matter by the same offset so the
  intervals stay intact.)
- **Amounts** — keep real; the arithmetic checks depend on them.
- **Section numbers, court names, statutory language, the legal averments** — these
  are what we are measuring. Never redact the pleading's substance.

Redaction rules of thumb:
- **Consistency over cleverness.** `ACCUSED-1` everywhere beats a different mask each
  time — inconsistent masks break section alignment and inflate the diff.
- **Redact the same value the same way in the fact sheet and the filed document.**
- When unsure whether something is privileged, redact it. A stripped identifier
  never changes a MISSING/EXTRA finding; those turn on legal averments, not names.

## 4. Naming and where to put things

One folder per matter under `intake/matters/`:

```
intake/matters/
  M-A/
    factsheet.md          # the filled template (redacted)
    filed-redacted.docx   # the actually-filed document (redacted)
    generated.docx        # engine output — the engineer produces this
  M-B/
    ...
```

- **`matter_id`** is an abstract label (`M-A`, `M-B`, …) with **no client
  identifier** in it. Keep the mapping from `matter_id` to the real matter in a
  separate, access-controlled place — never in this repo.
- Name the filed document `filed-redacted.<ext>` so it is obvious at a glance that
  redaction has been done.

## 5. Register the matters

Copy `intake/matters.example.json` to `intake/matters.json` and fill one entry per
matter: `matter_id`, `document_type`, `court`, `outcome`, and the three paths
(`factsheet`, `ours`, `filed`). `outcome` (granted / decreed / convicted / …) is
metadata for us; it does not affect the diff.

## 6. Run

The engineer, from the filled fact sheets, produces each `generated.docx` via the
matching pipeline, then:

```
python tools/compare_matter.py --report intake/matters.json
```

This prints a per-matter report (leading with **MISSING** — what the advocate
pleaded that we did not generate) and a cross-matter **aggregate** that surfaces
any MISSING item recurring across matters. A gap in two or more matters is a
proposed addition to a mandatory-averment list — it goes to the advocate review
pack for confirmation, **not** straight into the code.

---

## Note: the intake template is itself a test

If filling a template for a real matter is painful, that pain is a finding about
the fact-sheet interface — the same interface any frontend form will be built on.
Each template ends with a **"Notes for engineering (awkwardness observed)"**
section. The recurring theme already visible across all three: the flat form cannot
express **repeating structured sub-records** (multiple cheques, multiple
acknowledgements, multiple parity claims), and the **multi-date blocks** (offence
vs proceeding-start vs remand; memo-date vs memo-receipt) are where a non-lawyer
filler will go wrong without guided prompts. Capture any new awkwardness you hit
while filling — that list is the spec for the real form.
