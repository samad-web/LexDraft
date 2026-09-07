// =============================================================================
// drafting-prompts — the four-stage prompt builders for AI-assisted drafting.
//
// WHY FOUR STAGES (read before touching these):
// A single "read this and draft the document" call WILL invent a section number
// to fill an empty slot — that is malpractice in a legal product. So we split the
// job so that the stage which TOUCHES LAW can only choose from the offence KB, and
// the stage which WRITES PROSE is handed the law as fixed input it may not alter.
//
//   Stage 1  EXTRACT   free text/voice  -> structured facts (+ what's missing)
//   Stage 2  CLASSIFY  facts + KB slice -> chosen offence ids (KB-grounded ONLY)
//   Stage 3  DRAFT     facts + sections + skeleton -> the document prose
//   Stage 4  VERIFY    draft + allowed sections -> pass/flag report
//
// Each builder returns { system, user } and expects JSON-only replies, matching
// draft-extract.service.ts. These are PURE string builders — no LLM calls, no I/O
// — so they are unit-testable and reused by the drafting services.
//
// GROUNDING CONTRACT: Stage 2 is given a candidate list retrieved from
// offence-kb.json and may return ONLY ids from that list. Stage 3 is given the
// resolved sections and may NOT output any section not in that set. Stage 4
// re-checks the draft against the same set. The offence-kb `verification` gate
// still applies downstream: a section that is not `verified` is rendered as a
// suggestion, never a hard citation — see offence-kb.types.ts.
// =============================================================================

export interface StagePrompt {
  system: string;
  user: string;
}

// Shared caps so one runaway input can't blow the context / cost budget.
const MAX_BRIEF_CHARS = 40_000;
const MAX_FACTS_CHARS = 20_000;
const MAX_DRAFT_CHARS = 60_000;

// ---------------------------------------------------------------------------
// STAGE 1 — EXTRACT
// Turn the advocate's free-form brief (typed, or voice already transcribed +
// term-corrected) into structured facts, and NAME what is missing rather than
// filling gaps. The "needs_clarification" list is what the UI turns into
// follow-up questions instead of letting the model guess.
// ---------------------------------------------------------------------------

export interface ExtractStageInput {
  /** Document type slug, e.g. "anticipatory_bail". */
  docType: string;
  /** The required field keys for this doc type (from the skeleton). */
  requiredFields: string[];
  /** The advocate's brief — typed text or corrected transcript. */
  brief: string;
}

export function buildExtractStage(input: ExtractStageInput): StagePrompt {
  const system = `You are assisting an Indian advocate. Extract the FACTS of a case for the document type "${input.docType}" from the advocate's free-form brief (typed or dictated).

Output ONLY a JSON object — no prose, no markdown fence — of this exact shape:
{
  "parties": { "applicant": string|null, "respondent": string|null, "others": string[] },
  "case_refs": { "fir_no": string|null, "police_station": string|null, "court": string|null, "case_no": string|null },
  "dates": [ { "what": string, "date": "YYYY-MM-DD"|null, "as_stated": string } ],
  "alleged_offences": string[],
  "relief_sought": string|null,
  "facts_narrative": string,
  "needs_clarification": string[]
}

Rules:
- NEVER invent names, dates, FIR/case numbers, amounts, sections, or facts not present in the brief. If unknown, use null (or omit from arrays).
- "alleged_offences" = the offence(s) in the advocate's OWN plain words (e.g. "cheating", "grievous hurt"). Do NOT output section numbers here — that is a later stage's job.
- "facts_narrative" = a faithful, chronological restatement of what happened, in neutral formal English. Add nothing that is not in the brief.
- "dates": put the raw phrasing in "as_stated" (e.g. "last Tuesday", "5th of August"); set "date" to YYYY-MM-DD only when unambiguous, else null.
- "needs_clarification" = leave this an EMPTY array in almost all cases. We DRAFT from whatever the advocate gave us and leave missing facts as [bracketed blanks] in the document — we do NOT interrogate the advocate before drafting. Only add an item here if the brief is so empty that no document could be drafted at all (e.g. a single unrelated word). A brief that names an offence or a party is ALWAYS enough to draft.
- Do not editorialise, do not assess guilt, do not suggest strategy.`;

  const user = `# Advocate's brief\n${input.brief.slice(0, MAX_BRIEF_CHARS)}`;
  return { system, user };
}

