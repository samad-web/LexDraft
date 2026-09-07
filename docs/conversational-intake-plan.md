# Conversational Intake Loop — Design Plan

**Status:** plan, pre-code. **Pilot doc:** `s138_notice` (the only wired adapter).
**Owner constraint (non-negotiable):** *the engine decides which questions get
asked; the model only phrases them.* The model must never invent a question the
engine didn't ask for, and never skip one it did.

---

## 1. The problem, precisely

Today the Draft page (engine path) is a static form → one `POST /drafting/engine/draft`
→ one of three outcomes (422 / refused / generated). See
[EngineDraftPanel.tsx](../apps/web/src/components/engine/EngineDraftPanel.tsx) and
[useEngineDraft.ts](../apps/web/src/hooks/useEngineDraft.ts). An advocate must
front-load every field before anything happens, and the page never talks back.

Advocates don't brief that way. They narrate the matter ("client's cheque for
4.75L bounced, insufficient funds, memo came back on the 20th…") and expect to be
*asked* for whatever's missing.

We want a loop:

1. Advocate describes the matter freely.
2. Model **extracts** what it can into the fact sheet.
3. Engine reports what's still missing — **the 422 issues list**.
4. Model **phrases** those missing items as questions, one or two at a time.
5. Repeat until the engine stops returning 422.
6. Draft (which then either **refuses** on a legal ground, or **generates**).

The load-bearing realisation: **we already have the "which questions" engine.**
The 422 `issues` array from the adapter's `coerce()` is precisely the list of
what's still needed, keyed to inbound fields. We are not building question
intelligence. We are building:

- **(A) an extractor** — prose → the same inbound-key fact map the field map
  already produces, and
- **(B) a phraser** — engine's 422 issues → natural-language questions, and back.

The engine stays stateless and untouched. This is a new orchestration layer that
sits *above* the existing `/drafting/engine/*` endpoints.

---

## 2. Where the model is allowed to think, and where it is not

Two model calls, each with a deliberately narrow job. Neither decides *what is
required* or *whether the matter is legally sound* — those are the engine's.

| Concern | Decided by | Never by |
|---|---|---|
| Which fields exist / are required | Engine adapter (`describe()`, `coerce()` → 422) | Model |
| Whether a given answer is legally fatal | Engine pipeline (→ refusal) | Model |
| What natural language maps to which field | **Model (extractor)** | — |
| How to word a question / a refusal | **Model (phraser)** | — |

The model is a **translator on both ends** of the engine, never an oracle in the
middle. This is the same discipline as the existing no-model-call guarantee, just
relaxed by exactly two well-fenced translation steps — and critically, the model
never *originates* a requirement or a legal conclusion.

---

## 3. Partial extraction → fact-sheet fields

### 3.1 The extractor's contract

Input: the running transcript + the current partial fact map.
Output: **only** a patch of `{ inbound_key: value }` for fields it can fill *with
textual support*, plus a per-field provenance note.

The extractor is constrained three ways so it can't drift:

1. **Closed vocabulary.** It is handed the exact field list for this doc type from
   `GET /v1/doc-types` (`Adapter.describe()`) — keys, types, enums, and the human
   labels. It may only emit those keys. Anything it "learns" that has no field is
   dropped (or parked as a note; §7). It cannot invent `cheque_guarantor` because
   no such field exists.
2. **Types come from the schema, not the model.** The extractor proposes strings;
   coercion (ISO dates, amount→int, enum-membership, bank/branch split) is the
   **engine's** `coerce()`, exactly as today via
   [engine-field-map.ts](../apps/api/src/lib/engine-field-map.ts). The model does
   *not* decide that "the 20th of March" is `2026-03-20`; it proposes
   `"20 March 2026"` and lets coercion own the format — or, if the year is genuinely
   absent, it does **not** guess (see §6, ambiguity).
