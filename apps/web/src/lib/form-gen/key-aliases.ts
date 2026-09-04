// =============================================================================
// form-gen/key-aliases — old web field key -> new engine field key, per doc type.
//
// When a doc type is migrated from its hand-authored web form to the generated form,
// the field KEYS change (old "Bail Application" used `custody_days`, `accused_address`;
// the engine uses `custody_since`, `address`). Saved drafts store values under the OLD
// keys. This map is the single source of truth for the rename, used by BOTH:
//   * dual-read (web): when a saved draft has no value under the new key, fall back to
//     the old key's value so the advocate never sees a blank field, and
//   * the backfill migration (api): rewrite fields_json old-key -> new-key once.
//
// ONLY pure renames belong here (old value is valid as-is under the new key). A field
// whose SHAPE changes (e.g. old `custody_days` count -> engine `custody_since` date)
// is NOT a safe alias — list it in NON_TRIVIAL so it is surfaced to the advocate as a
// field to re-enter, never silently mismapped into a wrong-typed value.
// =============================================================================

export interface DocKeyAliases {
  /** newEngineKey -> oldWebKey. Pure renames only (value carries over unchanged). */
  renames: Record<string, string>;
  /** Old keys whose data cannot be safely carried to a new key (shape/meaning change).
   *  These are dropped from the migrated draft; the advocate re-enters them. Recorded
   *  so the backfill can LOG what it dropped rather than silently losing it. */
  nonTrivial: string[];
  /** Old keys with no engine equivalent at all (the engine doesn't collect them). */
  dropped: string[];
}

export const KEY_ALIASES: Record<string, DocKeyAliases> = {
  // s.138 notice: old flat "Notice u/s 138 NI Act" form -> engine s138_notice.
  // The cheque sub-fields are handled by the backfill (flat -> cheques[]); these are the
  // SCALAR renames the dual-read covers so an old draft's non-cheque fields aren't blank.
  s138_notice: {
    renames: {
      client: 'sender_name',            // payee/holder = the sender of the notice
      advocate: 'advocate_name',
      debt_nature: 'underlying_liability',
      memo_date: 'dishonour_date',      // date printed on the dishonour memo
      dispatch_tracking_placeholder: 'dispatch_tracking',
      // same-name across old/new (listed for completeness / clarity):
      recipient_name: 'recipient_name',
      recipient_address: 'recipient_address',
      presentation_date: 'presentation_date',
      presentation_bank: 'presentation_bank',
      memo_received_date: 'memo_received_date',
      dishonour_reason: 'dishonour_reason',
      notice_date: 'notice_date',
      advocate_enrolment: 'advocate_enrolment',
      dispatch_mode: 'dispatch_mode',
      place: 'place',
    },
    nonTrivial: [
      // flat cheque keys -> cheques[] array: handled by the backfill script, not a
      // simple rename (a scalar can't alias into an array element).
      'cheque_no', 'cheque_date', 'cheque_amount', 'drawee_bank',
    ],
    dropped: [
      'sender_address',  // engine derives the sender block from `client`; not a field
      'sender_pan',
      'invoice_refs',    // folded into debt_documents (advocate re-enters as a doc line)
    ],
  },
  // Regular Bail: old web "Bail Application" -> engine regular_bail.
  regular_bail: {
    renames: {
      // engineKey: oldWebKey  (pure rename, value valid as-is)
      accused_name: 'accused_name',
      address: 'accused_address',
      fir_no: 'fir_no',
      police_station: 'police_station',
      sections: 'sections',
      grounds: 'grounds',
    },
    nonTrivial: [
      // old `custody_days` (a count) -> engine `custody_since` (a date): cannot derive a
      // date from a day-count without the arrest date, so the advocate re-enters it.
      'custody_days',
      // old `arrest_status` (free text) -> engine has no direct equivalent; informs
      // custody fields the advocate now sets explicitly.
      'arrest_status',
      // old `bail_type` (free text) -> engine derives regular/anticipatory/default by
      // doc type + is_successive; not a direct field.
      'bail_type',
    ],
    dropped: [
      'court',              // superseded by court_level + bail_court (advocate re-enters)
      'accused_designation',
      'sureties',           // not part of the bail application body in the engine adapter
    ],
  },
};

/** Dual-read: given the saved fields_json and a doc type, return a getter that resolves
 *  a value for a NEW engine key, falling back to its OLD-key value when the new key is
 *  absent/empty. Non-alias keys read straight through. */
export function dualRead(
  docType: string,
  saved: Record<string, unknown>,
): (engineKey: string) => unknown {
  const aliases = KEY_ALIASES[docType]?.renames ?? {};
  return (engineKey: string) => {
    const direct = saved[engineKey];
    if (direct !== undefined && direct !== '') return direct;
    const oldKey = aliases[engineKey];
    if (oldKey && oldKey !== engineKey) return saved[oldKey];
    return direct;
  };
}
