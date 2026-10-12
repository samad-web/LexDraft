// =============================================================================
// engine-field-map — translate the Draft-page FORM fields into the engine's
// inbound contract, per document type. The FORM keys (doc-schemas.ts, web) and
// the ENGINE keys (the Python adapter's inbound contract) are deliberately
// different vocabularies; this is the one place that bridges them.
//
// What this does NOT do: invent values. A field the form doesn't collect is left
// ABSENT so the engine adapter returns a 422 "required" for it — that is the
// correct behaviour (an incomplete form, surfaced as a form problem), NOT a made-
// up value that would let a defective draft through. See the s.138 map: fields
// the current form lacks (advocate enrolment, presentation/memo dates, dispatch
// proof, place) are passed through from `extra` when present and otherwise left
// for the 422 channel.
// =============================================================================

import { logger } from '../logger';
import engineDocContract from '@lexdraft/types/engine-doc-contract.json';

export interface MappedFields {
  fields: Record<string, unknown>;
}

/** How many cheques a single s.138 notice can carry. The engine accepts any N≥1;
 *  this caps the indexed form keys we scan (cheque_no_2 … cheque_no_N). */
export const MAX_CHEQUES = 12;

/** Coerce a currency/amount string like "4,75,000" or "475000" to an int. */
function toAmount(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const digits = v.replace(/[^0-9]/g, '');
    return digits ? Number.parseInt(digits, 10) : undefined;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * s.138 notice: form -> engine inbound contract.
 *
 * The form collects ONE cheque flat; the engine wants a `cheques` list, so we
 * build a single-element list. Fields the form does not collect are taken from
 * `extra` (an escape hatch the panel fills from the fact sheet / advocate) and,
 * if still absent, omitted — the engine then returns a 422 for each, which the UI
 * shows as "complete these fields", never as a legal refusal.
 */
/**
 * Build the engine `cheques` array from a LEGACY flat s.138 form (base keys + indexed
 * cheque_no_2…). Exported so the saved-draft migration converts old drafts with the
 * EXACT same logic the mapper uses — the migration can never diverge from the mapper.
 * drawer/payee are the same parties for every cheque (drawer = notice recipient, payee
 * = client/sender); the combined "Bank, Branch" string is split.
 */
export function buildChequesFromFlatForm(
  form: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const buildCheque = (suffix: string): Record<string, unknown> | null => {
    const number = str(form[`cheque_no${suffix}`]);
    const date = str(form[`cheque_date${suffix}`]);
    const amount = toAmount(form[`cheque_amount${suffix}`]);
    const bankBranch = str(form[`drawee_bank${suffix}`]);
    if (!number && !date && amount === undefined && !bankBranch) return null;
    return {
      number,
      date,
      amount,
      ...splitBankBranch(bankBranch),
      drawer: str(form.recipient_name),
      payee: str(form.sender_name),
    };
  };
  const cheques: Array<Record<string, unknown>> = [];
  const first = buildCheque('');
  if (first) cheques.push(first);
  for (let i = 2; i <= MAX_CHEQUES; i += 1) {
    const c = buildCheque(`_${i}`);
    if (c) cheques.push(c);
  }
  if (cheques.length === 0) {
    cheques.push({
      number: str(form.cheque_no),
      date: str(form.cheque_date),
      amount: toAmount(form.cheque_amount),
      ...splitBankBranch(str(form.drawee_bank)),
      drawer: str(form.recipient_name),
      payee: str(form.sender_name),
    });
  }
  return cheques;
}

function mapS138(form: Record<string, unknown>, extra: Record<string, unknown>): MappedFields {
  // A field may come from the form or (as a fallback) from `extra`.
  const pick = (key: string): string | undefined => str(form[key]) ?? str(extra[key]);

  // MULTI-CHEQUE — the engine's `cheques` is a list of N, built from the flat form.
  const cheques = buildChequesFromFlatForm(form);

  const debtDocs: string[] = [];
  if (str(form.invoice_refs)) debtDocs.push(String(form.invoice_refs));

  const fields: Record<string, unknown> = {
    // client-side identity
    client: str(form.sender_name),
    recipient_name: str(form.recipient_name),
    recipient_address: str(form.recipient_address),
    // the cheque list — every cheque the form carries (base + indexed extras)
    cheques,
    debt_nature: str(form.underlying_liability),
    debt_documents: debtDocs,
    dishonour_reason: str(form.dishonour_reason),
    // `dishonour_date` is the date PRINTED ON the memo; `memo_received_date` is
    // the date the payee RECEIVED it — the limitation anchor, a separate field.
    memo_date: str(form.dishonour_date),
    memo_received_date: pick('memo_received_date'),

    // Presentation, notice, advocate, and service — now collected by the form
    // (fallback to `extra` for any caller that still supplies them there).
    presentation_date: pick('presentation_date'),
    presentation_bank: pick('presentation_bank'),
    notice_date: pick('notice_date'),
    advocate: pick('advocate_name') ?? pick('advocate'),
    advocate_enrolment: pick('advocate_enrolment'),
    dispatch_mode: pick('dispatch_mode'),
    // form key is `dispatch_tracking`; engine key is `dispatch_tracking_placeholder`.
    dispatch_tracking_placeholder: pick('dispatch_tracking') ?? pick('dispatch_tracking_placeholder'),
    place: pick('place'),
  };

  // Strip undefined so the engine sees a field as ABSENT (422 "required"), not
  // present-but-null (which some coercers treat differently).
  return { fields: pruneUndefined(fields) };
}

function splitBankBranch(bankBranch: string | undefined): { bank?: string; branch?: string } {
  if (!bankBranch) return {};
  const s = bankBranch.trim();
  // Preferred: an explicit comma separates bank from branch.
  const idx = s.indexOf(',');
  if (idx !== -1) {
    return { bank: s.slice(0, idx).trim(), branch: s.slice(idx + 1).trim() };
  }
  // No comma but the text names a "… Branch" — split on the word before "Branch"
  // so "Karur Vysya Bank Godown Street Branch" → bank "Karur Vysya Bank",
  // branch "Godown Street Branch". This is the common natural phrasing.
  const m = s.match(/^(.*?\bBank\b)\s+(.+\bBranch\b.*)$/i);
  if (m) return { bank: m[1]!.trim(), branch: m[2]!.trim() };
  // Otherwise, only the bank is given; branch stays absent (a legitimate 422/ask).
  return { bank: s };
}

function pruneUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    // prune undefined inside the single cheque object too
    if (k === 'cheques' && Array.isArray(v)) {
      out[k] = v.map((c) =>
        typeof c === 'object' && c ? pruneUndefined(c as Record<string, unknown>) : c,
      );
      continue;
    }
    out[k] = v;
  }
  return out;
}