3. **Provenance or omission.** Every proposed field carries a short quote/span from
   what the advocate actually said. No supporting span → the field is not emitted.
   This is the anti-hallucination gate: extraction is *grounding*, not *inference*.
   "The cheque was for a lot of money" yields no `cheque_amount`.

Extractor output shape:

```ts
interface ExtractionPatch {
  fields: Record<string, string>;          // inbound_key -> raw proposed value
  provenance: Record<string, string>;      // inbound_key -> supporting span
  unmapped_notes: string[];                // salient facts with no field (parked)
  low_confidence: string[];                // keys the model is unsure of -> confirm
}
```

### 3.2 Mapping to fact-sheet fields — reuse, don't rebuild

The inbound keys the extractor emits are the **same vocabulary**
`mapFormToEngine` already speaks (`client`, `cheques[].date`,
`memo_received_date`, `presentation_bank`, `place`, …). So the flow is:

```
prose ──extract──▶ {inbound_key: value}  (partial)
        merge into the running fact map (§5.3)
                            │
                            ▼
        POST /drafting/engine/ensure-matter   (create v1 / revise vN+1)
        POST /drafting/engine/draft           (coerce → 422 | refused | generated)
```

The running fact map is **the fact sheet**. We do not invent a parallel store: we
accumulate into the Node-owned versioned fact sheet
([useEnsureMatter](../apps/web/src/hooks/useEngineDraft.ts)) that already backs
the engine path. Each accepted extraction round is a `revise` → new version. This
is deliberate: it means the fact sheet's existing immutability/versioning and the
sign-off staleness rule keep working for free — a conversation is just a sequence
of revisions.

> Note on the flat↔nested seam: the form today is flat (`cheque_no`, `cheque_date`)
> and `mapS138` assembles the single-element `cheques[]` list. The extractor emits
> the **flat form keys** too, so it targets the *same* map the form fills. The
> conversation therefore reuses `engine-field-map.ts` verbatim; nothing new bridges
> to the engine contract. If the extractor ever needs multiple cheques, that's a
> field-map change (flat → list), not a conversation change.

### 3.3 What "still missing" means — reading the 422

The 422 body is already typed
([EngineFormError](../apps/web/src/hooks/useEngineDraft.ts)):

```ts
interface EngineValidationIssue {
  field: string;      // inbound key/path, e.g. "cheques[0].branch"
  code: string;       // 'required' | 'type' | 'enum' | 'malformed'
  message: string;
}
```

This **is** the question queue. The loop reads `issues`, and each issue becomes at
most one question. The engine's `coerce()` is the single source of "what's needed
next" — the model never computes this.

---

## 4. The phraser — engine issues → questions → answers

### 4.1 Strict 1:1, both directions

- The phraser is handed the `issues` array and the field labels
  (`fieldLabels` already threaded through `EngineDraftPanel`). It returns a natural
  question **per issue**, batching **one or two** issues per turn (§4.2).
- It must produce a question for **every** issue eventually (never skip) and must
  **never** produce a question not backed by an issue (never invent). We enforce
  this structurally, not by trusting the prompt:

```ts
// The phraser returns questions tagged with the issue field they address.
interface PhrasedQuestion { field: string; question: string; }

// GATE: drop any question whose field isn't in the current issue set;
// GATE: any issue with no question is asked with a fallback (label + message),
//       so an issue is NEVER silently skipped.
function reconcile(issues: EngineValidationIssue[], asked: PhrasedQuestion[]) {
  const issueFields = new Set(issues.map((i) => i.field));
  const kept = asked.filter((q) => issueFields.has(q.field)); // no invented Qs
  const coveredFields = new Set(kept.map((q) => q.field));
  const fallbacks = issues
    .filter((i) => !coveredFields.has(i.field))
    .map((i) => ({ field: i.field, question: fallbackFor(i) })); // no skipped Qs
  return [...kept, ...fallbacks];
}
```

