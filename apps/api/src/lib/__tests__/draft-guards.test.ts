import { describe, expect, it } from 'vitest';
import { introducedParticulars, lostParticulars, particularsOf, stripSentences } from '../draft-guards';

describe('particularsOf — format-independent keys', () => {
  it('treats different spellings of the same amount, date and section as equal', () => {
    const a = particularsOf('Rs. 450000/- on 2024-11-04 under BNS s.303(2) within 15 days');
    const b = particularsOf('Rs. 4,50,000/- on 4th November 2024 under Section 303 (2) within 15 days');
    const keys = (ps: ReturnType<typeof particularsOf>) => ps.map((p) => `${p.kind}:${p.key}`).sort();
    expect(keys(a)).toEqual(keys(b));
  });

  it('ignores the fillable [to be drafted] marker but keeps other markers', () => {
    const ps = particularsOf('GROUNDS: [to be drafted]. Presented through [bank where presented to be provided].');
    expect(ps.map((p) => p.raw)).toEqual(['[bank where presented to be provided]']);
  });
});

describe('lostParticulars / introducedParticulars', () => {
  const skeleton = '4. The petitioner was taken into custody on 2024-09-16 and has been in custody for 96 days. 3. The offence is registered under BNS s.303(2), BNS s.317(2).';

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
