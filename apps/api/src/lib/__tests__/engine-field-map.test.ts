import { describe, expect, it } from 'vitest';
import { mapFormToEngine, isRoutable, LABEL_TO_ENGINE_DOC } from '../engine-field-map';

// The form (doc-schemas.ts vocabulary) and the engine inbound contract are
// different key sets; this proves the bridge, including the two tricky cases:
// a flat single cheque -> a `cheques` list, and form-absent fields left ABSENT
// (so the engine returns 422 "required", never an invented value).

const FORM = {
  sender_name: 'Mehta Enterprises Pvt. Ltd.',
  sender_address: 'Plot 14, Naraina, New Delhi',
  recipient_name: 'Sandeep Verma',
  recipient_address: 'B-204, Gurugram',
  cheque_no: '000456789',
  cheque_date: '2026-03-12',
  cheque_amount: '4,75,000', // grouped digits
  drawee_bank: 'HDFC Bank, Connaught Place Branch, New Delhi',
  // Presentation
  presentation_date: '2026-03-15',
  presentation_bank: 'City Union Bank, R.S. Puram Branch',
  // Dishonour — memo date vs RECEIPT date (the limitation anchor) are distinct
  dishonour_date: '2026-03-18',
  memo_received_date: '2026-03-20',
  dishonour_reason: 'Funds Insufficient',
  underlying_liability: 'Part-payment of dues for industrial supplies.',
  invoice_refs: 'Invoice INV/2025/1142',
  // Notice & service
  notice_date: '2026-03-25',
  advocate_name: 'R. Sundaravadivel',
  advocate_enrolment: 'MS/2287/2011',
  dispatch_mode: 'Registered Post Acknowledgement Due',
  dispatch_tracking: '{{ rpad_consignment_no }}',
  place: 'Coimbatore',
};

