// Pure scoring functions for drafting evaluation.
//
// No I/O, no LLM calls - just deterministic string analysis. Keeping this
// pure makes the runner trivially testable in isolation and lets us swap
// the scoring rubric without touching the orchestration layer.

import type { GoldenBrief } from './golden-briefs';

export interface BriefResult {
  briefId: string;
  pass: boolean;
  score: number;       // 0-100
  failures: string[];  // human-readable
  output: string;
  latencyMs: number;
  tokenEstimate: number;
}

const PENALTY = {
  MISSING_REQUIRED: 20,
  FORBIDDEN_PRESENT: 30,
  STRUCTURAL_FAIL: 10,
} as const;

const PASS_THRESHOLD = 70;

/** Rough estimate - Anthropic/xAI tokenisation isn't exact at 4 chars/token,
 *  but for cost-tracking-trend purposes this is fine. The eval harness uses
 *  it only for the aggregate "did this run get more expensive?" signal. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function containsCI(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Detect paragraph numbering of the form "1.", "1)", or "(1)" at the start
 *  of at least two distinct lines. A single numbered line could just be a
 *  list inside a paragraph - two means the document is actually structured. */
function hasParagraphNumbering(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let count = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(\(?\d{1,3}\)?[.)]\s+|\d{1,3}\.\s+)/.test(line)) {
      count += 1;
      if (count >= 2) return true;
    }
  }
  return false;
}

/** Loose "parties block" detection - Indian pleadings name the parties at the
 *  top under a "BETWEEN" / "Petitioner" / "Plaintiff" / "Appellant" / "Versus"
 *  banner. Any of those signals means the structural intent is present even
 *  if the exact heading varies by court and document type. */
function hasPartiesBlock(text: string): boolean {
  const hay = text.toLowerCase();
  const partyMarkers = ['petitioner', 'plaintiff', 'appellant', 'complainant', 'applicant'];
  const oppositionMarkers = ['respondent', 'defendant', 'opposite party', 'accused'];
  const hasParty = partyMarkers.some((m) => hay.includes(m));
  const hasOpposition = oppositionMarkers.some((m) => hay.includes(m));
  const hasConnector = /\b(versus|v\.|vs\.?|between)\b/i.test(text);
  // Need a party and either an opposition or a connector - covers ex-parte
  // forms (no respondent) that still use "BETWEEN".
  return hasParty && (hasOpposition || hasConnector);
}

function hasPrayer(text: string): boolean {
  const hay = text.toLowerCase();
  return (
    hay.includes('prayer')
    || hay.includes('pray')
    || hay.includes('reliefs sought')
    || hay.includes('it is therefore prayed')
  );
}

function hasVerification(text: string): boolean {
  const hay = text.toLowerCase();
  // "Verified at <place> on <date>" / "solemnly affirm" / "verification" heading.
  return (
    hay.includes('verification')
    || hay.includes('solemnly affirm')
    || hay.includes('verified at')
    || hay.includes('verily believe')
  );
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function evaluateBrief(
  brief: GoldenBrief,
  output: string,
  latencyMs: number,
): BriefResult {
  const failures: string[] = [];
  let score = 100;

  for (const needle of brief.expectations.mustInclude) {
    if (!containsCI(output, needle)) {
      failures.push(`missing required substring: "${needle}"`);
      score -= PENALTY.MISSING_REQUIRED;
    }
  }

  for (const needle of brief.expectations.mustNotInclude) {
    if (containsCI(output, needle)) {
      failures.push(`contains forbidden substring: "${needle}"`);
      score -= PENALTY.FORBIDDEN_PRESENT;
    }
  }

  const checks = brief.expectations.structuralChecks;
  if (checks.hasParagraphNumbers && !hasParagraphNumbering(output)) {
    failures.push('expected numbered paragraphs');
    score -= PENALTY.STRUCTURAL_FAIL;
  }
  if (checks.hasPartiesBlock && !hasPartiesBlock(output)) {
    failures.push('expected a parties block (Petitioner/Respondent or similar)');
    score -= PENALTY.STRUCTURAL_FAIL;
  }
  if (checks.hasPrayer && !hasPrayer(output)) {
    failures.push('expected a prayer/relief section');
    score -= PENALTY.STRUCTURAL_FAIL;
  }
  if (checks.hasVerification && !hasVerification(output)) {
    failures.push('expected a verification clause');
    score -= PENALTY.STRUCTURAL_FAIL;
  }

  const wc = countWords(output);
  if (checks.maxWords !== undefined && wc > checks.maxWords) {
    failures.push(`word count ${wc} exceeds max ${checks.maxWords}`);
    score -= PENALTY.STRUCTURAL_FAIL;
  }
  if (checks.minWords !== undefined && wc < checks.minWords) {
    failures.push(`word count ${wc} below min ${checks.minWords}`);
    score -= PENALTY.STRUCTURAL_FAIL;
  }

  // Floor at 0, ceiling at 100 - multiple failures shouldn't push into
  // negatives or let a perfect-but-redundant brief score above 100.
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return {
    briefId: brief.id,
    pass: score >= PASS_THRESHOLD,
    score,
    failures,
    output,
    latencyMs,
    tokenEstimate: estimateTokens(output),
  };
}

export const SCORING = {
  PENALTY,
  PASS_THRESHOLD,
} as const;
