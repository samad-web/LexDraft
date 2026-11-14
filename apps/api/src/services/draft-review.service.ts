// =============================================================================
// draft-review.service — a senior-counsel critique of a finished draft.
//
// "Review this draft" reads the current paragraphs and returns FINDINGS, never
// edits: missing or weak grounds, limitation, jurisdiction, missing mandatory
// averments, inconsistent facts/dates, a prayer the grounds don't support, and
// formatting defects. Each finding names the paragraph it is about and may carry
// a suggested fix, written as a redraft INSTRUCTION. "Apply fix" in the UI sends
// that instruction through /drafting/revise (source: 'review'), so the advocate
// gets the same proposal / accept / discard flow and the same citation guard.
//
// Never invents facts:
//   - The model is told to name a missing fact as `needs` instead of supplying it.
//   - A deterministic pass then checks every fix: a date or amount that is not
//     already in the draft turns the fix into a "needs" (the figure is dropped,
//     not trusted); a citation or section not in the draft stays but is listed
//     under `warnings` for the advocate to check. The revise guard re-checks the
//     actual edit when the fix is applied.
//   - Paragraph-numbering gaps/repeats are found by code, not the model.
// =============================================================================

import { logger } from '../logger';
import { complete, parseJsonLoose, providerModel, resolveProvider, type Provider } from '../lib/llm-drafting';
import { aiUsageService } from './ai-usage.service';
import { findIntroducedDetailed } from './draft-revise.service';

