# Open drafting: any legal document, with or without a built-in format

Status: approved 2026-11-08, building. Master plan: `PLAN.md`, top section.

## Shared design

- Route: built-in or firm format only when it is truly the document asked for. Otherwise open drafting. The advocate is never blocked by the list.
- Open drafts reuse the attached-format pattern: label `<title> (open draft)`, state on the existing fact sheet (`StoredState.open`). No migration.
- New service: `apps/api/src/services/open-draft.service.ts`. One flow, no per-document code:
  1. **Blueprint** (1 call, JSON): document name and kind, forum and jurisdiction, parties and roles, required parts in order, governing law, formalities (stamp, registration, attestation, verification, limitation, court fee), points a senior would check, missing facts.
  2. **Draft** (1 call, continued if cut off): full document from the blueprint, facts, attachments and authorities.
  3. **Review** (1 call, JSON): draft against blueprint and facts. Reports omissions, wrong roles, inconsistent figures and dates, legal slips.
  4. **Repair** (0 or 1 call): fixes reported items only.
  5. **Code checks** (no model): F3.
  6. **Render**: F4.
- Usual cost: 3 to 4 model calls per draft on Sonnet 5.5. Testing uses the Agent SDK route only.

## Advocate-style output (applies to every step)

The draft must read as if a practising Tamil Nadu advocate wrote it, ready for the bundle, not like an AI answer.

- **Style sources, in order:** the firm's approved formats of the same kind; the closest of the 84 built-in templates (layout and phrasing only, never its facts); the existing per-family guides (`guideFor`).
- **Pleadings:** court and cause title, O.S./W.P. number line, parties with descriptions and ranks, "The petitioner above named respectfully submits as follows", numbered paragraphs, cause of action, jurisdiction, limitation, valuation and court fee where due, "It is therefore prayed that this Hon'ble Court may be pleased to", place and date, counsel's signature, verification, list of documents.
- **Deeds:** "THIS DEED OF ... is made on this the ... day of ... BETWEEN", full party description (name, parentage, age, occupation, address), "hereinafter called ... (which expression shall ...)", recitals with "WHEREAS", "NOW THIS DEED WITNESSETH", operative clauses, schedule with survey number, extent and four boundaries, "IN WITNESS WHEREOF", executant and witness blocks.
- **Notices:** advocate's letterhead lines, mode of dispatch, "Under instructions from and on behalf of my client", numbered facts, demand with time limit, consequence, copy retained.
- **Agreements, affidavits, letters, opinions:** the accepted form of each, from the same sources.
- **Indian usage:** DD.MM.YYYY, Rs. 1,00,000/- with the amount in words where customary, S.F. No., Door No., S/o, D/o, W/o, "Hon'ble", "aforesaid", "the said".
- **Never:** markdown, bullets, bold headings inside prose, summaries, explanations or notes to the reader inside the document, "In conclusion", chat phrasing, American spelling.
- **Length:** what the document needs; a one-page application stays one page.

---

## F1. Router that can say "not on the list"

**Purpose:** stop the wrong-format substitution (family settlement deed was drafted as Relinquishment Deed, 2026-11-08).

**Architecture**
- `classifyDocType` returns `{ label, confidence, notListed?: string }`. Prompt: pick a label only if it is that same document; a related document is not a match.
- `startAuto`: an explicit request ("draft a X") uses a label only on a named match or a strict keyword cue. Fuzzy cues no longer decide an explicitly named document.
- No label plus a recognisable legal document means open draft, instead of the 422 `doc_type_unclear`.
- A nameless, factless message still gets one question.
- A structured log line `open_draft_requested` records the document name, so demand shows which formats to build next.

**Impact map**
- `intake.service.ts` (`startAuto`, `keywordGuessLabel`, `routable`, `resolveDoc`): a tighter cue could misroute a built-in. Guarded by the 83-brief routing check.
- `intake-llm.service.ts` (`classifyDocType`): prompt change affects all auto-picks.
- `drafting.routes.ts` (`start-auto`, draft-now, label handling near line 1179): must accept the new label.
- Picked-format UI (`DraftBotModal`): "Change format" must still work.

**Edge cases**
- Advocate names a built-in loosely ("cheque case complaint"): stays built-in.
- Facts mention a gift, the request is a suit: the requested phrase decides.
- Classifier call fails: account failure shows the plain unavailable message; other failures fall back to keyword, then open draft.
- Non-legal or abusive request: declined, no matter created.

**Acceptance**
- All 83 existing briefs pick the same format as today.
- 30 out-of-list briefs: none drafted under a different document's format.
- A vague "draft something" asks one question and creates no draft.

---

## F2. Open drafting flow

**Purpose:** draft any legal document properly from the brief, as a strong general AI would, with more discipline.

**Architecture**
- `resolveDoc` returns an open doc with no fixed fields. `start`, `reply`, `draftNow`, `load` and `edit` branch early for open labels and skip the engine field loop.
- Draft first, ask after: missing facts appear as named brackets and in "points to confirm". Only a blocking unknown (no idea what document or which side) asks a question.
- Advocate's follow-up ("add an arbitration clause", new facts) re-runs Draft and Review on the whole conversation. Paragraph edits use the existing `/drafting/revise`.
- Attached reference documents are read as facts through the existing `attach` flow.
- The Draft step receives the style sources above; the Review step also checks form and phrasing against them.
- Reuse from `aiFallbackDraft`: no invented particulars, bracket style, `gatherAuthorities`, `guardRecalledCases`, usage recording.