This is the same "the engine decides, the model phrases" contract made mechanical:
the model's freedom is bounded to the *wording*; the *set* of questions is the
engine's `issues`, enforced by set-membership on both sides. If the model returns
prose with no `field` tag, or tags a field not in `issues`, that output is
discarded and we fall back to the plain label — we never ask something the engine
didn't ask for.

### 4.2 One or two at a time — how we choose which

We don't ask all 6 missing fields at once (that's just the form again). Ordering
rules, all cheap and deterministic (no model call to *choose*, only to *word*):

1. **Anchors and identities first** — the fields other answers depend on for
   sense (parties, then the cheque, then dates, then service). A small static
   priority map per doc type keyed by inbound field; unlisted fields sort last.
2. **Group naturally co-occurring fields** into one question — e.g.
   `cheques[0].bank` + `cheques[0].branch` → "Which bank and branch was the cheque
   drawn on?" The grouping map is static per doc type; the model phrases the
   grouped question but cannot regroup.
3. **Cap at two questions (or one group) per turn.**

If the advocate's free narration already answered several, those never become
questions — they were extracted in step 2 and cleared from `issues` before we
phrase. The conversation only asks for the genuine remainder.

### 4.3 The answer comes back as more prose → re-extract

An advocate's answer is just more narration. It goes back through the **same
extractor** (§3), scoped with a hint that it's answering questions about fields
`X, Y`. Then merge → ensure-matter (revise) → draft → new `issues`. The loop
tightens each turn because the issue set can only shrink (or surface a refusal;
§8).

---

## 5. The loop — control flow and termination

```
                 ┌──────────────────────────────────────────────┐
                 │  advocate says something (free text)          │
                 └───────────────────┬──────────────────────────┘
                                     ▼
                        EXTRACT (model, §3)  → patch + provenance
                                     ▼
                        MERGE into fact map (§5.3, contradiction check §7)
                                     ▼
                        ensure-matter (revise → vN+1)
                                     ▼
                        POST draft  ───────────────┐
                                     ▼             │
                    ┌───────── outcome? ───────────┤
                    │            │                 │
                 422 issues   refused          generated
                    │            │                 │
             PHRASE (model,    surface          show draft +
             §4) 1–2 Qs        refusal          review banner +
                    │          mid-loop (§8)    sign-off (existing)
                    ▼            │                 │
             ask advocate ◀──────┘                 ▼
                    │                          TERMINATE (success)
                    └────────► (advocate answers → top of loop)
```

### 5.1 Termination conditions (all explicit)

The loop ends on exactly one of:

- **Success** — draft returns `generated`. Hand off to the existing generated-draft
  UI (blocks + `ReviewBanner` + sign-off). This is the *only* success exit.
