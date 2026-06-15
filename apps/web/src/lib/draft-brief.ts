import type { DraftFieldSpec } from '@lexdraft/types';
import type { DocSchema } from './doc-schemas';

/**
 * Compact field spec sent to POST /drafting/extract-fields so the server can
 * extract values for exactly this document type's fields (the schema itself
 * lives only on the client).
 */
export function fieldSpecFor(schema: DocSchema): DraftFieldSpec[] {
  const out: DraftFieldSpec[] = [];
  for (const sec of schema.sections) {
    for (const f of sec.fields) {
      const spec: DraftFieldSpec = { key: f.key, label: f.label, type: f.type };
      if (f.options) spec.options = f.options;
      if (f.required) spec.required = true;
      out.push(spec);
    }
  }
  return out;
}

export interface BriefGuideSection {
  title: string;
  fields: Array<{ label: string; required: boolean }>;
}

/**
 * Render-ready "what to cover" guidance derived from the schema — the sample
 * prompt structure shown above the dictation box. Auto-derived so every doc
 * type gets guidance and it never drifts from the form.
 */
export function briefGuideFor(schema: DocSchema): BriefGuideSection[] {
  return schema.sections.map((sec) => ({
    title: sec.title,
    fields: sec.fields.map((f) => ({ label: f.label, required: Boolean(f.required) })),
  }));
}

/** The required fields (by label) still empty in `values` — the gaps to finish. */
export function missingRequiredLabels(schema: DocSchema, values: Record<string, string>): string[] {
  const out: string[] = [];
  for (const sec of schema.sections) {
    for (const f of sec.fields) {
      if (f.required && !(values[f.key] ?? '').toString().trim()) out.push(f.label);
    }
  }
  return out;
}