describe('engine-field-map — s.138', () => {
  it('maps the flat form into the engine contract, cheque -> list', () => {
    const { fields } = mapFormToEngine('s138_notice', FORM, {});
    expect(fields.client).toBe('Mehta Enterprises Pvt. Ltd.');
    expect(fields.recipient_name).toBe('Sandeep Verma');
    expect(Array.isArray(fields.cheques)).toBe(true);
    const cheque = (fields.cheques as any[])[0];
    expect(cheque.number).toBe('000456789');
    expect(cheque.amount).toBe(475000); // grouped digits -> int
    expect(cheque.drawer).toBe('Sandeep Verma'); // drawer = cheque issuer
    expect(cheque.payee).toBe('Mehta Enterprises Pvt. Ltd.'); // payee = client
    // bank/branch split from the combined form field
    expect(cheque.bank).toBe('HDFC Bank');
    expect(cheque.branch).toBe('Connaught Place Branch, New Delhi');
  });

  it('folds indexed extra-cheque form keys into a multi-element cheques[] list', () => {
    const multi = {
      ...FORM,
      cheque_no_2: '000102', cheque_date_2: '2026-04-25', cheque_amount_2: '3,00,000',
      drawee_bank_2: 'Karur Vysya Bank, Godown Street Branch',
      cheque_no_3: '000103', cheque_date_3: '2026-04-29', cheque_amount_3: '2,04,202',
      drawee_bank_3: 'Karur Vysya Bank, Godown Street Branch',
    };
    const { fields } = mapFormToEngine('s138_notice', multi, {});
    const cheques = fields.cheques as any[];
    expect(cheques).toHaveLength(3);
    expect(cheques[0].number).toBe('000456789');
    expect(cheques[1].number).toBe('000102');
    expect(cheques[1].amount).toBe(300000);
    expect(cheques[1].date).toBe('2026-04-25');
    expect(cheques[1].bank).toBe('Karur Vysya Bank');
    expect(cheques[2].number).toBe('000103');
    expect(cheques[2].amount).toBe(204202);
    // drawer/payee replicate onto every cheque (same parties).
    expect(cheques[1].drawer).toBe('Sandeep Verma');
    expect(cheques[1].payee).toBe('Mehta Enterprises Pvt. Ltd.');
  });

  it('a COMPLETE form maps to every engine-required field (one-pass draft)', () => {
    const { fields } = mapFormToEngine('s138_notice', FORM, {});
    // Every field the engine requires is present from the form — no 422, no extra.
    expect(fields.advocate).toBe('R. Sundaravadivel');
    expect(fields.advocate_enrolment).toBe('MS/2287/2011');
    expect(fields.presentation_date).toBe('2026-03-15');
    expect(fields.presentation_bank).toBe('City Union Bank, R.S. Puram Branch');
    expect(fields.notice_date).toBe('2026-03-25');
    expect(fields.dispatch_mode).toBe('Registered Post Acknowledgement Due');
    expect(fields.dispatch_tracking_placeholder).toBe('{{ rpad_consignment_no }}');
    expect(fields.place).toBe('Coimbatore');
  });

  it('memo DATE and memo RECEIPT date map to distinct engine fields', () => {
    const { fields } = mapFormToEngine('s138_notice', FORM, {});
    expect(fields.memo_date).toBe('2026-03-18');        // printed on the memo
    expect(fields.memo_received_date).toBe('2026-03-20'); // the limitation anchor
    expect(fields.memo_date).not.toBe(fields.memo_received_date);
  });

  it('a genuinely omitted field is left ABSENT (engine 422, not invented)', () => {
    const { memo_received_date: _omit, ...partial } = FORM;
    const { fields } = mapFormToEngine('s138_notice', partial, {});
    expect('memo_received_date' in fields).toBe(false); // -> 422 "required"
  });

  it('still accepts the fields from `extra` as a fallback', () => {
    const { memo_received_date: _drop, place: _drop2, ...partial } = FORM;
    const { fields } = mapFormToEngine('s138_notice', partial, {
      memo_received_date: '2026-03-21', place: 'Chennai',
    });
    expect(fields.memo_received_date).toBe('2026-03-21');
    expect(fields.place).toBe('Chennai');
  });

  it('a bank without a comma leaves branch absent (a 422, not a guess)', () => {
    const { fields } = mapFormToEngine('s138_notice', { ...FORM, drawee_bank: 'HDFC Bank' }, {});
    const cheque = (fields.cheques as any[])[0];
    expect(cheque.bank).toBe('HDFC Bank');
    expect('branch' in cheque).toBe(false);
  });

  it('s.138 keeps its bespoke mapper; the rest are routable via passthrough', () => {
    expect(isRoutable('s138_notice')).toBe(true);
    expect(isRoutable('plaint')).toBe(true);
    expect(isRoutable('sale_deed')).toBe(true);
    expect(isRoutable('not_a_doc_type')).toBe(false);
    expect(LABEL_TO_ENGINE_DOC['Notice u/s 138 NI Act']).toBe('s138_notice');
    expect(LABEL_TO_ENGINE_DOC['Sale Deed']).toBe('sale_deed');
  });
});

