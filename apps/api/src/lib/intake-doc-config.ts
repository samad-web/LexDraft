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
  /**
   * Optional starting value seeded into the fact sheet when the intake begins,
   * before the advocate says anything. Used for practice defaults that hold for
   * most matters of this type (e.g. Tamil-Nadu s.138 filings itemise documents
   * and pray for twice the cheque amount). The advocate can still change it; the
   * extractor overwrites it if the narration says otherwise.
   */
  default?: string;
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

/** Additional cheque rows (2..MAX_CHEQUES) for the COMPLAINT, mapped to the
 *  engine's cheques[i].* list slots with per-cheque bank/branch/drawer/payee. A
 *  s.138 complaint routinely runs on several cheques (four in the reference TN
 *  filing), so these matter more here than on the single-cheque notice. */
function complaintExtraChequeFields(): IntakeFieldConfig[] {
  const out: IntakeFieldConfig[] = [];
  for (let i = 2; i <= MAX_CHEQUES; i += 1) {
    const j = i - 1; // form cheque #2 -> engine cheques[1]
    out.push(
      { key: `cheque_no_${i}`, label: `Cheque ${i} — number`, type: 'text', required: false, engineKeys: [`cheques[${j}].number`] },
      { key: `cheque_date_${i}`, label: `Cheque ${i} — date`, type: 'date', required: false, engineKeys: [`cheques[${j}].date`] },
      { key: `cheque_amount_${i}`, label: `Cheque ${i} — amount`, type: 'currency', required: false, engineKeys: [`cheques[${j}].amount`] },
      { key: `drawee_bank_${i}`, label: `Cheque ${i} — bank & branch`, type: 'text', required: false, engineKeys: [`cheques[${j}].bank`, `cheques[${j}].branch`] },
    );
  }
  return out;
}

