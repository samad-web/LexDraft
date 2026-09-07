// =============================================================================
// intake-doc-config — the conversational intake field contract, per doc type.
//
// This is the extractor's CLOSED VOCABULARY and the fact-sheet view's layout,
// per document. Critically it also BRIDGES two key vocabularies:
//
//   * form key    — what the extractor fills and what engine-field-map reads
//                   (`sender_name`, `cheque_no`, `drawee_bank`, ...). One flat
//                   value per field; this is what the advocate is asked about.
//   * engine key  — what the engine's 422 `issues` reference on the way back
//                   (`client`, `cheques[0].branch`, ...). The engine speaks its
//                   own nested contract.
//
// The loop must translate engine-issue keys BACK to form keys so a "still
// missing: cheques[0].branch" issue becomes a question about the ONE form field
// the advocate fills (`drawee_bank`, which carries "Bank, Branch"). Each field
// declares the engine key(s) it is responsible for; `formKeyForEngineKey()`
// inverts that so issues land on the right conversational field.
//
// Sections mirror doc-schemas.ts (web) so the fact-sheet view reads like the
// document the advocate knows. Kept in sync by hand for now (s.138 only); a
// later pass can source this from GET /v1/doc-types + the web schema.
// =============================================================================

export interface IntakeFieldConfig {
  /** The flat form key the extractor fills / the advocate edits. */
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'number' | 'currency';
  options?: string[];
  required: boolean;
  /**
   * Engine inbound key(s) this form field is responsible for. When the engine
   * reports a 422 on any of these, the loop asks about THIS form field. Defaults
   * to [key] when the form key IS the engine key.
   */
  engineKeys?: string[];
  /** Optional hint shown in the fact-sheet view (not sent to the engine). */
  hint?: string;
}

export interface IntakeSectionSpec {
  title: string;
  fields: IntakeFieldConfig[];
}

import { MAX_CHEQUES } from './engine-field-map';

/** Field specs for cheques 2..MAX_CHEQUES — indexed form keys mapped to the
 *  engine's cheques[i].* list slots. Optional (a matter may have one cheque); the
 *  fact-sheet view only shows an extra-cheque field once it has a value. */
function extraChequeFields(): IntakeFieldConfig[] {
  const out: IntakeFieldConfig[] = [];
  for (let i = 2; i <= MAX_CHEQUES; i += 1) {
    const engIdx = i - 1; // form cheque #2 → engine cheques[1]
    out.push(
      { key: `cheque_no_${i}`, label: `Cheque ${i} — number`, type: 'text', required: false, engineKeys: [`cheques[${engIdx}].number`] },
      { key: `cheque_date_${i}`, label: `Cheque ${i} — date`, type: 'date', required: false, engineKeys: [`cheques[${engIdx}].date`] },
      { key: `cheque_amount_${i}`, label: `Cheque ${i} — amount`, type: 'currency', required: false, engineKeys: [`cheques[${engIdx}].amount`] },
      { key: `drawee_bank_${i}`, label: `Cheque ${i} — bank & branch`, type: 'text', required: false, engineKeys: [`cheques[${engIdx}].bank`, `cheques[${engIdx}].branch`] },
    );
  }
  return out;
}

// s.138 notice — mirrors doc-schemas.ts 'Notice u/s 138 NI Act' + mapS138's
// form->engine mapping. The engine key column matches mapS138 in
// apps/api/src/lib/engine-field-map.ts.
const s138: IntakeSectionSpec[] = [
  {
    title: 'Payee (sender of the notice)',
    fields: [
      { key: 'sender_name', label: 'Payee name', type: 'text', required: true, engineKeys: ['client', 'cheques[0].payee'] },
      { key: 'sender_address', label: 'Payee address', type: 'textarea', required: true, engineKeys: ['sender_address'] },
    ],
  },
  {
    title: 'Drawer (notice recipient)',
    fields: [
      { key: 'recipient_name', label: 'Drawer name (who issued the cheque)', type: 'text', required: true, engineKeys: ['recipient_name', 'cheques[0].drawer'] },
      { key: 'recipient_address', label: 'Drawer address', type: 'textarea', required: true, engineKeys: ['recipient_address'] },
    ],
  },
  {
    title: 'Cheque',
    fields: [
      { key: 'cheque_no', label: 'Cheque number', type: 'text', required: true, engineKeys: ['cheques[0].number'] },
      { key: 'cheque_date', label: 'Cheque date', type: 'date', required: true, engineKeys: ['cheques[0].date'] },
      { key: 'cheque_amount', label: 'Cheque amount', type: 'currency', required: true, engineKeys: ['cheques[0].amount'] },
      {
        key: 'drawee_bank',
        label: 'Drawee bank & branch',
        type: 'text',
        required: true,
        engineKeys: ['cheques[0].bank', 'cheques[0].branch'],
        hint: 'Bank and branch, e.g. "HDFC Bank, Connaught Place, New Delhi"',
      },
      // ADDITIONAL cheques (2..N): a s.138 matter can involve several cheques.
      // These are OPTIONAL and only surface in the fact sheet once a value is
      // captured for them (an empty extra-cheque row is hidden). The extractor
      // fills cheque_no_2 / cheque_amount_2 / cheque_date_2 / drawee_bank_2, and
      // the mapper folds them into the engine's cheques[] list.
      ...extraChequeFields(),
    ],
  },
  {
    title: 'Presentation',
    fields: [
      { key: 'presentation_date', label: 'Date the cheque was presented', type: 'date', required: true, engineKeys: ['presentation_date'] },
      { key: 'presentation_bank', label: "Bank where presented (payee's bank)", type: 'text', required: true, engineKeys: ['presentation_bank'] },
    ],
  },
  {
    title: 'Dishonour & liability',
    fields: [
      { key: 'dishonour_date', label: 'Date printed on the dishonour memo', type: 'date', required: true, engineKeys: ['memo_date'] },
      {
        key: 'memo_received_date',
        label: 'Date the payee received the memo (starts the notice clock)',
        type: 'date',
        required: true,
        engineKeys: ['memo_received_date'],
        hint: 'The limitation anchor — distinct from the date printed on the memo.',
      },
      {
        key: 'dishonour_reason',
        label: 'Reason for return',
        type: 'select',
        options: ['Funds Insufficient', 'Account Closed', 'Payment Stopped', 'Signature Differs', 'Refer to Drawer', 'Other'],
        required: true,
        engineKeys: ['dishonour_reason'],
      },
      { key: 'underlying_liability', label: 'Underlying transaction', type: 'textarea', required: true, engineKeys: ['debt_nature'] },
      { key: 'invoice_refs', label: 'Invoice / agreement references', type: 'text', required: false, engineKeys: ['debt_documents'] },
    ],
  },
  {
    title: 'Notice & service',
    fields: [
      { key: 'notice_date', label: 'Date of this notice', type: 'date', required: true, engineKeys: ['notice_date'] },
      { key: 'advocate_name', label: 'Advocate name', type: 'text', required: true, engineKeys: ['advocate'] },
      { key: 'advocate_enrolment', label: 'Advocate enrolment number', type: 'text', required: true, engineKeys: ['advocate_enrolment'] },
      {
        key: 'dispatch_mode',
        label: 'How the notice is sent',
        type: 'select',
        options: ['Registered Post Acknowledgement Due', 'Speed Post', 'Courier', 'Email', 'Hand Delivery'],
        required: true,
        engineKeys: ['dispatch_mode'],
      },
      { key: 'dispatch_tracking', label: 'Dispatch / tracking reference', type: 'text', required: true, engineKeys: ['dispatch_tracking_placeholder'] },
      { key: 'place', label: 'Place (from where the notice issues)', type: 'text', required: true, engineKeys: ['place'] },
    ],
  },
];

