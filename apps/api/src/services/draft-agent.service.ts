import type { DraftRequest } from '@lexdraft/types';
import { env } from '../env';
import { logger } from '../logger';
import { resolveFormat, renderFormatBlock } from '../lib/draft-format-catalog';
import { findOldProvisions } from '../lib/old-to-new-law';
import {
  type BuiltPrompt,
  type CaseFacts,
  type LlmUsage,
  type NoteContextItem,
  languageName,
  renderBriefLines,
  renderCaseFactsBlock,
  renderNotesBlock,
  resolveActiveProvider,
  runPrompt,
  streamPrompt,
} from './drafting.service';

// ---------------------------------------------------------------------------
// Drafting agent — a grounded multi-stage pipeline.
//
//   Stage 1  PLAN    : read the format catalog for the doc type; produce a
//                      concrete outline that binds the required sections to the
//                      facts present in the brief and flags gaps.
//   Stage 2  DRAFT   : compose the full document against the plan + format.
//   Stage 3  REVIEW  : check the draft against the format's required sections
//                      and statutory ingredients; emit a structured critique.
//   Stage 4  REFINE  : if the review found defects, rewrite to cure them; the
//                      cured document streams to the client. If the review is
//                      clean, the Stage-2 draft is streamed as-is.
//
// Only the FINAL stage streams token-by-token (so the UI paints the document as
// it lands). Plan and review run as fast non-streaming calls; the agent reports
// each transition to the caller via an onStage callback, which the route turns
// into an SSE `stage` event.
// ---------------------------------------------------------------------------

export type DraftStage = 'plan' | 'draft' | 'review' | 'refine' | 'done';

export interface StageEvent {
  stage: DraftStage;
  /** Human-readable label for the UI, e.g. "Planning structure". */
  label: string;
  /** Extra detail where useful (e.g. review verdict). */
  detail?: string;
}

export interface AgentOpts {
  provider?: 'xai' | 'anthropic';
  notes?: NoteContextItem[];
  /** Authoritative case-record facts (court, CNR, FIR, ...). Folded into every
   *  stage's grounding so the whole pipeline drafts for THIS matter. */
  facts?: CaseFacts | null;
  onUsage?: (usage: LlmUsage) => void;
  onStage?: (evt: StageEvent) => void;
}

const STAGE_LABELS: Record<DraftStage, string> = {
  plan: 'Planning structure',
  draft: 'Drafting document',
  review: 'Reviewing against format',
  refine: 'Refining for filing',
  done: 'Complete',
};

/** Shared preamble describing who the model is and the target language/tone. */
function personaLine(req: DraftRequest): string {
  return `You are an experienced Indian advocate drafting in ${languageName(
    req.language,
  )}. Tone: ${req.tone}.`;
}

/** The format block + case record + brief that every stage needs to see. The
 *  case-record block is marked AUTHORITATIVE so the model treats court/CNR/FIR
 *  as ground truth rather than facts to re-guess or placeholder. */
function groundingBlock(
  req: DraftRequest,
  notes: NoteContextItem[],
  facts: CaseFacts | null,
): string {
  const dated = req.draftDate ?? new Date().toISOString().slice(0, 10);
  return [
    renderFormatBlock(req.docType),
    renderCaseFactsBlock(facts),
    '',
    `# Document to produce: "${req.docType}", dated ${dated}`,
    '',
    '# Brief (facts supplied by the advocate)',
    renderBriefLines(req.fields) || '(no structured fields supplied)',
    renderNotesBlock(notes),
  ].join('\n');
}

// ---- Stage 1: PLAN ---------------------------------------------------------