// ---------------------------------------------------------------------------
// STAGE 2 — CLASSIFY (KB-grounded; this is the anti-hallucination core)
// Given the extracted facts and a CANDIDATE list retrieved from offence-kb.json,
// the model may pick ONLY from that list. It also checks the facts against each
// candidate's essential ingredients — the senior-advocate move — so a wrong
// section gets flagged, not silently drafted.
// ---------------------------------------------------------------------------

/** The subset of an offence-kb entry we expose to the classifier. */
export interface OffenceCandidate {
  id: string;
  offenceName: string;
  law: string;
  section: string;
  sectionTitle: string;
  essentialIngredients: string[];
  commonlyConfusedWith: string[];
}

export interface ClassifyStageInput {
  /** The Stage-1 JSON, re-serialised (facts_narrative + alleged_offences etc.). */
  factsJson: string;
  /** Candidates retrieved from the KB by alias/keyword/vector match. */
  candidates: OffenceCandidate[];
}

export function buildClassifyStage(input: ClassifyStageInput): StagePrompt {
  const system = `You are an Indian criminal-law classifier. Map the case FACTS to the correct offence section(s) — but ONLY by selecting from the CANDIDATE list you are given. You are working under the new codes (BNS/BNSS/BSA), not the repealed IPC/CrPC.

Output ONLY a JSON object — no prose, no markdown fence — of this exact shape:
{
  "selected": [
    {
      "id": string,               // MUST be an id from the candidate list
      "confidence": "high"|"medium"|"low",
      "ingredients_met": string[],    // ingredients the facts DO satisfy
      "ingredients_missing": string[],// ingredients the facts do NOT establish
      "why": string               // one sentence tying facts to this section
    }
  ],
  "consider_instead": [ { "id": string, "reason": string } ],  // from candidates' commonlyConfusedWith
  "unresolved": string[]          // alleged offences with NO matching candidate
}

Rules:
- The "id" in "selected" and "consider_instead" MUST be one of the candidate ids provided. NEVER output a section number or id that is not in the candidate list. If nothing fits, leave "selected" empty and list the offence in "unresolved".
- For each selection, test the facts against that candidate's essentialIngredients. If a key ingredient is not established by the facts, put it in "ingredients_missing" and lower the confidence.
- If an ingredient gap points at a different candidate (e.g. entrustment-then-dishonesty suggests criminal breach of trust rather than cheating), add that candidate to "consider_instead" with a reason.
- In "why", tie a SPECIFIC FACT to the ingredient it satisfies (e.g. "the accused received Rs. X on a promise he never intended to keep → dishonest inducement"), not a bare restatement of the offence name. Reason from the fact to the section, not from the section back to the facts.
- Do not assert guilt. You are identifying the section that the pleaded facts attract, for the advocate to confirm.`;

  const candidateBlock = input.candidates
    .map(
      (c) =>
        `- id: ${c.id}\n  offence: ${c.offenceName} (${c.law} ${c.section} — ${c.sectionTitle})\n  ingredients: ${c.essentialIngredients.join(' | ')}\n  confused_with: ${c.commonlyConfusedWith.join(', ') || '(none)'}`,
    )
    .join('\n');

  const user = `# Candidate offences (choose ONLY from these ids)\n${candidateBlock}\n\n# Case facts\n${input.factsJson.slice(0, MAX_FACTS_CHARS)}`;
  return { system, user };
}

// ---------------------------------------------------------------------------
// STAGE 3 — DRAFT
// Fill only the AI-generated blocks of the skeleton (facts/grounds/prayer),
// using the resolved sections as FIXED input. Static blocks are assembled by the
// engine, not here — so the model can't rewrite the cause-title or verification.
// ---------------------------------------------------------------------------

/** A section the engine has resolved and cleared for this draft. */
export interface ResolvedSection {
  /** How to render it, e.g. "BNS 318(4)". */
  citation: string;
  offenceName: string;
  /** Whether it may be stated as a hard citation or only as a suggestion. */
  verified: boolean;
}

/** One AI-generated block the skeleton wants written. */
export interface DraftBlockSpec {
  /** Block key, e.g. "facts", "grounds", "prayer". */
  block: string;
  /** The skeleton's instruction for this block. */
  instruction: string;
}

