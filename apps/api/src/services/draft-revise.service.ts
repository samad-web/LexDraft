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
// =============================================================================

import { logger } from '../logger';
import { complete, parseJsonLoose, providerModel, resolveProvider, type Provider } from '../lib/llm-drafting';
import { aiQuotaService } from './ai-quota.service';
import { aiUsageService } from './ai-usage.service';

export const MAX_REVISE_PARAGRAPHS = 2_000;
export const MAX_REVISE_CHARS = 80_000;

export interface ReviseRequest {
  docType: string;
  instruction: string;
  paragraphs: string[];
  /** Optional 0-based inclusive range the advocate wants changed. */
  focus?: { from: number; to: number };
  provider?: 'xai' | 'anthropic';
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

/** Citations / figures present in `edited` but in neither `original` nor `instruction`.
 *  Exported for tests. */
export function findIntroduced(original: string, instruction: string, edited: string[]): string[] {
  const haystack = norm(`${original}\n${instruction}`);
  const found = new Set<string>();
  for (const text of edited) {
    for (const { label, rx } of GUARDED) {
      for (const m of text.matchAll(rx)) {
        const hit = m[0].trim();
        if (hit && !haystack.includes(norm(hit))) found.add(`New ${label} not in the draft or your instruction: "${hit}"`);
      }
    }
  }
  return [...found];
}

interface RawRevise {
  edits?: ReviseEdit[];
  summary?: string;
  questions?: string[];
}

export const draftReviseService = {
  async revise(req: ReviseRequest, ctx: { firmId: string | null; userId: string }): Promise<ReviseResult> {
    const provider: Provider = resolveProvider(req.provider);
    if (provider === 'none') throw new ReviseUnavailableError();

    // May throw AiQuotaExceededError -> route maps to 429.
    await aiQuotaService.assertCanGenerate(ctx.firmId, ctx.userId);

    const focusLine = req.focus
      ? `\nThe advocate selected paragraphs [${req.focus.from}]-[${req.focus.to}]. Limit edits to that range unless the instruction clearly needs a new paragraph next to it.`
      : '';
    const user =
      `Document type: ${req.docType}\n\nDRAFT:\n${numbered(req.paragraphs)}\n\n` +
      `INSTRUCTION: ${req.instruction.trim()}${focusLine}`;

    const result = await complete(provider, SYSTEM, user, 4000);
    aiUsageService.recordAsync({
      firmId: ctx.firmId, userId: ctx.userId, feature: 'drafting',
      provider, model: providerModel(provider),
      tokensIn: result.tokensIn, tokensOut: result.tokensOut,
      cacheReadTokens: result.cacheRead, cacheWriteTokens: result.cacheWrite,
    });

    const raw = parseJsonLoose<RawRevise>(result.text);
    if (!raw) {
      logger.warn({ raw: result.text.slice(0, 200) }, 'draft-revise: unparseable JSON');
      return {
        paragraphs: req.paragraphs, changed: [], inserted: 0, diff: [], added: [],
        summary: 'The revision could not be read. Try rephrasing the instruction.',
        questions: [], warnings: [],
      };
    }

    const edits = Array.isArray(raw.edits) ? raw.edits : [];
    const applied = applyReviseEdits(req.paragraphs, edits);
    const editedTexts = edits
      .filter((e): e is Extract<ReviseEdit, { text: string }> => e.op !== 'delete' && typeof (e as { text?: unknown }).text === 'string')
      .map((e) => e.text);

    return {
      ...applied,
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      questions: Array.isArray(raw.questions) ? raw.questions.filter((q) => typeof q === 'string').slice(0, 10) : [],
      warnings: findIntroduced(req.paragraphs.join('\n'), req.instruction, editedTexts),
    };
  },
};