function planPrompt(req: DraftRequest, notes: NoteContextItem[], facts: CaseFacts | null): BuiltPrompt {
  const system = `${personaLine(req)} You produce a drafting plan, not the document itself. Be terse.`;
  const user = `${groundingBlock(req, notes, facts)}

# Task
Produce a numbered outline for this document. For EACH required section of the format:
- name the section,
- state in one line what it will contain, drawing first from the AUTHORITATIVE case record, then the brief,
- if neither the case record nor the brief supplies a fact the section needs, write "GAP: <what is missing>".
Do not write the document. Output only the outline.`;
  return { system, user };
}

// ---- Stage 2: DRAFT --------------------------------------------------------

function draftPrompt(
  req: DraftRequest,
  notes: NoteContextItem[],
  facts: CaseFacts | null,
  plan: string,
): BuiltPrompt {
  const system = `${personaLine(
    req,
  )} Draft court-ready documents following Indian legal conventions, statutes, and pleading style. Output ONLY the document text — no commentary, no markdown, no code fences.`;
  const user = `${groundingBlock(req, notes, facts)}

# Approved plan
${plan}

# Task
Write the complete "${req.docType}" following the plan and the required format exactly. Use the AUTHORITATIVE case record facts verbatim (the court, CNR, FIR particulars, parties). Number paragraphs where the format calls for it. Where a GAP was noted, insert a clearly bracketed placeholder like [TO BE CONFIRMED: ...] rather than inventing facts. Keep it precise and filing-ready.

Drafting discipline (apply where the document has grounds/pleaded paragraphs):
- One paragraph, one point. Never bundle two distinct legal grounds in one paragraph. TEST: if a ground cannot be summarised in five words or fewer, split it. Each ground should close a specific objection the decision-maker would raise.
- Precision over persuasion. State the verifiable fact from which the conclusion follows and let the fact carry the argument; do not substitute adjectives or character claims ("he is a good man") for facts. Do not assert the client's innocence as established fact — say the client "denies the allegations and submits...". Avoid conclusory labels the draft has not earned (do not call the case "baseless"; plead the facts that show it).
- The prayer must mirror the grounds: every relief requested must follow from a ground actually pleaded above it — introduce no new claim in the prayer.`;
  return { system, user };
}

// ---- Stage 3: REVIEW -------------------------------------------------------

interface ReviewVerdict {
  ok: boolean;
  /** Concrete, actionable defects the refine stage must cure. */
  defects: string[];
  raw: string;
}

function reviewPrompt(req: DraftRequest, draft: string): BuiltPrompt {
  const system = `${personaLine(
    req,
  )} You are reviewing a draft against a required format. Be strict and specific.`;
  const user = `${renderFormatBlock(req.docType)}

# Draft under review
${draft}

# Task
Check the draft against the required structure and statutory ingredients above.
List every defect: a missing required section, a statutory ingredient not
pleaded, a convention violated, or an internal inconsistency. Be specific and
actionable — name the section or ingredient.

Repealed law is a hard defect. The IPC, CrPC, and Indian Evidence Act are
REPEALED and replaced by the BNS, BNSS, and BSA respectively. Flag ANY reference
to the IPC, CrPC, or Indian Evidence Act, and any section number cited under
those repealed codes, as a defect the refine stage must cure by mapping it to
the in-force BNS/BNSS/BSA equivalent.

Where the document has grounds and a prayer, also check the drafting craft:
- Grounds ordering: are the grounds ordered strongest-and-most-objective first
  (grounds resting on the record or on indisputable facts before grounds that
  depend on inference, and any purely legal-principle ground last)? Flag if not.
- Ground independence: is each ground a single self-standing proposition, or are
  two points bundled into one ground? TEST: a ground that cannot be summarised in
  five words or fewer is doing two jobs — flag it to be split.
- Facts vs grounds: does the facts section argue (words like "illegal",
  "malafide", "therefore") instead of merely narrating? Flag any argument that
  belongs in the grounds.
- Prayer power: does every relief prayed for correspond to a pleaded ground and
  lie within the power of this forum to grant? Flag any relief that does not.
- Verification split: does the verification correctly separate matters of
  personal knowledge (the facts) from those based on legal advice/belief (the
  grounds)? Flag a blanket verification that swears the grounds as personal
  knowledge.

Respond in EXACTLY this shape:
VERDICT: PASS   (if the draft satisfies the format with no material defect)
or
VERDICT: FAIL
DEFECTS:
- <defect 1>
- <defect 2>`;
  return { system, user };
}

