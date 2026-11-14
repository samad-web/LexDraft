import { describe, expect, it, vi } from 'vitest';
import type { User } from '@lexdraft/types';

// The app (native) plays the launch splash for 4 s after every sign-in.
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});
vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 0; });

const { useAuthStore } = await import('@/store/auth');
const { useSplashStore } = await import('../Splash');

const user = { id: 'u1', name: 'Priya', email: 'p@x.in', role: 'Solo Advocate' } as User;
const reset = () => useSplashStore.setState({ showing: false, leaving: false, durationMs: 0 });

describe('splash after sign-in (app)', () => {
  it('signing in plays the splash for 4 seconds', () => {
    useAuthStore.setState({ user: null, token: null });
    reset();
    useAuthStore.getState().setSession(user, 'token-1');
    expect(useSplashStore.getState()).toMatchObject({ showing: true, leaving: false, durationMs: 4000 });
  });
  it('a token refresh while already signed in does not replay it', () => {
    reset();
    useAuthStore.getState().setSession(user, 'token-2');
    expect(useSplashStore.getState().showing).toBe(false);
  });
  it('with new Terms to accept: not over the Terms screen, but on "I agree"', () => {
    useAuthStore.setState({ user: null, token: null });
    reset();
    useAuthStore.getState().setSession({ ...user, needsTermsAcceptance: true }, 'token-3');
    expect(useSplashStore.getState().showing).toBe(false);
    useAuthStore.getState().refreshUser({ ...user, needsTermsAcceptance: false });
    expect(useSplashStore.getState()).toMatchObject({ showing: true, durationMs: 4000 });
  });
  it('signing out does not play it', () => {
    reset();
    useAuthStore.setState({ user: null, token: null });
    expect(useSplashStore.getState().showing).toBe(false);
  });
});
