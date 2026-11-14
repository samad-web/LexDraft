// =============================================================================
// draft-revise.service — one-line redraft instructions on a finished draft.
//
// The advocate types what to change ("make the prayer firmer", "add a clause on
// interest at 18% p.a.") and gets back a PROPOSED set of paragraph edits, never a
// silently rewritten document. The UI shows before/after and the advocate accepts
// or discards.
//
// Design rules:
//   - The model returns EDITS (replace / insert_after / delete by paragraph
//     index), not a whole new draft. Untouched paragraphs stay byte-identical, so
//     the engine .docx write-back (apply-edits) keeps the court layout whenever
//     the paragraph count is unchanged.
//   - It never invents facts. Anything the instruction needs but does not supply
//     becomes a ____ blank and is listed in `questions`.
//   - A deterministic guard (findIntroduced) then flags any citation, section,
//     amount or date in the edited text that appears in NEITHER the original
//     draft NOR the instruction. Those are surfaced as warnings — the model's
//     own promise is not trusted.
//   - Multi-paragraph redraft: a `focus` range (a selection or a whole section)
//     is ENFORCED, not just suggested — edits outside it are dropped. When no
//     range is given and the instruction names a section the draft has ("rewrite
//     the grounds stronger"), that section becomes the range.
//   - An instruction that came from the AI review (`source: 'review'`) is not
//     the advocate's own words, so it does NOT whitelist figures for the guard:
//     anything new must already be in the draft.
// =============================================================================

import { logger } from '../logger';
import { complete, parseJsonLoose, providerModel, resolveProvider, type Provider } from '../lib/llm-drafting';
import { creditService } from './credit.service';
import { countWords, reviseCredits } from '../lib/credit-costs';
import { aiUsageService } from './ai-usage.service';
import { localEdit } from '../lib/draft-local-edit';

export const MAX_REVISE_PARAGRAPHS = 2_000;
export const MAX_REVISE_CHARS = 80_000;

export interface ReviseRequest {
  docType: string;
  instruction: string;
  paragraphs: string[];
  /** Optional 0-based inclusive range the advocate wants changed. */
  focus?: { from: number; to: number };
  /** Who wrote the instruction. 'review' = an AI-review fix the advocate chose to
   *  apply; its text is model output, so the guard does not trust it. */
  source?: 'advocate' | 'review';
  provider?: 'xai' | 'anthropic';
}

/** The paragraph range a revision was limited to (null = whole draft). */
export interface ReviseScope {
  from: number;
  to: number;
  /** Section heading when the range is a detected section, else null. */
  label: string | null;
}

export type ReviseEdit =
  | { op: 'replace'; index: number; text: string }
  | { op: 'insert_after'; index: number; text: string }
  | { op: 'delete'; index: number };

export interface ReviseResult {
  /** The full paragraph list after applying the edits. */
  paragraphs: string[];
  /** Indices (into the ORIGINAL list) that were replaced or deleted. */
  changed: number[];
  /** Number of paragraphs added. */
  inserted: number;
  /** Before/after for each replaced (after = text) or deleted (after = null) paragraph. */
  diff: Array<{ index: number; before: string; after: string | null }>;
  /** Text of the added paragraphs, in document order. */
  added: string[];
  summary: string;
  /** Facts the instruction needs but did not give — left as ____ blanks. */
  questions: string[];
  /** Citations / figures in the edits found in neither the draft nor the instruction. */
  warnings: string[];
  /** The range edits were limited to, or null when the whole draft was open. */
  scope: ReviseScope | null;
}

export class ReviseUnavailableError extends Error {
  constructor(message = 'AI revision is not configured') {
    super(message);
    this.name = 'ReviseUnavailableError';
  }
}

