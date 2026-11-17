/**
 * Owner 2026-11-17: the plan is chosen once. Picked on the sign-in tab or via
 * "Start with …" on pricing → onboarding confirms it ("Your plan" + Change plan);
 * nothing picked → the three-plan grid.
 */
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingView } from '../OnboardingView';

const store = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => { store.clear(); vi.unstubAllGlobals(); });

function render(el: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/onboarding']}>{el}</MemoryRouter></QueryClientProvider>);
}

describe('onboarding: the plan is chosen once', () => {
  it('Firm already picked: "Your plan" shows Firm only, with Change plan; no second choice of three', () => {
    store.set('difai-intro', JSON.stringify({ kind: 'advocate', size: 'firm' }));
    const html = render(<OnboardingView />);
    expect(html).toContain('>Your plan<');
    expect(html).toContain('Change plan');
    expect(html).toContain('Up to 8 advocates');
    expect(html).not.toContain('Up to 3 advocates');
    expect(html).toContain('Firm: ₹3,699 + GST a month'); // left rail follows the plan
  });

  it('nothing picked yet: "Choose your plan" with all three plans', () => {
    const html = render(<OnboardingView />);
    expect(html).toContain('>Choose your plan<');
    expect(html).toContain('Up to 8 advocates');
    expect(html).toContain('Up to 3 advocates');
    expect(html).not.toContain('Change plan');
  });

  it('no page-wise credit wording on the plan step', () => {
    store.set('difai-intro', JSON.stringify({ size: 'solo' }));
    expect(render(<OnboardingView />)).not.toMatch(/400-word page/);
  });
});
