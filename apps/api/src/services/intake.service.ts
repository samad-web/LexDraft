// =============================================================================
// intake.service — the conversational fact-gathering LOOP orchestrator.
//
// See docs/conversational-intake-plan.md. The contract, in one line:
//   the ENGINE decides which questions get asked and whether the matter is sound;
//   the MODEL only extracts prose into fields and phrases the engine's questions.
//
// Each turn runs the full cycle:
//   EXTRACT (model)  -> field patch with confidence/provenance
//   MERGE            -> into the fact map; contradictions surfaced, not overwritten
//   REVISE           -> commit as the next immutable fact-sheet version
//   DRAFT (engine)   -> 422 issues | refused (finding) | generated (done)
//   PHRASE (model)   -> the 422 issues as 1-2 natural questions (skipped while
//                       a refusal stands: keep listening, stop interrogating)
//
// State lives in the versioned fact sheet (Node-owned, engine stays stateless):
//   facts_json = { <form field values>, __intakeMeta, __docLabel, __transcript,
//                  __askCounts }.
// The reserved __ keys never reach the engine — the field map only reads the
// document's own form keys, so meta/transcript ride along in storage but are
// stripped from what we send. This reuses the fact sheet's immutability +
// sign-off staleness for free: a correction is just another revise.
// =============================================================================

import type {
  FactSheetField,
  FactSheetSection,
  FieldMeta,
  IntakeDraft,
  IntakeIssue,
  IntakeRefusal,
  IntakeState,
  IntakeTurn,
  PhrasedQuestion,
} from '@lexdraft/types';
import { logger } from '../logger';
import { factSheetService, type Ctx } from './factsheet.service';
import {
  engineClient,
  EngineValidationError,
  EngineDisabledError,
  type EngineDraftResult,
} from './engine-client.service';
import { mapFormToEngine, LABEL_TO_ENGINE_DOC, isRoutable } from '../lib/engine-field-map';
import { intakeLlm, type IntakeFieldSpec } from './intake-llm.service';
import { intakeCompose } from './intake-compose.service';
import { extractDeterministic } from './intake-extract-rules.service';
import { extractText } from '../lib/text-extraction';
import { ocrImage } from '../lib/image-ocr';
import { env } from '../env';
import {
  intakeDocConfig,
  formKeyForEngineKey,
  intakeSectionsFromDescribe,
  type IntakeSectionSpec,
  type EngineDescribe,
} from '../lib/intake-doc-config';
import { aiUsageService } from './ai-usage.service';

// Reserved keys stored in facts_json but never part of the engine form.
const K_META = '__intakeMeta';
const K_LABEL = '__docLabel';
const K_TRANSCRIPT = '__transcript';
const K_ASKS = '__askCounts';
const K_PENDING = '__pending';
const K_SOURCE = '__sourceText';
const RESERVED = new Set([K_META, K_LABEL, K_TRANSCRIPT, K_ASKS, K_PENDING, K_SOURCE]);

/** How many times a single field may be asked conversationally before we fall
 *  back to a typed micro-form control (§5.2 guard; §12 open for review). */
const ASK_LIMIT = 2;
/** Questions asked per turn — the THREE most important missing fields, so an
 *  advocate who named only the document (or gave little) is asked for the
 *  essentials first, in one go, rather than a long march of one-at-a-time. */
const QUESTIONS_PER_TURN = 3;

/** Field-importance ranking for asking order. Lower = asked first. Keyed by a
 *  fragment of the inbound FORM key, so it applies across doc types (parties and
 *  core identifiers lead; supporting/paperwork fields trail). An unranked field
 *  sits in the middle. This is ordering only — the ENGINE still decides WHICH
 *  fields are required; we only choose which of the missing ones to surface first. */
const IMPORTANCE: Array<[RegExp, number]> = [
  [/name$|_name|applicant|petitioner|complainant|accused|plaintiff|defendant|vendor|vendee|lessor|lessee|donor|donee|caveator|deponent|testator|party/i, 0],
  [/amount|consideration|principal|claim|sum|quantum|rent|price|value/i, 1],
  [/cheque|instrument|fir|crime|section|offence|property|premises|suit_property|subject/i, 2],
  [/date|dated|_on$|since|execution|marriage|accident|presentation|dishonour|memo/i, 3],
  [/address|residence|bank|branch|police|district|forum|court|jurisdiction/i, 4],
  [/advocate|enrolment|counsel|dispatch|tracking|place|filing|reference|annex/i, 6],
];

function importanceOf(field: string): number {
  for (const [re, rank] of IMPORTANCE) if (re.test(field)) return rank;
  return 5; // unranked → middle
}

interface StoredState {
  form: Record<string, string>; // the fact map (engine-bound values only)
  meta: Record<string, FieldMeta>;
  transcript: IntakeTurn[];
  askCounts: Record<string, number>;
  /** The FORM-field keys the last assistant question asked about — so the NEXT
   *  turn's extractor knows which field a bare answer ("gowtham") fills. */
  pending: string[];
  /** Full text read off attached reference document(s), accumulated across
   *  attachments — the WHOLE content, not just parsed fields. Empty until a
   *  readable document is attached. Feeds the "Draft now" one-shot brief. */
  sourceText: string;
}

function unpack(facts: Record<string, unknown>): StoredState {
  const form: Record<string, string> = {};
  for (const [k, v] of Object.entries(facts)) {
    if (RESERVED.has(k)) continue;
    if (v === undefined || v === null) continue;
    form[k] = String(v);
  }
  return {
    form,
    meta: (facts[K_META] as Record<string, FieldMeta>) ?? {},
    transcript: (facts[K_TRANSCRIPT] as IntakeTurn[]) ?? [],
    askCounts: (facts[K_ASKS] as Record<string, number>) ?? {},
    pending: (facts[K_PENDING] as string[]) ?? [],
    sourceText: (facts[K_SOURCE] as string) ?? '',
  };
}

function pack(s: StoredState, docLabel: string): Record<string, unknown> {
  return {
    ...s.form,
    [K_LABEL]: docLabel,
    [K_META]: s.meta,
    [K_TRANSCRIPT]: s.transcript,
    [K_ASKS]: s.askCounts,
    [K_PENDING]: s.pending,
    [K_SOURCE]: s.sourceText,
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The engine's field contract for this doc, as the extractor's vocabulary. */
function fieldSpecs(sections: IntakeSectionSpec[]): IntakeFieldSpec[] {
  return sections.flatMap((sec) =>
    sec.fields.map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      ...(f.options ? { options: f.options } : {}),
      required: f.required,
    })),
  );
}

/** Human label for an inbound field key (falls back to a de-slugged key). */
function labelFor(specs: IntakeFieldSpec[], key: string): string {
  const s = specs.find((f) => f.key === key);
  if (s) return s.label;
  return key.replace(/\[\d+\]/g, '').replace(/[._]/g, ' ').trim();
}