**Impact map**
- `intake.service.ts`: `_turn`, `_evaluate`, `draftNow`, `edit`, `load` must not hit engine field lookups for open labels.
- `aiFallbackDraft`: shares its rules; existing built-in fallback behaviour must not change.
- `anthropic-client` / `claude-code-dev`: long outputs. 8,000 tokens is too small for long deeds and plaints.
- `aiQuotaService`, usage recording: one open draft counts as one draft. Known issue: intake drafts are not in `ai_generations` (pricing-v2 phase A).
- `fact_sheets`: JSON grows by one key; old sheets unaffected.

**Edge cases**
- Blueprint is bad JSON: one retry, then draft without it and say so in the notes.
- Output cut off: continue from the last paragraph; after two continuations, show what exists and say it is incomplete.
- Review or repair fails: return the checked draft with a note, never lose it.
- Instructions inside an attached file are data, never commands.
- Concurrent replies: existing fact-sheet versioning applies.
- Request to backdate, forge or fabricate evidence: refused plainly.
- Provider out of credit: existing failover, then the plain message.

**Acceptance**
- A draft for each of the 30 briefs, complete and not cut off, with the parts the blueprint lists.
- No fact, name, date or figure absent from the brief unless bracketed.
- A follow-up instruction changes that part and keeps the rest.
- Code check on every draft finds no markdown, bullets or chat phrasing, and dates and amounts in Indian form.
- No text copied from a style source's facts appears in the draft.

---

## F3. Law and citation safety

**Purpose:** this is where general AI fails. Wrong sections and invented cases must not reach an advocate unmarked.

**Architecture**
- Provisions come from `gatherAuthorities` and laws search where available. A provision from the model's memory is allowed but listed under "verify this citation".
- Judgments: only from our corpus or the authorities list. Anything else is removed (`guardRecalledCases`).
- New criminal codes: BNS, BNSS, BSA for matters on or after 01.07.2024, using the existing concordance. Older matters keep IPC and CrPC.
- Code checks on every draft: `introducedParticulars`, `lostParticulars`, `misnamedActs`, `correctLawSlips`, `unauthorisedCitations`.

**Impact map**
- `draft-guards.ts`, `compose-authorities.ts`: reused. Any change is re-tested against the compose suite.
- `laws-search`: may be unconfigured or slow; flow continues with flags.

**Edge cases**
- Laws search down: every statute cite becomes "verify".
- Facts straddle 01.07.2024: both codes named by date, flagged.
- Guard removes a whole sentence: re-tidy, no broken paragraph.
- State-specific law outside Tamil Nadu: blueprint names the state; flagged if not known.

**Acceptance**
- 0 invented judgments and 0 wrong-Act citations across the test set, by independent review.
- Every citation not found in our law sources appears in "verify this citation".
- Trap briefs (old code after 2024, time-barred claim, unregistrable oral transfer, minor as executant) are caught and flagged.

---

## F4. Word layout for any document

**Purpose:** pleadings, deeds, agreements, letters and opinions must each look right, not all like a court filing.

**Architecture**
- Blueprint `kind` (pleading, deed, agreement, notice, letter, opinion, form) goes to `/v1/compose-docx`.
- House layout matches the built-in formats: same fonts, margins, numbering and signature blocks.
- `compose.py` applies layout per kind. Change made in both engine copies.

**Impact map**
- `lexdraft-engine/src/service/compose.py`, `app.py`, `engine-client.service.ts`: default kind stays the current court layout, so the built-in AI fallback is unchanged.

**Edge cases:** tables and schedules in plain text; very long documents; unknown kind uses a plain layout; Word build failure gives a text-only draft with a note (existing).

**Acceptance:** one sample per kind opens in Word with correct headings, numbering, schedule, and signature or witness blocks. No "IN THE COURT OF" on a deed.

---

## F5. Composer experience

**Purpose:** the advocate knows what was used and what to check.

**Architecture**
- `IntakeState.draftedBy` gains `'open'`. Note on the draft: "Drafted by AI without a verified DifAi format. Please check it carefully."
- `draftNotes` carries "points to confirm" and "verify this citation" through the existing open-items panel.
- Offers "Use my own format" (attached-format flow). Existing black and white design.

**Impact map**
- `packages/types/src/index.ts`, `DraftBotModal.tsx`, `DraftingView.tsx` (`manual={draftedBy === 'ai'}` must treat `'open'` the same), Android via the same web build.

**Edge cases:** long notes list; reopening a saved open draft via `load`; export and save; keyboard and screen-reader access to notes.

**Acceptance:** note and lists are visible on first render and after reload; open drafts can be edited, saved and exported; browser check in light and dark.

---

## F6. Proof it competes

**Purpose:** measure, do not claim.

**Architecture**
- 30 out-of-list briefs: partition deed, family settlement, trust, adoption, partition suit, declaration suit, arbitration ss. 9, 11, 34, RERA, IBC ss. 7 and 9, DRT, labour dispute, loan, MoU, NDA, employment, shareholders' agreement, board resolution, guardianship, protest petition, discharge, habeas corpus, termination notice, legal opinion, and trap briefs.
- Checklist for each brief, written before any draft exists.
- Baseline: the same briefs given to a plain chat AI in one shot (no DifAi flow), scored blind by a separate reviewer agent.
- DraftBotPro: scored the same way if the user supplies its drafts (`benchmark-h2h/draftbotpro/`).

**Impact map:** test data in the scratchpad and `benchmark-h2h/`, local database only, matters removed afterwards.

**Acceptance**
- At least 90% of checklist items met overall, and clearly above the plain-AI baseline.
- 0 invented facts, 0 invented judgments, 0 wrong format picks.
- Reviewer agent, acting as a senior Tamil Nadu advocate and scoring blind, marks each draft "reads like an advocate's draft": at least 90% yes, with reasons for every no.
- Results recorded in `TESTING.md`, with failures fixed at the root and re-run.
