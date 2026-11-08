import { describe, expect, it } from 'vitest';
import { correctLawSlips, introducedParticulars, lostParticulars, misnamedActs, particularsOf, stripSentences, unauthorisedCitations } from '../draft-guards';

describe('particularsOf — format-independent keys', () => {
  it('treats different spellings of the same amount, date and section as equal', () => {
    const a = particularsOf('Rs. 450000/- on 2024-11-04 under BNS s.303(2) within 15 days');
    const b = particularsOf('Rs. 4,50,000/- on 4th November 2024 under Section 303 (2) within 15 days');
    const keys = (ps: ReturnType<typeof particularsOf>) => ps.map((p) => `${p.kind}:${p.key}`).sort();
    expect(keys(a)).toEqual(keys(b));
  });

  it('reads day-periods in digits, words, singular and "fifteen (15)" form alike', () => {
    const lost = lostParticulars(
      'in custody for 1 days; pay within 15 days; 60 days; forty-five days',
      'in custody for one day; pay within fifteen (15) days; sixty days; 45 days',
    );
    expect(lost).toEqual([]);
    expect(lostParticulars('pay within 15 days', 'pay within thirty days').map((p) => p.raw)).toEqual(['15 days']);
  });

  it('ignores the fillable [to be drafted] marker but keeps other markers', () => {
    const ps = particularsOf('GROUNDS: [to be drafted]. Presented through [bank where presented to be provided].');
    expect(ps.map((p) => p.raw)).toEqual(['[bank where presented to be provided]']);
  });
});

describe('lostParticulars / introducedParticulars', () => {
  const skeleton = '4. The petitioner was taken into custody on 2024-09-16 and has been in custody for 96 days. 3. The offence is registered under BNS s.303(2), BNS s.317(2).';

  it('never demands the draft-now sentinel "Rs. 0" be kept', () => {
    expect(lostParticulars('damages at Rs. 0/- per day and arrears of Rs. 48,000', 'damages at Rs. 20,000 per month and arrears of Rs. 48,000')).toEqual([]);
  });

  it('flags a section or date the composed text dropped', () => {
    const lost = lostParticulars(skeleton, 'He was arrested on 16.09.2024 under Section 303(2) and has been in custody for 96 days.');
    expect(lost.map((p) => p.raw)).toEqual(['s.317(2)']);
  });

  it('flags invented figures but allows totals of known amounts', () => {
    const src = 'Cheque 1 for Rs. 399088/-; cheque 2 for Rs. 300000/-.';
    const out = introducedParticulars('Total Rs. 6,99,088/- and interest of Rs. 25,000/- since 01.01.2026.', [src]);
    expect(out.map((p) => p.raw)).toEqual(['Rs. 25,000', '01.01.2026']);
  });
});

describe('stripSentences', () => {
  it('removes only the offending sentence and keeps abbreviations intact', () => {
    const r = stripSentences(
      ['5. The cheque No. 000105 for Rs. 399088/- was dishonoured. It was drawn on a Swiss bank. The memo was received on 2026-04-18.'],
      ['Swiss bank'],
    );
    expect(r.paragraphs).toEqual(['5. The cheque No. 000105 for Rs. 399088/- was dishonoured. The memo was received on 2026-04-18.']);
    expect(r.unresolved).toEqual([]);
  });

  it('drops a paragraph emptied down to its number and reports needles it cannot find', () => {
    const r = stripSentences(['6. He lives in Paris.', '7. He is innocent.'], ['Paris', 'London']);
    expect(r.paragraphs).toEqual(['7. He is innocent.']);
    expect(r.unresolved).toEqual(['London']);
  });
});

describe('draft-guards — Act-abbreviation sections and misnamed Acts', () => {
  it('reads "BNS 318(4)" as a section, but not "BNSS 2023" as one', () => {
    expect(particularsOf('registered under BNS 318(4) and IPC 420').filter((p) => p.kind === 'section').map((p) => p.key))
      .toEqual(['318(4)', '420']);
    expect(particularsOf('under the BNSS 2023').filter((p) => p.kind === 'section')).toEqual([]);
  });
  it('flags an Act expanded as another', () => {
    expect(misnamedActs(['The offence is under Section 318(4) of the Bharatiya Nagarik Suraksha Sanhita, 2023 (BNS). It is cheating.']))
      .toEqual(['The offence is under Section 318(4) of the Bharatiya Nagarik Suraksha Sanhita, 2023 (BNS).']);
    expect(misnamedActs(['Section 318(4) of the Bharatiya Nyaya Sanhita, 2023 (BNS).'])).toEqual([]);
  });
});

