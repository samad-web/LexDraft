// =============================================================================
// Drafting in Indian languages (build-docs/features/regional-languages.md).
//
// Every draft is finished in ENGLISH first, so every existing check (invented
// particulars, citations, amounts) runs on English text. This is the last step:
// the finished document's lines are translated by the drafting model, each line
// is checked (no AI) to keep its numbers, [placeholders] and table shape, and the
// translation is written back into the court .docx line for line (engine
// apply-edits), so layout and tables are unchanged.
//
//   - A line that fails the check stays English, with a note.
//   - High Court / Supreme Court filings are English only (Art. 348): such a
//     document is not translated and says so.
//   - Translated lines are cached per document, so a re-render (a live edit,
//     reopening the draft) translates only lines that changed.
//   - Charged once per document and language: ½ credit a page (user, 2026-11-16).
// =============================================================================

import type { IntakeDraft, IntakeState } from '@lexdraft/types';
import { env } from '../env';
import { claudeComplete } from '../lib/anthropic-client';
import { countWords, translateCredits } from '../lib/credit-costs';
import { logger } from '../logger';
import { aiUsageService } from './ai-usage.service';
import { CreditsExhaustedError, creditService } from './credit.service';
import { engineClient } from './engine-client.service';

export const DRAFT_LANGUAGES = {
  EN: { name: 'English', native: 'English' },
  HI: { name: 'Hindi', native: 'हिन्दी' },
  TA: { name: 'Tamil', native: 'தமிழ்' },
  TE: { name: 'Telugu', native: 'తెలుగు' },
  KN: { name: 'Kannada', native: 'ಕನ್ನಡ' },
  ML: { name: 'Malayalam', native: 'മലയാളം' },
  MR: { name: 'Marathi', native: 'मराठी' },
  GU: { name: 'Gujarati', native: 'ગુજરાતી' },
  BN: { name: 'Bengali', native: 'বাংলা' },
  PA: { name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  OR: { name: 'Odia', native: 'ଓଡ଼ିଆ' },
  AS: { name: 'Assamese', native: 'অসমীয়া' },
} as const;
export type DraftLang = keyof typeof DRAFT_LANGUAGES;
export const DRAFT_LANG_CODES = Object.keys(DRAFT_LANGUAGES) as [DraftLang, ...DraftLang[]];

interface Ctx { firmId: string | null; userId: string | null }

const BATCH = 25;        // lines per model call
const PARALLEL = 4;      // model calls at once
const HEADING_LINES = 12; // where the court is named

/** High Court / Supreme Court documents are filed in English only (Art. 348). */
export function englishOnlyForum(lines: string[]): boolean {
  return lines.slice(0, HEADING_LINES).some((l) => /\b(HIGH\s+COURT|SUPREME\s+COURT)\b/i.test(l));
}

const NUMBER = /\d[\d,./-]*\d|\d/g;
const PLACEHOLDER = /\[[^\]\n]+\]/g;
const isRow = (l: string) => /^\s*\|.*\|.*\|\s*$/.test(l);
const cellCount = (l: string) => l.trim().slice(1, -1).split('|').length;

/** No AI: the translation keeps every figure and [placeholder] of the English line,
 *  writes no new figure, and a table row stays a row with the same cells. */
export function keepsInvariants(src: string, out: string): boolean {
  if (!out.trim()) return false;
  const nums = (s: string) => (s.match(NUMBER) ?? []).sort().join(' ');
  if (nums(src) !== nums(out)) return false;
  for (const ph of src.match(PLACEHOLDER) ?? []) if (!out.includes(ph)) return false;
  if (isRow(src) !== isRow(out)) return false;
  return !isRow(src) || cellCount(src) === cellCount(out);
}

/** A line with no words outside brackets has nothing to translate. */
const needsTranslation = (l: string) => /\p{L}{2,}/u.test(l.replace(PLACEHOLDER, ''));

// Translated lines per document+language (English line -> translation). In-process
// and bounded; losing it only means re-translating (the charge is per document).
const cache = new Map<string, Map<string, string>>();
const CACHE_DOCS = 300;
function cacheFor(key: string): Map<string, string> {
  let c = cache.get(key);
  if (!c) {
    if (cache.size >= CACHE_DOCS) cache.delete(cache.keys().next().value as string);
    c = new Map();
    cache.set(key, c);
  }
  return c;
}

function systemPrompt(lang: DraftLang): string {
  const { name, native } = DRAFT_LANGUAGES[lang];
  return `You translate an Indian legal document, line by line, from English into ${name} (${native}), in the formal register used in courts, tribunals and government offices where ${name} is the official language.

Return ONLY a JSON array of strings: one translation per input line, same count, same order.

Keep EXACTLY as written in the English line:
- every number, date and amount (05.01.2026, Rs. 3,00,000/-, No. 262/2026), in Latin digits;
- every text in square brackets, e.g. [name of child to be provided];
- names of Acts, Codes and Sanhitas, and section / article / order / rule references (Section 138 of the Negotiable Instruments Act, 1881; Article 226);
- case names and citations;
- names of persons, firms, banks, places and courts as written;
- paragraph numbers and labels at the start of a line ("1.", "(a)", "A.").
A line of the form "| a | b |" is a table row: return it as a row with the same number of cells, translating only the words in each cell.
Translate everything else fully: headings, averments, the prayer, the verification. Use standard legal ${name} terms. Add nothing, drop nothing, no notes.`;
}