const SYSTEM = `You revise Indian legal drafts for an advocate. You receive the draft as numbered paragraphs and ONE instruction.

Return ONLY a JSON object:
{"edits":[{"op":"replace","index":N,"text":"..."},{"op":"insert_after","index":N,"text":"..."},{"op":"delete","index":N}],"summary":"one sentence","questions":["..."]}

Rules:
- Change ONLY what the instruction requires. Do not touch other paragraphs. Prefer "replace" over insert/delete.
- "insert_after" with index -1 inserts at the very top. Each edit "text" is ONE paragraph, no line breaks.
- Never invent facts, names, dates, amounts, case law or section numbers. Use only what is already in the draft or stated in the instruction.
- If the instruction needs a fact that is not given, write ____ in its place and add a short question to "questions".
- Do not add judgments or case citations unless the instruction gives them verbatim.
- Keep the draft's language, numbering style, tense and person (e.g. "the Complainant", "I state that").
- If the instruction is not a drafting change, return {"edits":[],"summary":"<why>","questions":[]}.`;

function numbered(paragraphs: string[]): string {
  return paragraphs.map((p, i) => `[${i}] ${p}`).join('\n');
}

// ---- Sections ---------------------------------------------------------------
// Headings Indian pleadings use. A paragraph that IS one of these (optionally
// numbered, optionally ending in ":") opens a section; one that STARTS with it
// followed by ":" / "-" ("PRAYER: It is prayed…") opens a section that includes
// itself.
const SECTION_WORDS =
  '(?:brief\\s+)?(?:statement\\s+of\\s+)?facts?(?:\\s+of\\s+the\\s+case)?|grounds?(?:\\s+of\\s+\\w+)?|prayers?|reliefs?(?:\\s+sought)?|' +
  'interim\\s+(?:relief|prayer)|jurisdiction|limitation|cause\\s+of\\s+action|valuation(?:\\s+and\\s+court\\s+fee)?|court\\s+fees?|' +
  'verification|list\\s+of\\s+(?:documents|witnesses)|submissions?|averments?|particulars|description\\s+of\\s+the\\s+\\w+';
const NUMBERING = '(?:[A-Z]\\.|[IVXL]+\\.|\\d+\\.|\\(\\w+\\))?\\s*';
const HEADING_ONLY = new RegExp(`^\\s*${NUMBERING}(${SECTION_WORDS})\\s*[:.\\-–—]?\\s*$`, 'i');
const HEADING_INLINE = new RegExp(`^\\s*${NUMBERING}(${SECTION_WORDS})\\s*[:\\-–—]\\s*\\S`, 'i');

export interface DraftSection {
  /** Heading as written, e.g. "GROUNDS". */
  title: string;
  /** Inclusive 0-based paragraph range of the section's CONTENT. */
  from: number;
  to: number;
}

/** Lines that end a section without opening another: the place/date and
 *  signature block, or a new cause title ("IN THE COURT OF …"). All-caps
 *  sub-headings inside the grounds ("A. THE ARREST IS ILLEGAL") do NOT end it. */