export const REVIEW_SEVERITIES = ['mandatory', 'important', 'minor'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const REVIEW_CATEGORIES = [
  'grounds', 'limitation', 'jurisdiction', 'averment', 'facts', 'prayer', 'format', 'other',
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

export interface ReviewRequest {
  docType: string;
  paragraphs: string[];
  provider?: 'xai' | 'anthropic';
}

export interface ReviewFinding {
  id: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  /** 0-based paragraph index the finding is about, or null (whole draft / missing). */
  paragraph: number | null;
  /** The start of that paragraph as it was reviewed, so the UI can re-find it
   *  if the draft changes before the fix is applied. */
  excerpt: string | null;
  /** The issue in one sentence. */
  issue: string;
  /** A redraft instruction that fixes it, or null when none is offered. */
  fix: string | null;
  /** Facts the fix needs that the draft does not contain. */
  needs: string[];
  /** Citations / sections in the fix that are not in the draft — check them. */
  warnings: string[];
}

export interface ReviewResult {
  summary: string;
  findings: ReviewFinding[];
}

export class ReviewUnavailableError extends Error {
  constructor(message = 'AI review is not configured') {
    super(message);
    this.name = 'ReviewUnavailableError';
  }
}

export const MAX_FINDINGS = 15;

const SYSTEM = `You are a senior advocate in India reviewing a junior's draft before it is filed. You receive the draft as numbered paragraphs.

Return ONLY a JSON object:
{"summary":"one or two sentences on the draft's overall fitness for filing","findings":[{"severity":"mandatory|important|minor","category":"grounds|limitation|jurisdiction|averment|facts|prayer|format|other","paragraph":N,"issue":"one sentence","fix":"an instruction to the redrafting assistant, or null","needs":["a fact the fix needs that the draft does not give"]}]}

Check, for this document type under Indian law and practice:
- Grounds: missing, weak, unsupported by the pleaded facts, or not tied to the relief.
- Limitation: is it averred, is the filing within time on the draft's own dates, is condonation needed and sought.
- Jurisdiction: territorial / pecuniary / subject-matter jurisdiction averred and consistent with the facts.
- Mandatory averments the law requires for this document type (e.g. for a s.138 NI Act complaint: presentation, dishonour, notice within 30 days, 15 days lapsed, complaint within one month; for bail: no other bail application pending, custody period).
- Inconsistent facts: names, dates, amounts, cheque or FIR numbers that differ between paragraphs; impossible date order.
- Prayer: relief asked for that the grounds do not support, or grounds argued with no matching relief.
- Format: cause title, numbering, verification, signature/advocate block, annexure references.

Rules:
- "paragraph" is the [N] index the finding is about; use null when the problem is something MISSING from the whole draft.
- "severity": "mandatory" ONLY for a defect that can get the pleading returned, rejected or dismissed (a missing statutory averment, limitation, jurisdiction). "important" for what weakens it. "minor" for style and form.
- Never invent facts, names, dates, amounts, case law or section numbers. A fix may use only what is already in the draft. If a fix needs a fact the draft does not give, write ____ in the fix and name the fact in "needs".
- Do not cite judgments. Name a statutory provision only if you are certain it is the current in-force provision (BNS / BNSS / BSA replace IPC / CrPC / Evidence Act).
- Write each "fix" as an instruction, e.g. "Add a paragraph after [6] averring that the complaint is filed within one month of the cause of action on ____".
- Do not report the existing [placeholders] or ____ blanks one by one; mention them once at most.
- At most ${MAX_FINDINGS} findings, most serious first. If the draft is sound, return few or none. Do not pad.`;

function numbered(paragraphs: string[]): string {
  return paragraphs.map((p, i) => `[${i}] ${p}`).join('\n');
}

interface RawFinding {
  severity?: unknown;
  category?: unknown;
  paragraph?: unknown;
  issue?: unknown;
  fix?: unknown;
  needs?: unknown;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const SEVERITY_RANK: Record<ReviewSeverity, number> = { mandatory: 0, important: 1, minor: 2 };

/** Turn the model's raw findings into checked ones: valid enums and indices,
 *  "needs:" pulled out of the fix text, and every fix guarded against figures
 *  the draft does not contain. Exported for tests. */
export function sanitizeFindings(raw: unknown, paragraphs: string[]): ReviewFinding[] {
  if (!Array.isArray(raw)) return [];
  const draft = paragraphs.join('\n');
  const out: ReviewFinding[] = [];
  for (const r of raw as RawFinding[]) {
    if (!r || typeof r !== 'object') continue;
    const issue = typeof r.issue === 'string' ? r.issue.replace(/\s+/g, ' ').trim() : '';
    if (!issue) continue;

    const severity = (REVIEW_SEVERITIES as readonly string[]).includes(r.severity as string)
      ? (r.severity as ReviewSeverity) : 'important';
    const category = (REVIEW_CATEGORIES as readonly string[]).includes(r.category as string)
      ? (r.category as ReviewCategory) : 'other';
    const idx = typeof r.paragraph === 'number' && Number.isInteger(r.paragraph)
      && r.paragraph >= 0 && r.paragraph < paragraphs.length ? r.paragraph : null;

    const needs = new Set<string>(
      Array.isArray(r.needs)
        ? (r.needs as unknown[]).filter((n): n is string => typeof n === 'string' && !!n.trim()).map((n) => clip(n.trim(), 160))
        : [],
    );

    let fix = typeof r.fix === 'string' ? r.fix.replace(/\s+/g, ' ').trim() : '';
    // "needs: date of arrest" written into the fix itself -> a need, not a fix.
    const inlineNeed = /^needs?\s*:\s*(.+)$/i.exec(fix);
    if (inlineNeed) {
      needs.add(clip(inlineNeed[1]!.trim(), 160));
      fix = '';
    }

    const warnings: string[] = [];
    if (fix) {
      for (const { label, hit } of findIntroducedDetailed(draft, '', [fix])) {
        if (label === 'amount' || label === 'date') {
          // A figure the draft never states is a FACT the model made up. Drop the
          // fix and ask for the fact instead of carrying the number forward.
          needs.add(`the ${label} to use (the suggestion gave "${hit}", which is not in the draft)`);
          fix = '';
          break;
        }
        warnings.push(`Not in the draft, check before applying: ${label} "${hit}"`);
      }
    }

    out.push({
      id: '',
      severity,
      category,
      paragraph: idx,
      excerpt: idx === null ? null : clip(paragraphs[idx]!.trim(), 140),
      issue: clip(issue, 400),
      fix: fix ? clip(fix, 1_000) : null,
      needs: [...needs].slice(0, 5),
      warnings: fix ? warnings : [],
    });
  }
  return out;
}

/** Paragraph-numbering defects found by code: a jump ("5." then "7.") or a
 *  repeat ("4." twice). Only the top-level "N." numbering of body paragraphs is
 *  read. Exported for tests. */
export function numberingFindings(paragraphs: string[]): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  let prev: { n: number; index: number } | null = null;
  paragraphs.forEach((p, index) => {
    const m = /^\s*(\d{1,3})\.\s+\S/.exec(p);
    if (!m) return;
    const n = Number(m[1]);
    // A restart at 1 begins a new list (prayer, list of documents) — not a defect.
    if (prev && n !== 1) {
      if (n === prev.n) {
        out.push(fmt(index, `Paragraph number ${n} is used twice.`));
      } else if (n > prev.n + 1) {
        out.push(fmt(index, `Paragraph numbering jumps from ${prev.n} to ${n}.`));
      }
    }
    prev = { n, index };
  });
  return out;

  function fmt(index: number, issue: string): ReviewFinding {
    return {
      id: '', severity: 'minor', category: 'format', paragraph: index,
      excerpt: clip(paragraphs[index]!.trim(), 140), issue,
      fix: 'Renumber the paragraphs so the numbering runs in sequence without gaps or repeats. Change nothing else.',
      needs: [], warnings: [],
    };
  }
}

/**
 * A reply cut off mid-findings: close the array after the last complete finding.
 * Tries each '}' from the end, so a half-written last finding is simply dropped.
 */
export function salvageReview(text: string): { summary?: unknown; findings?: unknown } | null {
  const body = text.replace(/```(?:json)?/gi, '');
  const start = body.indexOf('{');
  if (start === -1 || !/"findings"\s*:\s*\[/.test(body)) return null;
  let tries = 0;
  for (let i = body.lastIndexOf('}'); i > start && tries < 80; i = body.lastIndexOf('}', i - 1), tries += 1) {
    try {
      return JSON.parse(`${body.slice(start, i + 1)}]}`) as { summary?: unknown; findings?: unknown };
    } catch {
      // keep trimming
    }
  }
  return null;
}

export const draftReviewService = {
  async review(req: ReviewRequest, ctx: { firmId: string | null; userId: string }): Promise<ReviewResult> {
    const provider: Provider = resolveProvider(req.provider);
    if (provider === 'none') throw new ReviewUnavailableError();

    // Credits are charged by the route (POST /drafting/review).

    const user = `Document type: ${req.docType}\n\nDRAFT:\n${numbered(req.paragraphs)}`;
    // A long pleading's findings (excerpt + fix each) overran 4000 tokens and the
    // cut-off JSON lost the whole review; salvageReview() keeps what did complete.
    const result = await complete(provider, SYSTEM, user, 8000);
    aiUsageService.recordAsync({
      firmId: ctx.firmId, userId: ctx.userId, feature: 'drafting',
      provider, model: providerModel(provider),
      tokensIn: result.tokensIn, tokensOut: result.tokensOut,
      cacheReadTokens: result.cacheRead, cacheWriteTokens: result.cacheWrite,
    });

    const numbering = numberingFindings(req.paragraphs);
    const raw = parseJsonLoose<{ summary?: unknown; findings?: unknown }>(result.text) ?? salvageReview(result.text);
    if (!raw) {
      logger.warn({ raw: result.text.slice(0, 200) }, 'draft-review: unparseable JSON');
    }
    const model = raw ? sanitizeFindings(raw.findings, req.paragraphs) : [];
    // The model may also flag numbering; keep the code's version only once.
    const merged = [
      ...model.filter((f) => !(numbering.length > 0 && f.category === 'format' && /numbering|paragraph number|renumber/i.test(f.issue))),
      ...numbering,
    ]
      .map((f, i) => ({ f, i }))
      .sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.i - b.i)
      .slice(0, MAX_FINDINGS)
      .map(({ f }, i) => ({ ...f, id: `f${i + 1}` }));

    const summary = raw && typeof raw.summary === 'string' && raw.summary.trim()
      ? clip(raw.summary.replace(/\s+/g, ' ').trim(), 600)
      : raw ? '' : 'The review could not be read. Try again.';
    return { summary, findings: merged };
  },
};
