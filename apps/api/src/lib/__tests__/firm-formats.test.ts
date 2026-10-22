import { describe, expect, it } from 'vitest';
import { mapFormToFields, LABEL_TO_ENGINE_DOC } from '../engine-field-map';
import {
  docTypeForId,
  isFirmFormatDocType,
  isFirmFormatLabel,
  labelForTitle,
} from '../../services/firm-formats.service';

// A firm's own format is drafted by the engine from its stored spec. These pin the
// pieces that keep it separate from (and unable to shadow) the built-in formats.

describe('firm formats — labels and doc types', () => {
  it('labels carry the firm-format suffix and never equal a built-in label', () => {
    const label = labelForTitle('Memo for Return of Original Documents');
    expect(label).toBe('Memo for Return of Original Documents (firm format)');
    expect(isFirmFormatLabel(label)).toBe(true);
    for (const builtin of Object.keys(LABEL_TO_ENGINE_DOC)) {
      expect(isFirmFormatLabel(builtin)).toBe(false);
    }
  });

  it('doc type is a stable engine-safe slug derived from the row id', () => {
    const dt = docTypeForId('82CD866C-F680-45CF-9750-A6CA21DA36DD');
    expect(dt).toBe('firm_format_82cd866cf68045cf9750a6ca21da36dd');
    expect(isFirmFormatDocType(dt)).toBe(true);
    expect(/^[a-z][a-z0-9_]{2,60}$/.test(dt)).toBe(true); // engine SLUG_RE
    expect(Object.values(LABEL_TO_ENGINE_DOC)).not.toContain(dt);
  });
});

describe('firm formats — form -> engine field coercion', () => {
  const fields = [
    { key: 'case_ref', kind: 'string' },
    { key: 'leave_granted', kind: 'bool' },
    { key: 'copies', kind: 'int' },
    { key: 'documents', kind: 'string_list' },
    { key: 'disposal_date', kind: 'date' },
  ];

  it('coerces web strings to the spec kinds and drops blanks (engine 422s, never invents)', () => {
    const { fields: out } = mapFormToFields(fields, {
      case_ref: ' O.S. 9/2025 ',
      leave_granted: 'Yes',
      copies: '2',
      documents: 'Sale deed\n\nPatta',
      disposal_date: '2026-02-10',
      unrelated: '   ',
    });
    expect(out).toEqual({
      case_ref: 'O.S. 9/2025',
      leave_granted: true,
      copies: 2,
      documents: ['Sale deed', 'Patta'],
      disposal_date: '2026-02-10',
    });
  });

  it('an absent required fact stays absent', () => {
    const { fields: out } = mapFormToFields(fields, { case_ref: '' });
    expect('case_ref' in out).toBe(false);
  });
});