/**
 * The VALIDATED fact map, keyed by human LABEL rather than the raw form key, so
 * the compose LLM sees "Cheque amount: 399088" rather than "cheque_amount:
 * 399088". This is the ONLY input compose gets about what's true — never the
 * raw transcript or attachment text — because every value in `form` has
 * already passed through EXTRACT -> MERGE -> the engine's own validation.
 */
function labelledFacts(specs: IntakeFieldSpec[], form: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    if (!value || !String(value).trim()) continue;
    out[labelFor(specs, key)] = value;
  }
  return out;
}

/**
 * The reconcile GATE (§4.1): the model may only WORD the engine's questions.
 * - drop any phrased question whose field is not in the current issue set
 *   (no invented questions), and
 * - for any issue with no phrased question, add a plain-label fallback
 *   (no skipped questions).
 * The SET returned is exactly the engine's issue fields.
 */
function reconcile(
  issues: IntakeIssue[],
  phrased: Array<{ field: string; question: string }>,
  specs: IntakeFieldSpec[],
): PhrasedQuestion[] {
  const issueFields = new Set(issues.map((i) => i.field));
  const kept = phrased.filter((q) => issueFields.has(q.field));
  const covered = new Set(kept.map((q) => q.field));
  const fallbacks: PhrasedQuestion[] = issues
    .filter((i) => !covered.has(i.field))
    .map((i) => ({ field: i.field, question: fallbackQuestion(i, specs) }));
  // Order: follow the engine's issue order so anchors (which the engine surfaces
  // first for a given check) lead.
  const byField = new Map<string, PhrasedQuestion>();
  for (const q of [...kept, ...fallbacks]) if (!byField.has(q.field)) byField.set(q.field, q);
  return issues.map((i) => byField.get(i.field)!).filter(Boolean);
}

function fallbackQuestion(issue: IntakeIssue, specs: IntakeFieldSpec[]): string {
  const label = labelFor(specs, issue.field);
  if (issue.code === 'enum') {
    const opts = specs.find((f) => f.key === issue.field)?.options;
    if (opts?.length) return `What is the ${label.toLowerCase()}? (one of: ${opts.join(', ')})`;
  }
  if (issue.code === 'malformed' || issue.code === 'type') {
    return `Could you give the ${label.toLowerCase()} again — it didn't come through in a usable form?`;
  }
  return `What is the ${label.toLowerCase()}?`;
}

/** Build the always-visible fact-sheet view (§10) from state + engine issues. */
function buildFactSheet(
  sections: IntakeSectionSpec[],
  form: Record<string, string>,
  meta: Record<string, FieldMeta>,
  issues: IntakeIssue[],
): FactSheetSection[] {
  const issueByField = new Map(issues.map((i) => [i.field, i]));
  // An ADDITIONAL-cheque field (cheque_*_2, drawee_bank_3, …) is only shown once
  // it has a value or the engine is asking about it — otherwise the fact sheet
  // would carry dozens of empty "Cheque 7 — amount" rows. Base cheque fields and
  // all other fields always show.
  const isExtraCheque = (key: string) => /_(?:[2-9]|1[0-2])$/.test(key) && /^(?:cheque_|drawee_bank_)/.test(key);
  return sections.map((sec) => ({
    title: sec.title,
    fields: sec.fields
      .filter((f) => {
        if (!isExtraCheque(f.key)) return true;
        const hasValue = (form[f.key] ?? '').toString().trim().length > 0;
        return hasValue || issueByField.has(f.key);
      })
      .map((f): FactSheetField => {
        const issue = issueByField.get(f.key);
        const field: FactSheetField = {
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required,
          outstanding: Boolean(issue),
          ...(f.options ? { options: f.options } : {}),
        };
        if (form[f.key] !== undefined) field.value = form[f.key];
        if (meta[f.key]) field.meta = meta[f.key];
        if (issue) field.issueCode = issue.code;
        return field;
      }),
  }));
}

function toRefusal(r: Extract<EngineDraftResult, { outcome: 'refused' }>['refusal']): IntakeRefusal {
  return {
    code: r.code, severity: r.severity, reason: r.reason, computation: r.computation,
    pipeline: r.pipeline, spec: r.spec, fields_implicated: r.fields_implicated ?? [],
    remedy_hint: r.remedy_hint,
  };
}

function toDraft(r: Extract<EngineDraftResult, { outcome: 'generated' }>): IntakeDraft {
  return {
    blocks: r.blocks, signals: r.signals, unfilledSlots: r.unfilledSlots, docxBase64: r.docxBase64,
  };
}

// Cache of engine-derived intake sections, keyed by engine doc_type. Populated
// lazily from GET /v1/doc-types the first time a passthrough doc is resolved, so
// the 45 passthrough doc types need no hand-written config (s.138 keeps its own).
const derivedSectionsCache = new Map<string, IntakeSectionSpec[]>();

/** Resolve the engine doc-type slug + section config for a Draft-page label.
 *
 * Uses the hand-authored `intakeDocConfig` when one exists (s.138), otherwise
 * DERIVES the sections from the engine's own field contract (adapter.describe()
 * via GET /v1/doc-types). Returns null only when the label is not mapped to an
 * engine doc type or the engine has no such doc type. */
async function resolveDoc(
  docLabel: string,
): Promise<{ docType: string; sections: IntakeSectionSpec[] } | null> {
  const docType = LABEL_TO_ENGINE_DOC[docLabel];
  if (!docType) return null;

  const hand = intakeDocConfig[docType];
  if (hand) return { docType, sections: hand };

  if (derivedSectionsCache.has(docType)) {
    return { docType, sections: derivedSectionsCache.get(docType)! };
  }
  // Fetch the engine contract once and derive sections for every passthrough doc.
  try {
    const raw = (await engineClient.docTypes()) as { doc_types?: EngineDescribe[] };
    const list = raw?.doc_types ?? [];
    let mine: IntakeSectionSpec[] | null = null;
    for (const desc of list) {
      if (!desc?.doc_type || intakeDocConfig[desc.doc_type]) continue;
      const sections = intakeSectionsFromDescribe(desc);
      derivedSectionsCache.set(desc.doc_type, sections);
      if (desc.doc_type === docType) mine = sections;
    }
    if (mine) return { docType, sections: mine };
  } catch (err) {
    // The engine being unreachable is a DISTINCT condition from "this doc isn't
    // routable" — propagate it so the caller returns a clean 503 ("engine
    // unavailable"), instead of a misleading "not routable" 400/404.
    if (err instanceof EngineDisabledError) throw err;
    logger.warn({ err, docType }, 'intake: engine doc-types fetch failed');
  }
  return null;
}

interface RunCtx extends Ctx {
  provider?: 'xai' | 'anthropic';
}

export class IntakeError extends Error {}

