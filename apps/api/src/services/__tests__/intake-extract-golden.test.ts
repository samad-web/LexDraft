import { describe, expect, it } from 'vitest';
import { extractDeterministic } from '../intake-extract-rules.service';
import type { IntakeFieldSpec } from '../intake-llm.service';

// GOLDEN EXTRACTION CORPUS — real pasted documents across doc types, with the
// fields we EXPECT the free deterministic extractor to capture. This is the
// regression harness: it pins auto-capture correctness so a fix to one doc type
// can't silently break another. Each case asserts specific fields; it does NOT
// require 100% (some facts genuinely aren't in a document) — it asserts the ones
// that ARE present must be captured correctly, and nothing lands as junk.

const S = (key: string, label: string, type: IntakeFieldSpec['type'] = 'text', options?: string[]): IntakeFieldSpec =>
  ({ key, label, type, required: true, ...(options ? { options } : {}) });

/** Run the extractor and return a {key: value} map of what it captured. */
function capture(fields: IntakeFieldSpec[], text: string): Record<string, string> {
  const p = extractDeterministic({ fields, latest: text, answering: [] });
  return Object.fromEntries(p.fields.map((f) => [f.key, f.value]));
}

// A junk-guard: no captured value may be a boilerplate stopword.
const JUNK = /^(hereinafter|referred|the|no|and|as|is|of|whereas|this|that|said)$/i;
function assertNoJunk(by: Record<string, string>) {
  for (const [k, v] of Object.entries(by)) {
    expect(JUNK.test(v.trim()), `field ${k} captured junk: "${v}"`).toBe(false);
  }
}

