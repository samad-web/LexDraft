// =============================================================================
// form-gen/flags — per-doc-type switch between the legacy static form and the
// engine-generated form. REVERSIBLE and OFF by default.
//
// Flipping a doc type to the generated schema is the user-facing change (the advocate
// sees the new fields/labels and the draft routes to the engine). Gating it per doc
// type behind a flag means a single doc can be switched on — and rolled back — without
// a deploy: the flag is read at runtime, and can be overridden per-environment via
// VITE_FORMGEN_DOCTYPES (comma-separated engine slugs) without touching code.
//
// NOTHING is enabled here. Regular Bail stays OFF until the advocate confirms the gold
// template against a filed-and-accepted application (the last gate).
// =============================================================================

/**
 * Engine slugs whose GENERATED form is enabled. Empty = every doc type uses its
 * existing static schema (current behaviour, zero change). Add a slug here to flip it
 * on in code; OR set VITE_FORMGEN_DOCTYPES at runtime to override without a code change
 * (useful for staging / a quick rollback).
 */
const ENABLED_IN_CODE: ReadonlySet<string> = new Set<string>([
  // 'regular_bail',  // <- HELD: do not enable until advocate sign-off of the gold template
  // 'affidavit',     // <- HELD: presentation now covers matter_type/affidavit_kind (the
                       //    KNOWN LATENT BREAK in drafting.routes.ts) and all 14 required
                       //    engine fields, but still needs advocate sign-off against a
                       //    filed-and-accepted affidavit before this flips on for real users.
                       //    Verify via VITE_FORMGEN_DOCTYPES=affidavit first.
]);

/** Runtime override: VITE_FORMGEN_DOCTYPES="regular_bail,lease_deed". A leading "!"
 *  disables (e.g. "!regular_bail") so a bad flip can be killed without redeploying code. */
function runtimeOverrides(): { on: Set<string>; off: Set<string> } {
  const on = new Set<string>();
  const off = new Set<string>();
  const raw = (import.meta as { env?: Record<string, string> }).env?.VITE_FORMGEN_DOCTYPES;
  if (!raw) return { on, off };
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.startsWith('!')) off.add(part.slice(1));
    else on.add(part);
  }
  return { on, off };
}

/** Is the generated form enabled for this engine slug? Runtime "off" wins over
 *  everything (a kill switch); then runtime "on"; then the in-code set. */
export function isGeneratedFormEnabled(engineSlug: string): boolean {
  const { on, off } = runtimeOverrides();
  if (off.has(engineSlug)) return false;
  if (on.has(engineSlug)) return true;
  return ENABLED_IN_CODE.has(engineSlug);
}
