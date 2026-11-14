import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TermsAgree } from '../TermsConsent';

// build-docs/features/terms-consent.md AC4, AC5 (+ Part C wording).

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('terms consent (web)', () => {
  it('AC4: the box is unticked by default, required, and links both documents', () => {
    const html = renderToStaticMarkup(createElement(TermsAgree, { checked: false, onChange: () => {} }));
    expect(html).toMatch(/type="checkbox"/);
    expect(html).toMatch(/required=""/);
    expect(html).not.toMatch(/checked=""/);
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });

  it('AC4: every sign-up call sends acceptTerms and its button waits for the box', () => {
    for (const [file, calls] of [['views/AuthView.tsx', 2], ['views/SignupView.tsx', 2]] as const) {
      const s = src(file);
      expect(s.match(/acceptTerms: true/g)?.length, file).toBe(calls);
      expect(s.match(/<TermsAgree /g)?.length, file).toBe(2);
      expect(s, file).toMatch(/!agreedTerms/);
    }
    expect(src('views/AuthView.tsx')).toContain('ready={newPassword.length >= 8 && agreedTerms}');
    expect(src('views/SignupView.tsx').match(/disabled=\{isSubmitting \|\| signUp\.isPending \|\| !password\.ok \|\| !agreedTerms\}/g)?.length).toBe(2);
  });

  it('AC5: the app shows the consent screen first, never to superadmin or act-as', () => {
    const app = src('App.tsx');
    expect(app).toContain('if (user.needsTermsAcceptance && !user.isSuperadmin && !actAs) {');
    expect(app.indexOf('<TermsConsentView />')).toBeLessThan(app.indexOf("const onboarding = !!user.needsOnboarding"));
  });

  it('privacy Part C describes the tick box and the consent record', () => {
    const legal = src('views/LegalView.tsx');
    expect(legal).toContain('you tick a box, which is never ticked for you');
    expect(legal).toContain('the version you agreed or disagreed to, the time, and the IP address');
  });
});
