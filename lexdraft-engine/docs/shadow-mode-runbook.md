# Shadow mode — capture → report (s.138 notice, Phase 1)

Shadow mode compares the current **model** drafting pipeline against the **engine**
for the same real matters, to understand every divergence *before* routing s.138
notices through the engine. **Nothing user-visible changes** while it runs.

The golden rule: **report only on real captured traffic.** A shadow run on invented
fixtures tells us nothing, so the reporter refuses to produce one and says so.

## 1. Stand up the engine service (co-located, localhost)

```
cd lexdraft-engine
pip install -e ".[service]"
LEXDRAFT_SERVICE_TOKEN=<shared-secret> uvicorn src.service.app:app --port 8099
```

## 2. Enable the client on the Node API

In `apps/api/.env`:

```
ENGINE_SERVICE_URL=http://127.0.0.1:8099
ENGINE_SERVICE_TOKEN=<shared-secret>   # must match the engine's token
```

Run migrations `0066_fact_sheets` and `0067_shadow_pairs`
(`apps/api` → `npm run migrate` / `tsx src/scripts/migrate.ts`).

With the URL blank, everything below is a clean no-op — the model pipeline is
untouched.

## 3. Capture (automatic, background, real traffic only)

When an advocate drafts through `POST /drafting/pipeline`, capture happens **iff**
the request carries a fact-sheet `shadowMatterId` **and** the engine-shaped
`shadowFields`. The advocate sees the model output exactly as before; in the
background the engine is run for the same fields and the `(model, engine)` pair is
stored in `shadow_pairs`.

Requirements, by design:
- **Versioning.** `shadowMatterId` is the fact sheet's matter id; the engine client
  resolves the **current** version from `factSheetService.getCurrent` and sends it.
  The fact sheet is append-only (immutable revisions, monotonic version — migration
  `0066`), so the version can never be stale. A fact edit is a `revise()` (new
  version), never an in-place update.
- **No synthetic data.** No `shadowMatterId`/`shadowFields` → no capture. The
  recorder never fabricates a matter or invents fields.
- **Best-effort.** The engine call is fire-and-forget: an engine error is recorded
  as `engine_status='error'` (excluded from findings) and never affects the draft.

The frontend starts sending `shadowMatterId`/`shadowFields` once the s.138 form is
backed by a fact sheet; until then, zero pairs accumulate and the reporter says so
(step 4) rather than inventing traffic.

## 4. Report (classified divergences)

```
GET /drafting/shadow-report/s138_notice
```

Returns a classified report over the recorded pairs:

- **CRITICAL** — the engine **refused** where the model produced a draft. The model
  would have shipped a legally-defective notice. This is the category that
  justifies the migration.
- **REVIEW** — the model blocked (its own citation audit) where the engine
  generated. Usually a hallucinated-citation concern the engine sidesteps by
  construction; confirm.
- **AGREE** — both refused or both generated. Recorded for confirmation (compare
  sections/grounds), not an action item. **Narrative-wording deltas are NOISE** and
  are counted but never itemised.
- **EXCLUDED** — the engine errored / got invalid input on that pair. **Not counted
  as agreement** — a silently-broken engine must never read as "the engine agrees".

With **zero pairs** the report has `hasData: false` and a message explaining that
shadow mode reports only on real traffic — no report is produced.

## 5. Read the findings, then decide

Every CRITICAL is a document the model would have shipped and the engine stopped —
inspect a sample, confirm each is a real defect, and only then move s.138 from
shadow to a live flag for a pilot cohort (Phase 2 in `docs/api-layer-plan.md`).

## Offline harness (engine side)

`lexdraft-engine/tools/shadow_s138.py` runs the same classification offline against
recorded pair files — useful for spot-checking a captured pair or a fixture during
development. It is a dev aid; the Node `shadow-report` endpoint over `shadow_pairs`
is the real, traffic-backed report.
```