describe('golden extraction — s.138 deferment agreement', () => {
  const FIELDS = [
    S('sender_name', 'Payee name'), S('sender_address', 'Payee address', 'textarea'),
    S('recipient_name', 'Drawer name'), S('recipient_address', 'Drawer address', 'textarea'),
    S('cheque_no', 'Cheque number'), S('cheque_date', 'Cheque date', 'date'),
    S('cheque_amount', 'Cheque amount', 'currency'), S('drawee_bank', 'Drawee bank & branch'),
    S('place', 'Place'),
  ];
  const TEXT = `CHEQUE PRESENTATION DEFERMENT AGREEMENT made on 5th May 2026 at Chennai. `
    + `BETWEEN THOORIGAI PRINTS, Proprietor: Ambeth Arivukarasan, PAN: BKKPA0600B, Address: No. 8/2, `
    + `Nair Vardha Pillai Street, Royapettah, Chennai-600014, hereinafter referred to as the "Vendor / Payee" `
    + `AND VENKI PUBLICATIONS, Proprietor: R. Venkatesh Bhat, Address: No.102, Govindappa Naicken Street, `
    + `Parrys, Chennai-600001, hereinafter referred to as the "Customer / Drawer". The Customer has issued `
    + `Cheque No. 000105 for INR 3,99,088 dated 16/04/2026, Cheque No. 000102 for INR 3,00,000 dated 25/04/2026 `
    + `drawn on Karur Vysya Bank, Godown Street Branch, Chennai.`;

  it('captures parties, cheque, bank, place from the first cheque; no junk', () => {
    const by = capture(FIELDS, TEXT);
    assertNoJunk(by);
    expect(by.sender_name).toBe('THOORIGAI PRINTS');
    expect(by.recipient_name).toBe('VENKI PUBLICATIONS');
    expect(by.cheque_no).toBe('000105');           // the FIRST cheque
    expect(by.cheque_date).toBe('2026-04-16');
    expect(by.cheque_amount).toBe('399088');
    expect(by.drawee_bank).toMatch(/Karur Vysya Bank/);
    // Names must NOT contain the proprietor / boilerplate tail.
    expect(by.sender_name).not.toMatch(/proprietor|hereinafter/i);
    expect(by.recipient_name).not.toMatch(/proprietor|hereinafter|customer/i);
    // Address, when captured, is a full line — never a bare "No" / stopword.
    if (by.sender_address) {
      expect(by.sender_address).toMatch(/Nair Vardha Pillai Street/);
      expect(JUNK.test(by.sender_address.trim())).toBe(false);
    }
  });

  it('does NOT swap the two parties\' addresses (payee ≠ drawer address)', () => {
    const by = capture(FIELDS, TEXT);
    // Payee (THOORIGAI) lives on Nair Vardha Pillai Street; Drawer (VENKI) on
    // Govindappa Naicken Street. The bug filled BOTH with the payee's address.
    if (by.sender_address) expect(by.sender_address).toMatch(/Nair Vardha Pillai/);
    if (by.recipient_address) {
      expect(by.recipient_address).toMatch(/Govindappa Naicken/);
      expect(by.recipient_address).not.toMatch(/Nair Vardha Pillai/);
    }
    // If both captured, they must be DIFFERENT strings.
    if (by.sender_address && by.recipient_address) {
      expect(by.recipient_address).not.toBe(by.sender_address);
    }
  });

  it('the cheque amount is 3,99,088 — never a stray "2" from prose', () => {
    const by = capture(FIELDS, TEXT);
    expect(by.cheque_amount).toBe('399088');
    expect(by.cheque_amount).not.toBe('2');
  });

  it('captures ALL FOUR cheques as correlated indexed groups', () => {
    const MULTI = [
      S('cheque_no', 'Cheque number'), S('cheque_date', 'Cheque date', 'date'),
      S('cheque_amount', 'Cheque amount', 'currency'),
      S('cheque_no_2', 'Cheque 2 — number'), S('cheque_date_2', 'Cheque 2 — date', 'date'),
      S('cheque_amount_2', 'Cheque 2 — amount', 'currency'),
      S('cheque_no_3', 'Cheque 3 — number'), S('cheque_date_3', 'Cheque 3 — date', 'date'),
      S('cheque_amount_3', 'Cheque 3 — amount', 'currency'),
      S('cheque_no_4', 'Cheque 4 — number'), S('cheque_date_4', 'Cheque 4 — date', 'date'),
      S('cheque_amount_4', 'Cheque 4 — amount', 'currency'),
    ];
    const TEXT4 = `The Customer has issued the following cheques drawn on Karur Vysya Bank: `
      + `Cheque No. 000105 for INR 3,99,088 dated 16/04/2026, `
      + `Cheque No. 000102 for INR 3,00,000 dated 25/04/2026, `
      + `Cheque No. 000103 for INR 2,04,202 dated 29/04/2026, `
      + `Cheque No. 000104 for INR 3,97,899 dated 15/05/2026.`;
    const by = capture(MULTI, TEXT4);
    // Each cheque's number, amount, date stay TOGETHER under its own index.
    expect(by.cheque_no).toBe('000105');
    expect(by.cheque_amount).toBe('399088');
    expect(by.cheque_date).toBe('2026-04-16');
    expect(by.cheque_no_2).toBe('000102');
    expect(by.cheque_amount_2).toBe('300000');
    expect(by.cheque_date_2).toBe('2026-04-25');
    expect(by.cheque_no_3).toBe('000103');
    expect(by.cheque_amount_3).toBe('204202');
    expect(by.cheque_date_3).toBe('2026-04-29');
    expect(by.cheque_no_4).toBe('000104');
    expect(by.cheque_amount_4).toBe('397899');
    expect(by.cheque_date_4).toBe('2026-05-15');
  });

  it('does NOT fabricate dishonour dates a deferment agreement lacks', () => {
    // A pre-dishonour deferment agreement has NO presentation/memo/return dates.
    // The bug copied the cheque date (16/04/2026) into all of them. They must stay
    // EMPTY (→ a [placeholder] at draft-now), never the cheque date.
    const DISHONOUR_FIELDS = [
      S('cheque_date', 'Cheque date', 'date'),
      S('presentation_date', 'Date the cheque was presented', 'date'),
      S('dishonour_date', 'Date printed on the dishonour memo', 'date'),
      S('memo_received_date', 'Date the payee received the memo', 'date'),
    ];
    // Include the real deferment phrasing that used to false-match.
    const DEFERMENT = TEXT
      + ` The Vendor agrees to defer presentation of the following cheques only. `
      + ` The Customer undertakes to maintain sufficient balance to honour the said `
      + ` cheques upon presentation on or after the above date.`;
    const by = capture(DISHONOUR_FIELDS, DEFERMENT);
    expect(by.cheque_date).toBe('2026-04-16');           // the cheque date IS present
    expect(by.presentation_date).toBeUndefined();        // NOT fabricated
    expect(by.dishonour_date).toBeUndefined();
    expect(by.memo_received_date).toBeUndefined();
  });
});

