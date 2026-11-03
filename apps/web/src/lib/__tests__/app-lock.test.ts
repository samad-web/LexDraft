import { beforeEach, describe, expect, it, vi } from 'vitest';

// Native platform, the App lifecycle listener and the biometric plugin are
// all faked; the lock logic around them is what's under test.
const h = vi.hoisted(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  return {
    store,
    stateListener: null as null | ((s: { isActive: boolean }) => void),
    deviceIsSecure: true,
    authResult: 'ok' as 'ok' | 'cancel',
    authCalls: 0,
  };
});

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_: string, cb: (s: { isActive: boolean }) => void) => {
      h.stateListener = cb;
      return Promise.resolve({ remove: () => {} });
    },
  },
}));
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: async () => ({ deviceIsSecure: h.deviceIsSecure }),
    authenticate: async () => {
      h.authCalls++;
      if (h.authResult === 'cancel') throw new Error('userCancel');
    },
  },
}));

const { initLock, unlock, setLockEnabled, lockEnabled, shouldRelock, useLockStore, RELOCK_AFTER_MS } =
  await import('../app-lock');
const { useAuthStore } = await import('@/store/auth');

function signIn() {
  useAuthStore.setState({ token: 't', user: { id: 'u' } as never });
}

beforeEach(() => {
  h.store.clear();
  h.deviceIsSecure = true;
  h.authResult = 'ok';
  h.authCalls = 0;
  useLockStore.setState({ locked: false, busy: false, insecureDevice: false });
  useAuthStore.setState({ token: null, user: null });
  vi.useRealTimers();
});

describe('mobile-biometric-lock', () => {
  it('relocks only after 60 s in the background', () => {
    expect(shouldRelock(null, 1e6)).toBe(false);
    expect(shouldRelock(0, RELOCK_AFTER_MS - 1)).toBe(false);
    expect(shouldRelock(0, RELOCK_AFTER_MS)).toBe(true);
  });

  it('cold start: locked when signed in, not when signed out', () => {
    initLock();
    expect(useLockStore.getState().locked).toBe(false);
    signIn();
    initLock();
    expect(useLockStore.getState().locked).toBe(true);
  });

  it('resume after ≥60 s locks; resume under 60 s does not', () => {
    vi.useFakeTimers();
    signIn();
    h.store.set('difai-app-lock', 'on');
    initLock();
    useLockStore.setState({ locked: false });

    h.stateListener!({ isActive: false });
    vi.advanceTimersByTime(RELOCK_AFTER_MS - 1000);
    h.stateListener!({ isActive: true });
    expect(useLockStore.getState().locked).toBe(false);

    h.stateListener!({ isActive: false });
    vi.advanceTimersByTime(RELOCK_AFTER_MS);
    h.stateListener!({ isActive: true });
    expect(useLockStore.getState().locked).toBe(true);
  });

  it('the PIN screen backgrounding the app does not count as leaving', () => {
    vi.useFakeTimers();
    signIn();
    initLock();
    useLockStore.setState({ locked: false, busy: true });
    h.stateListener!({ isActive: false });
    vi.advanceTimersByTime(RELOCK_AFTER_MS * 2);
    h.stateListener!({ isActive: true });
    expect(useLockStore.getState().locked).toBe(false);
  });

  it('unlock succeeds on a verified biometric', async () => {
    useLockStore.setState({ locked: true });
    await unlock();
    expect(useLockStore.getState()).toMatchObject({ locked: false, busy: false });
  });

  it('cancel keeps the app locked and allows a retry', async () => {
    useLockStore.setState({ locked: true });
    h.authResult = 'cancel';
    await unlock();
    expect(useLockStore.getState()).toMatchObject({ locked: true, busy: false });
    h.authResult = 'ok';
    await unlock();
    expect(useLockStore.getState().locked).toBe(false);
  });

  it('phone without a screen lock: lets the user in and flags it', async () => {
    h.deviceIsSecure = false;
    useLockStore.setState({ locked: true });
    await unlock();
    expect(useLockStore.getState()).toMatchObject({ locked: false, insecureDevice: true });
    expect(h.authCalls).toBe(0);
  });

  it('turning the lock off needs a successful unlock first', async () => {
    h.authResult = 'cancel';
    expect(await setLockEnabled(false)).toBe(false);
    expect(lockEnabled()).toBe(true);
    h.authResult = 'ok';
    expect(await setLockEnabled(false)).toBe(true);
    expect(lockEnabled()).toBe(false);
    // Turning it back on never asks.
    h.authCalls = 0;
    expect(await setLockEnabled(true)).toBe(true);
    expect(h.authCalls).toBe(0);
  });

  it('lock off: cold start and resume stay unlocked', () => {
    vi.useFakeTimers();
    h.store.set('difai-app-lock', 'off');
    signIn();
    initLock();
    expect(useLockStore.getState().locked).toBe(false);
    h.stateListener!({ isActive: false });
    vi.advanceTimersByTime(RELOCK_AFTER_MS * 2);
    h.stateListener!({ isActive: true });
    expect(useLockStore.getState().locked).toBe(false);
  });

  it('signing out drops the lock', () => {
    signIn();
    initLock();
    expect(useLockStore.getState().locked).toBe(true);
    useAuthStore.setState({ token: null, user: null });
    expect(useLockStore.getState().locked).toBe(false);
  });
});
