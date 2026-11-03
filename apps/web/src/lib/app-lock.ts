/**
 * App lock for the Android build: fingerprint / face / device PIN on cold
 * start and when the app comes back after RELOCK_AFTER_MS in the background.
 * Only applies when someone is signed in; a no-op in the browser.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { create } from 'zustand';
import { useAuthStore } from '@/store/auth';

export const RELOCK_AFTER_MS = 60_000;
const PREF_KEY = 'difai-app-lock';

interface LockState {
  locked: boolean;
  /** The device has no screen lock, so there is nothing to unlock with. */
  insecureDevice: boolean;
  busy: boolean;
}

export const useLockStore = create<LockState>(() => ({
  locked: false,
  insecureDevice: false,
  busy: false,
}));

export function lockEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function canLock(): boolean {
  return Capacitor.isNativePlatform() && lockEnabled() && !!useAuthStore.getState().token;
}

/** Pure so it can be tested: lock again if the app was away long enough. */
export function shouldRelock(backgroundedAt: number | null, now: number): boolean {
  return backgroundedAt != null && now - backgroundedAt >= RELOCK_AFTER_MS;
}

/** Ask for fingerprint / face / PIN. Resolves true when the user passed. */
async function verify(reason: string): Promise<boolean> {
  const check = await BiometricAuth.checkBiometry();
  if (!check.deviceIsSecure) {
    // No screen lock on the phone: nothing to verify against. Let them in
    // and say why (shown on the lock screen and in Settings).
    useLockStore.setState({ insecureDevice: true });
    return true;
  }
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true,
      androidTitle: 'Unlock DifAi',
      androidSubtitle: reason,
    });
    return true;
  } catch {
    // Cancelled, lockout or failure: stay locked; the user can retry.
    return false;
  }
}

export async function unlock(): Promise<void> {
  const s = useLockStore.getState();
  if (!s.locked || s.busy) return;
  useLockStore.setState({ busy: true });
  try {
    if (await verify('Confirm it’s you to open your matters')) {
      useLockStore.setState({ locked: false });
    }
  } finally {
    useLockStore.setState({ busy: false });
  }
}

/** Settings toggle. Turning the lock off needs a successful unlock first. */
export async function setLockEnabled(on: boolean): Promise<boolean> {
  if (!on) {
    useLockStore.setState({ busy: true });
    try {
      if (!(await verify('Confirm it’s you to turn off the app lock'))) return false;
    } finally {
      useLockStore.setState({ busy: false });
    }
  }
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    return false;
  }
  return true;
}

export function initLock(): void {
  if (!Capacitor.isNativePlatform()) return;
  useLockStore.setState({ locked: canLock() });

  let backgroundedAt: number | null = null;
  void App.addListener('appStateChange', ({ isActive }) => {
    // The PIN screen is its own activity, so asking for it backgrounds us;
    // don't count that as leaving the app.
    if (useLockStore.getState().busy) return;
    if (!isActive) {
      backgroundedAt = Date.now();
      return;
    }
    if (shouldRelock(backgroundedAt, Date.now()) && canLock()) {
      useLockStore.setState({ locked: true });
    }
    backgroundedAt = null;
  });

  // Signing out drops the lock; signing in (fresh credentials) doesn't need it.
  useAuthStore.subscribe((s, prev) => {
    if (!s.token && prev.token) useLockStore.setState({ locked: false });
  });
}