type Mapper = (form: Record<string, unknown>, extra: Record<string, unknown>) => MappedFields;

/**
 * PASSTHROUGH mapper — used by every doc type EXCEPT s.138 notice.
 *
 * For all the doc types wired after the s.138 pilot, the web form is generated
 * from the engine's own field contract (GET /v1/doc-types -> adapter.describe()),
 * so the FORM keys are already the ENGINE inbound keys. The bridge is therefore an
 * identity map: merge the form over `extra`, prune undefined so an omitted field
 * stays ABSENT (engine 422 "required"), never invented. The s.138 notice keeps its
 * bespoke mapper because its form predates the engine and uses a different
 * vocabulary (flat cheque, combined bank/branch, sender/recipient naming).
 */
function mapPassthrough(
  form: Record<string, unknown>,
  extra: Record<string, unknown>,
): MappedFields {
  const merged: Record<string, unknown> = { ...extra, ...form };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue; // blank -> absent (422)
    out[k] = v;
  }
  return { fields: out };
}

// ---- contract-driven type coercion -----------------------------------------
// Generated forms collect everything as strings (a textarea, a Yes/No select, a
// number input's string value). The engine wants NATIVE types: bool, int, and lists.
// Rather than a hand-written mapper per doc type, we coerce generically using the
// engine contract's declared `kind` for each field. This makes every generated form
// routable with no per-doc code — the same reason describe() is the source of truth.