// s.138 COMPLAINT — the court filing (distinct from the pre-litigation notice
// above). Hand-tuned so the fields read the way an advocate thinks about a
// complaint, grouped into the sections of the actual document, with Tamil-Nadu
// practice defaults pre-seeded (itemised document schedule + twice-the-cheque-
// amount prayer). Form key == engine key here (passthrough), so most fields need
// no engineKeys override.
const s138Complaint: IntakeSectionSpec[] = [
  {
    title: 'Complainant',
    fields: [
      { key: 'complainant_name', label: 'Complainant name (payee / holder in due course)', type: 'text', required: true },
      { key: 'complainant_parentage', label: "Complainant's parentage (S/o, D/o, W/o)", type: 'text', required: false },
      { key: 'complainant_address', label: 'Complainant address', type: 'textarea', required: false },
      {
        key: 'is_payee',
        label: 'Is the complainant the payee or holder in due course?',
        type: 'select',
        options: ['Yes', 'No'],
        required: true,
        default: 'Yes',
        hint: 'A s.138 complaint can only be filed by the payee or holder in due course.',
      },
      {
        key: 'is_holder_in_due_course',
        label: 'Does the complainant sue as a holder in due course (not the payee)?',
        type: 'select',
        options: ['Yes', 'No'],
        required: false,
        default: 'No',
        hint: 'Answer "Yes" only where the cheque was negotiated to the complainant (s.9 NI Act). Most complainants are the payee — leave "No" and para 1 will plead "payee".',
      },
    ],
  },
  {
    title: 'Accused',
    fields: [
      { key: 'accused_name', label: 'Accused name (drawer of the cheque)', type: 'text', required: true },
      { key: 'accused_parentage', label: "Accused's parentage (S/o, D/o, W/o)", type: 'text', required: false },
      { key: 'accused_address', label: 'Accused address', type: 'textarea', required: false },
    ],
  },
  {
    title: 'Cheques',
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
        hint: 'Bank and branch, e.g. "Karur Vysya Bank, Godown Street, Chennai"',
      },
      ...complaintExtraChequeFields(),
    ],
  },
  {
    title: 'Underlying debt',
    fields: [
      { key: 'debt_slot', label: 'The legally enforceable debt / liability', type: 'textarea', required: false, hint: 'What the cheque was issued to discharge — e.g. price of goods supplied on credit against invoices.' },
    ],
  },
  {
    title: 'Presentation & dishonour',
    fields: [
      {
        key: 'deferment_agreement_date',
        label: 'Deferment agreement date (if the cheques were held & re-presented)',
        type: 'date',
        required: false,
        hint: 'Where the accused requested time and the parties agreed in writing to defer presentation. Leave blank if there was no deferment.',
      },
      { key: 'presentation_date', label: 'Date of (final) presentation', type: 'date', required: true, hint: 'If the cheques were re-presented after a deferment, use the last presentation date — it drives the s.138 limitation window.' },
      { key: 'memo_date', label: 'Date printed on the return memo', type: 'date', required: true },
      { key: 'memo_received_date', label: 'Date the complainant received the memo', type: 'date', required: true, hint: 'The limitation anchor — distinct from the date printed on the memo.' },
      {
        key: 'dishonour_reason',
        label: 'Reason for return',
        type: 'select',
        options: ['Funds Insufficient', 'Account Closed', 'Payment Stopped', 'Signature Differs', 'Refer to Drawer', 'Other'],
        required: true,
      },
    ],
  },
  {
    title: 'Statutory notice & service',
    fields: [
      { key: 'notice_date', label: 'Statutory notice date', type: 'date', required: true },
      { key: 'notice_dispatch_date', label: 'Notice dispatch date', type: 'date', required: true },
      { key: 'notice_delivery_date', label: 'Notice delivery / service date', type: 'date', required: false },
      { key: 'notice_ack_official_date', label: 'Service acknowledgement — official address (date)', type: 'date', required: false, hint: 'Date on the acknowledgement card for service at the accused’s office/official address.' },
      { key: 'notice_ack_residence_date', label: 'Service acknowledgement — residence (date)', type: 'date', required: false, hint: 'Date on the acknowledgement card for service at the accused’s residence.' },
    ],
  },
  {
    title: 'Jurisdiction & filing',
    fields: [
      {
        key: 'payee_bank_branch_in_jurisdiction',
        label: "Is the payee's collecting-bank branch within this court's jurisdiction?",
        type: 'select',
        options: ['Yes', 'No'],
        required: true,
        default: 'Yes',
        hint: 'Under s.142(2) NI Act, jurisdiction follows the branch where the cheque was presented for collection.',
      },
      { key: 'jurisdiction_basis', label: 'Jurisdiction basis (one sentence)', type: 'textarea', required: true, hint: 'e.g. "presented for collection through PNB Gopalapuram Branch, within this court’s territorial jurisdiction (s.142(2) NI Act)".' },
      { key: 'filing_date', label: 'Filing date', type: 'date', required: true },
      // REQUIRED so the intake asks for the real forum instead of the engine
      // falling back to a generic court (which produced "CRIMINAL COURT, CHENNAI"
      // on a real draft). The advocate must state the trying court.
      { key: 'court_designation', label: 'Court designation', type: 'text', required: true, hint: 'The court title only, e.g. "Metropolitan Magistrate, Fast Track Court-III" or "Judicial Magistrate No. II". Do NOT include the location/city here.' },
      { key: 'city', label: 'City', type: 'text', required: true, hint: 'e.g. "Chennai". Rendered last in the court title.' },
      { key: 'case_number_label', label: 'Case-number label', type: 'text', required: false, hint: 'The registry number label for the cause-title, e.g. "S.T.C. No." (Tamil Nadu cheque cases) or "C.C. No.". Leave blank for the generic "Criminal Complaint No.".' },
      { key: 'court_location', label: 'Court location', type: 'text', required: false, hint: 'The bench/area only, e.g. "Saidapet". Rendered after the designation.' },
      { key: 'place', label: 'Place (where the complaint is signed)', type: 'text', required: true },
    ],
  },
  {
    title: 'Document schedule & prayer',
    fields: [
      {
        key: 'itemise_documents',
        label: 'Itemise the document schedule (each cheque & memo separately)?',
        type: 'select',
        options: ['Yes', 'No'],
        required: false,
        default: 'Yes',
        hint: 'Tamil-Nadu practice lists each cheque and its return memo as separate numbered items, with the deferment agreement, notice and service cards.',
      },
      {
        key: 'prayer_twice_amount',
        label: 'Pray for twice the cheque amount (s.138 relief)?',
        type: 'select',
        options: ['Yes', 'No'],
        required: false,
        default: 'Yes',
        hint: 'The conventional s.138 prayer directs the accused to pay twice the dishonoured cheque amount (r/w s.395 BNSS).',
      },
      { key: 'extra_documents', label: 'Additional documents to list (one per line)', type: 'textarea', required: false, hint: 'e.g. GST certificate of the accused; bank statement of the complainant.' },
      { key: 'extra_witnesses', label: 'Additional witnesses (one per line)', type: 'textarea', required: false, hint: 'The complainant is added as CW-1 automatically; add bank managers or others here.' },
    ],
  },
  {
    title: 'Counsel for the complainant',
    fields: [
      { key: 'advocates', label: 'Advocate name(s) (one per line)', type: 'textarea', required: false, hint: 'The counsel on record for the complainant. One name per line — e.g. "M. Gowtham" / "M. Arunkumar" / "V. Srihari". Leave blank for a generic "Advocate" signature line.' },
      { key: 'advocate_enrolments', label: 'Bar enrolment number(s) (one per line, same order)', type: 'textarea', required: false, hint: 'One enrolment number per line, matching the advocate order above — e.g. "4687/2025". A name with no matching number is rendered without one.' },
      { key: 'advocate_contact', label: 'Counsel contact line', type: 'text', required: false, hint: 'A single contact line under the signature — e.g. "Mobile: 8056618648 | Email: chambers@example.com".' },
      { key: 'advocate_office_address', label: "Advocates' office address", type: 'textarea', required: false, hint: "The advocates' office address, pleaded in para 1 as the complainant's address for service — e.g. \"No. 160, 3rd Floor, Hussain Plaza, Thambu Chetty Street, Chennai-600001\"." },
    ],
  },
];