describe('engine-field-map — passthrough (non-s.138 doc types)', () => {
  it('passes form keys through as engine keys (they are the same vocabulary)', () => {
    const { fields } = mapFormToEngine('sale_deed', {
      vendor_name: 'A',
      vendee_name: 'B',
      property_desc: 'flat',
      total_consideration: 2500000,
      to_be_registered: true,
    });
    expect(fields.vendor_name).toBe('A');
    expect(fields.vendee_name).toBe('B');
    expect(fields.total_consideration).toBe(2500000);
    expect(fields.to_be_registered).toBe(true);
  });

  it('prunes blank/undefined so an omitted field stays ABSENT (engine 422)', () => {
    const { fields } = mapFormToEngine('plaint', {
      plaintiff_name: 'ABC',
      defendant_names: ['XYZ'],
      cause_of_action_place: '   ', // blank -> absent
      interest_document_ref: undefined,
    });
    expect(fields.plaintiff_name).toBe('ABC');
    expect('cause_of_action_place' in fields).toBe(false);
    expect('interest_document_ref' in fields).toBe(false);
  });

  it('merges `extra` under the form (form wins)', () => {
    const { fields } = mapFormToEngine(
      'caveat',
      { caveator_name: 'C' },
      { place: 'Chennai', caveator_name: 'ignored' },
    );
    expect(fields.caveator_name).toBe('C'); // form overrides extra
    expect(fields.place).toBe('Chennai'); // extra fills the gap
  });

  it('every LABEL_TO_ENGINE_DOC target is routable', () => {
    for (const docType of Object.values(LABEL_TO_ENGINE_DOC)) {
      expect(isRoutable(docType)).toBe(true);
    }
  });

  it('the TN/Madras court forms are routable via passthrough', () => {
    // A spread across the clusters: appointment, registry, process, bail-support,
    // interlocutory, and a court-issued instrument.
    for (const docType of [
      'vakalatnama', 'coding_sheet', 'process_application', 'bail_bond',
      'surrender_petition', 'adjournment_petition', 'summons', 'court_warrant',
    ]) {
      expect(isRoutable(docType)).toBe(true);
    }
    expect(LABEL_TO_ENGINE_DOC['Vakalatnama']).toBe('vakalatnama');
    expect(LABEL_TO_ENGINE_DOC['Court Warrant / Order']).toBe('court_warrant');
    // passthrough leaves an omitted field absent (engine 422), never invented.
    const { fields } = mapFormToEngine('surrender_petition', {
      accused_name: 'V', offence_section: 's.420 IPC', crime_no: 'Cr 5/26',
      identification_marks: ['mole'], case_ref: 'CMP 1', place: 'Chennai',
      accused_address: '   ', // blank -> absent
    });
    expect(fields.accused_name).toBe('V');
    expect(Array.isArray(fields.identification_marks)).toBe(true);
    expect('accused_address' in fields).toBe(false);
  });
});

describe('engine-field-map — bank/branch split (s.138)', () => {
  it('splits "Bank Branch" with no comma on the word Branch', () => {
    const { fields } = mapFormToEngine('s138_notice', { drawee_bank: 'Karur Vysya Bank Godown Street Branch' }, {});
    const c = (fields.cheques as any[])[0];
    expect(c.bank).toBe('Karur Vysya Bank');
    expect(c.branch).toBe('Godown Street Branch');
  });
  it('splits on the comma when present', () => {
    const { fields } = mapFormToEngine('s138_notice', { drawee_bank: 'HDFC Bank, Connaught Place' }, {});
    const c = (fields.cheques as any[])[0];
    expect(c.bank).toBe('HDFC Bank');
    expect(c.branch).toBe('Connaught Place');
  });
  it('bank-only leaves branch absent (a legitimate 422/ask)', () => {
    const { fields } = mapFormToEngine('s138_notice', { drawee_bank: 'HDFC Bank' }, {});
    const c = (fields.cheques as any[])[0];
    expect(c.bank).toBe('HDFC Bank');
    expect('branch' in c).toBe(false);
  });
});

