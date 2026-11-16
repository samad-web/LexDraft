import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner, 2026-11-16: the landing page's Pricing menu shows prices without
// sign-in, by opening the public prerendered /pricing page.
const src = readFileSync(resolve(__dirname, '../LandingView.tsx'), 'utf8');

describe('landing Pricing menu', () => {
  it('opens the public /pricing page, not sign-in', () => {
    expect(src).toContain("const goPricing = () => window.location.assign('/pricing');");
    expect(src).toContain("onTabChange={(id) => (id === 'pricing' ? goPricing() : goSection(id))}");
    expect(src).not.toContain("id === 'pricing' ? goAuth()");
  });

  it('a /#pricing link from elsewhere also lands on /pricing', () => {
    expect(src).toContain("if (id === 'pricing') { goPricing(); return; }");
  });

  it('phones and tablets get a Pricing link to /pricing (the tab bar is hidden there)', () => {
    const header = readFileSync(resolve(__dirname, '../../components/LandingHeader.tsx'), 'utf8');
    expect(header).toContain('<a className="btn lex-landing-pricing" href="/pricing">');
    expect(header).toMatch(/max-width: 1023px\) \{\s*\.lex-landing-pricing \{ display: inline-flex; \}/);
  });
});