interface ContractField {
  key: string;
  kind: string;
  enumValues?: string[];
  itemFields?: ContractField[];
  // Machine-readable conditional-required marker carried in the committed engine
  // contract snapshot (camelCase there; the runtime /doc-types uses required_when).
  // Not consumed by coercion yet — present so the snapshot type is honest.
  requiredWhen?: { field: string; equals: string };
}
type ContractEntry = { fields: ContractField[] };

// The committed engine-contract snapshot (same file the alignment test uses).
// Lives in @lexdraft/types since both apps' production code and tests
// depend on it - it used to sit under apps/api's __tests__ directory,
// which broke the web Docker build (can't reach across app boundaries
// into a sibling app's build context) and was never a true test-only
// fixture to begin with.
const ENGINE_CONTRACT: Record<string, ContractEntry> =
  engineDocContract as unknown as Record<string, ContractEntry>;

/** Coerce one web value to the engine kind. Blank/absent -> undefined (dropped ->
 *  engine 422 "required", the correct signal — never a fabricated value). */
function coerceKind(kind: string, v: unknown): unknown {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === 'string' ? v.trim() : v;
  if (s === '') return undefined;
  switch (kind) {
    case 'bool':
      if (typeof s === 'boolean') return s;
      return /^(yes|true|1)$/i.test(String(s)) ? true
        : /^(no|false|0)$/i.test(String(s)) ? false
        : undefined; // unrecognised -> absent, not a guessed boolean
    case 'int': {
      const n = typeof s === 'number' ? s : parseInt(String(s).replace(/[^0-9-]/g, ''), 10);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'string_list':
    case 'list': {
      if (Array.isArray(s)) return s;
      // web textarea: one item per line; drop blank lines.
      const items = String(s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      return items.length ? items : undefined;
    }
    default:
      return s; // string / date / enum pass through as strings
  }
}

/**
 * Fold INDEXED FLAT form keys (`<listKey>_<row>_<subKey>`, e.g. `cheques_0_number`,
 * `cheques_0_amount`, `cheques_1_number`) back into an array of row records keyed by
 * the item sub-field name — the inverse of intake-doc-config's listFieldToFlatKeys.
 *
 * Derived (passthrough) doc types expose a required engine `list` (e.g.
 * s138_complaint.cheques) as these flat per-row keys because the extractor cannot
 * fill a single opaque list textarea. This rebuilds the `<listKey>[]` records so
 * coerceRecordList / the engine receive real rows. A row is emitted only if at least
 * one of its cells is present; blank rows are skipped. Values stay strings here —
 * coerceRecordList applies the per-item kind coercion afterwards.
 *
 * Returns undefined when the form carries no flat keys for this list (so a caller
 * that already submitted a native `<listKey>` array is left untouched).
 */
export function buildRecordListFromFlatForm(
  listKey: string,
  itemFields: ContractField[],
  form: Record<string, unknown>,
): Array<Record<string, unknown>> | undefined {
  const rowRe = new RegExp(`^${listKey}_(\\d+)_(.+)$`);
  const rows = new Map<number, Record<string, unknown>>();
  let sawAny = false;
  for (const [k, v] of Object.entries(form)) {
    const m = rowRe.exec(k);
    if (!m) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (v === undefined || v === null) continue;
    const idx = Number.parseInt(m[1]!, 10);
    const sub = m[2]!;
    // Only fold sub-keys the list's item schema declares (ignore stray matches).
    if (!itemFields.some((f) => f.key === sub)) continue;
    sawAny = true;
    const row = rows.get(idx) ?? {};
    row[sub] = v;
    rows.set(idx, row);
  }
  if (!sawAny) return undefined;
  // Emit rows in ascending index order; a row with no non-empty cell never lands here.
  return [...rows.keys()].sort((a, b) => a - b).map((i) => rows.get(i)!);
}

/** Coerce a LIST-of-records value: an array of row objects, each coerced field-by-field
 *  against the item schema. Rows that are entirely empty after coercion are dropped so a
 *  stray blank row never 422s. Returns undefined if no non-empty rows remain. */
function coerceRecordList(itemFields: ContractField[], v: unknown): unknown {
  // Distinguish "no rows provided" (v empty/nullish -> silently absent, correct) from
  // "rows provided but wrong-shaped" (which must NOT be silently dropped into a false
  // 'required'). Tolerate the shapes the extractor / callers can plausibly emit:
  //   - a JSON string (a stringified array or object) -> parse then re-enter
  //   - a single non-null row object not wrapped in an array -> wrap as [v]
  // A genuinely undroppable-but-empty input is logged so the drop is traceable.
  let rows: unknown[] | undefined;
  if (Array.isArray(v)) {
    rows = v;
  } else if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return undefined; // blank textarea -> legitimately absent, no warn
    try {
      const parsed = JSON.parse(s);
      rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : undefined);
    } catch {
      rows = undefined; // unparseable prose -> not fabricated into rows
    }
  } else if (v && typeof v === 'object') {
    rows = [v as Record<string, unknown>]; // single row object -> wrap
  } else {
    rows = undefined;
  }
  if (!rows) {
    // Only warn when a non-empty value was actually received but yielded no rows —
    // an empty/nullish input is a legitimate absent list, not a dropped one.
    if (v !== undefined && v !== null && v !== '') {
      logger.warn({ key: 'list', type: typeof v }, 'coerceRecordList dropped a non-array list value (wrong-shaped) — surfaces as a false engine required');
    }
    return undefined;
  }
  const kinds = new Map(itemFields.map((f) => [f.key, f.kind]));
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const obj: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(row as Record<string, unknown>)) {
      const kind = kinds.get(k);
      const c = kind ? coerceKind(kind, val) : (typeof val === 'string' && val.trim() === '' ? undefined : val);
      if (c !== undefined) obj[k] = c;
    }
    if (Object.keys(obj).length > 0) out.push(obj);
  }
  if (out.length === 0) {
    // rows were present (non-empty input reached here) but coerced to nothing — the
    // list is about to be dropped and 422 as a false 'required'. Make it traceable.
    logger.warn({ key: 'list', type: typeof v, rows: rows.length }, 'coerceRecordList yielded zero rows from a non-empty list value — surfaces as a false engine required');
    return undefined;
  }
  return out;
}

