import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// build-docs/features/cocounsel-guest-scope.md AC4, AC5 (web).
const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('co-counsel guest scope (web)', () => {
  it('AC4: a guest without a plan can open a shared matter, and nothing else, before the onboarding redirect', () => {
    const app = src('App.tsx');
    const gate = app.indexOf(String.raw`if (onboarding && /^\/app\/co-counsel\/[^/]+$/.test(location.pathname))`);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(app.indexOf('if (onboarding) return <Navigate'));
    const block = app.slice(gate, app.indexOf('if (onboarding) return <Navigate'));
    expect(block.match(/<Route /g)?.length).toBe(1);
    expect(block).toContain('<Route path="/app/co-counsel/:caseId" element={<GuestCaseDetailView />} />');
    expect(block).toContain("navigate('/onboarding')");
  });

  it('AC5: the plan page lists the matters shared with them', () => {
    const onb = src('views/OnboardingView.tsx');
    expect(onb).toContain('useGuestCases()');
    expect(onb).toContain('to={`/app/co-counsel/${c.caseId}`}');
    expect(onb).toContain('<SharedWithYou />');
  });
});
