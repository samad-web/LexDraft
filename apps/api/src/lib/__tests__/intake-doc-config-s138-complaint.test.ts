// Validates the hand-tuned s.138 COMPLAINT intake config: its sectioning,
// Tamil-Nadu practice defaults, and that every field key it exposes is a real
// engine field (so passthrough can't 422 on an unknown key).
import { describe, expect, it } from 'vitest';
import { intakeDocConfig, seedDefaults } from '../intake-doc-config';
import engineDocContract from '../../../../../packages/types/src/data/engine-doc-contract.json';

const contract = engineDocContract as unknown as Record<string, { all: string[]; required: string[] }>;

describe('s138_complaint intake config', () => {
  const sections = intakeDocConfig['s138_complaint']!;

  it('is hand-tuned (present in intakeDocConfig, not auto-derived)', () => {
    expect(sections).toBeDefined();
    expect(sections.length).toBeGreaterThan(1); // grouped, not one "Details" section
  });

  it('groups fields into the sections of the actual complaint', () => {
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual([
      'Complainant',
      'Accused',
      'Cheques',
      'Underlying debt',
      'Presentation & dishonour',
      'Statutory notice & service',
      'Jurisdiction & filing',
      'Document schedule & prayer',
      'Counsel for the complainant',
    ]);
  });

  it('seeds Tamil-Nadu practice defaults (itemise & twice-amount = Yes)', () => {
    const defaults = seedDefaults(sections);
    expect(defaults.itemise_documents).toBe('Yes');
    expect(defaults.prayer_twice_amount).toBe('Yes');
    expect(defaults.is_payee).toBe('Yes');
    expect(defaults.payee_bank_branch_in_jurisdiction).toBe('Yes');
  });

  it('exposes the new refinement fields with readable labels', () => {
    const byKey = new Map(sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(byKey.get('deferment_agreement_date')?.label).toMatch(/deferment/i);
    expect(byKey.get('itemise_documents')?.options).toEqual(['Yes', 'No']);
    expect(byKey.get('prayer_twice_amount')?.options).toEqual(['Yes', 'No']);
    expect(byKey.get('notice_ack_official_date')).toBeDefined();
    expect(byKey.get('notice_ack_residence_date')).toBeDefined();
  });

  it('every declared engine key is a real s138_complaint engine field', () => {
    const engineKeys = new Set(contract['s138_complaint']!.all);
    // Indexed cheque paths (cheques[0].number) normalise to the list field `cheques`.
    const unknown: string[] = [];
    for (const sec of sections) {
      for (const f of sec.fields) {
        const keys = f.engineKeys ?? [f.key];
        for (const k of keys) {
          const base = k.replace(/\[\d+\]\..*$/, '').replace(/\[\d+\]$/, '');
          if (!engineKeys.has(base)) unknown.push(`${f.key} -> ${k}`);
        }
      }
    }
    expect(unknown, `intake keys with no matching engine field:\n  ${unknown.join('\n  ')}`).toEqual([]);
  });

  it('every required engine field is covered by some intake field', () => {
    const required = contract['s138_complaint']!.required;
    const covered = new Set<string>();
    for (const sec of sections) {
      for (const f of sec.fields) {
        for (const k of f.engineKeys ?? [f.key]) {
          covered.add(k.replace(/\[\d+\]\..*$/, '').replace(/\[\d+\]$/, ''));
        }
      }
    }
    const missing = required.filter((k) => !covered.has(k));
    expect(missing, `required engine fields with no intake question:\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});