/** Apply contract-driven coercion to a passthrough result for `docType`. Fields not in
 *  the contract pass through unchanged (defensive — the alignment gate keeps them in
 *  sync). Absent-after-coercion keys are dropped so the engine 422s rather than
 *  receiving a wrong-typed value. LIST-of-records fields (e.g. cheques) are coerced
 *  per-item against their sub-schema. */
function coerceToContract(docType: string, mapped: MappedFields): MappedFields {
  const entry = ENGINE_CONTRACT[docType];
  if (!entry) return mapped; // no contract -> leave as-is
  const byKey = new Map(entry.fields.map((f) => [f.key, f]));
  const out: Record<string, unknown> = {};
  // Track which flat per-row list keys we consume so they don't also leak through
  // as stray top-level fields the engine doesn't recognise.
  const consumedFlat = new Set<string>();
  // FIRST fold any indexed flat form keys (`cheques_0_number` …) back into their
  // `list` records. Derived doc types expose a required engine `list` as these flat
  // keys (see intake-doc-config.listFieldToFlatKeys) because the extractor cannot fill
  // one opaque list textarea. When the caller already supplied a native array under
  // the list key, that value wins and the flat fold is skipped.
  for (const spec of entry.fields) {
    if (spec.kind !== 'list' || !spec.itemFields?.length) continue;
    if (Array.isArray(mapped.fields[spec.key])) continue; // native array already present
    const rows = buildRecordListFromFlatForm(spec.key, spec.itemFields, mapped.fields);
    if (rows === undefined) continue;
    const coerced = coerceRecordList(spec.itemFields, rows);
    // Mark every flat key for this list consumed regardless of coercion outcome.
    for (const k of Object.keys(mapped.fields)) {
      if (new RegExp(`^${spec.key}_\\d+_.+$`).test(k)) consumedFlat.add(k);
    }
    if (coerced !== undefined) out[spec.key] = coerced;
  }
  for (const [k, v] of Object.entries(mapped.fields)) {
    if (consumedFlat.has(k)) continue; // already folded into a list record above
    const spec = byKey.get(k);
    let coerced: unknown;
    if (spec?.kind === 'list' && spec.itemFields?.length) {
      coerced = coerceRecordList(spec.itemFields, v);
    } else if (spec) {
      coerced = coerceKind(spec.kind, v);
    } else {
      coerced = v;
    }
    if (coerced !== undefined) out[k] = coerced;
  }
  return { fields: out };
}

