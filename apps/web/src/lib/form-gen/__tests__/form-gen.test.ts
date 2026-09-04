import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateDocSchema, humanise, fallbackPresentation } from '../generate';
import { dualRead, KEY_ALIASES } from '../key-aliases';
import { regularBailPresentation } from '../presentation/regular_bail';
import type { EngineContractEntry } from '../types';

const contract = JSON.parse(
  readFileSync(join(__dirname, '../../../../../api/src/lib/__tests__/engine-doc-contract.json'), 'utf8'),
) as Record<string, EngineContractEntry>;

describe('form generator', () => {
  it('places every engine field for regular_bail', () => {
    const schema = generateDocSchema(contract.regular_bail!, regularBailPresentation);
    const rendered = schema.sections.flatMap((s) => s.fields.map((f) => f.key));
    const engineKeys = contract.regular_bail!.fields.map((f) => f.key);
    expect(new Set(rendered)).toEqual(new Set(engineKeys));
  });

  it('groups into the authored section order', () => {
    const schema = generateDocSchema(contract.regular_bail!, regularBailPresentation);
    expect(schema.sections.map((s) => s.title)).toEqual([
      'Accused', 'FIR & Offence', 'Custody', 'Court & Application', 'Grounds', 'Successive Application',
    ]);
  });

  it('maps engine kinds to web field types', () => {
    const schema = generateDocSchema(contract.regular_bail!, regularBailPresentation);
    const byKey = Object.fromEntries(schema.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(byKey.custody_since!.type).toBe('date');
    expect(byKey.age!.type).toBe('number');
    expect(byKey.chargesheet_filed!.type).toBe('select'); // bool -> Yes/No
    expect(byKey.chargesheet_filed!.options).toEqual(['Yes', 'No']);
    expect(byKey.special_statute!.type).toBe('select');   // enum
    expect(byKey.special_statute!.options).toEqual(['NDPS Act', 'PMLA', 'UAPA', 'SC/ST Act']);
    expect(byKey.sections!.type).toBe('textarea');        // string_list
    expect(byKey.address!.type).toBe('textarea');         // rows:2 in presentation
  });

  it('carries help + visibleWhen from presentation', () => {
    const schema = generateDocSchema(contract.regular_bail!, regularBailPresentation);
    const byKey = Object.fromEntries(schema.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(byKey.sections!.help).toContain('statute tables');
    expect(byKey.change_of_circumstance!.visibleWhen).toEqual({ field: 'is_successive', equals: 'Yes' });
  });

  it('required/optional flags follow the engine contract', () => {
    const schema = generateDocSchema(contract.regular_bail!, regularBailPresentation);
    const byKey = Object.fromEntries(schema.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
    expect(byKey.accused_name!.required).toBe(true);
    expect(byKey.offence_date!.optional).toBe(true);
  });

  it('humanise turns snake_case into a readable label', () => {
    expect(humanise('accused_parentage')).toBe('Accused parentage');
  });

  it('fallback presentation renders an un-annotated doc type usably (one section, all fields)', () => {
    const anyDoc = contract.will ?? Object.values(contract)[0]!;
    const schema = generateDocSchema(anyDoc, fallbackPresentation(anyDoc));
    expect(schema.sections).toHaveLength(1);
    const rendered = schema.sections[0]!.fields.map((f) => f.key);
    expect(new Set(rendered)).toEqual(new Set(anyDoc.fields.map((f) => f.key)));
    // every label is non-empty (humanised)
    expect(schema.sections[0]!.fields.every((f) => f.label.length > 0)).toBe(true);
  });
});

describe('saved-draft dual-read', () => {
  it('falls back to the old web key when the new engine key is absent', () => {
    const saved = { accused_address: '47, Kamaraj Nagar, Avadi', fir_no: '812/2024' };
    const read = dualRead('regular_bail', saved);
    // new key `address` absent -> falls back to old `accused_address`
    expect(read('address')).toBe('47, Kamaraj Nagar, Avadi');
    // same-name key reads through
    expect(read('fir_no')).toBe('812/2024');
  });

  it('prefers the new key when it already has a value', () => {
    const saved = { address: 'NEW value', accused_address: 'OLD value' };
    expect(dualRead('regular_bail', saved)('address')).toBe('NEW value');
  });

  it('when BOTH old and new keys are populated, the NEW key wins', () => {
    // The new engine key is checked first and returned when non-empty; the old key is
    // only a fallback for an absent/empty new key. So a migrated draft (backfilled into
    // the new key) or an advocate's edit under the new key always takes precedence over
    // a stale old-key value — the new key is the current truth.
    const saved = { address: 'NEW: 12 MG Road', accused_address: 'OLD: 47 Kamaraj Nagar' };
    expect(dualRead('regular_bail', saved)('address')).toBe('NEW: 12 MG Road');
    // but an empty new key still falls back to the old value (never shows blank).
    const savedEmptyNew = { address: '', accused_address: 'OLD only' };
    expect(dualRead('regular_bail', savedEmptyNew)('address')).toBe('OLD only');
  });

  it('non-trivial reshaped fields are NOT aliased (advocate re-enters)', () => {
    // custody_days must not silently become custody_since
    expect(KEY_ALIASES.regular_bail!.renames.custody_since).toBeUndefined();
    expect(KEY_ALIASES.regular_bail!.nonTrivial).toContain('custody_days');
    const read = dualRead('regular_bail', { custody_days: '95' });
    expect(read('custody_since')).toBeUndefined();
  });
});
