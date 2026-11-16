import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner, 2026-11-16: clicking Pricing shows the plan cards on the landing
// page itself (the original card design), with no sign-in and no other page.
const src = readFileSync(resolve(__dirname, '../LandingView.tsx'), 'utf8');
const header = readFileSync(resolve(__dirname, '../../components/LandingHeader.tsx'), 'utf8');

describe('landing Pricing', () => {
  it('the Pricing tab scrolls to the pricing section on the same page, never sign-in', () => {
    expect(src).toContain('onTabChange={goSection}');
    expect(src).toContain("const known: TabId[] = ['home', 'features', 'pricing', 'faq', 'trial'];");
    expect(src).not.toMatch(/'pricing' \? goAuth\(\)/);
    expect(src).not.toContain("window.location.assign('/pricing')");
  });

  it('the pricing section renders the shared plan catalogue as cards with a monthly/yearly switch', () => {
    expect(src).toContain('id="pricing"');
    expect(src).toContain('SIGNUP_PLANS.map((plan, i) =>');
    expect(src).toContain('items={BILLING_OPTIONS}');
    expect(src).toContain("'per month + GST'");
  });

  it('phones and tablets get a Pricing button that scrolls to the same section', () => {
    expect(header).toContain(`onClick={() => onTabChange('pricing')}`);
    expect(header).toMatch(/max-width: 1023px\) \{\s*\.lex-landing-pricing \{ display: inline-flex; \}/);
  });

  it('the footer Pricing link stays on the page', () => {
    expect(src).toContain("{ label: 'Pricing', href: '#pricing' }");
  });
});
