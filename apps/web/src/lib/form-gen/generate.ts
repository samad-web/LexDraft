// =============================================================================
// form-gen/generate — merge engine contract + presentation metadata -> DocSchema.
//
// The engine contract decides WHICH fields exist and their type; the presentation
// metadata decides how they READ (label/section/order/help). Every engine field is
// emitted; anything the metadata doesn't annotate falls back to a humanised label in
// the default section, so an un-annotated doc type still renders usably.
// =============================================================================

import type { DocField, DocFieldType, DocSchema, DocSection } from '../doc-schemas';
import type { DocPresentation, EngineContractEntry, EngineField, EngineKind } from './types';

/** Map an engine kind to a web DocFieldType. string_list/list are collected as a
 *  textarea (one item per line) — the field-map/mapper reshapes to the engine's list;
 *  bool becomes a select (Yes/No) so it round-trips as a string the mapper coerces. */
function webType(kind: EngineKind, rows?: number): DocFieldType {
  switch (kind) {
    case 'date': return 'date';
    case 'int': return 'number';
    case 'enum': return 'select';
    case 'bool': return 'select';
    case 'string_list':
    case 'list': return 'textarea';
    case 'string':
    default: return rows && rows > 1 ? 'textarea' : 'text';
  }
}

/** Humanise a snake_case key: 'accused_parentage' -> 'Accused parentage'. */
export function humanise(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Naive singular for a group noun used in row headings ('Cheques' -> 'Cheque'). Only
 *  the trivial plural; a presentation `itemNoun` overrides it for irregular cases. */
export function singularise(word: string): string {
  if (/ies$/i.test(word)) return word.replace(/ies$/i, 'y');
  if (/ses$/i.test(word)) return word.replace(/es$/i, '');
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.replace(/s$/i, '');
  return word;
}

/** Build one sub-record DocField for a list item field. Same mapping as a scalar, but
 *  driven by the item's own presentation (pres.itemFields[key]). */
function buildItemField(ef: EngineField, itemPres: Record<string, import('./types').FieldPresentation>): DocField {
  const p = itemPres[ef.key] ?? {};
  const type = webType(ef.kind, p.rows);
  const field: DocField = { key: ef.key, label: p.label ?? humanise(ef.key), type };
  if (ef.required) field.required = true; else field.optional = true;
  if (p.placeholder) field.placeholder = p.placeholder;
  if (p.help) field.help = p.help;
  if (ef.kind === 'enum' && ef.enumValues) {
    field.options = ef.enumValues.map((v) => p.enumLabels?.[v] ?? humanise(v));
  }
  if (ef.kind === 'bool') field.options = ['Yes', 'No'];
  return field;
}

/** Build one DocField from an engine field + its (optional) presentation override. */
function buildField(ef: EngineField, pres: DocPresentation): DocField | null {
  const p = pres.fields[ef.key] ?? {};
  if (p.hidden) return null;

  // LIST field -> a repeatable sub-record group.
  if (ef.kind === 'list' && ef.itemFields?.length) {
    const itemPres = p.itemFields ?? {};
    // order item sub-fields by presentation order then contract order
    const items = ef.itemFields
      .map((it, idx) => ({ it, order: itemPres[it.key]?.order ?? idx }))
      .sort((a, b) => a.order - b.order)
      .map(({ it }) => buildItemField(it, itemPres));
    const field: DocField = {
      key: ef.key,
      label: p.label ?? humanise(ef.key),
      type: 'list',
      itemFields: items,
      minItems: ef.minItems ?? (ef.required ? 1 : 0),
      itemNoun: p.itemNoun ?? singularise(humanise(ef.key)),
    };
    if (ef.required) field.required = true; else field.optional = true;
    if (p.help) field.help = p.help;
    if (p.prefillFromFirst) field.prefillFromFirst = p.prefillFromFirst;
    return field;
  }

  const type = webType(ef.kind, p.rows);
  const field: DocField = {
    key: ef.key,
    label: p.label ?? humanise(ef.key),
    type,
  };
  if (ef.required) field.required = true;
  else field.optional = true;
  if (p.placeholder) field.placeholder = p.placeholder;
  if (p.default !== undefined) field.default = p.default;
  if (p.rows && type === 'textarea') field.rows = p.rows;
  if (p.help) field.help = p.help;
  if (p.visibleWhen) field.visibleWhen = p.visibleWhen;

  if (ef.kind === 'enum' && ef.enumValues) {
    field.options = ef.enumValues.map((v) => p.enumLabels?.[v] ?? humanise(v));
  }
  if (ef.kind === 'bool') {
    field.options = ['Yes', 'No'];
  }
  if ((ef.kind === 'string_list' || ef.kind === 'list') && !field.placeholder) {
    field.placeholder = 'One per line';
  }
  return field;
}

/**
 * Generate a DocSchema for one doc type from its engine contract + presentation.
 * Every engine field is placed; presentation controls label/section/order/help; the
 * fallback keeps an un-annotated field usable.
 */
export function generateDocSchema(
  contract: EngineContractEntry,
  pres: DocPresentation,
): DocSchema {
  // Group fields by their (annotated or default) section, preserving contract order as
  // the tiebreak so an un-ordered section still reads in the adapter's declared order.
  const bySection = new Map<string, Array<{ field: DocField; order: number; idx: number }>>();
  contract.fields.forEach((ef, idx) => {
    const field = buildField(ef, pres);
    if (!field) return;
    const p = pres.fields[ef.key] ?? {};
    const section = p.section ?? pres.defaultSection;
    const order = p.order ?? Number.MAX_SAFE_INTEGER; // un-ordered -> after ordered ones
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push({ field, order, idx });
  });

  // Section display order: the declared sectionOrder first, then any extra sections
  // (including the default) that received fields, appended in first-seen order.
  const declared = pres.sectionOrder.filter((s) => bySection.has(s));
  const extra = [...bySection.keys()].filter((s) => !declared.includes(s));
  const orderedSections = [...declared, ...extra];

  const sections: DocSection[] = orderedSections.map((title) => {
    const items = bySection.get(title)!;
    items.sort((a, b) => (a.order - b.order) || (a.idx - b.idx));
    return { title, fields: items.map((i) => i.field) };
  });

  return { category: pres.category, description: pres.description, sections };
}

/** A minimal fallback presentation for a doc type with no authored metadata: one
 *  section, humanised labels, contract order. Keeps a brand-new doc type usable. */
export function fallbackPresentation(contract: EngineContractEntry): DocPresentation {
  return {
    category: 'Document',
    description: contract.title,
    sectionOrder: ['Details'],
    defaultSection: 'Details',
    fields: {},
  };
}