/**
 * Doc types with a BESPOKE mapper (form vocabulary != engine vocabulary). Every
 * other registered doc type uses the passthrough map above. Keeping this a small
 * explicit set (rather than a big per-doc table) means new doc types are routable
 * the moment their engine adapter + form exist, with no field-map edit.
 */
/**
 * s.138 COMPLAINT mapper. The complaint's intake config collects cheques as the
 * flat `cheque_no` / `cheque_date` / `cheque_amount` / `drawee_bank` (+ indexed
 * `_2`…`_N`) keys — the same shape the extractor fills — NOT the generic
 * `cheques_0_number` fold keys. The passthrough `coerceToContract` fold only
 * understands `cheques_<row>_<sub>`, so without this mapper the cheques silently
 * drop and the engine refuses "provide the cheque details" even though the facts
 * are on record. Here we fold the flat cheque keys into the engine's `cheques[]`
 * list (drawer = accused, payee = complainant for a complaint), then pass every
 * other field through the contract coercion.
 */
function mapS138Complaint(form: Record<string, unknown>, extra: Record<string, unknown>): MappedFields {
  const cheques = buildComplaintChequesFromFlatForm(form);
  // Everything else flows through the generic contract coercion, MINUS the flat
  // cheque keys we just consumed (so they don't leak as stray top-level fields).
  const withoutFlatCheques: Record<string, unknown> = {};
  const flatChequeRe = /^(cheque_no|cheque_date|cheque_amount|drawee_bank)(_\d+)?$/;
  for (const [k, v] of Object.entries(form)) {
    if (flatChequeRe.test(k)) continue;
    withoutFlatCheques[k] = v;
  }
  const passthrough = coerceToContract('s138_complaint', mapPassthrough(withoutFlatCheques, extra));
  const fields: Record<string, unknown> = { ...passthrough.fields };
  if (cheques.length > 0) fields.cheques = cheques;
  return { fields };
}

/** Build the complaint's `cheques[]` from the flat form keys, with drawer =
 *  accused and payee = complainant (a complaint's parties), unlike the notice's
 *  builder which uses recipient/sender. */
function buildComplaintChequesFromFlatForm(
  form: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const drawer = str(form.accused_name);
  const payee = str(form.complainant_name);
  const buildCheque = (suffix: string): Record<string, unknown> | null => {
    const number = str(form[`cheque_no${suffix}`]);
    const date = str(form[`cheque_date${suffix}`]);
    const amount = toAmount(form[`cheque_amount${suffix}`]);
    const bankBranch = str(form[`drawee_bank${suffix}`]);
    if (!number && !date && amount === undefined && !bankBranch) return null;
    return { number, date, amount, ...splitBankBranch(bankBranch), drawer, payee };
  };
  const cheques: Array<Record<string, unknown>> = [];
  const first = buildCheque('');
  if (first) cheques.push(first);
  for (let i = 2; i <= MAX_CHEQUES; i += 1) {
    const c = buildCheque(`_${i}`);
    if (c) cheques.push(c);
  }
  return cheques;
}

const CUSTOM_MAPPERS: Record<string, Mapper> = {
  s138_notice: mapS138,
  s138_complaint: mapS138Complaint,
};

/**
 * All engine doc types the Node layer will route. Passthrough doc types are
 * routable as soon as they appear here; the engine's /v1/doc-types is the source
 * of truth for the field contract of each.
 */
