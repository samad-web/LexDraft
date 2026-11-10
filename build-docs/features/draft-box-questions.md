# Questions in the Draft box

## Purpose
Advocates type questions ("Is registration compulsory for a partition deed?") into the Draft box. Before: the app started a related format and asked for party names, or wrote a whole paid open draft. Now it answers.

## Architecture
- `intake.service.startAuto`: when no document is explicitly requested and the text looks like a question (`looksLikeQuestion`: ends in "?" or starts with an interrogative), the keyword shortcut is skipped and the LLM classifier decides.
- `intakeLlm.classifyDocType` returns `question: true` when the message asks about law or practice and does not ask for a document. Acted on only for question-shaped text, so briefs route as before.
- `open-draft.service.answerQuestion`: one call on the drafting model, grounded on `gatherAuthorities`; judgments not in our sources removed (`keepListedJudgments`); provisions our sources don't confirm listed as `verify`.
- Response: `IntakeState`-free `{ answer: { text, verify, draftOffer? } }` from start-auto (200). `draftOffer` = a routable label the answer relates to, when the classifier named one.
- UI: DraftBotModal shows the answer (neutral box, monochrome) with "check before relying" list; no matter is created.

## Impact map
- start-auto route (response shape adds an `answer` variant) → DraftBotModal (only live caller; IntakePanel is not mounted).
- classifier prompt: risk of misrouting real briefs → guarded by question-shape gate; re-run route-check 30 open + 83 known.
- Quota: one call counted via `recordUsage`; `assertCanGenerate` already runs.

## Edge cases
- "Can you draft a bail application?" → explicit request wins, drafts as before.
- A brief ending with a question ("client arrested yesterday, can we get bail?") → classifier says not a question → routes to bail.
- Answer call fails → 503 `ai_unavailable` path as for drafting.
- Prompt injection in the question → answer prompt says the text is the question only; output is plain text shown escaped by React.

## Acceptance
- 12 test questions: ≥11 answered, 0 matters created for answered ones.
- Route-check unchanged: 30/30 open, 83/83 known.
- Unit tests: question gate, answer cleaning (judgments removed, verify list), route response.