function parseArray(text: string, n: number): string[] | null {
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try {
    const arr = JSON.parse(text.slice(a, b + 1)) as unknown;
    return Array.isArray(arr) && arr.length === n && arr.every((s) => typeof s === 'string') ? (arr as string[]) : null;
  } catch {
    return null;
  }
}

async function translateBatch(lines: string[], lang: DraftLang, ctx: Ctx): Promise<string[] | null> {
  const r = await claudeComplete({
    system: systemPrompt(lang),
    user: JSON.stringify(lines),
    maxTokens: 16_000,
  });
  aiUsageService.recordAsync({
    firmId: ctx.firmId, userId: ctx.userId, feature: 'drafting',
    provider: 'anthropic', model: env.ANTHROPIC_MODEL, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
  });
  return parseArray(r.text, lines.length);
}

async function inParallel<T>(jobs: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]!();
    }
  }));
  return out;
}

/** Translate `lines` (cache first); a line that fails the check twice stays English. */
export async function translateLines(
  key: string, lines: string[], lang: DraftLang, ctx: Ctx,
): Promise<{ lines: string[]; keptEnglish: number }> {
  const known = cacheFor(key);
  let todo = [...new Set(lines.filter((l) => needsTranslation(l) && !known.has(l)))];
  for (let attempt = 0; attempt < 2 && todo.length; attempt += 1) {
    const batches: string[][] = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    const results = await inParallel(batches.map((b) => () => translateBatch(b, lang, ctx).catch((err) => {
      logger.warn({ err, lang }, 'draft-translate: batch failed');
      return null;
    })), PARALLEL);
    batches.forEach((b, i) => b.forEach((src, j) => {
      const out = results[i]?.[j];
      if (out !== undefined && keepsInvariants(src, out)) known.set(src, out.trim());
    }));
    todo = todo.filter((l) => !known.has(l));
  }
  return {
    lines: lines.map((l) => known.get(l) ?? l),
    keptEnglish: new Set(todo).size,
  };
}

/** One draft (or its companion) -> translated draft, Word file rewritten in place. */
async function translateDraft(
  key: string, draft: IntakeDraft, lang: DraftLang, ctx: Ctx,
): Promise<{ draft: IntakeDraft; keptEnglish: number } | null> {
  const src = draft.blocks.map((b) => b.text);
  const t = await translateLines(key, src, lang, ctx);
  let docxBase64 = draft.docxBase64;
  if (docxBase64) {
    docxBase64 = await engineClient.applyEdits(docxBase64, t.lines).catch((err) => {
      logger.warn({ err }, 'draft-translate: Word write-back failed');
      return null;
    });
    if (!docxBase64) return null; // preview and Word file must match: keep English
  }
  return {
    draft: { ...draft, docxBase64, blocks: draft.blocks.map((b, i) => ({ ...b, text: t.lines[i] ?? b.text })) },
    keptEnglish: t.keptEnglish,
  };
}

const note = (state: IntakeState, text: string): IntakeState =>
  ({ ...state, draftNotes: [...(state.draftNotes ?? []), text] });

export const draftTranslateService = {
  /** The generated intake draft in `lang` (English returns it unchanged). */
  async intake(ctx: Ctx, state: IntakeState, lang: DraftLang | null | undefined): Promise<IntakeState> {
    if (!lang || lang === 'EN' || state.status !== 'generated' || !state.draft) return state;
    const { name } = DRAFT_LANGUAGES[lang];
    const lines = state.draft.blocks.map((b) => b.text);
    if (englishOnlyForum(lines)) {
      return note(state, `This document is for the High Court or the Supreme Court, where filings must be in English, so it is drafted in English and not in ${name}.`);
    }
    const key = `${state.matterId}:${state.docLabel}:${lang}`;
    try {
      // Once per document and language, ½ credit a page; later
      // re-renders (live edits, reopening) only translate changed lines.
      const words = countWords([...lines, ...(state.companionDraft?.blocks ?? []).map((b) => b.text)].join('\n'));
      await creditService.charge(ctx, 'revise', translateCredits(words), `translate:${key}`, { kind: 'translate', lang });
    } catch (err) {
      if (err instanceof CreditsExhaustedError) {
        return note(state, `Not enough AI credits to translate this document into ${name}; it is shown in English.`);
      }
      throw err;
    }
    try {
      const main = await translateDraft(key, state.draft, lang, ctx);
      if (!main) return note(state, `The ${name} version could not be built, so the document is shown in English. Please try again.`);
      let out: IntakeState = { ...state, draft: main.draft };
      let kept = main.keptEnglish;
      if (state.companionDraft) {
        const comp = await translateDraft(`${key}:companion`, state.companionDraft, lang, ctx);
        if (comp) {
          out = { ...out, companionDraft: { ...state.companionDraft, ...comp.draft } };
          kept += comp.keptEnglish;
        }
      }
      return kept
        ? note(out, `${kept} line${kept === 1 ? '' : 's'} stayed in English because the ${name} version changed a figure or a [placeholder]. Please translate ${kept === 1 ? 'it' : 'them'} by hand.`)
        : out;
    } catch (err) {
      logger.warn({ err, lang }, 'draft-translate: failed; English kept');
      return note(state, `The ${name} version could not be built, so the document is shown in English. Please try again.`);
    }
  },
};
