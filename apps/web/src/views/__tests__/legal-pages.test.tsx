import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OPERATOR, PrivacyPolicyView, TermsView } from '../LegalView';

// build-docs/features/legal-pages.md — acceptance criteria 1–6.

const html = (C: () => JSX.Element) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C)));
const text = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ');
const terms = html(TermsView);
const privacy = html(PrivacyPolicyView);
const web = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8');

describe('legal pages', () => {
  it('AC1: /terms has Parts A, D, E and /privacy has Parts B, C', () => {
    for (const p of ['Part A: Terms of Service', 'Part D: Cookie and Device Permissions Notice', 'Part E: Subscription, Refund and Cancellation Policy']) expect(terms).toContain(p);
    for (const p of ['Part B: Privacy Policy', 'Part C: DPDP Act Notice, Consent and Your Rights']) expect(privacy).toContain(p);
  });

  it('AC2: no unfilled [placeholder] brackets on either page', () => {
    expect(text(terms)).not.toMatch(/\[[^\]]*\]/);
    expect(text(privacy)).not.toMatch(/\[[^\]]*\]/);
  });

  it('AC2: /terms makes no "free" offer (pricing v4)', () => {
    expect(text(terms)).not.toMatch(/(?<![-\w])free\b(?! right)/i);
  });

  it('AC3: both pages name the operator, GSTIN, address and contact email', () => {
    for (const page of [terms, privacy]) {
      expect(page).toContain(OPERATOR.gstin);
      expect(page).toContain(OPERATOR.form);
      expect(page).toContain('Zamin Pallavaram');
      expect(page).toContain(`mailto:${OPERATOR.email}`);
    }
  });

  it('AC3: privacy page publishes the Grievance Officer', () => {
    expect(privacy).toContain('id="grievance-officer"');
    expect(privacy).toContain(OPERATOR.grievanceOfficer);
  });

  it('AC4: privacy page names both AI providers', () => {
    expect(privacy).toContain('Anthropic');
    expect(privacy).toContain('OpenAI');
  });

  it('edge: device notice matches the shipped app (mic + camera disclosed, no false "no microphone")', () => {
    expect(terms).toContain('Microphone');
    expect(terms).toContain('Camera');
    expect(text(terms)).not.toMatch(/does not read[^.]*microphone/i);
  });

  it('AC5: /terms and /legal/terms are app routes and nginx serves them the SPA shell', () => {
    const app = web('src/App.tsx');
    expect(app).toContain('<Route path="/terms" element={<TermsView />} />');
    expect(app).toContain('<Route path="/legal/terms" element={<Navigate to="/terms" replace />} />');
    expect(app).toContain("location.pathname === '/terms'");
    expect(web('nginx.conf')).toMatch(/\|terms\|/);
  });

  it('AC6: landing, sign-up and settings link to /terms and /privacy', () => {
    expect(web('src/views/LandingView.tsx')).toContain("{ label: 'Terms', href: '/terms' }");
    const auth = web('src/views/AuthView.tsx');
    expect(auth.match(/href="\/terms"/g)?.length).toBe(2);
    expect(auth.match(/href="\/privacy"/g)?.length).toBe(2);
    const settings = web('src/views/SettingsView.tsx');
    expect(settings).toContain('<a href="/terms">Terms of Service</a>');
    expect(settings).not.toContain('/legal/terms');
  });
});
