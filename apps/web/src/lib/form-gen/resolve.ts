// =============================================================================
// form-gen/resolve — the single integration point for the generated forms.
//
// resolveDocSchemas() returns the doc-type -> DocSchema map the drafting UI renders.
// For any doc type whose generated form is ENABLED (flags.ts) and that has both an
// engine contract and presentation metadata, it exposes the GENERATED schema under the
// ENGINE label (so the draft routes to the engine) and drops the legacy static label.
// Every other doc type is returned exactly as today.
//
// While all flags are OFF (current state), this returns DOC_SCHEMAS unchanged — a true
// no-op. That is what makes the flip reversible: enable a flag -> the doc swaps to the
// generated schema; disable it (or set VITE_FORMGEN_DOCTYPES="!slug") -> it reverts,
// no deploy.
// =============================================================================

import { DOC_SCHEMAS, type DocSchema } from '../doc-schemas';
import { LABEL_TO_ENGINE_DOC, LEGACY_LABEL_FOR_SLUG } from './engine-labels';
import { generateDocSchema, fallbackPresentation } from './generate';
import { isGeneratedFormEnabled } from './flags';
import { PRESENTATIONS } from './presentation';
import engineContract from '../../../../api/src/lib/__tests__/engine-doc-contract.json';
import type { EngineContractEntry } from './types';

const CONTRACT = engineContract as unknown as Record<string, EngineContractEntry>;

/** The legacy (static) DOC_SCHEMAS label for an engine slug, so we can drop it when the
 *  generated form replaces it. */
function legacyLabelFor(slug: string): string | undefined {
  return LEGACY_LABEL_FOR_SLUG[slug];
}

/** Engine label (the routing label) for a slug. */
function engineLabelFor(slug: string): string | undefined {
  for (const [label, s] of Object.entries(LABEL_TO_ENGINE_DOC)) {
    if (s === slug) return label;
  }
  return undefined;
}

export function resolveDocSchemas(): Record<string, DocSchema> {
  const out: Record<string, DocSchema> = { ...DOC_SCHEMAS };

  for (const slug of Object.keys(CONTRACT)) {
    if (!isGeneratedFormEnabled(slug)) continue;
    const engineLabel = engineLabelFor(slug);
    if (!engineLabel) continue; // not a routable label -> skip
    const contract = CONTRACT[slug];
    if (!contract) continue;
    const pres = PRESENTATIONS[slug] ?? fallbackPresentation(contract);

    // Expose the generated schema under the ENGINE label so engineActive fires.
    out[engineLabel] = generateDocSchema(contract, pres);
    // Drop the legacy static label if it differs (so the picker shows one entry).
    const legacy = legacyLabelFor(slug);
    if (legacy && legacy !== engineLabel) delete out[legacy];
  }
  return out;
}