// Contract-driven coercion: a GENERATED passthrough form submits everything as strings
// (Yes/No select, newline textarea, numeric string). mapFormToEngine must coerce these
// to the engine's native types (bool/int/list) using the contract, so a generated form
// routes with no per-doc mapper — while still dropping blanks (deliberate absence).
describe('passthrough contract-driven coercion (regular_bail)', () => {
  const bailForm = {
    accused_name: 'Dinesh Kumar @ Dinesh',
    accused_parentage: 'S/o Kumaravel',
    age: '34', // string -> int
    occupation: 'lorry driver',
    address: '47, Kamaraj Nagar, Avadi, Chennai 600054',
    fir_no: '812/2024',
    police_station: 'Avadi',
    district: 'Tiruvallur',
    sections: 'BNS s.303(2)\nBNS s.317(2)', // newline textarea -> string[]
    custody_since: '2024-09-16',
    as_on: '2024-12-20',
    prison: 'Puzhal Central Prison',
    chargesheet_filed: 'Yes', // select -> boolean true
    court_level: 'Principal Sessions Judge, Tiruvallur',
    bail_court: 'Principal Sessions Court, Tiruvallur',
    application_date: '2024-12-20',
    place: 'Chennai',
    is_successive: 'No', // select -> boolean false
    special_statute: '', // blank -> dropped (not sent)
  };

  it('coerces strings to engine-native bool / int / list', () => {
    const { fields } = mapFormToEngine('regular_bail', bailForm);
    expect(fields.age).toBe(34);
    expect(fields.sections).toEqual(['BNS s.303(2)', 'BNS s.317(2)']);
    expect(fields.chargesheet_filed).toBe(true);
    expect(fields.is_successive).toBe(false);
  });

  it('drops blank fields so the engine 422s rather than receiving a fabricated value', () => {
    const { fields } = mapFormToEngine('regular_bail', bailForm);
    expect('special_statute' in fields).toBe(false);
  });

  it('leaves string/date fields as-is', () => {
    const { fields } = mapFormToEngine('regular_bail', bailForm);
    expect(fields.accused_name).toBe('Dinesh Kumar @ Dinesh');
    expect(fields.custody_since).toBe('2024-09-16');
  });
});

describe('s138_complaint — flat cheque keys fold into the engine cheques[] list', () => {
  // Regression: the complaint's intake collects cheques as cheque_no / cheque_date
  // / cheque_amount / drawee_bank (+ _2.._N), NOT the generic cheques_0_number fold
  // keys. Without the bespoke mapper these silently dropped and the engine refused
  // "provide the cheque details" even with every cheque on record.
  const COMPLAINT_FORM = {
    complainant_name: 'Ambeth Arivukarasan',
    accused_name: 'R. Venkatesh Bhat',
    is_payee: 'Yes',
    cheque_no: '000102', cheque_date: '2026-04-25', cheque_amount: '3,00,000',
    drawee_bank: 'Karur Vysya Bank, Godown Street Branch, Chennai',
    cheque_no_2: '000103', cheque_date_2: '2026-04-29', cheque_amount_2: '2,00,000',
    drawee_bank_2: 'Karur Vysya Bank, Godown Street Branch, Chennai',
    presentation_date: '2026-07-15', memo_date: '2026-07-15', memo_received_date: '2026-07-15',
    dishonour_reason: 'Funds Insufficient',
    notice_date: '2026-07-17', notice_dispatch_date: '2026-07-17',
    filing_date: '2026-08-24', jurisdiction_basis: 'PNB Gopalapuram within jurisdiction',
    payee_bank_branch_in_jurisdiction: 'Yes', place: 'Chennai',
    itemise_documents: 'Yes', prayer_twice_amount: 'Yes',
  };

  it('folds every flat cheque row into cheques[] with drawer=accused, payee=complainant', () => {
    const { fields } = mapFormToEngine('s138_complaint', COMPLAINT_FORM);
    const cheques = fields.cheques as Array<Record<string, unknown>>;
    expect(Array.isArray(cheques)).toBe(true);
    expect(cheques).toHaveLength(2);
    expect(cheques[0]).toMatchObject({
      number: '000102', date: '2026-04-25', amount: 300000,
      bank: 'Karur Vysya Bank', drawer: 'R. Venkatesh Bhat', payee: 'Ambeth Arivukarasan',
    });
    expect(cheques[1]!.number).toBe('000103');
  });

  it('passes the new refinement flags and other fields through', () => {
    const { fields } = mapFormToEngine('s138_complaint', COMPLAINT_FORM);
    expect(fields.itemise_documents).toBe(true);
    expect(fields.prayer_twice_amount).toBe(true);
    expect(fields.is_payee).toBe(true);
    expect(fields.notice_date).toBe('2026-07-17');
    // Flat cheque keys must NOT leak through as stray top-level fields.
    expect('cheque_no' in fields).toBe(false);
    expect('drawee_bank_2' in fields).toBe(false);
  });
});