export const intakeDocConfig: Record<string, IntakeSectionSpec[]> = {
  s138_notice: s138,
  s138_complaint: s138Complaint,
};

/**
 * Collect the pre-seeded default values from a hand-tuned section spec — the
 * `{ formKey: default }` map to merge into a fresh fact sheet's `form` so
 * practice defaults (e.g. TN s.138 itemised schedule + twice-amount prayer) are
 * set before the advocate says anything. Fields without a `default` are omitted.
 */
export function seedDefaults(sections: IntakeSectionSpec[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sec of sections) {
    for (const f of sec.fields) {
      if (f.default !== undefined) out[f.key] = f.default;
    }
  }
  return out;
}

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
  // Present only when the field is CONDITIONALLY required (engine
  // FieldSpec.requires_when). Machine-readable: the field is required exactly when
  // the named sibling field equals this value. Emitted by the engine's describe()
  // for e.g. the affidavit's s.138 cheque/dishonour fields. No consumer reads it
  // yet — the type exists so the /doc-types contract is honest; conditional form
  // rendering is separate frontend work.
  required_when?: { field: string; equals: string };
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

/** How many rows of a derived `list` field (e.g. s138_complaint.cheques) we expose
 *  as indexed flat form keys. Row 0 mirrors the list's own `required` flag; rows
 *  1..N-1 are always optional and only surface in the fact sheet once filled. Kept
 *  small so the extractor's field contract stays compact. */
const MAX_LIST_ROWS = 6;

/** A list item's engine sub-kind mapped to the intake field type used for the flat
 *  per-row form key (so `amount`:int -> a number input, `date`:date -> a date input,
 *  and the extractor/coercer treat each cell correctly). */
function itemFieldType(f: EngineDescribeField): IntakeFieldConfig['type'] {
  return ENGINE_KIND_TO_INTAKE[f.kind] ?? 'text';
}

/**
 * Expand a required/optional engine `list` field with `item_fields` into INDEXED
 * FLAT form keys — `<listKey>_<row>_<subKey>` — one per item sub-field per row, up
 * to MAX_LIST_ROWS. Each flat key declares the exact `engineKeys:['<listKey>[row].<subKey>']`
 * so a `cheques[0].amount` 422 round-trips to the `cheques_0_amount` form field, and
 * engine-field-map's fold rebuilds the `<listKey>[]` records from these flat keys.
 * This replaces the single opaque textarea that coerceRecordList could never fill.
 */
function listFieldToFlatKeys(f: EngineDescribeField): IntakeFieldConfig[] {
  const out: IntakeFieldConfig[] = [];
  const items = f.item_fields ?? [];
  for (let row = 0; row < MAX_LIST_ROWS; row += 1) {
    for (const item of items) {
      const cfg: IntakeFieldConfig = {
        key: `${f.key}_${row}_${item.key}`,
        label: `${humanise(f.key)} ${row + 1} — ${humanise(item.key)}`,
        type: itemFieldType(item),
        // Only the FIRST row inherits the list's required-ness (a required list
        // needs at least one complete item); further rows are always optional.
        required: row === 0 ? f.required && item.required : false,
        engineKeys: [`${f.key}[${row}].${item.key}`],
      };
      if (item.kind === 'enum' && item.enum_values) cfg.options = item.enum_values;
      if (item.kind === 'bool') cfg.options = ['Yes', 'No'];
      out.push(cfg);
    }
  }
  return out;
}

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
  const fields: IntakeFieldConfig[] = desc.fields.flatMap((f) => {
    // A `list` of records (e.g. s138_complaint.cheques) MUST NOT collapse into one
    // opaque textarea — the extractor can only write prose into it, coerceRecordList
    // then drops the string, and the engine 422s on every `<list>[i].*` sub-field.
    // Expand it into indexed flat per-row sub-fields the extractor can fill and the
    // mapper folds back into the `<list>[]` records.
    if (f.kind === 'list' && (f.item_fields?.length ?? 0) > 0) {
      return listFieldToFlatKeys(f);
    }
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
    return [cfg];
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
