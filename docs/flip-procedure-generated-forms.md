# Flip Procedure — switching a doc type to the engine-generated form

This is the reversible, per-doc-type switch from a legacy static form to the
engine-generated form (which routes the draft through the engine to the fidelity
pipeline). It is gated so a single doc type can be turned **on and rolled back without a
deploy**.

**Precondition (hard gate):** the doc type's gold template must be **advocate-validated**
against a filed-and-accepted document before flipping it on. Structural + test validation
is not legal validation.

---

## What a flip does

For an enabled engine slug, `resolveDocSchemas()` ([apps/web/src/lib/form-gen/resolve.ts](../apps/web/src/lib/form-gen/resolve.ts)):
1. exposes the **generated** schema under the **engine label** (e.g. `Regular Bail
   Application`), so `engineActive` fires and the draft routes to the engine, and
2. removes the **legacy static label** (e.g. `Bail Application`) from the picker.

While a slug is disabled, `resolveDocSchemas()` returns the current static `DOC_SCHEMAS`
unchanged — a true no-op.

---

## To flip a doc type ON (example: `regular_bail`)

Two ways. **Runtime (no deploy)** is preferred for the first enable and for rollback.

### A. Runtime (no code change, no deploy)
Set the env var on the web app and reload:
```
VITE_FORMGEN_DOCTYPES=regular_bail
```
Multiple: `VITE_FORMGEN_DOCTYPES=regular_bail,lease_deed`.

### B. In code (permanent, needs deploy)
1. `apps/web/src/lib/form-gen/flags.ts` — add the slug to `ENABLED_IN_CODE`.
2. `apps/web/src/lib/form-gen/engine-labels.ts` — ensure `LABEL_TO_ENGINE_DOC` has the
   engine label and `LEGACY_LABEL_FOR_SLUG` has the old static label.
3. `apps/web/src/lib/form-gen/presentation/index.ts` — ensure a presentation entry
   exists (else it falls back to humanised labels — usable but unpolished).
4. Wire `resolveDocSchemas()` as the schema source in `DraftingView` (one-time; until
   then the UI reads static `DOC_SCHEMAS`).

### Then, once confirmed working, remove the drift baseline entry
`apps/api/src/lib/__tests__/engine-alignment-baseline.json`:
- delete the doc's **engine label** from `unreachableLabels`, and
- delete any entry for it from `misalignedFields`.

The alignment CI test then asserts it stays reachable+aligned (the backlog can only
shrink — a fixed entry that lingers in the baseline fails CI by design).

---

## How to VERIFY a flip

1. **Unit**: `apps/web` — `resolve.test.ts` (reversibility), `form-gen.test.ts`
   (generation + dual-read), `apps/api` — `engine-field-map.test.ts` (coercion),
   `schema-engine-alignment.test.ts` (no new drift).
2. **Routing**: open the doc in the drafting UI; the engine card is active (not the
   model path). Submitting reaches `/drafting/engine/draft` and returns a render, not a
   model draft.
3. **Fidelity**: the downloaded `.docx`/PDF is the engine render (A4, real numbering,
   dotted leaders — asserted by the golden test for that doc).
4. **Saved drafts**: open a pre-existing draft of that doc type — no field is blank
   (dual-read fallback + the backfill migration). See "Saved-draft safety" below.

---

## How to ROLL BACK (no deploy)

Fastest — the kill switch (wins over the in-code flag):
```
VITE_FORMGEN_DOCTYPES=!regular_bail
```
The doc reverts to its legacy static form immediately on reload. For a permanent
rollback, also remove the slug from `ENABLED_IN_CODE` and restore its baseline entry.

Rolling back does **not** touch saved drafts: values written under new engine keys stay,
and dual-read still resolves old keys, so a draft opens correctly under either form.

---

## Saved-draft safety (ships with the generator)

- **Dual-read** ([key-aliases.ts](../apps/web/src/lib/form-gen/key-aliases.ts)):
  reading a saved draft, if the new engine key is absent/empty it falls back to the old
  web key. **When both are populated, the NEW key wins** — it is checked first and
  returned when non-empty; the old key is only a fallback. Rationale: the new key is the
  current truth (an advocate edit under the new form, or the backfill result); a stale
  old-key value must never override it.
- **Backfill** ([migration 0069](../apps/api/migrations/0069_backfill_regular_bail_fields.sql)):
  one-time, additive, idempotent — copies pure-rename old-key values into new keys,
  never overwriting or deleting. Run it before/with the flip.
- **Reshaped fields are NOT aliased** (e.g. `custody_days` count → `custody_since`
  date): the advocate re-enters them (the form shows them empty — the correct signal),
  because silently mapping a count into a date would be wrong.

---

## Files involved (reference)

| File | Role |
|---|---|
| `form-gen/flags.ts` | which slugs are enabled (in-code + runtime override) |
| `form-gen/resolve.ts` | the integration point: swaps schema+label when enabled |
| `form-gen/generate.ts` | merges engine contract + presentation → DocSchema |
| `form-gen/presentation/<slug>.ts` | authored labels/sections/help/conditionals |
| `form-gen/engine-labels.ts` | engine label + legacy label per slug (web copy) |
| `form-gen/key-aliases.ts` | old→new key renames; dual-read |
| `apps/api/.../engine-doc-contract.json` | engine field contract snapshot (source of truth for fields) |
| `apps/api/.../engine-alignment-baseline.json` | accepted-drift baseline (shrinks per flip) |
| `apps/api/migrations/00xx_backfill_*.sql` | per-doc saved-draft backfill |