export interface DraftStageInput {
  docType: string;
  /** Forum, for register/formality, e.g. "Court of Session". */
  forum: string;
  /** Stage-1 facts JSON. */
  factsJson: string;
  /** Sections cleared by Stage 2 + the verification gate. */
  sections: ResolvedSection[];
  /** The blocks to write, in order. */
  blocks: DraftBlockSpec[];
  /** The advocate's own format to draft INTO (their house style / clause order
   *  / [placeholders]). When present, follow this structure instead of the
   *  default skeleton, filling it with grounded content. */
  templateFormat?: string;
}

/**
 * Document-type-specific drafting craft, appended to the DRAFT system prompt.
 * The generic grounds/prayer rules above are strong for a bail application; a
 * quashing petition or an exemption application argue differently and a senior
 * advocate's draft reflects that. Keep each block tight — a handful of the
 * distinctions that actually change how the document reads. Matched loosely on
 * the doc-type name so aliases ("Regular Bail", "Bail Application") all hit.
 */
function docTypeConventions(docType: string): string {
  const t = docType.toLowerCase();
  const lines: string[] = [];

  if (/anticipatory/.test(t)) {
    lines.push(
      'Anticipatory bail: establish a REASONABLE APPREHENSION of arrest first (the FIR/accusation and why arrest is imminent) — without it the application is premature. Argue that custodial interrogation is not required (documentary case / cooperation shown), address the triple test, and frame the prayer as a DIRECTION that in the event of arrest the applicant be released on bail, not as release simpliciter.',
    );
  } else if (/bail/.test(t)) {
    lines.push(
      'Regular bail: open the grounds from the record — period already in custody, whether the charge-sheet is filed (so custodial interrogation is complete), and the maximum sentence the offence carries relative to time served. State plainly whether this is a first or successive application; if successive, the change in circumstances is itself a ground. Offer concrete conditions the applicant will accept (surety, passport surrender, reporting) rather than bare assurances.',
    );
  }

  if (/exemption|personal appearance|attendance/.test(t)) {
    lines.push(
      'Exemption from personal appearance: the application turns on TWO things the court must see — (1) that the accused is represented by an advocate, and (2) a concrete reason attendance is not necessary in the interests of justice on the specific date(s) (illness, distance, hardship). Confine the prayer to the identified hearing date(s); never seek an open-ended blanket exemption. Include the standard undertaking that the accused will appear whenever the court directs and does not dispute identity.',
    );
  }

  if (/quash/.test(t)) {
    lines.push(
      'Quashing petition: plead the inherent-jurisdiction threshold — that no prima facie offence is made out on the FIR/complaint taken at its highest, or that continuance is an abuse of process. Argue on the FOUR CORNERS of the FIR/complaint as they stand; do not invite a mini-trial on disputed facts. Where the matter is compoundable or settled, plead the settlement and the futility of continuance as a distinct ground.',
    );
  }

  // Affidavit voice guidance. LABEL-BASED and best-effort only: this runs in the
  // model DRAFT stage, which never sees the engine's matter_type — so an affidavit
  // in a s.138 matter is recognised only by its docType label carrying "affidavit".
  // Real enforcement of the s.138 window rules is engine-side (the affidavit
  // pipeline). This branch is if/else paired with the §138-notice branch below so a
  // label mentioning BOTH ("Affidavit under s.138") takes the affidavit line, NOT
  // the notice line — otherwise the model drafts a demand notice in affidavit
  // clothing (second person, addressed to the accused).
  //
  // NOTE for anyone tempted to add a post-hoc second-person check: it was considered
  // and REJECTED. An affidavit legitimately recites the notice ("the said notice
  // called upon you to pay ...") — a correct recital and an erroneous deponent-voice
  // sentence are textually identical, and recited second person cannot be reliably
  // delimited in free-form prose. Voice guidance at generation time (here) is the
  // safe lever; a regex refusal would fire on correct affidavits.
  if (/affidavit/.test(t)) {
    lines.push(
      'Affidavit: write in the FIRST PERSON — the deponent speaks ("I, the deponent, state that..."). Refer to the opposite party in the THIRD person (the accused / the respondent / the defendant), never in the second person and never as "my client". Do NOT address anyone directly: an affidavit is a sworn statement of facts, not a letter or a notice. The only place second person may appear is when the affidavit RECITES another document\'s words (e.g. quoting the demand the notice made). No letterhead, no addressee block, and no advocate sign-off block — an affidavit closes with the deponent\'s verification and the attestation, not "Yours faithfully".',
    );
  } else if (/notice.*138|138.*notice|cheque/.test(t)) {
    lines.push(
      'Section 138 notice: the statutory limbs must all appear — the cheque particulars, its presentation within validity, the return memo and its date, the demand for the exact cheque amount, and the fifteen-day period running from receipt. The notice must demand the cheque sum specifically; a vague demand defeats the cause of action.',
    );
  }

  if (lines.length === 0) return '';
  return `\n\nDocument-specific drafting (for a ${docType}):\n- ${lines.join('\n- ')}`;
}