describe('draft-guards — case names keep their sentence', () => {
  it('does not end a sentence at "Ors." / "Anr." inside a case name', () => {
    const s = stripSentences(
      ['As held in Dev Gupta v. PEC University of Technology and Ors. that a reason is required, the order fails. Next point.'],
      ['a reason is required'],
    );
    expect(s.paragraphs).toEqual(['Next point.']);
  });
});

describe('draft-guards — CPC Orders and Rules', () => {
  it('reads "Order XXXIX Rules 1 and 2" and "O.39 R.1 & 2" as the same provision', () => {
    const a = particularsOf('under Order XXXIX Rules 1 and 2 CPC').filter((p) => p.kind === 'order').map((p) => p.key);
    const b = particularsOf('under O.39 R.1 & 2').filter((p) => p.kind === 'order').map((p) => p.key);
    expect(a).toEqual(['39:1,2']);
    expect(b).toEqual(a);
  });
  it('strips an Order the skeleton and authorities do not carry', () => {
    const bad = unauthorisedCitations(['The plaint complies with Order VII Rule 1 CPC. The suit is within Order XX Rule 12.'],
      [''], [{ cite: 'Order VII Rule 1 of the Code of Civil Procedure, 1908', actPattern: 'CPC|Code of Civil Procedure' }]);
    expect(bad).toEqual(['The suit is within Order XX Rule 12.']);
  });
});

describe('stripSentences — leave the averment slot, not a hole', () => {
  it('puts one marker where sentences were removed, keeping the ground letter', () => {
    const s = stripSentences(
      ['B. The cause of action arose on 21.02.2024 on default. It is invented. The court has jurisdiction.', '7. Fine paragraph.'],
      ['21.02.2024', 'It is invented'], '[to be drafted]',
    );
    expect(s.paragraphs).toEqual(['B. [to be drafted] The court has jurisdiction.', '7. Fine paragraph.']);
    expect(s.removed).toHaveLength(2);
  });
});

describe('lostParticulars — a precise clause keeps its parent', () => {
  it('treats Section 13(1)(ia) as keeping s.13(1), but not the reverse', () => {
    expect(lostParticulars('divorce under s.13(1)', 'divorce under Section 13(1)(ia)')).toEqual([]);
    expect(lostParticulars('cruelty under s.13(1)(ia)', 'divorce under Section 13(1)').map((p) => p.key)).toEqual(['13(1)(ia)']);
  });
});

describe('draft-guards — Order/Rule in any case', () => {
  it('reads an engine title "ORDER XVII RULE 1" as the same provision as "Order XVII Rule 1"', () => {
    const key = (t: string) => particularsOf(t).filter((p) => p.kind === 'order').map((p) => p.key);
    expect(key('PETITION UNDER ORDER XVII RULE 1 OF THE CODE')).toEqual(['17:1']);
    expect(key('under Order XVII Rule 1 of the Code')).toEqual(['17:1']);
    expect(unauthorisedCitations(['The petition is under Order XVII Rule 1 of the Code of Civil Procedure.'],
      ['PETITION FOR ADJOURNMENT UNDER ORDER XVII RULE 1'], [])).toEqual([]);
  });
});


describe('correctLawSlips', () => {
  it('test_s106_notice_item9_guard: the pre-2002 month-end rule cannot come back', () => {
    const [p] = correctLawSlips(["It can be terminated by the landlord by giving the tenant fifteen days' notice expiring with the end of a month of the tenancy."]);
    expect(p).not.toMatch(/end of a month/);
    expect(p).toContain("fifteen days' notice");
    // the statement that the rule does NOT apply is left alone
    const ok = 'The notice need not expire with the end of a month of the tenancy.';
    expect(correctLawSlips([ok])[0]).toBe(ok);
  });

  it('test_general_notice_item9_guard: interest is never equated with the principal alone', () => {
    const [p] = correctLawSlips(['refund the deposit with interest at 12% p.a. from 31.08.2026, being the sum of Rs. 1,50,000/- within 15 days']);
    expect(p).toContain('the principal sum being Rs. 1,50,000');
    expect(p).not.toContain('being the sum of');
  });
});
