import { describe, expect, it } from 'vitest';
import { patchFromRaw, type IntakeFieldSpec } from '../intake-llm.service';

// Unit tests for the raw-extraction -> ExtractionPatch validation, focused on the
// collision handling (the bug where a "collision" naming the SAME field twice
// wrongly blocked the value from committing → empty cheque fields on screen).

const SPECS: IntakeFieldSpec[] = [
  { key: 'cheque_no', label: 'Cheque number', type: 'text', required: true },
  { key: 'cheque_amount', label: 'Cheque amount', type: 'currency', required: true },
  { key: 'sender_name', label: 'Payee name', type: 'text', required: true },
];

describe('patchFromRaw — collision handling', () => {
  it('a degenerate collision (same field twice) does NOT block the field', () => {
    const patch = patchFromRaw(
      {
        fields: [{ key: 'cheque_no', value: '000105', confidence: 'stated', source: 'Cheque No. 000105' }],
        collisions: [{ value: '000105', candidates: ['cheque_no', 'cheque_no'] }],
      },
      SPECS,
      'test',
    );
    // The value commits (was previously dropped), and there is no real collision.
    expect(patch.fields.find((f) => f.key === 'cheque_no')?.value).toBe('000105');
    expect(patch.collisions).toHaveLength(0);
  });

  it('a GENUINE collision (two distinct fields) blocks both and is recorded', () => {
    const patch = patchFromRaw(
      {
        fields: [
          { key: 'cheque_no', value: '5000', confidence: 'stated', source: '5000' },
          { key: 'cheque_amount', value: '5000', confidence: 'stated', source: '5000' },
        ],
        collisions: [{ value: '5000', candidates: ['cheque_no', 'cheque_amount'] }],
      },
      SPECS,
      'test',
    );
    // Neither committed (don't pick); the collision is surfaced to ask.
    expect(patch.fields.find((f) => f.key === 'cheque_no')).toBeUndefined();
    expect(patch.fields.find((f) => f.key === 'cheque_amount')).toBeUndefined();
    expect(patch.collisions).toHaveLength(1);
    expect(patch.collisions[0]!.candidates).toEqual(['cheque_no', 'cheque_amount']);
  });

  it('drops hallucinated keys not in the contract', () => {
    const patch = patchFromRaw(
      { fields: [{ key: 'not_a_field', value: 'x', confidence: 'stated', source: 'x' }] },
      SPECS,
      'test',
    );
    expect(patch.fields).toHaveLength(0);
  });
});

describe('patchFromRaw — currency guard (the "amount = 2" bug)', () => {
  it('rejects a 1-2 digit "amount" (a stray numeral, not money)', () => {
    for (const bad of ['2', '12', 'Rs. 2', '2.']) {
      const patch = patchFromRaw(
        { fields: [{ key: 'cheque_amount', value: bad, confidence: 'stated', source: bad }] },
        SPECS,
        'test',
      );
      expect(patch.fields.find((f) => f.key === 'cheque_amount'), `"${bad}" should be rejected`).toBeUndefined();
    }
  });

  it('accepts a real amount and strips symbols/commas', () => {
    const patch = patchFromRaw(
      { fields: [{ key: 'cheque_amount', value: 'INR 3,99,088', confidence: 'stated', source: 'INR 3,99,088' }] },
      SPECS,
      'test',
    );
    expect(patch.fields.find((f) => f.key === 'cheque_amount')?.value).toBe('399088');
  });
});

describe('patchFromRaw — cheque-number guard (the document-title-as-cheque-number bug)', () => {
  // Real fabrication caught by intake-compose's VERIFY: the model read a
  // document's own title ("CHEQUE PRESENTATION DEFERMENT AGREEMENT") as if it
  // were a cheque NUMBER, then invented cheques 9-12 around it.
  const MULTI_CHEQUE_SPECS: IntakeFieldSpec[] = [
    ...SPECS,
    { key: 'cheque_no_9', label: 'Cheque 9 — number', type: 'text', required: false },
    { key: 'cheque_no_12', label: 'Cheque 12 — number', type: 'text', required: false },
  ];

  it('rejects a document title / sentence as a cheque number', () => {
    for (const bad of [
      'PRESENTATION DEFERMENT AGREEMENT',
      'CHEQUE PRESENTATION DEFERMENT AGREEMENT (1)',
      'the cheque mentioned above',
    ]) {
      const patch = patchFromRaw(
        { fields: [{ key: 'cheque_no', value: bad, confidence: 'stated', source: bad }] },
        SPECS,
        'test',
      );
      expect(patch.fields.find((f) => f.key === 'cheque_no'), `"${bad}" should be rejected`).toBeUndefined();
    }
  });

  it('rejects the same garbage on INDEXED cheque_no_N keys (cheque 9, cheque 12, …)', () => {
    const patch = patchFromRaw(
      {
        fields: [
          { key: 'cheque_no_9', value: 'CHEQUE PRESENTATION DEFERMENT AGREEMENT (1)', confidence: 'stated', source: 'x' },
          { key: 'cheque_no_12', value: '000104', confidence: 'stated', source: 'Cheque No. 000104' },
        ],
      },
      MULTI_CHEQUE_SPECS,
      'test',
    );
    expect(patch.fields.find((f) => f.key === 'cheque_no_9')).toBeUndefined();
    expect(patch.fields.find((f) => f.key === 'cheque_no_12')?.value).toBe('000104'); // a REAL number still passes
  });

  it('accepts real cheque numbers (digits, with or without a leading letter)', () => {
    for (const good of ['000105', '456789', 'A1234']) {
      const patch = patchFromRaw(
        { fields: [{ key: 'cheque_no', value: good, confidence: 'stated', source: good }] },
        SPECS,
        'test',
      );
      expect(patch.fields.find((f) => f.key === 'cheque_no')?.value).toBe(good);
    }
  });
});