const END_MARKER = /^\s*(?:place|dated?|station)\s*[:-]|^\s*(?:advocate|counsel)s?\s+for\b|^\s*(?:through|filed\s+by)\b|^\s*in\s+the\s+(?:hon'?ble\s+)?(?:high\s+)?court\b|^\s*before\s+the\b|^\s*\/*\s*true\s+copy/i;

/** Split a draft into its named sections (facts, grounds, prayer, …). Only
 *  headings from the known list open a section; a section runs to the next
 *  heading or the place/signature block. Exported for tests. */
export function detectSections(paragraphs: string[]): DraftSection[] {
  const opens: Array<{ title: string; index: number; inline: boolean }> = [];
  const closes = new Set<number>();
  paragraphs.forEach((p, i) => {
    const only = HEADING_ONLY.exec(p);
    if (only) { opens.push({ title: p.trim().replace(/[:.\-–—\s]+$/, ''), index: i, inline: false }); return; }
    const inline = HEADING_INLINE.exec(p);
    if (inline) { opens.push({ title: inline[1]!.trim().toUpperCase(), index: i, inline: true }); return; }
    if (END_MARKER.test(p)) closes.add(i);
  });
  const out: DraftSection[] = [];
  opens.forEach((o, k) => {
    const from = o.inline ? o.index : o.index + 1;
    const nextOpen = opens[k + 1]?.index ?? paragraphs.length;
    let to = nextOpen - 1;
    for (let i = from + 1; i <= to; i += 1) {
      if (closes.has(i)) { to = i - 1; break; }
    }
    if (from <= to && from < paragraphs.length) out.push({ title: o.title, from, to });
  });
  return out;
}

// Instruction words -> the heading they point at.
const SECTION_HINTS: Array<{ rx: RegExp; heading: RegExp }> = [
  { rx: /\bgrounds?\b/i, heading: /ground/i },
  { rx: /\b(?:prayer|reliefs?)\b/i, heading: /prayer|relief/i },
  { rx: /\bfacts?\b/i, heading: /fact/i },
  { rx: /\bjurisdiction\b/i, heading: /jurisdiction/i },
  { rx: /\blimitation\b/i, heading: /limitation/i },
  { rx: /\bcause of action\b/i, heading: /cause of action/i },
  { rx: /\bverification\b/i, heading: /verification/i },
];

/** When the instruction names exactly one section the draft has ("rewrite the
 *  grounds stronger"), that section. Exported for tests. */
export function sectionFromInstruction(instruction: string, paragraphs: string[]): DraftSection | null {
  const sections = detectSections(paragraphs);
  const hits = new Set<DraftSection>();
  for (const { rx, heading } of SECTION_HINTS) {
    if (!rx.test(instruction)) continue;
    for (const s of sections) if (heading.test(s.title)) hits.add(s);
  }
  return hits.size === 1 ? [...hits][0]! : null;
}

/** Drop edits outside the focus range. Inserts may land right before the range
 *  (index from-1) or anywhere inside it. Exported for tests. */
export function limitToFocus(edits: ReviseEdit[], focus: { from: number; to: number }): ReviseEdit[] {
  return edits.filter((e) => {
    if (!e || typeof e.index !== 'number') return false;
    if (e.op === 'insert_after') return e.index >= focus.from - 1 && e.index <= focus.to;
    return e.index >= focus.from && e.index <= focus.to;
  });
}

/** Apply edits to the original list. Invalid / duplicate indices are dropped.
 *  Exported for tests. */
export function applyReviseEdits(
  original: string[],
  edits: ReviseEdit[],
): {
  paragraphs: string[];
  changed: number[];
  inserted: number;
  diff: Array<{ index: number; before: string; after: string | null }>;
  added: string[];
} {
  const replaced = new Map<number, string>();
  const deleted = new Set<number>();
  const inserts = new Map<number, string[]>();
  const inRange = (i: unknown): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < original.length;

  for (const e of edits) {
    if (e.op === 'replace' && inRange(e.index) && typeof e.text === 'string' && e.text.trim()) {
      if (!deleted.has(e.index)) replaced.set(e.index, e.text.replace(/\s*\n+\s*/g, ' ').trim());
    } else if (e.op === 'delete' && inRange(e.index)) {
      replaced.delete(e.index);
      deleted.add(e.index);
    } else if (
      e.op === 'insert_after' && typeof e.index === 'number' && Number.isInteger(e.index) &&
      e.index >= -1 && e.index < original.length && typeof e.text === 'string' && e.text.trim()
    ) {
      const list = inserts.get(e.index) ?? [];
      list.push(e.text.replace(/\s*\n+\s*/g, ' ').trim());
      inserts.set(e.index, list);
    }
  }

  const out: string[] = [...(inserts.get(-1) ?? [])];
  original.forEach((p, i) => {
    if (!deleted.has(i)) {
      const next = replaced.get(i) ?? p;
      out.push(next);
    }
    out.push(...(inserts.get(i) ?? []));
  });

  const changed = [...new Set([...replaced.keys()].filter((i) => replaced.get(i) !== original[i]).concat([...deleted]))]
    .sort((a, b) => a - b);
  const added = [...inserts.entries()].sort(([a], [b]) => a - b).flatMap(([, l]) => l);
  const diff = changed.map((i) => ({
    index: i,
    before: original[i]!,
    after: deleted.has(i) ? null : replaced.get(i)!,
  }));
  return { paragraphs: out, changed, inserted: added.length, diff, added };
}

// Patterns for things that must never appear from nowhere in a legal draft.
const GUARDED: Array<{ label: string; rx: RegExp }> = [
  { label: 'case citation', rx: /\(\d{4}\)\s*\d+\s*SCC\s*\d+|\d{4}\s*SCC\s*OnLine\s*[A-Za-z]+\s*\d+|AIR\s*\d{4}\s*[A-Z][A-Za-z]*\s*\d+|\d{4}\s*\(\d+\)\s*[A-Z]{2,}\s*\d+/g },
  { label: 'case name', rx: /\b[A-Z][A-Za-z.&']+(?:\s+[A-Z][A-Za-z.&']+){0,4}\s+v(?:s)?\.?\s+[A-Z][A-Za-z.&']+(?:\s+(?:of\s+)?[A-Z][A-Za-z.&']+){0,4}/g },
  { label: 'section', rx: /\b(?:sections?|sec\.?|u\/s\.?|§)\s*\d+[A-Z]*(?:\s*\(\d+\))*(?:\s*\([a-z]\))?/gi },
  { label: 'order/rule', rx: /\border\s+[IVXLC\d]+\s*,?\s*rules?\s+\d+[A-Z]*/gi },
  { label: 'amount', rx: /(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?(?:\s*(?:lakhs?|crores?))?|\b\d+(?:\.\d+)?\s*%/gi },
  { label: 'date', rx: /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b/gi },
];

