/**
 * "Sign in with Google". Both paths end in a Google ID token (`credential`)
 * that the API verifies at /auth/google:
 *   - browser: Google Identity Services button (loadGoogleIdentity)
 *   - Android app: native account picker via @capgo/capacitor-social-login,
 *     because Google blocks its web sign-in inside WebViews. The token's
 *     audience is still the Web client id, so the API needs no change.
 */
import { Capacitor } from '@capacitor/core';
import type { SocialLogin as SocialLoginPlugin } from '@capgo/capacitor-social-login';

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

export const googleSignInAvailable = (): boolean => !!GOOGLE_CLIENT_ID;

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

let nativeReady: Promise<typeof SocialLoginPlugin> | null = null;

/** Android: open the system Google account picker and return the ID token. */
export async function nativeGoogleCredential(): Promise<string> {
  if (!nativeReady) {
    nativeReady = import('@capgo/capacitor-social-login').then(async ({ SocialLogin }) => {
      await SocialLogin.initialize({ google: { webClientId: GOOGLE_CLIENT_ID } });
      return SocialLogin;
    });
    nativeReady.catch(() => { nativeReady = null; });
  }
  const SocialLogin = await nativeReady;
  // No `scopes`: the plugin already asks for openid + email + profile (all the
  // ID token needs), and passing scopes on Android makes it demand a modified
  // MainActivity ("You CANNOT use scopes without modifying the main activity").
  const res = await SocialLogin.login({ provider: 'google', options: {} });
  const result = res.result as { idToken?: string | null };
  if (!result.idToken) throw new Error('Google sign-in did not return an ID token.');
  return result.idToken;
}

interface GsiButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill';
  width?: number;
}

interface GsiApi {
  initialize(opts: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: 'popup'; login_hint?: string;
    use_fedcm_for_prompt?: boolean; cancel_on_tap_outside?: boolean }): void;
  renderButton(el: HTMLElement, opts: GsiButtonOptions): void;
  prompt(): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GsiApi } };
  }
}

let loading: Promise<GsiApi> | null = null;

export function loadGoogleIdentity(): Promise<GsiApi> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;
  loading = new Promise<GsiApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else reject(new Error('Google sign-in failed to load'));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error('Google sign-in failed to load. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Open Google's account chooser straight away (One Tap / FedCM), e.g. when
 * "Create account" is tapped, so sign-up starts in Google without a second
 * click. Browsers may hold the prompt back (cooldown after a dismiss); the
 * rendered Google button stays on screen as the fallback. Never throws.
 */
export async function promptGoogle(onCredential: (credential: string) => void): Promise<void> {
  if (!googleSignInAvailable() || isNativeApp()) return;
  try {
    const gsi = await loadGoogleIdentity();
    gsi.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => onCredential(r.credential), use_fedcm_for_prompt: true, cancel_on_tap_outside: true });
    gsi.prompt();
  } catch { /* the on-screen Google button remains */ }
}