const ROUTABLE_DOC_TYPES: readonly string[] = [
  // pilot (bespoke map)
  's138_notice',
  // NOTE: standalone 'affidavit' is deliberately EXCLUDED — the engine's
  // affidavit contract requires matter_type + affidavit_kind (and, for s138
  // matters, the cheque/dishonour fields), which doc-schemas.ts does not yet
  // collect. Routing it would 422 on every draft. Re-add once the web form
  // gains those inputs. See engine-doc-contract.json for the field contract.
  // pleadings + notices (passthrough)
  's138_complaint', 'regular_bail', 'anticipatory_bail', 'default_bail',
  'general_notice', 'plaint', 'summary_suit', 'injunction', 'writ_petition',
  'maintenance', 'dv_application', 'consumer_complaint', 'mact_claim',
  'divorce_contested', 'divorce_mutual_first', 'divorce_mutual_second',
  'permanent_injunction', 'specific_performance', 'ejectment',
  'indigent_application', 'o39_r2a_application', 'caveat', 'transfer_petition',
  'execution_application', 'restitution_conjugal_rights', 'judicial_separation',
  'succession_grant', 'succession_certificate', 'writ_criminal',
  'special_leave_petition', 'contempt_petition', 'written_statement',
  's106_notice', 's80_notice', 's138_reply',
  // conveyancing deeds (passthrough)
  'will', 'power_of_attorney', 'agreement_for_sale', 'sale_deed', 'lease_deed',
  'mortgage_deed', 'partnership_deed', 'dissolution_deed', 'relinquishment_deed',
  'gift_deed',
  // TN / Madras court forms set — generalised for any state (passthrough).
  'vakalatnama', 'memo_of_appearance', 'coding_sheet', 'process_application',
  'copy_application', 'call_for_memo', 'batta_witness', 'recall_petition', 'process_memo', 'surety_memo', 'service_of_process_application', 'affidavit_of_service',
  'substituted_service', 'bail_bond', 'surety_affidavit', 'affidavit_of_surety',
  'memorandum_furnish_sureties', 'surrender_petition', 's256_condone_absence',
  's317_dispense_presence', 'recall_warrant', 'adjournment_petition',
  'urgent_petition', 'appeal_record_cost_schedule',
  // court-issued instruments (the advocate prepares the draft; the doc carries a
  // [COURT ISSUES THIS] marker rendered by the engine template).
  'summons', 'court_notice', 'court_warrant',
];

const ROUTABLE_SET = new Set(ROUTABLE_DOC_TYPES);

/** Whether an engine doc type has a form->engine mapping (i.e. is routable). */
export function isRoutable(docType: string): boolean {
  return ROUTABLE_SET.has(docType);
}

/** Map a form payload to engine inbound fields for `docType`, or throw.
 *
 *  Passthrough doc types then get contract-driven TYPE coercion (web strings ->
 *  engine bool/int/list), so a generated form routes with no per-doc code. Bespoke
 *  mappers (s138) own their whole shape and are returned as-is — they already emit
 *  native types. "Deliberate absence over invention" is preserved throughout: a blank
 *  or uncoercible value is dropped, so the engine 422s rather than receiving a
 *  fabricated one. */
export function mapFormToEngine(
  docType: string,
  form: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): MappedFields {
  if (!ROUTABLE_SET.has(docType)) {
    throw new Error(`no engine field map for doc type ${docType}`);
  }
  // s138 is mid-migration: the LEGACY flat form (cheque_no/sender_name, one cheque)
  // needs the bespoke reshaping mapper; the NEW generated form already submits a
  // `cheques` array of engine-keyed records and takes the passthrough+coercion path.
  // Detect by shape so BOTH work during the transition (no flip-day breakage), and the
  // bespoke mapper becomes naturally dead once all traffic is the new form.
  if (docType === 's138_notice' && !Array.isArray(form.cheques)) {
    return mapS138(form, extra); // legacy flat form
  }

  const custom = CUSTOM_MAPPERS[docType];
  if (custom && docType !== 's138_notice') return custom(form, extra);
  return coerceToContract(docType, mapPassthrough(form, extra));
}

/**
 * The Draft-page label -> engine doc-type slug. Every routable engine doc type
 * has an entry; the label is what the Draft page shows in its document picker.
 */
