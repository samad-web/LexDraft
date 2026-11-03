# Drafting quality vs DraftBotPro

## Purpose
Every format should read like a Madras/TN filing an advocate would sign. The benchmark is a DraftBotPro writ the user supplied.

## Architecture
- Engine path: facts → engine skeleton (hard-stops) → compose (AI body, guards, verify) → splice into .docx.
- Fallback path: when the engine refuses after "Draft now", a general-AI draft is written. It now gets the same per-format guide (`guideFor`) and governing provisions (`gatherAuthorities`).
- Templates: `lexdraft-engine/templates/build_templates.py`. There are two engine copies, and both must stay identical.

## Impact map
- `intake-compose.service.ts`: the particulars guard, the lost-particulars rule and `guideFor`.
- `intake.service.ts`: the fallback prompt and the classifier cues.
- `intake-llm.service.ts`: multi-pick list fields.
- `draft-guards.ts`: the `Rs. 0` sentinel.
- `intake-doc-config.ts`: list options.
- Engine: `apply_edits.splice_lines`, the plaint/summary_suit adapters and pipelines, `jurisdiction.basis_text`, and the adapter enum 422.
- Contract: `packages/types/src/data/engine-doc-contract.json` now lists the territorial_bases values.

## Edge cases
- A figure the advocate typed is a valid source. A figure that appears nowhere is still stripped.
- A dropped `[gap]` marker no longer rejects a compose. A dropped date, amount or section still does.
- `Rs. 0` is the draft-now sentinel. It renders as `Rs. [amount to be provided]` and is never demanded.
- A splice edge inside a multi-line paragraph keeps the out-of-range lines.
- An invalid enum value in a list field returns a 422, never a 500.

## Acceptance criteria
- Each of the 46 suite briefs drafts through the engine path, or through the guided fallback.
- A senior-advocate grade of "Competes" or "Close" for every format, re-graded after each round.
