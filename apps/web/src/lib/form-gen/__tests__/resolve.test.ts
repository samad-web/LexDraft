import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOC_SCHEMAS } from '../../doc-schemas';

// The set of enabled slugs the mocked flags module reports. Mutated per test. Using a
// module mock (not import.meta.env) because Vite inlines VITE_* env at build, so
// stubEnv doesn't reliably reach import.meta.env under vitest.
const enabled = new Set<string>();
vi.mock('../flags', () => ({
  isGeneratedFormEnabled: (slug: string) => enabled.has(slug),
}));

// Import AFTER the mock is registered (vi.mock is hoisted, so a static import is fine).
import { resolveDocSchemas } from '../resolve';

beforeEach(() => enabled.clear());
afterEach(() => enabled.clear());

describe('resolveDocSchemas — reversible flip', () => {
  it('is a NO-OP while every flag is off (returns DOC_SCHEMAS unchanged)', () => {
    const resolved = resolveDocSchemas();
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(DOC_SCHEMAS).sort());
    expect(resolved['Bail Application']).toEqual(DOC_SCHEMAS['Bail Application']);
  });

  it('enabling regular_bail exposes the generated schema under the engine label and drops the legacy label', () => {
    enabled.add('regular_bail');
    const resolved = resolveDocSchemas();
    expect(resolved['Regular Bail Application']).toBeDefined();
    expect(resolved['Regular Bail Application']!.sections.map((s) => s.title)).toContain('Custody');
    expect(resolved['Bail Application']).toBeUndefined();
    expect(resolved['Notice u/s 138 NI Act']).toEqual(DOC_SCHEMAS['Notice u/s 138 NI Act']);
  });

  it('is reversible: enable then disable restores the original', () => {
    enabled.add('regular_bail');
    expect(resolveDocSchemas()['Bail Application']).toBeUndefined();
    enabled.clear();
    expect(resolveDocSchemas()['Bail Application']).toEqual(DOC_SCHEMAS['Bail Application']);
  });
});
