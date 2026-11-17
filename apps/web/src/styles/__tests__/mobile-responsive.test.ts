// mobile-responsive (build-docs/features/mobile-responsive.md): the central
// touch/phone rules in chambers.css. Layout itself is checked in a real
// browser by the audit script (see the feature doc); these tests stop the
// rules from being dropped or weakened by later CSS edits.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../chambers.css'), 'utf8').replace(/\r\n/g, '\n');
const section = css.slice(css.indexOf('/* ---------- TOUCH + PHONE FIXES'));

/** Body of the first `@media <query> {` block in the touch section (brace-matched). */
function media(query: string): string {
  const start = section.indexOf(`@media ${query} {`);
  expect(start, `@media ${query}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = section.indexOf('{', start); i < section.length; i++) {
    if (section[i] === '{') depth++;
    if (section[i] === '}' && --depth === 0) return section.slice(start, i + 1);
  }
  throw new Error(`unclosed @media ${query}`);
}

describe('mobile-responsive: touch targets (AC3)', () => {
  const touch = media('(pointer: coarse)');
  it('buttons, small buttons and inputs are 44px tall on touch screens', () => {
    expect(touch).toMatch(/--btn-h: 44px;/);
    expect(touch).toMatch(/--btn-sm-h: 44px;/);
    expect(touch).toMatch(/--input-h: 44px;/);
  });
  it('chips, tabs, segment buttons, selects and stand-alone links get a 44px row', () => {
    for (const sel of ['.chip', '.pill-nav button', '.ct-seg button', '.select-trigger', '.page-header-back', '.adv-link', '.auth-forgot']) {
      expect(touch, sel).toContain(sel);
    }
    expect(touch).toMatch(/min-height: 44px;/);
  });
  it('icon-only controls are at least 44px wide', () => {
    // Only icon buttons (aria-label): a min-width on every .btn would let flex rows squeeze text buttons.
    expect(touch).toMatch(/\.btn\[aria-label\] \{ min-width: 44px; flex-shrink: 0; \}/);
    expect(touch).toMatch(/\.auth-eye \{\n\s*min-width: 44px;\n\s*flex-shrink: 0;/);
    expect(touch).not.toMatch(/\.matter-intel-tab,\n[^{]*\.auth-eye \{\n\s*min-width/);
  });
  it('only a coarse pointer gets the bigger sizes (desktop density unchanged, AC6)', () => {
    const outside = section.replace(touch, '');
    expect(outside).not.toMatch(/--btn-h: 44px/);
  });
});

describe('mobile-responsive: no iOS zoom on focus (AC4)', () => {
  it('form fields are 16px on touch screens, overriding inline 13-15px sizes', () => {
    const touch = media('(pointer: coarse)');
    expect(touch).toMatch(/--input-fs: 16px;/);
    expect(touch).toMatch(/select,\n\s*:root\[data-ui='chambers'\] textarea \{\n\s*font-size: 16px !important;/);
    // Checkboxes/radios and the two deliberately larger fields are left alone.
    expect(touch).toMatch(/input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)/);
    expect(touch).toMatch(/:not\(\[style\*='font-size: 24px'\]\)/);
  });
});

describe('mobile-responsive: phone shell (AC1, AC5)', () => {
  const phone = media('(max-width: 767px)');
  it('the closed drawer casts no shadow and leaves the tab order', () => {
    expect(phone).toMatch(/\.sidebar:not\(\.is-open\) \{\n\s*visibility: hidden;\n\s*box-shadow: none;/);
    // visibility flips only after the 220ms slide-out, so closing still animates.
    expect(phone).toMatch(/visibility 0s linear 220ms/);
  });
  it('a long screen title wraps to two lines instead of being cut', () => {
    expect(phone).toMatch(/\.topbar-title-row \{[^}]*-webkit-line-clamp: 2;/);
  });
  it('360px phones keep 44px-tall top-bar icons, 40px wide', () => {
    expect(media('(pointer: coarse) and (max-width: 374px)')).toMatch(/width: 40px; min-width: 40px;/);
  });
});

describe('mobile-responsive: phone content (AC2, AC5)', () => {
  const small = media('(max-width: 640px)');
  it('field hints wrap under the label', () => {
    expect(small).toMatch(/\.field-label:has\(\.field-hint\) \{ white-space: normal; \}/);
  });
  it('stacked invoice cards put the relative due date under the date', () => {
    expect(small).toMatch(/td:has\(> \.cm-due-rel\) \{ flex-wrap: wrap; row-gap: 0; \}/);
    expect(small).toMatch(/> \.cm-due-rel \{ flex-basis: 100%;/);
  });
});
