import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Found live 2026-11-14: after onboarding a paid plan, saving the onboarded
// session routed away from /onboarding before the view's per-call onSuccess
// ran, so Razorpay never opened and the sign-up landed in the app unpaid.
// The redirect lives in the hook's own onSuccess, before the session is saved.
describe('paid sign-up opens Razorpay', () => {
  it('useCompleteOnboarding redirects to checkoutUrl before saving the session', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../useBilling.ts'), 'utf8');
    const hook = src.slice(src.indexOf('export function useCompleteOnboarding'));
    const redirect = hook.indexOf('window.location.assign(r.checkoutUrl)');
    const save = hook.indexOf('setSession(r.user, token)');
    expect(redirect).toBeGreaterThan(-1);
    expect(save).toBeGreaterThan(redirect);
  });

  it('the sidebar shows AI credits, not the retired draft count', () => {
    const side = fs.readFileSync(path.resolve(__dirname, '../../components/shell/Sidebar.tsx'), 'utf8');
    expect(side).toContain('useCredits()');
    expect(side).not.toContain('AI documents');
  });
});