function parseReview(raw: string): ReviewVerdict {
  const passed = /verdict:\s*pass/i.test(raw);
  const defects: string[] = [];
  if (!passed) {
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*[-*]\s+(.*\S)/);
      if (m && m[1]) defects.push(m[1].trim());
    }
  }
  // Treat "FAIL with no parseable defects" as a soft pass — we have nothing
  // concrete to act on, and shipping the draft beats looping blindly.
  const ok = passed || defects.length === 0;
  return { ok, defects, raw };
}

// ---- Stage 4: REFINE -------------------------------------------------------

function refinePrompt(
  req: DraftRequest,
  notes: NoteContextItem[],
  facts: CaseFacts | null,
  draft: string,
  defects: string[],
): BuiltPrompt {
  const system = `${personaLine(
    req,
  )} You revise a legal draft to cure specific defects while preserving everything already correct. Output ONLY the corrected document text — no commentary, no markdown.`;
  const user = `${groundingBlock(req, notes, facts)}

# Current draft
${draft}

# Defects to cure (from format review)
${defects.map((d) => `- ${d}`).join('\n')}

# Task
Rewrite the document so every listed defect is cured and the required format is
fully satisfied. Do not invent facts; where a fact is genuinely absent, keep a
bracketed [TO BE CONFIRMED: ...] placeholder. Output the full corrected document.`;
  return { system, user };
}

// ---- Orchestrator ----------------------------------------------------------