- **Advocate ends it** — explicit "stop"/close. State is preserved in the fact
  sheet (it's versioned), so they can resume.

A **refusal is not a termination.** It is a finding about the current facts, not a
verdict on the matter. So the loop does not end on `refused`: it **stops asking new
intake questions** (interrogating), delivers the finding, and **stays open** — the
advocate can volunteer a correction, which we still extract, and we **re-evaluate on
every such correction**. See §8; this is the resolved §10 call. The only thing a
refusal changes about the loop is that we stop *pushing* the advocate for the next
missing field while a legal defect stands.

**No convergence-by-guessing.** The loop is *only* driven by the engine's `issues`
shrinking. There is no model-side "I think we have enough" — if the engine still
422s, we still ask. If it stops 422-ing, we draft. This makes non-termination
impossible in the normal case: `issues` is bounded by the finite field set, each
answered field is coerced by the engine (not re-asked once it validates), so the
set is monotone-decreasing across accepted rounds.

### 5.2 The one place the loop could stall — and the guard

Risk: the advocate keeps answering but a field never validates (e.g. they keep
giving a bank with no branch, so `cheques[0].branch` stays `required`, or they give
an un-parseable date so a field stays `malformed`). The issue set doesn't shrink →
we'd re-ask forever.

Guard: **per-field ask counter.** If the same `field` has been asked N times (2)
without the issue clearing, we stop re-phrasing it conversationally and switch that
one field to an **explicit, typed micro-form control** (the existing form widget for
just that field, with its `message` shown). This is a graceful downgrade to the
mechanism we know works, not a new intelligence. It also covers the case where the
advocate simply doesn't understand the natural-language question. We `log`/telemeter
every such downgrade so we can see which fields the phraser handles badly.

### 5.3 State the loop carries

```ts
interface FieldMeta {
  confidence: 'stated' | 'inferred' | 'confirmed';
  //  stated    = advocate said it plainly; extractor quoted it verbatim-ish.
  //  inferred  = extractor DERIVED it ("arrested yesterday" -> a date). Visible
  //              in the fact-sheet view as derived; not a draft blocker (§11).
  //  confirmed = advocate explicitly confirmed a previously-inferred/low-conf value.
  source: string;          // the supporting span from what the advocate said
  derivation?: string;     // for 'inferred': how it was derived ("'yesterday' + today's date")
  askedVia?: 'narration' | 'question' | 'direct-edit'; // how the value arrived
}

interface IntakeState {
  matterId: string;              // the versioned fact sheet (created on first extract)
  factMap: Record<string, unknown>;   // accumulated inbound-key values (the facts)
  meta: Record<string, FieldMeta>;    // per-field confidence + provenance + derivation (§11)
  transcript: Turn[];            // advocate + assistant turns
  lastIssues: EngineValidationIssue[];// what the engine last asked for
  lastRefusal: EngineRefusal | null;  // the standing finding, if any (§8; pause, not stop)
  askCounts: Record<string, number>;  // field -> times asked (§5.2 guard)
  status: 'gathering' | 'refused' | 'generated' | 'closed';
  //  'refused' means "a finding stands"; the loop is PAUSED on interrogation, not
  //  ended — corrections still flow (§5.1, §8).
}
```

`factMap` is the mirror of the current fact-sheet version; it's what we re-submit
each round. It is never the *source of truth for legality* — the engine is — it's
just the accumulator we feed the engine. `meta` travels alongside it (it is **not**
sent to the engine — the engine only wants values) and drives the fact-sheet view
(§10) and the derived-value marking (§11).

---

## 6. Ambiguous answers

"Ambiguous" splits into cases the engine can catch and cases only the model can.

**(a) Ambiguity the engine catches** — the answer coerces to the wrong type or
fails an enum. The engine returns `code: 'type' | 'enum' | 'malformed'` for that
field (not `'required'`). We treat these exactly like a re-ask, but the phrased
question carries the constraint from `message`: "That didn't read as a date — what
was the calendar date the memo reached your client?" or, for an enum,
we present the allowed options (`dishonour_reason` ∈ the schema's option list). The
engine defined the constraint; the model only phrases the retry.

**(b) Ambiguity only the model sees** — the advocate says "the 20th" with no month,
or "he" when two people are in play, or gives one value that could fill two fields.
Rules:

- The extractor must **not** resolve these by guessing. If a value is
  under-determined, it goes to `low_confidence` (or is withheld) rather than into
  `fields`. Withholding means the engine keeps 422-ing that field, which naturally
  produces a clarifying question next turn — *the ambiguity routes back through the
  engine's own "still missing" channel.* We don't need a separate ambiguity path
  for withheld fields; the loop already handles "missing."
- For a value the model *did* extract but is unsure of (`low_confidence`), we
  **echo it back for confirmation before it hardens**: "I've noted the cheque date
  as **12 March 2026** — is that right?" Confirmation is a normal turn; a "no"
  re-opens it. We never silently commit a low-confidence extraction as fact.
- **One value, two possible fields** (e.g. an address that could be the payee's or
  the drawer's): never assign by guess. Ask which. This is phrased by the model but
  triggered by the extractor flagging the collision — again, no field is written
  until disambiguated.

The through-line: **the model's uncertainty defers to a question; it is never
resolved by invention.** A withheld/uncertain field simply remains "missing," and
missing is a channel the engine already owns.

---

## 7. Contradictions with an earlier answer

Two flavours:

**(a) Advocate contradicts a fact they gave earlier** ("actually the cheque was for
5 lakh, not 4.75"). The extractor emits a value for a field that **already has a
different value** in `factMap`. We detect this on merge (§5.3) — same key, changed
value — and it is **never a silent overwrite**. Behaviour:

- Surface it in one line: "Earlier you said the cheque was ₹4,75,000 — updating it
  to ₹5,00,000. Correct?" (uses stored `provenance` to quote the earlier basis).
- On confirm, we **revise** the fact sheet (new version). Because revision is how
  the fact sheet already works, the contradiction resolution rides the existing
  versioning: the old value lives in the prior immutable version; the new value is
  vN+1. If a document had been signed off against the old version, the existing
  **staleness rule** already re-raises the review banner — a contradiction that
  moves a signed fact correctly un-signs the draft. We get this for free.
- On "no, keep the old one," we discard the new extraction for that field.

Detection is deterministic (key present with a different coerced value); only the
*confirmation wording* is the model's. We do not let the model decide which value
"wins" — the advocate does.

**(b) Advocate's new fact contradicts the *engine's* view** — i.e. the combination
becomes legally impossible (e.g. a corrected date now puts the notice outside the
statutory window). That is **not** a fact-map contradiction; it's a **refusal**, and
it surfaces via §8 the moment the corrected facts are drafted. We don't try to
predict it — we let the engine find it. This keeps the "engine decides legality"
line clean even when the trigger was a mid-conversation correction.

---

## 8. Refusals surfacing mid-conversation (not at the end)

The whole point of the engine is that a refusal is a **legal finding**, and the
advocate should hit it as soon as the facts make it true — not after answering ten
more questions.

- The loop calls `draft` **every round**, as soon as enough is present to attempt
  it (i.e. whenever the fields the engine needs to *reach* the refusing check are
  filled). Because the engine returns `refused` at **200** (not an error) with a
  typed `Refusal`, the loop can see it the instant it becomes true and **stop
  interrogating immediately** (it does not stop *listening* — see below).
- The refusal is rendered inline in the conversation with the existing
  [RefusalMessage](../apps/web/src/components/engine/RefusalMessage.tsx) voice —
  amber, conversational, plain reason, computation behind "show the working",
  `fields_implicated` as clickable chips (already built). It appears **as the next
  assistant turn**, mid-conversation, not on a final results screen.
- **422 vs refusal are different channels, always.** A missing field (422) becomes a
  *question*; a legal defect (refusal) becomes a *finding*. They never share a
  component or a voice — the codebase already enforces this split
  (`FormIncompleteMessage` vs `RefusalMessage`); the conversation preserves it: a
  question bubble vs a refusal card.

**Refusal-pause behaviour (resolved §10 call): keep listening, stop interrogating.**
A refusal is a finding about the *current facts*, not a verdict on the matter. So
when a refusal stands:

- We **deliver the finding** (the refusal card) and **stop asking** for the next
  missing field. We do not push the advocate through more intake questions on a
  matter the engine has already found defective — that would be the dishonest UX we
  are avoiding.
- We **stay open to corrections.** The advocate can keep talking; anything they
  volunteer still goes through the extractor and merges into the fact map exactly as
  before. We are listening, just not interrogating.
- We **re-evaluate on every correction.** Each volunteered fact that changes the
  `factMap` triggers a fresh revise → draft. Three things can then happen:
  1. the correction **removes the defect** → the engine returns `generated` (done) or
     `422` (back to gathering — we resume asking, the pause lifts);
  2. the correction **leaves the same defect** → the refusal card updates in place
     (same code) and we keep listening;
  3. the correction **produces a different refusal** → the new finding replaces the
     old card.
- Concretely in state (§5.3): `status: 'refused'` with `lastRefusal` set means
  *paused*, not *ended*. `submitTurn` still runs the full extract→merge→draft cycle
  while paused; it simply skips the phraser (no new questions) until the outcome is
  no longer `refused`.

This is the one asymmetry between the 422 loop and the refusal state: 422 *pulls*
(we ask for the next field), refusal *waits* (we accept whatever the advocate
offers and re-check). Both re-evaluate through the same engine call — neither lets
the model decide when the problem is solved.

> Why every-round drafting is safe and cheap: `draft` on incomplete facts just
> returns 422 (no LLM, no cost beyond the engine call), so calling it each round
> is how we *discover* both "still missing" and "now refused" from the one
> authoritative source. We never guess which state we're in.

Ordering guarantee we must preserve: a refusal that is *reachable* with the facts
so far must win over asking the next optional question. Concretely — if the current
`factMap` already triggers a refusal, we surface the refusal even if other required
fields are still missing, **provided** the refusing check doesn't itself depend on
those missing fields. The engine already encodes this: it refuses only when it
reaches the check, and it 422s first for anything the check needs. So "refusal
surfaces as early as the engine can prove it" falls out of calling the engine every
round and trusting its outcome. We add nothing.

---

## 9. What we build (thin, on top of what exists)

Nothing in the engine or the existing endpoints changes. New pieces:

1. **`GET /v1/doc-types` passthrough** (Node) — expose the adapter field/enum/label
   contract to the web app so the extractor's vocabulary is the engine's, sourced
   not hardcoded.
2. **Extractor** (`apps/api`, one model call) — prose + field contract →
   `ExtractionPatch`. Grounded, closed-vocabulary, provenance-required. This is the
   *only* new place a model reads free text on the engine path, and it writes only
   proposed field values, never a document.
3. **Phraser** (`apps/api`, one model call) — `issues` + labels → `PhrasedQuestion[]`,
   run through `reconcile()` (§4.1) so it can neither invent nor skip.
4. **Intake orchestrator** (`apps/api`) — owns `IntakeState` (§5.3), the merge +
   contradiction check (§7), the ask-counter guard (§5.2), and the per-round
   ensure-matter→draft calls. It calls the *existing* engine client; it does not
   call the engine directly.
5. **Conversation UI** (`apps/web`) — a transcript view that renders three turn
   kinds mapped 1:1 to the engine outcomes: **question** (from 422), **refusal
   card** (`RefusalMessage`, from refused), **draft** (blocks + `ReviewBanner`, from
   generated). Reuses all three existing components; adds only the transcript shell
   and the free-text input.

### 9.1 Preserving the no-model-call guarantee's spirit

The existing static import test asserts the *s.138 form path* reaches no LLM. The
conversation path **does** call the LLM (extractor + phraser) — that's the feature.
We keep the guarantee honest by fencing it:

- Extractor and phraser live in their **own module**, imported only by the intake
  orchestrator, never by the form draft path. The form path's no-model test stays
  green and unchanged.
- A **new** static test asserts the inverse for the intake module: the extractor/
  phraser may reach the LLM client **but must not reach the drafting orchestrator**
  (`useDrafting`/EXTRACT/CLASSIFY/DRAFT/VERIFY). The model may translate *into and
  out of* the engine; it may never draft the document. That is the structural
  encoding of "engine decides, model phrases."

---

## 10. The fact-sheet view — the conversation is the input, not the only view

A pure conversation with no visible state is disorienting past a handful of fields,
and — worse — it's how an extraction error survives unnoticed until it lands in the
draft. So the conversation is **the input method, not the only view of the data.**
Alongside the transcript, the advocate always sees the **accumulated fact sheet**
and can edit it directly.

- **Always-visible panel.** A `FactSheetView` renders `factMap` grouped by the doc
  type's sections (from `Adapter.describe()` — same source as the old form's
  sections), every field showing its current value, its label, and — per §11 — a
  marker when the value was *inferred* rather than stated. Empty required fields are
  shown as outstanding (this is the same information the 422 issues carry, rendered
  as a checklist rather than a question).
- **Direct edit is a first-class input.** Editing a field in the panel is exactly
  equivalent to stating it in the conversation: it goes through the **same merge →
  revise → draft** path (`askedVia: 'direct-edit'`, `confidence: 'stated'` — a direct
  edit is the advocate stating the value themselves, so it is never "inferred").
  A direct edit can therefore resolve a 422, fix an extraction error, or trigger /
  clear a refusal — all through the one engine call, no special path.
- **Editing is revising.** Because every accepted change is a fact-sheet `revise`
  (new version), a correction made in the panel carries the same versioning /
  sign-off-staleness consequences as one made in the chat. The panel does not get a
  back door around the immutable fact sheet.
- **The panel is where extraction errors get caught.** If the model read
  "arrested yesterday" as the wrong date, the advocate sees the derived date in the
  panel (marked derived, §11) and corrects it there — before it reaches the draft,
  not after. This is the whole reason the view is not optional.
- The panel and the transcript are two views of **one** `IntakeState`; there is no
  second store. A change in either re-renders both.

## 11. Extraction confidence & derived values

Every field in `factMap` carries a `FieldMeta` (§5.3) recording **how sure** we are
and **how the value arrived**. The point is honesty about what the advocate actually
said versus what the model *derived*.

- **`stated`** — the advocate gave it plainly; the extractor quoted a supporting
  span. Rendered normally.
- **`inferred`** — the extractor **derived** the value rather than reading it off.
  The canonical case: "arrested yesterday" → a concrete `arrest_date` computed from
  "yesterday" + the current date. The value is *usable* (it's very likely right), so
  it is **not a draft blocker** — but it is **visibly marked as derived** in the
  fact-sheet view, with the derivation shown on hover/expand ("from 'yesterday',
  relative to 1 Sep 2026"). The advocate can see at a glance which facts are their
  words and which are the model's arithmetic.
- **`confirmed`** — an `inferred` (or low-confidence) value the advocate then
  explicitly confirmed (§6). Once confirmed it reads like `stated` but we keep the
  history that it began as a derivation.

Rules that keep this meaningful:

- The **extractor emits the confidence**, per field, as part of its structured
  output — it must tag a value `inferred` whenever the value is not substantially
  present as text (any relative date, any computed/normalised value, any field it
  assembled from scattered mentions). Guessing without derivation is still
  forbidden (§3.1, §6): `inferred` means *derived by a stated rule from stated
  inputs*, not *guessed*.
- A **direct edit** (§10) always lands as `stated` (or `confirmed` if it confirms a
  prior derivation) — the advocate typing the value is definitionally stating it.
- Confidence is **UI + audit metadata only**; it is never sent to the engine and
  never changes what the engine validates or refuses. A derived value that is wrong
  fails the same way any wrong value does — via a refusal or a bad draft the
  advocate catches in review. Marking it derived just makes it *catchable earlier*.
- `inferred` never blocks the draft. It is a flag, not a gate — consistent with the
  brief: "Not a blocker on the draft, but visible in the fact-sheet view."

---

## 12. Still open for the advocate review

Two calls deliberately left for the advocate session rather than decided now:

1. **Ask-counter downgrade threshold** (§5.2) — is 2 tries the right point to fall
   back to a typed control, or do advocates prefer more natural-language attempts?
2. **Low-confidence confirmation breadth** (§6) — confirm *every* `inferred`/low-
   confidence value, or only a high-risk subset (dates, amounts, party identity —
   the fields whose error is expensive)? Confirming everything is safest but
   chattier. (The `inferred` marking of §11 ships regardless; this is only about
   which ones additionally prompt a "is that right?" turn.)

Neither changes the core contract — engine decides the question set and the
legality; the model only extracts and phrases.
