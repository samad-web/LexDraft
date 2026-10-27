import type { PipelineKind } from './case-pipeline.service';

// =============================================================================
// eCourts "purpose" -> DifAI pipeline stage
//
// eCourts describes where a case is with free text per hearing - "FOR
// EVIDENCE", "Cross Examination of PW1", "Framing of Charges", "For Orders",
// "Appearance", "WS" … - and it varies by state and court. The matter's
// pipeline uses a fixed catalog per kind (case-pipeline.service STAGE_CATALOG
// plus the firm's custom stages). This maps the first onto the second.
//
// Rules, in priority order; the first rule whose pattern matches AND whose
// stage exists in this matter's pipeline wins. No match -> null, and the
// caller leaves the pipeline where it is (a wrong move is worse than none).
// A disposed case maps to the judgment-type stage regardless of purpose.
// =============================================================================

interface Rule {
  re: RegExp;
  /** Candidate stage labels, tried in order against the matter's pipeline. */
  stages: string[];
}

const RULES: Rule[] = [
  // Specific multi-word phrases first, before the broad single words below.
  { re: /charge\s*-?\s*sheet|final\s+report/i, stages: ['Chargesheet'] },
  { re: /framing\s+of\s+charge|charge\s+fram|\bcharges?\b/i, stages: ['Framing of Charges'] },
  { re: /framing\s+of\s+issue|\bissues?\b/i, stages: ['Issues'] },
  { re: /cognizance/i, stages: ['Cognizance'] },
  { re: /rejoinder/i, stages: ['Rejoinder'] },
  { re: /written\s+statement|\bw\.?\s?s\.?\b|counter\s+affidavit|\bcounter\b/i, stages: ['Written Statement', 'Counter', 'Reply'] },
  { re: /\breply\b|objection/i, stages: ['Reply', 'Written Statement', 'Counter'] },
  { re: /\bi\.?\s?a\.?\b|interlocutory|interim\s+application|injunction|\bstay\b/i, stages: ['IA'] },
  // "Questioning" = questioning of the accused (s.313 CrPC / s.351 BNSS),
  // which closes the evidence stage in a criminal trial (seen live).
  { re: /evidence|examination|\bcross\b|\bchief\b|witness|deposition|\b[pd]\.?\s?w\.?\s?\d*\b|marking\s+of\s+(exhibit|document)|questioning|\b313\b|\b351\b|statement\s+of\s+(the\s+)?accused/i, stages: ['Evidence'] },
  { re: /argument|final\s+hearing/i, stages: ['Arguments'] },
  { re: /judg(e)?ment|pronounce|\bverdict\b|for\s+orders?|\border(s)?\b/i, stages: ['Judgment', 'Order'] },
  { re: /summons?|\bnotice\b|\bservice\b|appearance|\bprocess\b|\bunserved\b|\bserved\b/i, stages: ['Summons', 'Notice', 'Service'] },
  { re: /fir\b|investigation/i, stages: ['FIR'] },
  { re: /filing|registration|admission|scrutiny|\bdefects?\b|\bfresh\b|\bnew\s+case\b|\bfirst\s+hearing\b/i, stages: ['Filing'] },
];

const JUDGMENT_STAGES = ['Judgment', 'Order'];

/**
 * @param purpose   eCourts purpose_name (the current/next stage text)
 * @param available the matter's pipeline stage labels (catalog + firm extras)
 * @param disposed  eCourts reports the case disposed (disp_name set)
 * @returns a label from `available`, or null when nothing maps confidently
 */
export function mapEcourtsPurposeToStage(
  purpose: string | null | undefined,
  available: readonly string[],
  disposed = false,
): string | null {
  const byLower = new Map(available.map((s) => [s.toLowerCase(), s]));
  const pick = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const hit = byLower.get(c.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };

  if (disposed) return pick(JUDGMENT_STAGES);

  const text = (purpose ?? '').trim();
  if (!text) return null;

  // An exact (case-insensitive) match with one of the matter's own stages -
  // including firm custom stages - beats any rule.
  const exact = byLower.get(text.toLowerCase());
  if (exact) return exact;

  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    const hit = pick(rule.stages);
    if (hit) return hit;
  }
  return null;
}

/** Exposed for tests / callers that want the kind-specific catalog check. */
export type { PipelineKind };
