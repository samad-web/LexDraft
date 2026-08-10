// =============================================================================
// drafting-orchestrator.service — runs the four-stage AI drafting pipeline.
//
//   EXTRACT  (facts)  ->  CLASSIFY (KB-grounded sections)  ->  [gate]
//                     ->  DRAFT    (prose)                 ->  VERIFY (audit)
//
// Design goals (see drafting-prompts.ts for the per-stage contracts):
//   • Anti-hallucination: CLASSIFY may only pick from offence-KB candidates; the
//     gate decides VERIFIED vs SUGGESTED per the KB `verification` status; DRAFT
//     is handed a fixed citation set; VERIFY re-audits the output.
//   • Graceful degradation (matches draft-extract.service): if the provider is
//     off, or any stage's LLM call fails or returns unparseable JSON, the stage
//     yields a safe empty/partial result and the pipeline continues, reporting
//     what it could and could not do. The orchestrator NEVER throws for AI
//     failure — only aiQuotaService.assertCanGenerate may throw (route -> 429).
//
// The result is a structured object, not a finished filing: the caller renders a
// review screen. `blocked` is true when VERIFY found unauthorised citations or
// old-law references — the UI must not allow export until an advocate resolves it.
// =============================================================================

import { env } from '../env';
import { logger } from '../logger';
import { aiQuotaService } from './ai-quota.service';
import { aiUsageService, type AiUsageFeature } from './ai-usage.service';
import { offenceKbService } from './offence-kb.service';
import {
  resolveProvider,
  providerTag,
  providerModel,
  complete,
  parseJsonLoose,
  type Provider,
} from '../lib/llm-drafting';
import type { NormalizedUsage } from '../lib/llm-usage';
import {
  buildExtractStage,
  buildClassifyStage,
  buildDraftStage,
  buildVerifyStage,
  type OffenceCandidate,
  type ResolvedSection,
  type DraftBlockSpec,
} from '../lib/drafting-prompts';
import type { OffenceEntry } from '../types/offence-kb.types';

// ---- Public shapes ---------------------------------------------------------

export interface DraftPipelineRequest {
  docType: string;
  forum: string;
  /** The advocate's brief — typed text or corrected voice transcript. */
  brief: string;
  /** Required field keys from the skeleton (drives needs_clarification). */
  requiredFields: string[];
  /** The AI-generated blocks the skeleton wants written (facts/grounds/prayer). */
  blocks: DraftBlockSpec[];
  provider?: 'xai' | 'anthropic';
}

export interface ExtractResult {
  parties?: Record<string, unknown>;
  case_refs?: Record<string, unknown>;
  dates?: unknown[];
  alleged_offences?: string[];
  relief_sought?: string | null;
  facts_narrative?: string;
  needs_clarification?: string[];
}

export interface ClassifySelection {
  id: string;
  confidence?: string;
  ingredients_met?: string[];
  ingredients_missing?: string[];
  why?: string;
}

export interface ClassifyResult {
  selected: ClassifySelection[];
  consider_instead: Array<{ id: string; reason: string }>;
  unresolved: string[];
}

export interface VerifyResult {
  pass: boolean;
  unauthorised_citations: string[];
  unsupported_facts: string[];
  placeholders_remaining: string[];
  old_law_references: string[];
  notes: string;
}

export interface DraftPipelineResult {
  modelUsed: string;
  /** Stages that ran with a real LLM vs degraded. */
  stagesRun: { extract: boolean; classify: boolean; draft: boolean; verify: boolean };
  facts: ExtractResult;
  /** Sections chosen by CLASSIFY, enriched with the verification gate outcome. */
  sections: Array<ResolvedSection & { id: string; status: string; confidence?: string; ingredientsMissing?: string[] }>;
  considerInstead: Array<{ id: string; citation: string; offenceName: string; reason: string }>;
  unresolvedOffences: string[];
  /** The drafted AI blocks, by block key. */
  draft: Record<string, string>;
  verify: VerifyResult | null;
  /** True when VERIFY flagged unauthorised/old-law citations — block export. */
  blocked: boolean;
  /** Human-readable notes about degradation / gaps, surfaced to the advocate. */
  advisories: string[];
}

const MAX_BRIEF_CHARS = 40_000;

function emptyExtract(): ExtractResult {
  return { alleged_offences: [], facts_narrative: '', needs_clarification: [] };
}

