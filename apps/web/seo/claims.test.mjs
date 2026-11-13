// Landing claims must match what the product does (decision 2026-11-13,
// build-docs/MEMORY.md). AI answer engines quote this copy verbatim.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const files = ['index.html', 'src/views/LandingView.tsx'].map((f) => [
  f,
  readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'),
]);

const FALSE_CLAIMS = [
  ['200+ templates', /200\+/],
  ['direct API e-filing', /file directly/i],
  ['Hindi templates', /Hindi templates/i],
  ['tribunal case tracking', /Tribunal records/i],
  ['Supreme Court tracking', /or the Supreme Court/i],
  ['2026 language roadmap', /2026 roadmap/i],
];

describe('landing claims', () => {
  for (const [file, text] of files) {
    for (const [label, re] of FALSE_CLAIMS) {
      it(`${file} does not claim ${label}`, () => {
        expect(text).not.toMatch(re);
      });
    }
  }

  it('states the real format count and data location', () => {
    const landing = files[1][1];
    expect(landing).toContain('84 court-ready Indian formats');
    expect(landing).toContain('Mumbai');
  });
});