export function buildDraftStage(input: DraftStageInput): StagePrompt {
  const verified = input.sections.filter((s) => s.verified);
  const suggested = input.sections.filter((s) => !s.verified);

  const system = `You are drafting parts of an Indian legal document ("${input.docType}") for filing before the ${input.forum}. Write in formal Indian legal English (the register used in pleadings), first-person on behalf of the client where appropriate.

Output ONLY a JSON object — no prose, no markdown fence — mapping each requested block key to its drafted text:
{ "<block_key>": "<drafted text>", ... }

Rules on SECTIONS (strict):
- You may cite ONLY the sections listed below. NEVER introduce any other section number, Act, or case citation.
- Sections marked VERIFIED may be stated as fact (e.g. "an offence punishable under BNS 318(4)").
- Sections marked SUGGESTED are not yet counsel-confirmed: refer to them hedged (e.g. "the alleged offence, which may attract BNS 316(2), subject to counsel's confirmation"). Do not present a SUGGESTED section as settled.
- If no section is listed for a point, write the point WITHOUT a citation rather than inventing one.

Rules on FACTS:
- Use only facts from the provided facts JSON. Do not add events, admissions, or particulars that are not there. Where a required particular is absent, write the exact literal [to be drafted] and nothing else — do NOT name the missing item inside the brackets, do NOT use any descriptive variant. The only permitted placeholder is the exact string [to be drafted].
- Keep each block to its instruction. Do not write blocks you were not asked for. Do not output the cause-title, party memo, or verification — those are assembled separately.

Rules on GROUNDS and PRAYER (where such a block is requested):
- Grounds: number them; each ground is ONE self-standing proposition (opening with "That") the court could accept on its own — never bundle two points into one ground. TEST for bundling: if a ground cannot be summarised in five words or fewer, it is doing two jobs — split it. Order them strongest-and-most-objective first: grounds resting on the record or on facts the opponent cannot dispute come before grounds that depend on inference, and any ground resting purely on a legal principle comes last.
- Each ground must close a specific objection a court would raise (flight risk, tampering, gravity, antecedents, stage of investigation, etc.). Before writing a ground, know which objection it defeats and which fact defeats it; a ground with no identifiable objection behind it is filler — omit it. State the verifiable fact as the basis (e.g. "the charge-sheet has been filed, so custodial interrogation is complete"), never a character assurance ("he would not tamper").
- Facts vs grounds: the facts block narrates and does not argue; the grounds block argues. Do not smuggle argument words ("illegal", "malafide", "therefore") into the facts block, and do not restate the raw narrative in the grounds block.
- Prayer: every relief sought must correspond to a ground actually pleaded and must be within the power of THIS forum (${input.forum}) to grant. Do not pray for relief this forum cannot give.
- Neutral, respectful tone toward the court ("It is respectfully submitted that..."). No rhetoric, no assertions of fact about the merits beyond what the brief supports.${docTypeConventions(input.docType)}`;

  const sectionBlock =
    [
      ...verified.map((s) => `- VERIFIED   ${s.citation} — ${s.offenceName}`),
      ...suggested.map((s) => `- SUGGESTED  ${s.citation} — ${s.offenceName} (counsel to confirm)`),
    ].join('\n') || '- (no sections resolved — draft without citations)';

  const blockBlock = input.blocks
    .map((b) => `- ${b.block}: ${b.instruction}`)
    .join('\n');

  // When the advocate supplied their own format, instruct the model to follow
  // that structure/house-style and fill it — while STILL obeying the section
  // and fact rules above (the format governs form, not the law or the facts).
  const templateBlock = input.templateFormat?.trim()
    ? `\n\n# Firm format to follow (the advocate's house style)\n` +
      `Draft each block so that, when assembled, it matches the STRUCTURE, clause order, ` +
      `headings and wording style of the format below. Preserve its [placeholders] where a ` +
      `particular is not in the facts. Do NOT copy any citation or fact from the format that ` +
      `the case facts/sections above do not support — the format governs FORM, not the law or facts.\n` +
      `--- FORMAT START ---\n${input.templateFormat.slice(0, 12_000)}\n--- FORMAT END ---`
    : '';

  const user = `# Sections you may cite\n${sectionBlock}\n\n# Blocks to write (write each one)\n${blockBlock}${templateBlock}\n\n# Case facts (JSON)\n${input.factsJson.slice(0, MAX_FACTS_CHARS)}`;
  return { system, user };
}