describe('golden extraction — regular bail', () => {
  const FIELDS = [
    S('accused_name', 'Accused name'), S('age', 'Age', 'number'), S('occupation', 'Occupation'),
    S('fir_no', 'FIR number'), S('police_station', 'Police station'), S('sections', 'Sections'),
    S('custody_since', 'Custody since', 'date'), S('accused_address', 'Accused address', 'textarea'),
  ];
  const TEXT = `The accused Rajesh Kumar, aged 34, occupation driver, residing at 12 Anna Nagar Chennai. `
    + `FIR No. 45/2026 at E4 Police Station under section 420 IPC. In custody since 11/01/2026.`;

  it('captures accused, age, occupation, FIR, PS, section, custody date, address', () => {
    const by = capture(FIELDS, TEXT);
    assertNoJunk(by);
    expect(by.accused_name).toBe('Rajesh Kumar');
    expect(by.age).toBe('34');
    expect(by.occupation).toMatch(/driver/);
    expect(by.fir_no).toBe('45/2026');
    expect(by.police_station).toMatch(/E4/);
    expect(by.sections).toMatch(/420/);
    expect(by.custody_since).toBe('2026-01-11');
    expect(by.accused_address).toMatch(/Anna Nagar/);
  });
});

describe('golden extraction — sale deed', () => {
  const FIELDS = [
    S('vendor_name', 'Vendor name'), S('vendee_name', 'Vendee name'),
    S('total_consideration', 'Total consideration', 'currency'), S('place', 'Place'),
  ];
  const TEXT = `Vendor: Mr. Suresh Kumar son of Ramaswamy. Vendee: M/s Anand Traders. `
    + `Property is a flat at No.7 Beach Road, Chennai, sold for a total consideration of Rs. 25,00,000.`;

  it('captures both parties + consideration', () => {
    const by = capture(FIELDS, TEXT);
    assertNoJunk(by);
    expect(by.vendor_name).toBe('Mr. Suresh Kumar');
    expect(by.vendee_name).toBe('M/s Anand Traders');
    expect(by.total_consideration).toBe('2500000');
  });
});

describe('golden extraction — lease deed', () => {
  const FIELDS = [
    S('lessor_name', 'Lessor name'), S('lessee_name', 'Lessee name'),
    S('monthly_rent', 'Monthly rent', 'currency'), S('security_deposit', 'Security deposit', 'currency'),
    S('term_months', 'Term months', 'number'),
  ];
  const TEXT = `Lessor: Mrs. Lakshmi Priya wife of Karthik. Lessee: Techno Solutions Pvt Ltd. `
    + `Monthly rent Rs. 40,000, security deposit Rs. 1,20,000, term 24 months.`;

  it('captures parties, rent, deposit, term', () => {
    const by = capture(FIELDS, TEXT);
    assertNoJunk(by);
    expect(by.lessor_name).toBe('Mrs. Lakshmi Priya');
    expect(by.lessee_name).toMatch(/Techno Solutions Pvt Ltd/);
    expect(by.monthly_rent).toBe('40000');
    expect(by.security_deposit).toBe('120000');
    expect(by.term_months).toBe('24');
  });
});

describe('golden extraction — worded lakh/crore amount', () => {
  it('captures a bare lakh/crore amount for a lone currency field', () => {
    const lakh = capture([S('total_consideration', 'Total consideration', 'currency')],
      'The property was sold for 25 lakh only, possession handed over.');
    expect(lakh.total_consideration).toBe('2500000');
    const crore = capture([S('claim_amount', 'Claim amount', 'currency')],
      'Damages claimed to the tune of 1.2 crore against the defendant.');
    expect(crore.claim_amount).toBe('12000000');
  });
});

describe('golden extraction — place (execution/signing town), across formats', () => {
  const P = [S('place', 'Place')];
  it('captures place from common Indian legal phrasings', () => {
    expect(capture(P, 'This Agreement is made on this 5th day of May, 2026 at Chennai.').place).toBe('Chennai');
    expect(capture(P, 'The deed shall be executed at Coimbatore before witnesses.').place).toBe('Coimbatore');
    expect(capture(P, 'All disputes subject to the jurisdiction of Courts at Madurai.').place).toBe('Madurai');
    expect(capture(P, 'Place: Salem. Advocate signs here.').place).toBe('Salem');
  });
  it('does NOT grab a property location or "No." as the place', () => {
    // "flat at No.7 Beach Road, Chennai" is a property address, not the signing town.
    const by = capture(P, 'The property is a flat at No.7 Beach Road, Chennai, sold to the vendee.');
    expect(by.place === undefined || by.place !== 'No').toBe(true);
    expect(by.place).not.toBe('No');
  });
});