export const intakeDocConfig: Record<string, IntakeSectionSpec[]> = {
  s138_notice: s138,
};

// ---------------------------------------------------------------------------
// Deriving intake sections from the engine's own field contract.
//
// s.138 has a bespoke, hand-tuned config above (its form vocabulary differs from
// the engine's). Every other doc type is PASSTHROUGH — the form key IS the engine
// inbound key — so its intake config can be DERIVED from GET /v1/doc-types
// (adapter.describe()) instead of hand-maintained. That keeps one source of truth
// (the Python adapter) and means a new doc type is intake-drivable the moment its
// adapter exists. `formKeyForEngineKey` already falls back to the engine key, so a
// derived field (form key == engine key) round-trips cleanly.
// ---------------------------------------------------------------------------

/** The shape of one field in an engine `adapter.describe()` payload. */
export interface EngineDescribeField {
  key: string;
  kind: string; // 'string' | 'int' | 'bool' | 'date' | 'enum' | 'string_list' | 'list'
  required: boolean;
  enum_values?: string[];
  item_fields?: EngineDescribeField[];
}

export interface EngineDescribe {
  doc_type: string;
  title: string;
  fields: EngineDescribeField[];
  slots: string[];
}

const ENGINE_KIND_TO_INTAKE: Record<string, IntakeFieldConfig['type']> = {
  string: 'text',
  string_list: 'textarea',
  list: 'textarea',
  int: 'number',
  bool: 'select',
  date: 'date',
  enum: 'select',
};

/** Humanise an engine field key into a label: `cause_of_action_date` -> "Cause
 *  of action date". */
function humanise(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build an intake section spec from an engine describe() payload. All fields land
 * in one "Details" section (passthrough doc types don't carry the s.138 form's
 * hand-authored sectioning); the fact-sheet view still renders them, just flat.
 * Booleans and enums become selects; lists become a textarea the extractor fills.
 */
export function intakeSectionsFromDescribe(desc: EngineDescribe): IntakeSectionSpec[] {
  const fields: IntakeFieldConfig[] = desc.fields.map((f) => {
    const type = ENGINE_KIND_TO_INTAKE[f.kind] ?? 'text';
    const cfg: IntakeFieldConfig = {
      key: f.key,
      label: humanise(f.key),
      type,
      required: f.required,
      engineKeys: [f.key], // passthrough: form key IS the engine key
    };
    if (f.kind === 'enum' && f.enum_values) cfg.options = f.enum_values;
    if (f.kind === 'bool') cfg.options = ['Yes', 'No'];
    return cfg;
  });
  return [{ title: 'Details', fields }];
}

/**
 * Invert the engineKeys map: given an engine inbound key (or path) from a 422
 * issue, return the FORM key the loop should ask about. Matches exact keys and
 * indexed paths (`cheques[0].branch`). Falls back to the engine key itself when
 * no mapping is declared (so an unmapped issue still surfaces, just less nicely).
 */
export function formKeyForEngineKey(sections: IntakeSectionSpec[], engineKey: string): string {
  for (const sec of sections) {
    for (const f of sec.fields) {
      const keys = f.engineKeys ?? [f.key];
      if (keys.includes(engineKey)) return f.key;
    }
  }
  // Try a normalised match ignoring list indices: cheques[0].branch ~ cheques[].branch
  const norm = engineKey.replace(/\[\d+\]/g, '[0]');
  for (const sec of sections) {
    for (const f of sec.fields) {
      const keys = (f.engineKeys ?? [f.key]).map((k) => k.replace(/\[\d+\]/g, '[0]'));
      if (keys.includes(norm)) return f.key;
    }
  }
  return engineKey;
}