export const intakeService = {
  /** Is a Draft-page label drivable by the conversational intake loop? */
  async routable(docLabel: string): Promise<boolean> {
    // Cheap synchronous check first: a label with no engine mapping is never
    // routable and needs no engine round-trip.
    if (!LABEL_TO_ENGINE_DOC[docLabel]) return false;
    try {
      return (await resolveDoc(docLabel)) !== null;
    } catch (err) {
      // Engine unreachable: this is a liveness problem, not "unroutable". Report
      // false here (so the guard doesn't 500); the actual start/startAuto call
      // will surface the clean 503 when it tries to use the engine.
      if (err instanceof EngineDisabledError) return false;
      throw err;
    }
  },

  /** Start a new conversation from the advocate's opening description. */
  async start(docLabel: string, message: string, ctx: RunCtx): Promise<IntakeState> {
    const doc = await resolveDoc(docLabel);
    if (!doc) throw new IntakeError(`doc "${docLabel}" is not intake-routable`);
    const initial: StoredState = { form: {}, meta: {}, transcript: [], askCounts: {}, pending: [], sourceText: '' };
    const sheet = await factSheetService.create(pack(initial, docLabel), ctx);
    return this._turn(sheet.matterId, docLabel, message, ctx, 'narration');
  },

  /**
   * Start a conversation WITHOUT the advocate having picked a format. The opening
   * message is CLASSIFIED into one of the engine's routable document labels, and
   * the normal intake then runs for that label. The returned state names the
   * detected label (and whether the guess was confident) so the UI can confirm it
   * and offer a one-click override. If nothing can be classified, throws an
   * IntakeError the route turns into a "please pick a format" prompt.
   */
  async startAuto(message: string, ctx: RunCtx): Promise<IntakeState> {
    const labels = routableLabels();
    // Classify the format. DETERMINISTIC mode (flag on) skips the LLM entirely and
    // uses the keyword classifier — instant, no network, no cost. Otherwise the LLM
    // classifies with the keyword classifier as a fallback.
    let label: string | null;
    let confidence: 'high' | 'medium' | 'low';
    if (env.intakeDeterministic) {
      label = keywordGuessLabel(message, labels);
      confidence = 'low';
    } else {
      const guess = await intakeLlm.classifyDocType({
        brief: message, labels,
        ...(ctx.provider ? { provider: ctx.provider } : {}),
        onUsage: (u) => recordUsage(ctx, u),
      });
      label = guess.label ?? keywordGuessLabel(message, labels);
      confidence = guess.label ? guess.confidence : 'low';
    }
    if (!label) {
      throw new IntakeError('could not determine the document type from the description');
    }
    const state = await this.start(label, message, ctx);
    // Announce the detection at the top of the transcript so it's visible, and
    // surface it on the state for the UI's confirm/override affordance.
    return {
      ...state,
      detectedDocLabel: label,
      detectionConfidence: confidence,
    };
  },

  /** Continue a conversation with the advocate's next message. */
  async reply(matterId: string, docLabel: string, message: string, ctx: RunCtx): Promise<IntakeState> {
    return this._turn(matterId, docLabel, message, ctx, 'narration');
  },

  /**
   * DRAFT NOW (DraftBot-style): draft the WHOLE document from what's already on
   * record, filling genuinely-missing REQUIRED fields with clearly-marked
   * [placeholders] instead of asking. Adds NO new facts — it only permits the
   * draft to render with gaps. Hard-stop refusals still block (never bypassed).
   * No new advocate message; it re-evaluates the current state with draftNow on.
   */
  async draftNow(matterId: string, docLabel: string, ctx: RunCtx): Promise<IntakeState> {
    const doc = await resolveDoc(docLabel);
    if (!doc) throw new IntakeError(`doc "${docLabel}" is not intake-routable`);
    const specs = fieldSpecs(doc.sections);
    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new IntakeError(`no intake for matter ${matterId}`);
    const state = unpack(current.facts);
    return this._evaluate(matterId, docLabel, doc, specs, state, ctx, {
      phrase: true,
      bumpAsks: false,
      draftNow: true,
    });
  },

  /**
   * Directly edit fact-sheet fields (§10). Equivalent to the advocate STATING
   * the values — always lands as `stated`/`direct-edit`, never inferred. Runs
   * the same merge -> revise -> draft cycle, so an edit can resolve a 422, fix
   * an extraction error, or clear/trigger a refusal, all through one engine call.
   */
  async edit(
    matterId: string,
    docLabel: string,
    edits: Record<string, string>,
    ctx: RunCtx,
  ): Promise<IntakeState> {
    const doc = await resolveDoc(docLabel);
    if (!doc) throw new IntakeError(`doc "${docLabel}" is not intake-routable`);
    const specs = fieldSpecs(doc.sections);
    const allowed = new Set(specs.map((f) => f.key));

    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new IntakeError(`no intake for matter ${matterId}`);
    const state = unpack(current.facts);

    const applied: string[] = [];
    for (const [key, raw] of Object.entries(edits)) {
      if (!allowed.has(key)) continue; // closed vocabulary, same as extraction
      const value = String(raw ?? '').trim();
      if (value === '') {
        delete state.form[key];
        delete state.meta[key];
      } else {
        state.form[key] = value;
        state.meta[key] = { confidence: 'stated', source: '', via: 'direct-edit' };
      }
      applied.push(key);
    }
    if (applied.length) {
      state.transcript.push({
        role: 'advocate',
        text: `(edited ${applied.map((k) => labelFor(specs, k)).join(', ')} directly)`,
      });
    }

    const revised = await factSheetService.revise(matterId, pack(state, docLabel), ctx);
    return this._evaluate(revised.matterId, docLabel, doc, specs, state, ctx, { phrase: true });
  },

  /** Load the current state without changing anything (reopen a conversation). */
  async load(matterId: string, docLabel: string, ctx: RunCtx): Promise<IntakeState> {
    const doc = await resolveDoc(docLabel);
    if (!doc) throw new IntakeError(`doc "${docLabel}" is not intake-routable`);
    const specs = fieldSpecs(doc.sections);
    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new IntakeError(`no intake for matter ${matterId}`);
    const state = unpack(current.facts);
    // Passive reload: re-check the engine outcome and re-render, but make NO
    // model call (no new questions) and do not advance ask counts. The advocate
    // sees where they left off — the last questions are already in the transcript.
    return this._evaluate(matterId, docLabel, doc, specs, state, ctx, { phrase: false, bumpAsks: false, persist: false });
  },

  // ---- the core turn ------------------------------------------------------

  async _turn(
    matterId: string,
    docLabel: string,
    message: string,
    ctx: RunCtx,
    via: 'narration' | 'question',
  ): Promise<IntakeState> {
    const doc = await resolveDoc(docLabel);
    if (!doc) throw new IntakeError(`doc "${docLabel}" is not intake-routable`);
    const specs = fieldSpecs(doc.sections);

    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new IntakeError(`no intake for matter ${matterId}`);
    const state = unpack(current.facts);

    // What the advocate said this turn.
    state.transcript.push({ role: 'advocate', text: message });

    // Which fields the last assistant turn asked about (so extraction can assign a
    // bare answer like "gowtham" to the right field). Recorded on the state when the
    // questions were phrased last turn — NOT re-derived from free text.
    const answering = state.pending ?? [];

    // EXTRACT (§3). HYBRID for cost + capability:
    //  - Short typed answers → the FREE deterministic rule extractor (no API cost).
    //  - A SUBSTANTIAL DOCUMENT PASTE → the LLM extractor (a real document buries
    //    names in prose the regex can't parse — "NAME, Proprietor:…, hereinafter
    //    referred to as the Role"; the LLM reads them). This costs a fraction of a
    //    cent, and ONLY on a genuine paste, not on ordinary messages.
    // When INTAKE_DETERMINISTIC is off, the LLM is always used (a paid upgrade).
    const transcriptText = renderTranscript(state.transcript);
    const useLlmExtract = !env.intakeDeterministic || isDocumentPaste(message);
    const patch = useLlmExtract
      ? await intakeLlm.extract({
          docLabel,
          fields: specs,
          transcript: transcriptText,
          latest: message,
          answering,
          today: todayIso(),
          ...(ctx.provider ? { provider: ctx.provider } : {}),
          onUsage: (u) => recordUsage(ctx, u),
        })
      : extractDeterministic({ fields: specs, latest: message, answering });

    // MERGE (§7 contradictions surfaced, not silently overwritten).
    const notes = mergePatch(state, patch, specs, via === 'question' ? 'question' : 'narration');

    // REVISE — commit as the next immutable version.
    const revised = await factSheetService.revise(matterId, pack(state, docLabel), ctx);

    return this._evaluate(revised.matterId, docLabel, doc, specs, state, ctx, {
      phrase: true,
      bumpAsks: true,
      preface: notes,
    });
  },

  /**
   * Attach files (a cheque/memo image, a scanned PDF, a .docx) as an EXTRACTION
   * SOURCE — with ZERO per-use API cost. Text is pulled out LOCALLY (images via
   * tesseract.js OCR; pdf/docx/txt via lib/text-extraction), then mapped to fields
   * by the DETERMINISTIC rule extractor (no model call). The resulting patch flows
   * through the identical MERGE -> REVISE -> engine DRAFT path. Every value lands
   * `inferred` with the file named as its source, so the advocate confirms it in
   * the fact sheet before it drafts. The engine still enforces every hard-stop; an
   * attachment can FILL a field, never bypass a refusal. Files are read and then
   * discarded (session-only) — nothing is persisted.
   */
  async attach(
    matterId: string,
    docLabel: string,
    files: AttachmentInput[],
    caption: string,
    ctx: RunCtx,
  ): Promise<IntakeState> {
    const doc = await resolveDoc(docLabel);
    if (!doc) throw new IntakeError(`doc "${docLabel}" is not intake-routable`);
    const specs = fieldSpecs(doc.sections);

    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new IntakeError(`no intake for matter ${matterId}`);
    const state = unpack(current.facts);

    // Read each file to TEXT locally: an image via OCR, a text-extractable doc via
    // mammoth/pdf-parse, or (unreadable) carried as an annexure note.
    const documentTexts: string[] = [];
    const readFiles: string[] = [];
    const annexures: string[] = [];
    for (const file of files) {
      const buf = Buffer.from(file.dataBase64, 'base64');
      if (isImageMime(file.mime, file.fileName)) {
        const ocr = await ocrImage(buf);
        if (ocr.ok && ocr.text.trim()) {
          documentTexts.push(`--- ${file.fileName} ---\n${ocr.text}`);
          readFiles.push(file.fileName);
        } else {
          annexures.push(file.fileName);
        }
        continue;
      }
      const extracted = await extractText({ body: buf, mime: file.mime, fileName: file.fileName });
      if (extracted.ok && extracted.text.trim()) {
        documentTexts.push(`--- ${file.fileName} ---\n${extracted.text}`);
        readFiles.push(file.fileName);
      } else {
        // Unreadable / unsupported (e.g. .zip, .xlsx) -> carry as an annexure note.
        annexures.push(file.fileName);
      }
    }

    // Record the attachment as an advocate turn (what was attached + any caption).
    const attachedList = files.map((f) => f.fileName).join(', ');
    const turnText = caption.trim()
      ? `(attached ${attachedList}) ${caption.trim()}`
      : `(attached ${attachedList})`;
    state.transcript.push({ role: 'advocate', text: turnText });

    // EXTRACT from the gathered document text with the DETERMINISTIC rule extractor
    // (no API call). Values it reads are re-marked `inferred` (read off a document,
    // to be confirmed) with the file(s) named as the source/derivation.
    const combinedText = documentTexts.join('\n\n');
    // Preserve the WHOLE document text (not just the parsed fields) so a "Draft
    // now" can draft from the entire reference document — nothing the field
    // extractor missed is lost. Accumulate across successive attachments.
    if (combinedText.trim()) {
      state.sourceText = [state.sourceText, combinedText].filter((t) => t && t.trim()).join('\n\n');
    }
    // EXTRACT from the attached document text. An attachment IS a substantial
    // document — exactly the case the LLM extractor exists for (it reads facts buried
    // in prose the regex recognizer can't parse: role, occupation, narrative averments,
    // party descriptions). So an attachment ALWAYS prefers the LLM extractor when a
    // provider is configured — INDEPENDENT of INTAKE_DETERMINISTIC, which governs the
    // cost of extracting short TYPED messages, not the reading of a whole document.
    // Falls back to the deterministic recognizer only when no LLM provider is available
    // (or the read text is empty). Doc-type-agnostic: whatever fields the doc declares,
    // the extractor maps what the document actually STATES, and leaves genuinely-absent
    // fields (e.g. a deponent's age, not present in a notice) for the engine to ask
    // about — deliberate absence over invention.
    const canUseLlm = env.llmProvider !== 'none';
    const rawPatch = !combinedText.trim()
      ? { fields: [], unmappedNotes: [], lowConfidence: [], collisions: [], modelUsed: 'deterministic:none' }
      : canUseLlm
        ? await intakeLlm.extract({
            docLabel,
            fields: specs,
            transcript: renderTranscript(state.transcript),
            latest: combinedText,
            answering: [],
            today: todayIso(),
            ...(ctx.provider ? { provider: ctx.provider } : {}),
            onUsage: (u) => recordUsage(ctx, u),
          })
        : extractDeterministic({ fields: specs, latest: combinedText, answering: [] });

    // FOCUSED NARRATIVE PASS. A document's factual body (body_paras / facts / grounds /
    // narrative) is the content that MATTERS, but a single extraction over many fields
    // fills the easy scalars and unreliably skips the long narrative field — worse the
    // more fields the doc has (an affidavit now has 30). So if a REQUIRED textarea field
    // is still empty after the main pass and we have document text, run a second, tiny
    // extraction dedicated to JUST that field. With nothing competing, the LLM reliably
    // returns the factual sentences. Deterministic-in-effect: if the document states
    // facts, they land in the body. No fabrication — it still only pulls what's written.
    if (canUseLlm && combinedText.trim()) {
      const filled = new Set(rawPatch.fields.map((f) => f.key));
      const emptyNarrative = specs.filter(
        (s) => s.type === 'textarea' && s.required && !filled.has(s.key),
      );
      for (const nf of emptyNarrative) {
        const focused = await intakeLlm.extract({
          docLabel,
          fields: [nf], // ONLY this field — nothing else to divert the model
          transcript: '',
          latest: combinedText,
          answering: [nf.key],
          today: todayIso(),
          ...(ctx.provider ? { provider: ctx.provider } : {}),
          onUsage: (u) => recordUsage(ctx, u),
        });
        const got = focused.fields.find((f) => f.key === nf.key);
        if (got && String(got.value).trim()) rawPatch.fields.push(got);
      }
    }

    // Observability for attachment extraction: counts only (no document text in logs),
    // so an empty/partial draft can be traced to "OCR read nothing" vs "extractor mapped
    // nothing" without leaking client content.
    logger.info(
      {
        docLabel,
        ocrTextChars: combinedText.length,
        fieldsExtracted: rawPatch.fields.length,
        hasBody: rawPatch.fields.some((f) => f.key === 'body_paras'),
        extractor: canUseLlm ? 'llm' : 'deterministic',
      },
      'intake attach: extraction complete',
    );
    const sourceLabel = readFiles.join(', ') || 'the attached document';
    const patch = {
      ...rawPatch,
      fields: rawPatch.fields.map((f) => ({
        ...f,
        confidence: 'inferred' as const,
        source: f.source || sourceLabel,
        derivation: `read from ${sourceLabel}`,
      })),
    };

    // MERGE — same path as narration, via 'attachment' provenance.
    const notes = mergePatch(state, patch, specs, 'attachment');
    if (annexures.length) {
      notes.unshift(
        `Attached as annexure(s) but not read (unsupported type or unreadable): ${annexures.join(', ')}.`,
      );
    }
    if (!patch.fields.length && !annexures.length && readFiles.length) {
      notes.push('I read the attachment(s) but couldn’t pull usable details automatically. You can type them, and I’ll re-check.');
    }

    const revised = await factSheetService.revise(matterId, pack(state, docLabel), ctx);
    return this._evaluate(revised.matterId, docLabel, doc, specs, state, ctx, {
      phrase: true,
      bumpAsks: true,
      preface: notes,
    });
  },

  /**
   * DRAFT against the engine, then decide the next assistant turn:
   *   generated -> status 'generated', hand off the draft.
   *   refused   -> status 'refused' (PAUSE, not end): deliver the finding, do
   *                NOT phrase new questions; keep listening for corrections.
   *   422       -> status 'gathering': phrase 1-2 questions from the issues,
   *                honouring the ask-counter downgrade to a typed control.
   */
  async _evaluate(
    matterId: string,
    docLabel: string,
    doc: { docType: string; sections: IntakeSectionSpec[] },
    specs: IntakeFieldSpec[],
    state: StoredState,
    ctx: RunCtx,
    opts: { phrase: boolean; bumpAsks?: boolean; preface?: string[]; persist?: boolean; draftNow?: boolean },
  ): Promise<IntakeState> {
    const persist = opts.persist ?? true;
    const { fields } = mapFormToEngine(doc.docType, state.form, {});

    let outcome: EngineDraftResult | null = null;
    let issues: IntakeIssue[] = [];
    try {
      outcome = await engineClient.draft(doc.docType, matterId, fields, { render: true });
    } catch (err) {
      if (err instanceof EngineValidationError) {
        // The engine reports issues in ENGINE keys; translate to the FORM keys
        // the advocate is asked about and the view renders. Multiple engine keys
        // can fold into one form field (drawee_bank -> bank + branch), so dedupe.
        issues = translateIssues(err.issues, doc.sections);
      } else {
        throw err;
      }
    }

    const preface = opts.preface ?? [];
    for (const p of preface) state.transcript.push({ role: 'assistant', text: p, kind: 'note' });

    // DRAFT NOW (DraftBot-style): the advocate wants the WHOLE document now, not a
    // question loop. When the engine 422'd purely for MISSING VALUES (never a
    // refusal — a hard-stop must still block), fill each missing required field
    // with a clearly-bracketed placeholder and re-draft ONCE, so the document
    // comes out complete with [ ... ] gaps the advocate fills in the editor. This
    // is the ONLY place we synthesise values, and only for the draft-now gesture;
    // the normal loop still asks. Hard-stops are untouched: a refusal below is
    // returned as-is, never bypassed.
    if (opts.draftNow && !outcome && issues.length > 0) {
      const placeholders: Record<string, string> = {};
      // DATE fields can't take a bracketed placeholder (the engine requires a
      // real ISO date and some dates drive limitation/validity math). For a
      // missing date we substitute the FIRST CHEQUE'S OWN DATE — the most
      // conservative, non-arbitrary stand-in (it can only ever make a validity
      // check MORE permissive, never assert an earlier/later date than what's
      // actually on record) — and remember which engine value we synthesised so
      // we can swap it for a visible "[DATE TO BE CONFIRMED]" marker in the
      // RENDERED text afterwards. This never fabricates a distinct date; it
      // marks the gap honestly while still letting the document generate.
      const sentinelDate = state.form.cheque_date;
      const syntheticDateValues = new Set<string>();
      // Fields the retry filled with a sentinel that must be shown as a visible gap in
      // the rendered text afterwards (numbers can't take a bracketed marker — the engine
      // requires a real integer — so we use 0 and mark it, exactly as dates use a
      // sentinel date and get marked).
      const syntheticNumberFields: string[] = [];
      for (const iss of issues) {
        const spec = specs.find((f) => f.key === iss.field);
        if (!spec) continue;
        if (spec.type === 'date' && sentinelDate) {
          placeholders[iss.field] = sentinelDate;
          syntheticDateValues.add(sentinelDate);
        } else if (spec.type === 'number' || spec.type === 'currency') {
          // A bracketed "[age]" is NOT an integer — the engine 422s on it, which used
          // to make draft-now fall back to the blocking form for any doc with a required
          // numeric field. Substitute a sentinel 0 (valid int) so the document GENERATES,
          // and record the field so the rendered text shows a "[… to be provided]" gap
          // instead of a fabricated 0. Never asserts a real number.
          placeholders[iss.field] = '0';
          syntheticNumberFields.push(iss.field);
        } else {
          // A bracketed, human-readable gap marker — NEVER a fabricated fact.
          // (select fields are plain strings at the engine, so this is safe too.)
          placeholders[iss.field] = placeholderFor(spec);
        }
      }
      if (Object.keys(placeholders).length > 0) {
        const merged = { ...state.form, ...placeholders };
        const { fields: filledFields } = mapFormToEngine(doc.docType, merged, {});
        try {
          const retry = await engineClient.draft(doc.docType, matterId, filledFields, { render: true });
          if (retry.outcome === 'generated') {
            let marked = syntheticDateValues.size
              ? markSyntheticDates(retry, syntheticDateValues)
              : retry;
            // Mark a synthetic sentinel age (0) as a visible gap in the rendered text.
            // Narrow to the "aged 0 years" idiom so a legitimate 0 elsewhere is untouched.
            if (syntheticNumberFields.includes('age')) {
              marked = {
                ...marked,
                blocks: marked.blocks.map((b) => ({
                  ...b,
                  text: b.text.replace(/\baged\s+0\s+years\b/gi, 'aged [age to be provided] years'),
                })),
              };
            }
            outcome = marked;
            issues = [];
            preface.push(
              `I drafted the whole document now. The fields I couldn’t find in what you gave me are left as clearly-marked [placeholders] — fill them in the editor (or tell me and I’ll set them).`,
            );
          }
          // If the retry now REFUSES (a hard-stop surfaced once fields were
          // present), fall through to the refusal branch below — never bypass it.
          else if (retry.outcome === 'refused') {
            outcome = retry;
          }
        } catch (err) {
          if (err instanceof EngineValidationError) {
            // Still 422 even with placeholders (e.g. a date field with no cheque
            // date to fall back on). Keep the remaining issues so the loop asks
            // for just those — better than a dead draft-now.
            issues = translateIssues(err.issues, doc.sections);
          } else {
            throw err;
          }
        }
      }
    }

    // GENERATED — the only success exit. Every fact is now engine-validated;
    // COMPOSE may enrich the prose (never invent facts — see intake-compose.service),
    // gated by a VERIFY fact-check that falls back to the plain engine draft on
    // any rejection. This call is intentionally fed ONLY the engine's own block
    // output + the validated form map — never state.transcript or the raw
    // advocate message, so composition can never see unvalidated prose.
    if (outcome?.outcome === 'generated') {
      let draft = toDraft(outcome);
      if (env.intakeComposeEnabled && composeAppliesTo(doc.docType)) {
        const composeResult = await intakeCompose.compose({
          docLabel,
          engineBlocks: outcome.blocks,
          facts: labelledFacts(specs, state.form),
          ...(ctx.provider ? { provider: ctx.provider } : {}),
          onUsage: (u) => recordUsage(ctx, u),
        });
        if (composeResult.composed) {
          draft = { ...draft, blocks: composeResult.blocks };
        }
      }
      state.transcript.push({
        role: 'assistant',
        text: 'That’s everything the engine needs — here’s the draft, for your review before filing.',
        kind: 'draft',
      });
      if (persist) await this._persistTranscript(matterId, docLabel, state, ctx);
      return this._render(matterId, docLabel, doc, specs, state, {
        status: 'generated', issues: [], questions: [], refusal: null, draft,
      });
    }

    // REFUSED — a finding stands. PAUSE interrogation, keep listening (§8).
    if (outcome?.outcome === 'refused') {
      const refusal = toRefusal(outcome.refusal);
      state.transcript.push({ role: 'assistant', text: refusal.reason, kind: 'refusal' });
      if (persist) await this._persistTranscript(matterId, docLabel, state, ctx);
      // No phrasing: we do NOT ask for the next field while a defect stands. The
      // fact-sheet view still shows outstanding fields; the advocate may correct
      // anything and we re-evaluate on the next turn.
      return this._render(matterId, docLabel, doc, specs, state, {
        status: 'refused', issues: [], questions: [], refusal, draft: null,
      });
    }

    // 422 — still gathering. Phrase 1-2 questions, honour the ask-counter guard.
    const directEntry: string[] = [];
    const askable: IntakeIssue[] = [];
    for (const iss of issues) {
      const count = state.askCounts[iss.field] ?? 0;
      if (count >= ASK_LIMIT) {
        directEntry.push(iss.field); // downgrade to a typed control (§5.2)
      } else {
        askable.push(iss);
      }
    }

    // Ask the N MOST IMPORTANT missing fields this turn (essentials first), the
    // rest wait (still visible in the fact-sheet view). Stable sort keeps the
    // engine's own order within a tier, so a check's anchor field still leads.
    const ranked = askable
      .map((iss, i) => ({ iss, i, rank: importanceOf(iss.field) }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((x) => x.iss);
    const thisTurn = ranked.slice(0, QUESTIONS_PER_TURN);

    let questions: PhrasedQuestion[] = [];
    if (opts.phrase && thisTurn.length) {
      // Deterministic mode makes NO phraser call: reconcile() with an empty
      // phrased set yields the built-in plain-language questions for every issue
      // (fallbackQuestion). LLM mode words them warmly, still through the same
      // gate so it can neither invent nor skip.
      const phrased = env.intakeDeterministic
        ? []
        : await intakeLlm.phrase({
            docLabel,
            issues: thisTurn.map((i) => ({
              field: i.field, code: i.code, message: i.message, label: labelFor(specs, i.field),
              ...(specs.find((f) => f.key === i.field)?.options
                ? { options: specs.find((f) => f.key === i.field)!.options }
                : {}),
            })),
            ...(ctx.provider ? { provider: ctx.provider } : {}),
            onUsage: (u) => recordUsage(ctx, u),
          });
      // GATE: no invented / no skipped — the set is exactly `thisTurn`.
      questions = reconcile(thisTurn, phrased, specs);

      if (opts.bumpAsks) {
        for (const q of questions) state.askCounts[q.field] = (state.askCounts[q.field] ?? 0) + 1;
      }

      // Record the phrased question(s) as an assistant turn so the transcript and
      // the "answering" hint stay in sync.
      const text = questions.map((q) => q.question).join(' ');
      if (text) state.transcript.push({ role: 'assistant', text, kind: 'question' });
      // Remember which FORM fields we just asked about, so a bare answer next turn
      // ("gowtham") is assigned to the right field by the extractor.
      state.pending = questions.map((q) => q.field);
    } else if (directEntry.length && !thisTurn.length) {
      state.transcript.push({
        role: 'assistant',
        text: `A couple of fields are easier to type in directly — I’ve marked them in the fact sheet.`,
        kind: 'note',
      });
    }

    await this._persistTranscript(matterId, docLabel, state, ctx);
    return this._render(matterId, docLabel, doc, specs, state, {
      status: 'gathering', issues, questions, refusal: null, draft: null, directEntry,
    });
  },

  async _persistTranscript(matterId: string, docLabel: string, state: StoredState, ctx: RunCtx): Promise<void> {
    // The transcript / askCounts changed during evaluation; commit them so a
    // reload sees the same conversation. This is a revise (new version) — cheap,
    // and it keeps the "every change is a version" invariant honest.
    await factSheetService.revise(matterId, pack(state, docLabel), ctx);
  },

  async _render(
    matterId: string,
    docLabel: string,
    doc: { docType: string; sections: IntakeSectionSpec[] },
    specs: IntakeFieldSpec[],
    state: StoredState,
    r: {
      status: IntakeState['status'];
      issues: IntakeIssue[];
      questions: PhrasedQuestion[];
      refusal: IntakeRefusal | null;
      draft: IntakeDraft | null;
      directEntry?: string[];
    },
  ): Promise<IntakeState> {
    const current = await factSheetService.getCurrent(matterId);
    const version = current?.version ?? 1;
    // Persistent set of downgraded fields (accumulates across turns).
    const persistentDirect = specs
      .filter((f) => (state.askCounts[f.key] ?? 0) >= ASK_LIMIT)
      .map((f) => f.key);
    const directEntryFields = Array.from(new Set([...(r.directEntry ?? []), ...persistentDirect]));
    return {
      matterId,
      version,
      docLabel,
      status: r.status,
      transcript: state.transcript,
      factSheet: buildFactSheet(doc.sections, state.form, state.meta, r.issues),
      questions: r.questions,
      directEntryFields,
      refusal: r.refusal,
      draft: r.draft,
      ...(state.sourceText.trim() ? { sourceText: state.sourceText } : {}),
    };
  },
};

// ---- helpers ---------------------------------------------------------------

/**
 * Which engine doc types the COMPOSE enrichment pass is allowed to run on.
 *
 * Compose's prompt (intake-compose.service.buildComposePrompt) hard-codes the
 * TARGET STRUCTURE of a cheque-dishonour (s.138) notice — cheque tables, the
 * deferment-agreement acknowledgment paragraph, the §138/141/142 characterisation,
 * the aggregate demand. On s.138 that enrichment is audited and fabricates nothing
 * (every hard fact traces to the validated field map). On ANY OTHER doc type it
 * mis-shapes the document: it discards the engine's correct template structure and
 * re-drafts it as notice-style numbered prose — which on an affidavit dropped the
 * AFFIDAVIT-OF heading, re-numbered the prayer into the averments, and paraphrased
 * the attestation block into a line no template contains ("Attested by: <notary>").
 *
 * So compose is scoped to the doc types it was written and verified for. Adding a
 * doc type here means authoring (and auditing) a compose structure for it first.
 */
const COMPOSE_DOC_TYPES = new Set<string>(['s138_notice']);

function composeAppliesTo(docType: string): boolean {
  return COMPOSE_DOC_TYPES.has(docType);
}

/** One inbound attachment: a base64 blob + its mime/name (session-only). */
export interface AttachmentInput {
  fileName: string;
  mime: string;
  dataBase64: string;
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

function isImageMime(mime: string, fileName: string): boolean {
  if (mime.toLowerCase().startsWith('image/')) return true;
  return IMAGE_EXTS.has(extOf(fileName));
}

/**
 * Is this message a SUBSTANTIAL DOCUMENT PASTE (worth one LLM read to capture the
 * facts regex can't), rather than a short typed answer? Deliberately CONSERVATIVE
 * so the paid path fires only on a real document, keeping ordinary turns free:
 *   - long (≥ 300 chars, ~50+ words), OR
 *   - clearly document-shaped: several structured cues AND real length.
 * A one-line reply, a name, a date — none of these trip it.
 */
function isDocumentPaste(message: string): boolean {
  const t = message.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (t.length >= 300 || words >= 50) return true;
  // Shorter but unmistakably a document excerpt: 3+ distinct structured cues.
  let cues = 0;
  if (/cheque\s*(?:no|number|#)|hereinafter|whereas|agreement|referred to as/i.test(t)) cues++;
  if (/\bdated\b|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/i.test(t)) cues++;
  if (/\b(?:rs\.?|inr|₹)\s*[\d,]/i.test(t)) cues++;
  if (/\bPAN\b|\bGST\b/i.test(t)) cues++;
  if (/proprietor|vendor|vendee|drawer|payee|lessor|lessee|plaintiff|defendant/i.test(t)) cues++;
  return cues >= 3 && words >= 20;
}

/** Every Draft-page label the engine can route right now (the same set the
 *  /engine/status `formats` list exposes). The classifier picks from these. */
function routableLabels(): string[] {
  return Object.keys(LABEL_TO_ENGINE_DOC).filter((l) => isRoutable(LABEL_TO_ENGINE_DOC[l]!));
}

/** A cheap keyword classifier used when the LLM is off or returns nothing. Maps a
 *  brief to one of the given labels by common cues; null if nothing matches (the
 *  caller then asks the advocate to pick). Only returns a label present in
 *  `labels`, so it can never route to something the engine can't draft. */
function keywordGuessLabel(brief: string, labels: string[]): string | null {
  const t = brief.toLowerCase();
  const has = (label: string) => labels.includes(label);
  // Word-boundaried cues — avoid substring false positives (e.g. "please" must not
  // match "lease", "will" the verb must not match a Will document loosely).
  const cues: Array<[RegExp, string]> = [
    // A clear "affidavit" intent must win over the generic notice/cheque cues below —
    // an advocate who typed "draft an affidavit" means the standalone affidavit, even
    // when a 138 notice or cheque is ATTACHED as the reference content. Guard against
    // the more-specific affidavit labels ("Affidavit of Service", "Surety Affidavit"),
    // which the advocate would name explicitly and which have their own doc types.
    [/\baffidavit\b(?!\s+of\s+service)/, 'Affidavit'],
    [/\bcheque\b|\b138\b|dishonou?r|\bbounced?\b/, 'Notice u/s 138 NI Act'],
    [/anticipat|pre.?arrest|apprehend/, 'Anticipatory Bail Application'],
    [/\bbail\b|\barrest(ed)?\b|\bcustody\b|\bremand\b/, 'Regular Bail Application'],
    [/\bvakalat/, 'Vakalatnama'],
    [/written statement|defendant.*\brepl/, 'Written Statement'],
    [/\bplaint\b|civil suit|recovery of/, 'Plaint (Money Recovery)'],
    [/\bmaintenance\b/, 'Maintenance Petition'],
    [/\bdivorce\b/, 'Divorce Petition (Contested)'],
    [/\bsale deed\b|\bsell\b.*property|\bsale of\b/, 'Sale Deed'],
    [/\blease\b|\btenanc/, 'Lease Deed'],
    [/\bwill\b.*(bequeath|testament|estate|property)|testament|bequeath/, 'Will'],
    [/\bgift\b/, 'Gift Deed'],
    [/power of attorney|\bpoa\b/, 'Power of Attorney'],
    [/\bcaveat\b/, 'Caveat u/s 148-A CPC'],
    [/\bexecution\b|decree.*enforc/, 'Execution Application'],
    [/eviction|ejectment|\bvacate\b/, 'Suit for Ejectment & Damages'],
    [/\bconsumer\b|deficien.*service/, 'Consumer Complaint'],
    [/\baccident\b|\bmact\b|motor vehicle/, 'MACT Claim Petition'],
    [/\bnotice\b/, 'General Demand Notice'],
  ];
  for (const [re, label] of cues) {
    if (re.test(t) && has(label)) return label;
  }
  return null;
}

/**
 * A bracketed placeholder for a missing REQUIRED field, used ONLY by the
 * draft-now gesture to render a complete document with clearly-marked gaps.
 * Returns '' for a select field — an enum can't take a free placeholder, so
 * those stay unfilled and the loop still asks for them (better than an invalid
 * draft). Dates use a date-shaped marker so the engine's date validator passes
 * while the gap stays obvious.
 */
function placeholderFor(spec: IntakeFieldSpec): string {
  const label = (spec.label || spec.key).toLowerCase();
  if (spec.type === 'date') return `[${label} — to be confirmed]`;
  if (spec.type === 'currency' || spec.type === 'number') return `[${label}]`;
  // 'select' fields (dishonour_reason, dispatch_mode, ...) are plain non-empty
  // STRINGS at the engine — a bracketed marker satisfies validation and reads as
  // an obvious gap, so draft-now no longer stalls on an unanswered enum.
  return `[${label} to be provided]`;
}

/**
 * Swap every occurrence of a SYNTHETIC sentinel date (the cheque's own date,
 * substituted in for a missing presentation/memo/notice date so the engine could
 * generate) for a visible gap marker in the rendered block text. This runs AFTER
 * generation, on the TEXT ONLY — the underlying fields the engine validated are
 * never touched, and the document a court would see never shows an invented date
 * as if it were real.
 *
 * CAUTION — the sentinel is the CHEQUE'S OWN date, so it is textually identical
 * to the real, correct date printed wherever the cheque particulars themselves
 * are stated ("Cheque No. 000105 dated 2026-04-16"). A blind find-and-replace
 * would wrongly mask that TRUE fact. We therefore skip any match that is part of
 * a "Cheque No. … dated <date>" (or "dated <date> for Rs./INR/₹…") phrase — the
 * cheque-particulars idiom — and mark every OTHER occurrence (presentation,
 * memo, notice date lines, which use different surrounding wording).
 */
export function markSyntheticDates(
  outcome: Extract<EngineDraftResult, { outcome: 'generated' }>,
  syntheticIsoDates: Set<string>,
): Extract<EngineDraftResult, { outcome: 'generated' }> {
  // Build a regex matching any common rendering of each synthetic ISO date. The
  // s138 template prints the RAW ISO form ("2026-04-16") verbatim; also cover
  // "16-04-2026"/"16/04/2026" and "16th April 2026" in case a template/forum
  // formats it differently.
  const patterns: RegExp[] = [];
  for (const iso of syntheticIsoDates) {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) continue;
    const [, y, mo, d] = m;
    const dd = String(Number(d));
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthName = monthNames[Number(mo) - 1];
    const isoRaw = `${y}-${mo}-${d}`;
    const dmy = `${d}[-/]${mo}[-/]${y}`;
    const long = `${dd}(?:st|nd|rd|th)?\\s+${monthName}\\.?,?\\s+${y}`;
    patterns.push(new RegExp(`\\b(?:${isoRaw}|${dmy}|${long})\\b`, 'g'));
  }
  if (!patterns.length) return outcome;
  const MARK = '[DATE TO BE CONFIRMED]';
  // The cheque-particulars idiom SPECIFICALLY: "Cheque No. <digits> … dated
  // <date>". Deliberately narrower than "cheque…dated" alone — the memo-date
  // sentence ("memo dated <date>") also contains the words "cheque" and "dated"
  // nearby and must NOT be protected. Only "Cheque No." immediately anchoring
  // the "dated" clause is the real, non-synthetic cheque date.
  const CHEQUE_CONTEXT = /cheque\s*no\.?\s*[\w-]*[^.]{0,30}dated\s*$/i;
  const blocks = outcome.blocks.map((b) => {
    let text = b.text;
    for (const re of patterns) {
      text = text.replace(re, (match, offset: number) => {
        const before = text.slice(Math.max(0, offset - 60), offset);
        return CHEQUE_CONTEXT.test(before) ? match : MARK;
      });
    }
    return { ...b, text };
  });
  return { ...outcome, blocks };
}

/**
 * MERGE a field patch into the working state (§7): take each new value, surface
 * any contradiction as a note (never a silent overwrite), and record provenance.
 * Returns the notes to preface the next assistant turn. Shared by narration and
 * attachment so both merge identically.
 */
function mergePatch(
  state: StoredState,
  patch: {
    fields: Array<{ key: string; value: string; confidence: 'stated' | 'inferred'; source: string; derivation?: string }>;
    unmappedNotes: string[];
    collisions: Array<{ value: string; candidates: string[] }>;
  },
  specs: IntakeFieldSpec[],
  via: FieldMeta['via'],
): string[] {
  const notes: string[] = [];
  for (const f of patch.fields) {
    const prior = state.form[f.key];
    if (prior !== undefined && prior !== f.value) {
      const priorMeta = state.meta[f.key];
      notes.push(
        `Noting a change to ${labelFor(specs, f.key)}: “${prior}” → “${f.value}”.` +
          (priorMeta?.source ? ` (Earlier: “${priorMeta.source}”.)` : ''),
      );
    }
    state.form[f.key] = f.value;
    const meta: FieldMeta = { confidence: f.confidence, source: f.source, via };
    if (f.derivation) meta.derivation = f.derivation;
    state.meta[f.key] = meta;
  }
  for (const n of patch.unmappedNotes) notes.push(`Noted (no field for this yet): ${n}`);
  for (const c of patch.collisions) {
    notes.push(
      `“${c.value}” could be the ${c.candidates.map((k) => labelFor(specs, k)).join(' or the ')} — which is it?`,
    );
  }
  return notes;
}

function renderTranscript(turns: IntakeTurn[]): string {
  return turns
    .map((t) => `${t.role === 'advocate' ? 'Advocate' : 'Assistant'}: ${t.text}`)
    .join('\n');
}

/**
 * Translate engine-key issues to form-key issues (§ vocabulary bridge). One form
 * field may own several engine keys, so several engine issues can collapse into
 * one form-field issue. When they do, prefer a `required` code (the strongest
 * signal: the field is empty) and keep the first message.
 */
function translateIssues(engineIssues: IntakeIssue[], sections: IntakeSectionSpec[]): IntakeIssue[] {
  const byFormKey = new Map<string, IntakeIssue>();
  const order: string[] = [];
  for (const iss of engineIssues) {
    const formKey = formKeyForEngineKey(sections, iss.field);
    const existing = byFormKey.get(formKey);
    if (!existing) {
      byFormKey.set(formKey, { field: formKey, code: iss.code, message: iss.message });
      order.push(formKey);
    } else if (existing.code !== 'required' && iss.code === 'required') {
      // Upgrade to the strongest signal.
      byFormKey.set(formKey, { field: formKey, code: 'required', message: iss.message });
    }
  }
  return order.map((k) => byFormKey.get(k)!);
}

function recordUsage(
  ctx: RunCtx,
  u: { provider: 'xai' | 'anthropic' | 'none'; model: string; tokensIn?: number; tokensOut?: number; cacheRead?: number; cacheWrite?: number },
): void {
  if (u.provider === 'none') return;
  try {
    aiUsageService.recordAsync({
      firmId: ctx.firmId,
      userId: ctx.userId,
      feature: 'drafting',
      provider: u.provider,
      model: u.model,
      ...(u.tokensIn !== undefined ? { tokensIn: u.tokensIn } : {}),
      ...(u.tokensOut !== undefined ? { tokensOut: u.tokensOut } : {}),
      ...(u.cacheRead !== undefined ? { cacheReadTokens: u.cacheRead } : {}),
      ...(u.cacheWrite !== undefined ? { cacheWriteTokens: u.cacheWrite } : {}),
    });
  } catch (err) {
    logger.warn({ err }, 'intake usage record failed (non-fatal)');
  }
}