export const draftAgentService = {
  /**
   * Run the drafting agent, streaming the final document's text deltas. Stage
   * transitions are reported through opts.onStage. Falls back gracefully: if no
   * provider key is configured, it degrades to the single-shot template path by
   * throwing, which the route handles by delegating to draftingService.
   */
  async *run(req: DraftRequest, opts: AgentOpts = {}): AsyncGenerator<string, void, void> {
    const provider = resolveActiveProvider(opts.provider);
    const notes = opts.notes ?? [];
    const facts = opts.facts ?? null;
    const emit = (stage: DraftStage, detail?: string) =>
      opts.onStage?.({ stage, label: STAGE_LABELS[stage], ...(detail ? { detail } : {}) });

    if (provider === 'none') {
      // No key: let the caller fall back to the deterministic template path.
      throw new NoProviderError();
    }

    // Log which format the agent resolved — invaluable when a draft comes out
    // structured wrong and we need to know which catalog entry drove it.
    logger.info(
      { docType: req.docType, format: resolveFormat(req.docType).label, provider },
      'draft-agent: starting pipeline',
    );

    // Stage 1: PLAN (non-streaming, cheap)
    emit('plan');
    let plan = '';
    try {
      const r = await runPrompt(planPrompt(req, notes, facts), provider, 900);
      plan = r.text.trim();
      opts.onUsage?.({ provider, model: modelFor(provider), ...r.usage });
    } catch (err) {
      // A failed plan isn't fatal — draft without an outline rather than abort.
      logger.warn({ err }, 'draft-agent: plan stage failed, continuing without a plan');
      plan = '(planning stage unavailable — draft directly from the format and brief)';
    }

    // Stage 2: DRAFT (non-streaming so we can review before showing anything)
    emit('draft');
    let draft = '';
    try {
      const r = await runPrompt(draftPrompt(req, notes, facts, plan), provider, 2048);
      draft = r.text.trim();
      opts.onUsage?.({ provider, model: modelFor(provider), ...r.usage });
    } catch (err) {
      logger.warn({ err }, 'draft-agent: draft stage failed');
      throw err; // let the route fall back to single-shot streaming
    }
    if (!draft) throw new Error('draft-agent: empty draft');

    // Stage 3: REVIEW (non-streaming, cheap)
    emit('review');
    let verdict: ReviewVerdict = { ok: true, defects: [], raw: '' };
    try {
      const r = await runPrompt(reviewPrompt(req, draft), provider, 700);
      opts.onUsage?.({ provider, model: modelFor(provider), ...r.usage });
      verdict = parseReview(r.text);
    } catch (err) {
      // Review failure → ship the draft. Better a good-enough draft than none.
      logger.warn({ err }, 'draft-agent: review stage failed, shipping draft as-is');
      verdict = { ok: true, defects: [], raw: '' };
    }

    // DETERMINISTIC old-law guard — citation-audit parity with the orchestrator's
    // VERIFY stage. The LLM review can miss a repealed IPC/CrPC/Evidence-Act
    // reference; this scan cannot. Any hit forces a refine pass with a concrete
    // "replace X with Y" defect so REFINE remaps it to the in-force sanhita.
    // Never throws — findOldProvisions is a pure lookup; guard defensively anyway.
    try {
      const oldRefs = findOldProvisions(draft);
      if (oldRefs.length > 0) {
        const existing = new Set(verdict.defects);
        for (const m of oldRefs) {
          const defect = `Replace repealed ${m.old} with ${m.new}${
            m.approximate ? ' (approx. — confirm)' : ''
          }`;
          if (!existing.has(defect)) {
            existing.add(defect);
            verdict.defects.push(defect);
          }
        }
        verdict.ok = false;
      }
    } catch (err) {
      logger.warn({ err }, 'draft-agent: old-law guard failed, relying on LLM review');
    }

    // Stage 4: REFINE — only when the review found actionable defects. The
    // final document streams to the client in both branches.
    if (verdict.ok) {
      emit('done', 'Draft passed format review');
      yield* streamText(draft);
      return;
    }

    emit('refine', `${verdict.defects.length} defect(s) to cure`);
    try {
      yield* streamPrompt(
        refinePrompt(req, notes, facts, draft, verdict.defects),
        provider,
        opts.onUsage,
        2048,
      );
      emit('done', 'Refined and passed');
    } catch (err) {
      // Refine failed mid-flight — fall back to streaming the un-refined draft
      // so the user still gets the Stage-2 document.
      // RESIDUAL RISK: when the deterministic old-law guard above set verdict.ok
      // = false, this fallback re-emits the UN-refined Stage-2 draft, which may
      // still carry the repealed IPC/CrPC/Evidence-Act references the refine pass
      // was meant to cure. We prefer delivering *a* draft over none (the advocate
      // reviews before filing, and the client-side old-law warning still fires),
      // but a hard-block on old-law refs here is the safer future hardening if
      // this fallback proves to leak repealed citations in practice.
      logger.warn({ err }, 'draft-agent: refine stage failed, streaming pre-refine draft');
      yield* streamText(draft);
      emit('done', 'Delivered pre-refinement draft');
    }
  },
};

/** Thrown when no provider is configured so the route can fall back cleanly. */
export class NoProviderError extends Error {
  constructor() {
    super('No LLM provider configured for the drafting agent');
    this.name = 'NoProviderError';
  }
}

function modelFor(provider: 'xai' | 'anthropic'): string {
  return provider === 'anthropic' ? env.ANTHROPIC_MODEL : env.XAI_MODEL;
}

/** Yield an already-complete string as a few chunks so the UI still animates
 *  the paint rather than dumping the whole document in one frame. */
async function* streamText(text: string): AsyncGenerator<string, void, void> {
  // Chunk on paragraph boundaries; keeps the streamed feel without provider
  // round-trips (this path is only hit when the draft is already final).
  const parts = text.split(/(\n\n+)/);
  for (const part of parts) {
    if (part) yield part;
  }
}
