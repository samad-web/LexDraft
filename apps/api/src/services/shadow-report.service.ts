// =============================================================================
// shadow-report.service — classify engine-vs-model divergences from REAL pairs.
//
// The report is only meaningful on recorded real traffic. If there are no
// recorded pairs it says so and produces NOTHING — a shadow run on invented
// traffic tells us nothing, so we never fabricate one.
//
// Divergences are CLASSIFIED, not just listed:
//
//   CRITICAL  engine REFUSED where the model produced a draft — the model would
//             have shipped a legally-defective document. This is the category
//             that justifies the whole migration.
//   REVIEW    model blocked (its own citation audit) where the engine generated —
//             worth a look; usually a hallucinated-citation concern the engine
//             sidesteps by construction, but confirm.
//   AGREE     both refused, or both generated — record for confirmation
//             (compare grounds / sections), not an action item.
//   NOISE     narrative-wording differences and other cosmetic deltas. Counted
//             but never itemised — they are not decision divergences.
//   EXCLUDED  the engine errored or got invalid input on this pair — not a
//             decision divergence, excluded from findings (but surfaced as a
//             coverage caveat so a silently-broken engine isn't read as "agrees").
// =============================================================================

import { shadowRecorderService } from './shadow-recorder.service';

export type Severity = 'CRITICAL' | 'REVIEW' | 'AGREE' | 'NOISE' | 'EXCLUDED';

export interface Finding {
  severity: Severity;
  summary: string;
  detail?: string;
}

export interface ShadowReport {
  docType: string;
  pairs: number;
  /** True only when there is real traffic to report on. */
  hasData: boolean;
  message: string;
  counts: Record<Severity, number>;
  findings: Finding[]; // CRITICAL + REVIEW only (the actionable ones)
}

interface ModelResult {
  blocked?: boolean;
  advisories?: string[];
  verify?: { old_law_references?: string[]; unauthorised_citations?: string[] } | null;
  sections?: Array<{ citation?: string }>;
}

interface EngineRefused {
  outcome: 'refused';
  refusal: { code: string; reason: string; fields_implicated: string[] };
}
interface EngineGenerated {
  outcome: 'generated';
}

function classifyPair(
  model: ModelResult,
  engineStatus: string,
  engine: unknown,
  docType: string,
): Finding {
  // Engine could not decide -> excluded from divergence findings, but flagged so
  // a broken engine is never mistaken for agreement.
  if (engineStatus === 'error' || engineStatus === 'invalid_input') {
    return {
      severity: 'EXCLUDED',
      summary: `engine ${engineStatus} — excluded from divergence analysis`,
    };
  }

  const modelBlocked = Boolean(model.blocked);
  const engineRefused = engineStatus === 'refused';

  if (engineRefused && !modelBlocked) {
    const r = (engine as EngineRefused).refusal;
    return {
      severity: 'CRITICAL',
      summary: `engine refused (${r.code}) but the model produced a draft`,
      detail:
        `The model would have shipped a legally-defective ${docType}: ${r.reason}. ` +
        `Implicated fields: ${r.fields_implicated.join(', ') || '—'}.`,
    };
  }

  if (modelBlocked && !engineRefused) {
    const v = model.verify ?? {};
    const why =
      (v.unauthorised_citations?.length ? `unauthorised: ${v.unauthorised_citations.join(', ')}; ` : '') +
      (v.old_law_references?.length ? `old-law: ${v.old_law_references.join(', ')}` : '');
    return {
      severity: 'REVIEW',
      summary: 'model blocked export but the engine generated',
      detail: `Model block reason(s): ${why || model.advisories?.join('; ') || '(unspecified)'}. ` +
        `The engine cites in-force codes by construction and refuses on legal defects, ` +
        `so a model citation-audit block often has no engine equivalent — confirm.`,
    };
  }

  // Both refused, or both generated -> agreement on the decision. (Section- and
  // wording-level comparison is a separate, lower-severity pass; wording deltas
  // are NOISE and not itemised.)
  if (engineRefused && modelBlocked) {
    return { severity: 'AGREE', summary: 'both blocked — confirm same ground' };
  }
  return { severity: 'AGREE', summary: 'both generated — compare citations (wording deltas are noise)' };
}

export const shadowReportService = {
  async build(docType: string): Promise<ShadowReport> {
    const pairs = await shadowRecorderService.list(docType);

    const counts: Record<Severity, number> = {
      CRITICAL: 0, REVIEW: 0, AGREE: 0, NOISE: 0, EXCLUDED: 0,
    };

    // The hard rule: no real traffic -> no report. Say so; do not invent.
    if (pairs.length === 0) {
      return {
        docType,
        pairs: 0,
        hasData: false,
        message:
          `No recorded ${docType} pairs. Shadow mode reports only on REAL captured ` +
          `traffic — run the drafting flow with the engine enabled so pairs are ` +
          `recorded, then re-run this report. (A shadow run on invented traffic ` +
          `tells us nothing, so none is generated.)`,
        counts,
        findings: [],
      };
    }

    const findings: Finding[] = [];
    for (const p of pairs) {
      const f = classifyPair(p.model as ModelResult, p.engineStatus, p.engine, docType);
      counts[f.severity] += 1;
      if (f.severity === 'CRITICAL' || f.severity === 'REVIEW') findings.push(f);
    }

    // Sort CRITICAL before REVIEW.
    findings.sort((a, b) => (a.severity === 'CRITICAL' ? -1 : 1) - (b.severity === 'CRITICAL' ? -1 : 1));

    const excludedNote = counts.EXCLUDED > 0
      ? ` ${counts.EXCLUDED} pair(s) excluded (engine error / invalid input) — ` +
        `these are NOT counted as agreement.`
      : '';

    return {
      docType,
      pairs: pairs.length,
      hasData: true,
      message:
        `${pairs.length} recorded ${docType} pair(s). ` +
        `${counts.CRITICAL} CRITICAL (engine refused, model drafted), ` +
        `${counts.REVIEW} to review, ${counts.AGREE} in agreement.${excludedNote} ` +
        `Shadow mode: nothing user-visible changed.`,
      counts,
      findings,
    };
  },
};