const norm = (s: string) => s.toLowerCase().replace(/[\s.,]+/g, '');

/** Each citation / figure present in `edited` but in neither `original` nor
 *  `instruction`, with its kind. Exported for the review service + tests. */
export function findIntroducedDetailed(
  original: string,
  instruction: string,
  edited: string[],
): Array<{ label: string; hit: string }> {
  const haystack = norm(`${original}\n${instruction}`);
  const seen = new Set<string>();
  const out: Array<{ label: string; hit: string }> = [];
  for (const text of edited) {
    for (const { label, rx } of GUARDED) {
      for (const m of text.matchAll(rx)) {
        const hit = m[0].trim();
        const key = `${label}|${hit}`;
        if (hit && !seen.has(key) && !haystack.includes(norm(hit))) {
          seen.add(key);
          out.push({ label, hit });
        }
      }
    }
  }
  return out;
}

/** Citations / figures present in `edited` but in neither `original` nor `instruction`.
 *  Exported for tests. */
export function findIntroduced(original: string, instruction: string, edited: string[]): string[] {
  return findIntroducedDetailed(original, instruction, edited)
    .map(({ label, hit }) => `New ${label} not in the draft or your instruction: "${hit}"`);
}

interface RawRevise {
  edits?: ReviseEdit[];
  summary?: string;
  questions?: string[];
}

