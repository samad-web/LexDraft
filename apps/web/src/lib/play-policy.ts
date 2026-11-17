import { isNativeApp } from './google';

/**
 * Google Play Payments policy (build-docs/features/play-sign-in-only.md).
 * The Android app is sign-in only: no sign-up, no prices, no buy / pay /
 * upgrade / renew buttons, and no text pointing to paying elsewhere. Every
 * native-only line the app shows in place of a purchase prompt lives here.
 */
export const NATIVE_COPY = {
  welcome: 'Sign in with your DifAi account.',
  noGoogleAccount: 'No DifAi account is linked to this Google account.',
  noEmailAccount: 'No DifAi account uses this email.',
  setupIncomplete: 'Your account setup isn’t complete.',
  planInactive: 'Your plan isn’t active.',
  seatsFull: 'All seats on your plan are in use.',
  storageFull: 'Your storage is full. Delete some files to keep uploading.',
  creditsShort: 'Not enough credits left to unlock this draft.',
  noCredits: 'No AI credits yet.',
  featureLocked: (feature: string) => `${feature} isn’t included in your plan.`,
} as const;

/** Server error codes whose message names a purchase ("renew", "upgrade",
 *  "create your free account"); the app shows the neutral line instead. */
const BY_CODE: Record<string, string> = {
  account_not_found: NATIVE_COPY.noEmailAccount,
  plan_cancelled: NATIVE_COPY.planInactive,
  plan_past_due: NATIVE_COPY.planInactive,
  plan_expired: NATIVE_COPY.planInactive,
  plan_inactive: NATIVE_COPY.planInactive,
  trial_expired: NATIVE_COPY.planInactive,
  onboarding_required: NATIVE_COPY.setupIncomplete,
  seat_cap_exceeded: NATIVE_COPY.seatsFull,
  storage_full: NATIVE_COPY.storageFull,
};

/** The neutral message for this error code in the Android app; null on the website. */
export function nativeErrorCopy(code: string | null | undefined): string | null {
  return code && isNativeApp() ? BY_CODE[code] ?? null : null;
}

/** The Play Store listing. Linked only on the website (never in the app). */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=in.sirahdigital.difai';