function toCandidate(e: OffenceEntry): OffenceCandidate {
  return {
    id: e.id,
    offenceName: e.offenceName,
    law: e.law,
    section: e.section,
    sectionTitle: e.sectionTitle,
    essentialIngredients: e.essentialIngredients,
    commonlyConfusedWith: e.commonlyConfusedWith,
  };
}

function citationOf(e: OffenceEntry): string {
  return `${e.law} ${e.section}`;
}

export const draftingOrchestratorService = {
  /**
   * Run the full pipeline. Never throws on AI failure — returns a structured
   * result with `stagesRun`/`advisories` describing any degradation. May throw
   * AiQuotaExceededError (route -> 429) before any real call.
   */
  async run(
    req: DraftPipelineRequest,
    ctx: { firmId: string | null; userId: string },
  ): Promise<DraftPipelineResult> {
    const provider = resolveProvider(req.provider);
    const advisories: string[] = [];
    const stagesRun = { extract: false, classify: false, draft: false, verify: false };

    // --- Provider off / bad input: degrade to a manual-entry shell ----------
    if (provider === 'none' || !req.brief.trim() || !ctx.userId || !ctx.firmId) {
      advisories.push('AI is disabled or the brief is empty — falling back to manual drafting.');
      return {
        modelUsed: 'fallback:none',
        stagesRun,
        facts: emptyExtract(),
        sections: [],
        considerInstead: [],
        unresolvedOffences: [],
        draft: {},
        verify: null,
        blocked: false,
        advisories,
      };
    }

    // Quota guard (may throw AiQuotaExceededError -> route maps to 429).
    await aiQuotaService.assertCanGenerate(ctx.firmId, ctx.userId);

    const recordUsage = (feature: AiUsageFeature, r: NormalizedUsage) => {
      aiUsageService.recordAsync({
        firmId: ctx.firmId, userId: ctx.userId, feature,
        provider, model: providerModel(provider),
        tokensIn: r.tokensIn, tokensOut: r.tokensOut,
        cacheReadTokens: r.cacheRead, cacheWriteTokens: r.cacheWrite,
      });
    };

    const callStage = async <T>(
      feature: AiUsageFeature,
      prompt: { system: string; user: string },
      maxTokens: number,
    ): Promise<T | null> => {
      try {
        const result = await complete(provider, prompt.system, prompt.user, maxTokens);
        recordUsage(feature, result);
        const obj = parseJsonLoose<T>(result.text);
        if (!obj) {
          logger.warn({ feature, raw: result.text.slice(0, 200) }, 'orchestrator: unparseable JSON');
        }
        return obj;
      } catch (err) {
        logger.warn({ err, feature }, 'orchestrator: stage LLM call failed');
        return null;
      }
    };

    // ---- STAGE 1: EXTRACT --------------------------------------------------
    const s1 = buildExtractStage({
      docType: req.docType,
      requiredFields: req.requiredFields,
      brief: req.brief.slice(0, MAX_BRIEF_CHARS),
    });
    const extracted = (await callStage<ExtractResult>('draft_extract', s1, 2500)) ?? emptyExtract();
    stagesRun.extract = true;
    const facts: ExtractResult = { ...emptyExtract(), ...extracted };
    if (!extracted || !extracted.facts_narrative) {
      advisories.push('Fact extraction was incomplete — review the facts before drafting.');
    }
    if (facts.needs_clarification && facts.needs_clarification.length > 0) {
      advisories.push(`Missing details the advocate should confirm: ${facts.needs_clarification.join('; ')}`);
    }

    // ---- Retrieval: KB candidates for the alleged offences -----------------
    const alleged = facts.alleged_offences?.length ? facts.alleged_offences : [];
    const candidateEntries = alleged.length ? offenceKbService.candidatesFor(alleged) : [];
    if (alleged.length && candidateEntries.length === 0) {
      advisories.push(`No knowledge-base match for: ${alleged.join(', ')}. Sections must be added manually.`);
    }

    // ---- STAGE 2: CLASSIFY (only if we have candidates) --------------------
    let classify: ClassifyResult = { selected: [], consider_instead: [], unresolved: alleged };
    if (candidateEntries.length > 0) {
      const s2 = buildClassifyStage({
        factsJson: JSON.stringify(facts),
        candidates: candidateEntries.map(toCandidate),
      });
      const raw = await callStage<ClassifyResult>('drafting', s2, 1500);
      stagesRun.classify = true;
      if (raw) {
        // HARD grounding guard: drop any id the model invented that is not a
        // real candidate — the model is instructed not to, but we enforce it.
        const candidateIds = new Set(candidateEntries.map((e) => e.id));
        classify = {
          selected: (raw.selected ?? []).filter((s) => candidateIds.has(s.id)),
          consider_instead: (raw.consider_instead ?? []).filter((c) => offenceKbService.getById(c.id)),
          unresolved: raw.unresolved ?? [],
        };
        const dropped = (raw.selected ?? []).length - classify.selected.length;
        if (dropped > 0) advisories.push(`${dropped} AI-proposed section(s) were rejected as not KB-backed.`);
      } else {
        advisories.push('Section classification failed — choose sections manually.');
      }
    }

    // ---- GATE: resolve each selection to VERIFIED vs SUGGESTED -------------
    const sections = classify.selected
      .map((sel) => {
        const entry = offenceKbService.getById(sel.id);
        if (!entry) return null;
        const isVerified = entry.verification === 'verified';
        return {
          id: entry.id,
          citation: citationOf(entry),
          offenceName: entry.offenceName,
          verified: isVerified,
          status: entry.verification,
          confidence: sel.confidence,
          ingredientsMissing: sel.ingredients_missing,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const anySuggested = sections.some((s) => !s.verified);
    if (anySuggested) {
      advisories.push('Some sections are not counsel-verified and are cited hedged (SUGGESTED) — confirm before filing.');
    }

    const considerInstead = classify.consider_instead
      .map((c) => {
        const e = offenceKbService.getById(c.id);
        return e ? { id: e.id, citation: citationOf(e), offenceName: e.offenceName, reason: c.reason } : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // ---- STAGE 3: DRAFT ----------------------------------------------------
    let draft: Record<string, string> = {};
    if (req.blocks.length > 0) {
      const s3 = buildDraftStage({
        docType: req.docType,
        forum: req.forum,
        factsJson: JSON.stringify(facts),
        sections: sections.map<ResolvedSection>((s) => ({ citation: s.citation, offenceName: s.offenceName, verified: s.verified })),
        blocks: req.blocks,
      });
      const raw = await callStage<Record<string, string>>('drafting', s3, 4000);
      stagesRun.draft = true;
      if (raw) {
        // Keep only requested block keys with string values.
        const wanted = new Set(req.blocks.map((b) => b.block));
        for (const [k, v] of Object.entries(raw)) {
          if (wanted.has(k) && typeof v === 'string') draft[k] = v;
        }
      } else {
        advisories.push('Draft generation failed — the skeleton is available for manual completion.');
      }
    }

    // ---- STAGE 4: VERIFY (audit the draft) ---------------------------------
    let verify: VerifyResult | null = null;
    let blocked = false;
    const draftText = Object.values(draft).join('\n\n').trim();
    if (draftText) {
      const allowed = sections.map((s) => s.citation);
      const s4 = buildVerifyStage({ draftText, allowedCitations: allowed, factsJson: JSON.stringify(facts) });
      const raw = await callStage<VerifyResult>('drafting', s4, 1200);
      stagesRun.verify = true;
      if (raw) {
        verify = {
          pass: Boolean(raw.pass),
          unauthorised_citations: raw.unauthorised_citations ?? [],
          unsupported_facts: raw.unsupported_facts ?? [],
          placeholders_remaining: raw.placeholders_remaining ?? [],
          old_law_references: raw.old_law_references ?? [],
          notes: raw.notes ?? '',
        };
        // Block export on the two dangerous classes: fabricated citations or
        // repealed-law references. Placeholders/unsupported-facts are surfaced
        // as advisories for the advocate but do not hard-block.
        blocked = verify.unauthorised_citations.length > 0 || verify.old_law_references.length > 0;
        if (blocked) {
          advisories.push('AUDIT BLOCK: the draft contains unauthorised or repealed-law citations. Export is disabled until reviewed.');
        }
        if (verify.unsupported_facts.length > 0) {
          advisories.push(`Draft contains assertions not backed by the brief: ${verify.unsupported_facts.join('; ')}`);
        }
      } else {
        // If we can't audit, be conservative: warn but don't hard-block.
        advisories.push('Self-audit did not run — advocate must review all citations manually before export.');
      }
    }

    return {
      modelUsed: providerTag(provider),
      stagesRun,
      facts,
      sections,
      considerInstead,
      unresolvedOffences: classify.unresolved,
      draft,
      verify,
      blocked,
      advisories,
    };
  },
};

// Re-export the Provider type for route/testing convenience.
export type { Provider };
