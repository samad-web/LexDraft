# Drafting eval harness

A lightweight, on-demand regression suite for the drafting feature. Run it
when you change the prompt in `drafting.service.ts`, swap models, switch
providers, or upgrade a provider SDK. It is **not** a vitest test — LLM
calls are slow, non-deterministic, and cost money, so we don't run it on
every commit.

## What it does

1. Sends ~20 representative `DraftRequest` payloads (English / Hindi / Tamil,
   different doc types and tones) to `draftingService.generate()`.
2. Scores each response against a per-brief rubric:
   - Required substrings (e.g. "prayer", "138", "Petitioner")
   - Forbidden substrings (e.g. "as an AI", "I cannot")
   - Structural checks (paragraph numbering, parties block, prayer,
     verification, min/max words)
3. Aggregates into a pass/fail per brief plus run-level totals.
4. Optionally diffs against a saved baseline so a regression breaks CI.

The scoring rubric lives in `evaluator.ts` and is intentionally crude
substring matching. The point is to catch the model going off the rails —
refusing, switching languages, dropping the prayer — not to grade the
quality of the prose.

## How to run

```bash
# All briefs, using whichever provider env.LLM_PROVIDER resolves to
pnpm --filter @lexdraft/api eval

# Force a provider (overrides env.LLM_PROVIDER, falls back if key missing)
pnpm --filter @lexdraft/api eval --provider anthropic
pnpm --filter @lexdraft/api eval --provider xai

# Only briefs whose id or description contains the substring
pnpm --filter @lexdraft/api eval --filter plaint
pnpm --filter @lexdraft/api eval --filter hi

# Save the current run to use as a baseline later
pnpm --filter @lexdraft/api eval --save eval/baselines/anthropic-2026-05-12.json

# Diff against a saved baseline (non-zero exit on regressions)
pnpm --filter @lexdraft/api eval --baseline eval/baselines/anthropic-2026-05-12.json

# Machine-readable output for CI
pnpm --filter @lexdraft/api eval --json
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | All briefs passed (no-baseline mode) **or** no regressions vs baseline |
| 1    | At least one brief failed, **or** a regression was detected vs baseline |
| 2    | Invalid CLI arguments |

## Updating the baseline when prompts change

When you intentionally change the prompt, model, or provider behaviour:

1. Run the suite with `--save eval/baselines/<provider>-<date>.json`.
2. Eyeball every brief in the output. Anything that *should* still pass had
   better pass; anything that newly fails needs a rubric tweak or a prompt
   tweak.
3. Commit the new baseline. The diff in PR review should be small — if
   half the scores moved, you've either broken something or your rubric
   was too tight.

Baselines are kept under `eval/baselines/` and are JSON. They are
human-readable so you can grep for `"pass": false` to spot the failures
without rerunning anything.

## Interpreting a regression

The runner reports two kinds of regression:

- **regression** — a brief that passed in the baseline now fails. Almost
  always means the prompt or model lost a structural element the rubric
  requires. Read the `failures` array on that brief.
- **score-drop** — a brief that still passes but lost ≥ 10 points vs the
  baseline. Usually a soft signal: the output is shorter, lost a required
  substring, or skipped a structural check. Worth investigating before
  shipping.

A brief with `failures: ["contains forbidden substring: \"as an AI\""]`
means the model started refusing or breaking persona — that's almost
always a prompt regression, not a model regression.

## Cost

Each brief is one round-trip to a frontier model with ≤ ~2 KB of input and
≤ ~2 KB of output. Rough estimate per full run (~20 briefs):

| Provider  | Cost per run (very rough) |
|-----------|---------------------------|
| Anthropic Sonnet | ~5-10 ₹ (about 5-10 US cents) |
| xAI Grok-4       | similar order of magnitude    |

These are pennies, not pounds, but they accumulate if you wire the runner
into a per-commit CI job. Don't. Run it manually on prompt changes, or
schedule it nightly at most.

## Adding a new brief

`golden-briefs.ts` is the single source of truth. Append a new entry:

```ts
{
  id: 'reply-divorce-en-pro-1',
  description: 'Reply to divorce notice, English',
  request: { docType: 'Reply', language: 'EN', tone: 'Professional', fields: { ... } },
  expectations: {
    mustInclude: ['reply', 'notice'],
    mustNotInclude: ['as an AI'],
    structuralChecks: { hasPrayer: true, maxWords: 700 },
  },
}
```

Keep `mustInclude` short — five entries is plenty. The rubric should
catch a refusal or a structure break, not enforce a specific style.

## Files

- `golden-briefs.ts` — the brief corpus + per-brief rubrics
- `evaluator.ts`    — pure scoring functions, no I/O
- `runner.ts`       — CLI orchestrator