export const LABEL_TO_ENGINE_DOC: Record<string, string> = {
  'Notice u/s 138 NI Act': 's138_notice',
  Affidavit: 'affidavit',
  'Complaint u/s 138 NI Act': 's138_complaint',
  'Regular Bail Application': 'regular_bail',
  'Anticipatory Bail Application': 'anticipatory_bail',
  'Default Bail Application': 'default_bail',
  'General Demand Notice': 'general_notice',
  'Plaint (Money Recovery)': 'plaint',
  'Summary Suit (Order XXXVII)': 'summary_suit',
  'Application for Temporary Injunction': 'injunction',
  'Writ Petition (Civil)': 'writ_petition',
  'Maintenance Petition': 'maintenance',
  'Domestic Violence Application': 'dv_application',
  'Consumer Complaint': 'consumer_complaint',
  'MACT Claim Petition': 'mact_claim',
  'Divorce Petition (Contested)': 'divorce_contested',
  'Divorce by Mutual Consent (First Motion)': 'divorce_mutual_first',
  'Divorce by Mutual Consent (Second Motion)': 'divorce_mutual_second',
  'Suit for Permanent Injunction': 'permanent_injunction',
  'Suit for Specific Performance': 'specific_performance',
  'Suit for Ejectment & Damages': 'ejectment',
  'Application to Sue as an Indigent Person': 'indigent_application',
  'Application u/O39 R2-A CPC': 'o39_r2a_application',
  'Caveat u/s 148-A CPC': 'caveat',
  'Transfer Petition (Civil)': 'transfer_petition',
  'Execution Application': 'execution_application',
  'Restitution of Conjugal Rights': 'restitution_conjugal_rights',
  'Judicial Separation Petition': 'judicial_separation',
  'Probate / Letters of Administration': 'succession_grant',
  'Succession Certificate': 'succession_certificate',
  'Writ Petition (Criminal)': 'writ_criminal',
  'Special Leave Petition': 'special_leave_petition',
  'Contempt Petition': 'contempt_petition',
  'Written Statement': 'written_statement',
  'Notice u/s 106 TPA (Ejectment)': 's106_notice',
  'Notice u/s 80 CPC': 's80_notice',
  'Reply to s.138 Notice': 's138_reply',
  Will: 'will',
  'Power of Attorney': 'power_of_attorney',
  'Agreement for Sale': 'agreement_for_sale',
  'Sale Deed': 'sale_deed',
  'Lease Deed': 'lease_deed',
  'Mortgage Deed': 'mortgage_deed',
  'Partnership Deed': 'partnership_deed',
  'Deed of Dissolution of Partnership': 'dissolution_deed',
  'Relinquishment Deed': 'relinquishment_deed',
  'Gift Deed': 'gift_deed',
  // TN / Madras court forms set (generalised for any state).
  Vakalatnama: 'vakalatnama',
  'Memo of Appearance': 'memo_of_appearance',
  'Registry Coding Sheet': 'coding_sheet',
  'Application for Issue of Process': 'process_application',
  'Application for Certified Copies': 'copy_application',
  'Call for Memo': 'call_for_memo',
  'Batta Witness (Issue of Process)': 'batta_witness',
  'Recall Petition (s.70(2) CrPC)': 'recall_petition',
  'Process Memo': 'process_memo',
  'Surety Memo': 'surety_memo',
  'Affidavit of Surety': 'affidavit_of_surety',
  'Application for Service of Process': 'service_of_process_application',
  'Affidavit of Service': 'affidavit_of_service',
  'Petition for Substituted Service (O.5 R.20 CPC)': 'substituted_service',
  'Bail Bond': 'bail_bond',
  'Surety Affidavit': 'surety_affidavit',
  'Memorandum to Furnish Sureties': 'memorandum_furnish_sureties',
  'Surrender Petition': 'surrender_petition',
  'Petition u/s 256 CrPC (Condone Complainant Absence)': 's256_condone_absence',
  'Petition u/s 317 CrPC (Dispense with Accused Presence)': 's317_dispense_presence',
  'Petition to Recall Warrant (s.70(2) CrPC)': 'recall_warrant',
  'Petition for Adjournment (O.XVII R.1 CPC)': 'adjournment_petition',
  'Urgent Petition (s.151 CPC)': 'urgent_petition',
  'Appeal Record Cost Schedule (Form 476)': 'appeal_record_cost_schedule',
  'Court Summons': 'summons',
  'Court Notice': 'court_notice',
  'Court Warrant / Order': 'court_warrant',
};