export const draftReviseService = {
  async revise(req: ReviseRequest, ctx: { firmId: string | null; userId: string }): Promise<ReviseResult> {
    // An exact edit needs no model: no cost, no quota, nothing else touched.
    // A review fix is model text, so only the advocate's own words qualify.
    if (req.source !== 'review') {
      const local = localEdit(req.instruction, req.paragraphs);
      const scope = local ? resolveScope(req) : null;
      const edits = local && scope ? limitToFocus(local.edits, scope) : local?.edits;
      if (local && edits?.length) {
        return { ...applyReviseEdits(req.paragraphs, edits), summary: local.summary, questions: [], warnings: local.warnings, scope };
      }
    }

    const provider: Provider = resolveProvider(req.provider);
    if (provider === 'none') throw new ReviseUnavailableError();

    const scope = resolveScope(req);
    // ½ credit per page rewritten (the paragraphs in scope), min ½. 402 when
    // out; refunded when the model call fails or its answer can't be read.
    const inScope = scope ? req.paragraphs.slice(scope.from, scope.to + 1) : req.paragraphs;
    const credit = await creditService.charge(ctx, 'revise', reviseCredits(countWords(inScope.join('\n'))));
    try {
    const focusLine = scope
      ? `\nSCOPE: only paragraphs [${scope.from}]-[${scope.to}]${scope.label ? ` (the ${scope.label} section)` : ''} may change. ` +
        'You may rewrite any or all of them, split one into several (replace + insert_after) or merge them (replace + delete), ' +
        `and add new paragraphs inside the range (insert_after an index from ${scope.from - 1} to ${scope.to}). ` +
        'Keep their heading lines and numbering style. Edits outside the range are discarded.'
      : '';
    const user =
      `Document type: ${req.docType}\n\nDRAFT:\n${numbered(req.paragraphs)}\n\n` +
      `INSTRUCTION: ${req.instruction.trim()}${focusLine}`;

    // A whole-section rewrite returns many paragraphs; give it room.
    const span = scope ? scope.to - scope.from + 1 : 0;
    const result = await complete(provider, SYSTEM, user, span > 3 ? 8000 : 4000);
    aiUsageService.recordAsync({
      firmId: ctx.firmId, userId: ctx.userId, feature: 'drafting',
      provider, model: providerModel(provider),
      tokensIn: result.tokensIn, tokensOut: result.tokensOut,
      cacheReadTokens: result.cacheRead, cacheWriteTokens: result.cacheWrite,
    });

    const raw = parseJsonLoose<RawRevise>(result.text);
    if (!raw) {
      await credit.refund();
      logger.warn({ raw: result.text.slice(0, 200) }, 'draft-revise: unparseable JSON');
      return {
        paragraphs: req.paragraphs, changed: [], inserted: 0, diff: [], added: [],
        summary: 'The revision could not be read. Try rephrasing the instruction.',
        questions: [], warnings: [], scope,
      };
    }

    const proposed = Array.isArray(raw.edits) ? raw.edits.filter((e) => e && typeof e === 'object') : [];
    const edits = scope ? limitToFocus(proposed, scope) : proposed;
    const applied = applyReviseEdits(req.paragraphs, edits);
    const editedTexts = edits
      .filter((e): e is Extract<ReviseEdit, { text: string }> => e.op !== 'delete' && typeof (e as { text?: unknown }).text === 'string')
      .map((e) => e.text);
    // A review fix is model text, so it does not vouch for any figure in it.
    const trusted = req.source === 'review' ? '' : req.instruction;

    return {
      ...applied,
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      questions: Array.isArray(raw.questions) ? raw.questions.filter((q) => typeof q === 'string').slice(0, 10) : [],
      warnings: findIntroduced(req.paragraphs.join('\n'), trusted, editedTexts),
      scope,
    };
    } catch (err) {
      await credit.refund();
      throw err;
    }
  },
};

/** The range a revision is limited to: the client's focus (clamped to the
 *  draft), else a section the instruction names, else null (whole draft). */
function resolveScope(req: ReviseRequest): ReviseScope | null {
  const last = req.paragraphs.length - 1;
  if (req.focus) {
    const from = Math.max(0, Math.min(req.focus.from, last));
    const to = Math.max(from, Math.min(req.focus.to, last));
    const section = detectSections(req.paragraphs).find((s) => s.from === from && s.to === to);
    return { from, to, label: section?.title ?? null };
  }
  const section = sectionFromInstruction(req.instruction, req.paragraphs);
  return section ? { from: section.from, to: section.to, label: section.title } : null;
}
