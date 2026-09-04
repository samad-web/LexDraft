// =============================================================================
// form-gen/types — the contract between the engine's field list and the web form.
//
// The engine's describe() gives field NAMES, KINDS, and required flags — never
// advocate-readable labels, grouping, ordering, or help. A flat list of 28 raw keys
// would be worse than today's hand-authored forms. So a generated form is the MERGE of:
//   1. the engine contract  (source of truth for which fields exist + their type), and
//   2. per-doc PRESENTATION METADATA authored here (label, section, order, help,
//      conditional visibility, placeholder/default).
//
// Presentation metadata is OPTIONAL and PARTIAL: any field it doesn't annotate falls
// back to a humanised label + a default section, so an un-annotated doc type still
// renders usably (just less polished). The engine contract — not the metadata — decides
// which fields exist, so the form can never drift from what the engine accepts.
// =============================================================================

/** The engine field kinds, mirrored from describe() (see dump_engine_contract.py). */
export type EngineKind = 'string' | 'date' | 'enum' | 'int' | 'bool' | 'string_list' | 'list';

/** One field as the engine reports it (from the committed contract snapshot). */
export interface EngineField {
  key: string;
  kind: EngineKind;
  required: boolean;
  enumValues?: string[];
}

/** One doc type's engine contract entry (subset of engine-doc-contract.json). */
export interface EngineContractEntry {
  title: string;
  required: string[];
  all: string[];
  fields: EngineField[];
}

/** Per-field presentation overrides. All optional — omitted parts fall back. */
export interface FieldPresentation {
  /** Advocate-readable label. Falls back to a humanised key. */
  label?: string;
  /** Section title this field belongs under. Falls back to the default section. */
  section?: string;
  /** Order within its section (ascending). Falls back to contract order. */
  order?: number;
  /** Help text shown under the field. */
  help?: string;
  placeholder?: string;
  default?: string;
  /** Number of rows — promotes a string to a textarea when > 1. */
  rows?: number;
  /** Nicer labels for enum option values, keyed by the raw engine value. */
  enumLabels?: Record<string, string>;
  /** Conditional visibility: show this field only when another field has a value.
   *  { field: 'is_successive', equals: true } — shown when is_successive is truthy/equal. */
  visibleWhen?: { field: string; equals: string | number | boolean };
  /** Hide this field from the form entirely (e.g. an engine field the advocate should
   *  never set directly — it's derived). It is still sent absent → engine 422 if required,
   *  which is the correct signal, so only hide genuinely-optional/derived fields. */
  hidden?: boolean;
}

/** A doc type's presentation metadata: ordered sections + per-field overrides. */
export interface DocPresentation {
  /** Category shown in the picker (maps to the web DocSchema.category). */
  category: string;
  /** One-line description under the doc title. */
  description: string;
  /** Section titles in display order. Fields are grouped into these; any field whose
   *  section isn't listed here goes into the default section, appended last. */
  sectionOrder: string[];
  /** Default section title for un-annotated fields. */
  defaultSection: string;
  /** Per-field overrides, keyed by engine field key. */
  fields: Record<string, FieldPresentation>;
}
