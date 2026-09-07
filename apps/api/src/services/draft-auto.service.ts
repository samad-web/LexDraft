// =============================================================================
// draft-auto.service — the ONE-INPUT drafting flow.
//
// The advocate gives a single free-form brief (typed or dictated). This service:
//   1. TRIAGE  — decides the document type, forum, and blocks (draft-triage).
//   2. PIPELINE — runs the grounded EXTRACT -> CLASSIFY(BNS/BNSS) -> DRAFT ->
//      VERIFY pipeline (drafting-orchestrator) with the triaged parameters.
// The advocate never picks a tab, a doc type, or fills a form — the agent
// understands the brief and produces the document.
//
// Returns the triage decision ALONGSIDE the pipeline result so the UI can show
// "Detected: Bail Application · Court of Session" and let the advocate override.
// =============================================================================

import { draftTriageService, type TriageResult } from './draft-triage.service';
import {
  draftingOrchestratorService,
  type DraftPipelineResult,
} from './drafting-orchestrator.service';

export interface AutoDraftRequest {
  /** The advocate's plain-language matter — typed or dictated transcript. */
  brief: string;
  provider?: 'xai' | 'anthropic';
  /** Optional override: if the advocate corrected the detected document, the
   *  UI resends the brief with the chosen docType to skip re-triage. */
  docTypeOverride?: string;
  /** Advocate-corrected offence-KB section ids: skip CLASSIFY, ground on these. */
  sectionsOverride?: string[];
  /** The advocate's own format text; the agent drafts into it. */
  templateFormat?: string;
}

export interface AutoDraftResult {
  /** What the agent decided the document is. */
  triage: {
    docType: string;
    forum: string;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
    /** The other documents the advocate could switch to. */
    alternatives: string[];
  };
  /** The grounded pipeline output (sections, drafted blocks, audit). Null when
   *  the agent is uncertain and is asking the advocate to confirm first. */
  pipeline: DraftPipelineResult | null;
  /** True when triage is uncertain (low confidence / snapped): the agent asks
   *  the advocate to confirm the document type before drafting. */
  needsConfirmation?: boolean;
}

export const draftAutoService = {
  async run(
    req: AutoDraftRequest,
    ctx: { firmId: string | null; userId: string },
  ): Promise<AutoDraftResult> {
    // --- Stage 0: TRIAGE — understand the brief, decide the document ---------
    let triage: TriageResult = await draftTriageService.triage(req.brief, req.provider);

    // Advocate override: honour a corrected doc type by re-triaging against it.
    if (req.docTypeOverride && req.docTypeOverride !== triage.docType) {
      const forced = await forceDocType(req.docTypeOverride, req.brief, req.provider);
      if (forced) triage = forced;
    }

    // --- Confirm-before-draft gate -------------------------------------------
    // The system prompt requires: if the document type/jurisdiction is uncertain,
    // CONFIRM before drafting. When the advocate has NOT explicitly picked a type
    // and triage is low-confidence (or its pick had to be snapped to a known
    // type), return the decision + alternatives and ask for confirmation — do
    // NOT run the pipeline. An explicit docTypeOverride means the advocate has
    // already confirmed, so we always draft.
    if (!req.docTypeOverride && (triage.confidence === 'low' || triage.snapped === true)) {
      return {
        triage: {
          docType: triage.docType,
          forum: triage.forum,
          confidence: triage.confidence,
          reasoning: triage.reasoning,
          alternatives: alternativesFor(triage.docType),
        },
        pipeline: null,
        needsConfirmation: true,
      };
    }

    // DRAFT-FIRST, always. We do NOT interrogate the advocate with a wall of
    // questions before drafting — that is exactly what makes a legal-tech tool
    // unusable. Like ChatGPT: say a sentence, get a draft. Whatever facts are
    // missing become clearly-bracketed [blanks] IN the draft (the DRAFT stage
    // prompt handles this), which the advocate fills in the editor — far faster
    // than answering fifteen questions first. The grounding/citation safety
    // still applies (the model can only cite resolved sections); only the
    // ask-before-drafting behaviour is removed.

    // --- Stages 1-4: the grounded pipeline, auto-parameterised ---------------
    const pipeline = await draftingOrchestratorService.run(
      {
        docType: triage.docType,
        forum: triage.forum,
        brief: req.brief,
        requiredFields: [],
        blocks: triage.blocks,
        ...(req.provider ? { provider: req.provider } : {}),
        ...(req.sectionsOverride ? { sectionsOverride: req.sectionsOverride } : {}),
        ...(req.templateFormat ? { templateFormat: req.templateFormat } : {}),
      },
      ctx,
    );

    return {
      triage: {
        docType: triage.docType,
        forum: triage.forum,
        confidence: triage.confidence,
        reasoning: triage.reasoning,
        alternatives: alternativesFor(triage.docType),
      },
      pipeline,
    };
  },
};

// Import the catalog lazily to avoid a cycle and to keep triage the single
// source of truth for the doc-type list.
import { TRIAGE_DOC_TYPES } from './draft-triage.service';

function alternativesFor(chosen: string): string[] {
  return TRIAGE_DOC_TYPES.map((t) => t.docType).filter((d) => d !== chosen);
}

/** Build a TriageResult for an advocate-forced doc type (skips the LLM pick). */
async function forceDocType(
  docType: string,
  _brief: string,
  _provider?: 'xai' | 'anthropic',
): Promise<TriageResult | null> {
  const entry = TRIAGE_DOC_TYPES.find((t) => t.docType === docType);
  if (!entry) return null;
  return {
    docType: entry.docType,
    forum: entry.defaultForum,
    blocks: entry.blocks,
    confidence: 'high',
    reasoning: 'Document type selected by the advocate.',
    snapped: false,
    modelUsed: 'override',
  };
}
