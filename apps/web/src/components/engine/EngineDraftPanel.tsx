// =============================================================================
// EngineDraftPanel — the ENGINE-routed draft surface (Phase 2, flagged), s.138.
//
// Imports ONLY the engine hooks — never useDrafting (the model hooks). For s.138
// there is no model call at all: the advocate's form is mapped to the engine
// contract server-side and the engine validates / refuses / generates. This panel
// renders the three outcomes with the right voice for each:
//
//   generated -> the draft blocks, under an on-screen review banner + sign-off.
//   refused   -> a conversational legal message (RefusalMessage), NOT an error.
//   422       -> an incomplete-form checklist (FormIncompleteMessage), NOT a refusal.
// =============================================================================

import { useState } from 'react';
import {
  useEngineDraft,
  useEngineSignOff,
  useEnsureMatter,
  EngineFormError,
  type EngineDraftResult,
  type EngineValidationIssue,
} from '@/hooks/useEngineDraft';
import { RefusalMessage } from './RefusalMessage';
import { FormIncompleteMessage } from './FormIncompleteMessage';
import { ReviewBanner } from './ReviewBanner';
import { DraftRenderView } from './DraftRenderView';

interface Props {
  docLabel: string;          // e.g. "Notice u/s 138 NI Act"
  /** An existing fact-sheet matter id. Optional — the panel creates one from the
   *  form on first draft when absent. */
  matterId?: string;
  form: Record<string, unknown>;
  extra?: Record<string, unknown>;
  /** Inbound-key -> human label, for refusal/validation field naming. */
  fieldLabels?: Record<string, string>;
  onHighlightFields?: (fields: string[]) => void;
}

export function EngineDraftPanel({
  docLabel,
  matterId: matterIdProp,
  form,
  extra,
  fieldLabels,
  onHighlightFields,
}: Props) {
  const ensureMatter = useEnsureMatter();
  const draft = useEngineDraft();
  const signOff = useEngineSignOff();

  // The matter this panel drafts against. Created on first draft from the form;
  // reused across re-drafts. Editing the facts and re-drafting commits a NEW
  // version (immutable revise), which is what makes a prior sign-off go stale.
  const [matterId, setMatterId] = useState<string | undefined>(matterIdProp);
  const [result, setResult] = useState<EngineDraftResult | null>(null);
  const [formIssues, setFormIssues] = useState<EngineValidationIssue[] | null>(null);
  const [bannerText, setBannerText] = useState<string>('');
  const [signOffError, setSignOffError] = useState<string | null>(null);

  const run = async () => {
    setResult(null);
    setFormIssues(null);
    setSignOffError(null);
    // The facts of record = the form + the extra fields. Committing them to the
    // fact sheet (create or revise) gives the engine the version to key on.
    const facts = { ...form, ...(extra ?? {}) };
    const ensured = await ensureMatter.mutateAsync(
      matterId ? { matterId, facts } : { facts },
    );
    setMatterId(ensured.matterId);
    try {
      const r = await draft.mutateAsync({
        docLabel, matterId: ensured.matterId, form, ...(extra ? { extra } : {}),
      });
      setResult(r);
      if (r.outcome === 'generated') setBannerText(r.signals.review_banner);
    } catch (err) {
      if (err instanceof EngineFormError) {
        // 422 — incomplete form. A DIFFERENT channel from a refusal: render the
        // checklist, never the refusal message.
        setFormIssues(err.issues);
      } else {
        throw err;
      }
    }
  };

  const doSignOff = async () => {
    if (!result || result.outcome !== 'generated' || !matterId) return;
    setSignOffError(null);
    try {
      await signOff.mutateAsync({
        docLabel,
        matterId,
        signedOn: new Date().toISOString().slice(0, 10),
        // The engine re-derives the banner from context + sign-off state; for the
        // slot-check it needs the same context, which for s.138 has no slots.
        context: { place: (form as Record<string, unknown>).place ?? '' },
      });
      setBannerText(''); // banner clears on screen — signed off as final
    } catch (err) {
      // 409: the document couldn't be finalised (an unfilled slot). s.138 has
      // none, but surface it faithfully if it ever happens.
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'This document can’t be marked final yet.';
      setSignOffError(msg);
    }
  };

  return (
    <div className="engine-panel">
      <button
        type="button"
        className="engine-panel__run"
        onClick={run}
        disabled={draft.isPending || ensureMatter.isPending}
      >
        {draft.isPending || ensureMatter.isPending
          ? 'Checking with the engine…'
          : 'Draft with the engine'}
      </button>

      {/* 422 — incomplete form. Its own component, its own gentle voice. */}
      {formIssues && (
        <FormIncompleteMessage
          issues={formIssues}
          {...(fieldLabels ? { fieldLabels } : {})}
          {...(onHighlightFields ? { onFocusField: (f) => onHighlightFields([f]) } : {})}
        />
      )}

      {/* Refusal — a legal finding, read conversationally. NOT an error box. */}
      {result?.outcome === 'refused' && (
        <RefusalMessage
          refusal={result.refusal}
          {...(fieldLabels ? { fieldLabels } : {})}
          {...(onHighlightFields ? { onHighlightFields } : {})}
        />
      )}

      {/* Generated — the draft, under an on-screen review banner + sign-off. */}
      {result?.outcome === 'generated' && (
        <div className="engine-panel__doc">
          <ReviewBanner
            bannerText={bannerText}
            unverifiedMarker={result.signals.unverified_marker}
            canSignOff={(result.unfilledSlots?.length ?? 0) === 0}
            signingOff={signOff.isPending}
            onSignOff={doSignOff}
            signOffError={signOffError}
          />
          {/* blocks[] are DISPLAY METADATA — the editable on-screen text. The FILING
              copy is the PDF/.docx below, rendered by the engine (single path). */}
          <article className="engine-panel__blocks" aria-label="Drafted document">
            {result.blocks.map((b) => (
              <p key={b.key} className="engine-panel__block">{b.text}</p>
            ))}
          </article>
          <DraftRenderView renderId={result.renderId} initialStatus={result.renderStatus} />
        </div>
      )}
    </div>
  );
}