// ---------------------------------------------------------------------------
// STAGE 4 — VERIFY (self-check before the draft reaches the advocate)
// Re-reads the generated draft against the ONLY-allowed section set and the
// source facts, and reports violations. This is a guard, not a rewrite: it emits
// a report the engine acts on (block for review / strip citation / warn).
// ---------------------------------------------------------------------------

export interface VerifyStageInput {
  /** The assembled draft (or the AI blocks) to audit. */
  draftText: string;
  /** The citations that were allowed for this draft, e.g. ["BNS 318(4)"]. */
  allowedCitations: string[];
  /** Stage-1 facts JSON, to catch fabricated particulars. */
  factsJson: string;
}

export function buildVerifyStage(input: VerifyStageInput): StagePrompt {
  const system = `You are an auditor for an AI-drafted Indian legal document. Do NOT rewrite it. Find violations and report them.

Output ONLY a JSON object — no prose, no markdown fence — of this exact shape:
{
  "pass": boolean,
  "unauthorised_citations": string[],   // any section/Act cited in the draft but NOT in the allowed list
  "unsupported_facts": string[],        // NEW FACTUAL assertions not backed by the facts JSON (see rule)
  "placeholders_remaining": string[],   // bracketed "[...]" gaps still to be filled
  "old_law_references": string[],       // any IPC/CrPC/Evidence-Act reference (should be BNS/BNSS/BSA)
  "notes": string
}

Rules:
- "pass" is true ONLY when unauthorised_citations, unsupported_facts, and old_law_references are ALL empty. Remaining placeholders alone do not fail the audit (they are expected gaps) but must be listed.
- Scan for ANY section number or statute name in the draft. If it is not in the allowed list (exact citation match), report it under unauthorised_citations.
- Flag any reference to IPC, CrPC, or Indian Evidence Act (repealed) under old_law_references, even if the number happens to be right.
- "unsupported_facts" means NEW FACTUAL PARTICULARS invented in the draft — a date, name, amount, place, or event that is not in the facts JSON. It does NOT mean legal argument, characterisation, or relief. Grounds and prayer are ADVOCACY: submissions such as "the applicant has deep roots and poses no flight risk", "does not warrant further custodial detention", "undertakes not to tamper with evidence", or "the offence is punishable under <allowed section>" are legitimate legal submissions, NOT unsupported facts — do not list them. Only flag a grounds/prayer statement if it asserts a concrete NEW FACT (e.g. a specific prior acquittal, a surety's name, a date) that the facts JSON does not contain.
- Be strict about invented particulars, but do not penalise a draft for arguing its case. When unsure whether something is a new factual particular versus a legal submission, treat a bare argument/characterisation as supported (do not list it) and list only concrete invented particulars.
- Also flag under "unsupported_facts" any statement that asserts the client's INNOCENCE as established fact rather than as the client's position (e.g. "the applicant is innocent" or "the case is false/baseless" stated flatly). A proper draft says the client "denies the allegations and submits...". This is a misrepresentation guard, not an argument-suppression rule: "it is submitted that no offence is made out" is legitimate advocacy and must NOT be flagged.`;

  const user = `# Allowed citations (exact)\n${input.allowedCitations.map((c) => `- ${c}`).join('\n') || '- (none — draft should contain NO citations)'}\n\n# Source facts (JSON)\n${input.factsJson.slice(0, MAX_FACTS_CHARS)}\n\n# Draft to audit\n${input.draftText.slice(0, MAX_DRAFT_CHARS)}`;
  return { system, user };
}
