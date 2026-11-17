import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type { BillingStateResponse, DraftLock, User } from '@lexdraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// build-docs/features/play-sign-in-only.md: the Android app is sign-in only.
// Each test runs once as the Android app (native) and once as the website.
const env = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', async (orig) => {
  const real = await orig<typeof import('@capacitor/core')>();
  return { ...real, Capacitor: { ...real.Capacitor, isNativePlatform: () => env.native } };
});

import { NATIVE_COPY, nativeErrorCopy } from '../play-policy';
import { apiClient } from '../api';
import { useAuthStore } from '@/store/auth';
import { AppWelcomeView, NativeSetupIncompleteView } from '@/views/AppWelcomeView';
import { AuthView } from '@/views/AuthView';
import { daysLeftNote, statusLine } from '@/views/BillingView';
import { describeCap } from '@/components/CapExceededModal';
import { LockedDraftCard } from '@/components/LockedDraftCard';
import { FreePlanLocked } from '@/components/FreePlanLocked';
import { TrialBanner } from '@/components/TrialBanner';
import { CreditMeter } from '@/components/DraftMeter';

const src = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

function render(el: ReactNode, url = '/', data: [unknown[], unknown][] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  for (const [key, value] of data) qc.setQueryData(key, value);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}>{el}</MemoryRouter></QueryClientProvider>,
  );
}

/** Words that sell, price or point to paying elsewhere. */
const PURCHASE = /₹|\bupgrade|\bbuy\b|\bpay\b|pay now|pay and continue|\brenew\b|see plans|pick a plan|create (your|account)|sign up|website|\+ GST|brief pack/i;

const current = (over: Partial<BillingStateResponse['current']> = {}): BillingStateResponse['current'] => ({
  planTier: 'Solo', planStatus: 'active', freePlan: false, trialEndsAt: null, renewsAt: null,
  billingCycle: 'monthly', selectedPlan: 'advocate', subscribed: true, seats: 1, munshiSeats: 0, ...over,
});

beforeEach(() => { env.native = false; });
/** Server rendering reads the store's initial state (zustand), so sign in there. */
const signIn = (user: Partial<User> | null) => { (useAuthStore.getInitialState() as { user: User | null }).user = user as User | null; };
afterEach(() => signIn(null));

describe('gap 1: welcome screen (native only)', () => {
  it('AC1: sign in only, neutral line, no sign-up, no price', () => {
    env.native = true;
    const html = render(<AppWelcomeView />);
    expect(html).toContain('>Sign in<');
    expect(html).toContain(NATIVE_COPY.welcome);
    expect(html).not.toMatch(PURCHASE);
    expect(html).not.toMatch(/free account|plans from/i);
  });
});

describe('gap 2: sign-up and onboarding', () => {
  it('AC2: /signup is a route to the welcome in the app, the sign-up page on the website', () => {
    const app = src('App.tsx');
    expect(app).toContain('<Route path="/signup" element={Capacitor.isNativePlatform() ? <Navigate to="/" replace /> : <SignupView />} />');
  });

  it('AC3: onboarding renders the neutral notice in the app, OnboardingView on the website', () => {
    expect(src('App.tsx')).toContain('{Capacitor.isNativePlatform() ? <NativeSetupIncompleteView /> : <OnboardingView />}');
    env.native = true;
    const html = render(<NativeSetupIncompleteView />);
    expect(html).toContain('Your account setup isn’t complete.');
    expect(html).toContain('>Sign out<');
    expect(html).not.toMatch(PURCHASE);
    expect(html).not.toMatch(/plan/i);
  });

  it('AC4: /auth?signup=1 opens Sign in in the app (no sign-up links), sign-up on the website', () => {
    env.native = true;
    const app = render(<AuthView />, '/auth?signup=1');
    expect(app).toContain('>Sign in</h1>');
    expect(app).not.toMatch(PURCHASE);
    expect(app).not.toMatch(/New to DifAi|Book a demo|Talk to us/);

    env.native = false;
    const web = render(<AuthView />, '/auth?signup=1');
    expect(web).toMatch(/Create your account</); // one sign-in card since 2026-11-17 (no plan tabs)
  });

  it('AC5: website sign-in keeps its "Create your account" link (NUSI-style card, owner 2026-11-17: one bottom line)', () => {
    const web = render(<AuthView />, '/auth');
    expect(web).toContain('Create your account');
  });

  it('AC6: a Google account with no DifAi account gets a plain notice in the app', () => {
    const auth = src('views/AuthView.tsx');
    expect(auth).toMatch(/if \(isGoogleSignupRequired\(r\)\) \{\s+\/\/[^\n]*\n\s+if \(native\) \{\s+setNoGoogleAccount\(true\);\s+return;/);
    expect(auth).toContain('{NATIVE_COPY.noGoogleAccount}');
    expect(NATIVE_COPY.noGoogleAccount).toBe('No DifAi account is linked to this Google account.');
  });

  it('AC7: an email with no account says so without a sign-up link in the app', () => {
    expect(src('views/AuthView.tsx')).toContain("!native && (signIn.error as { response?: { data?: { code?: string } } }).response?.data?.code === 'account_not_found' ? (");
    env.native = true;
    expect(nativeErrorCopy('account_not_found')).toBe('No DifAi account uses this email.');
  });

  it('AC8: invitations still work in the app (InviteAcceptView route untouched)', () => {
    expect(src('App.tsx')).toContain('<Route path="/invite/:token" element={<InviteAcceptView />} />');
  });
});

describe('gap 3: plan not active at sign-in (402 renew flow)', () => {
  it('AC9: the reason banner is neutral in the app, renew copy on the website', () => {
    env.native = true;
    const app = render(<AuthView />, '/auth?reason=plan_expired');
    expect(app).toContain('Your plan isn’t active.');
    expect(app).not.toMatch(PURCHASE);

    env.native = false;
    expect(render(<AuthView />, '/auth?reason=plan_expired')).toContain('Renew to continue using DifAi.');
  });

  it('AC10: the renew plan picker and Pay button are web only; the app shows one neutral line', () => {
    const auth = src('views/AuthView.tsx');
    expect(auth).toMatch(/\{renewToken && native && \(\s+<div role="alert" style=\{noticeStyle\}>\{NATIVE_COPY\.planInactive\}<\/div>/);
    expect(auth).toContain('{renewToken && !native && (');
    env.native = true;
    for (const code of ['plan_cancelled', 'plan_past_due', 'plan_expired', 'trial_expired']) {
      expect(nativeErrorCopy(code)).toBe('Your plan isn’t active.');
    }
  });
});

describe('gap 4: credits / seats / drafting cap modal', () => {
  const credits = { kind: 'credits' as const, cap: 1, used: 3, resetsAt: '2026-12-01T00:00:00Z' };
  it('AC11: no steering sentence in the app', () => {
    env.native = true;
    for (const cap of [credits, { kind: 'ai_quota' as const, cap: 5, used: 5, planTier: 'Solo' }, { kind: 'seat_cap' as const, cap: 1, used: 1, planTier: 'Solo' }, { kind: 'seat_cap' as const, cap: 8, used: 8, planTier: 'Firm' }]) {
      const d = describeCap(cap).description;
      expect(d, cap.kind).not.toMatch(/website|upgrade|brief pack|bigger plan|contact support/i);
    }
    expect(describeCap(credits).description).toContain('Nothing was charged.');
  });

  it('AC12: website keeps the plans / Brief Pack line', () => {
    expect(describeCap(credits).description).toContain('Buy credits to continue now.'); // owner 2026-11-17: credits-not-pages wording
    expect(describeCap({ kind: 'seat_cap', cap: 1, used: 1, planTier: 'Solo' }).description).toContain('Upgrade to invite more advocates.');
  });
});

describe('audit: other surfaces reachable in the app', () => {
  const lock: DraftLock = { draftKey: 'k', lockedCredits: 3 } as DraftLock;

  it('AC13: locked draft card has no buy button or website hint in the app', () => {
    env.native = true;
    const app = render(<LockedDraftCard lock={lock} onUnlocked={() => {}} />);
    expect(app).toContain(NATIVE_COPY.creditsShort);
    expect(app).not.toMatch(PURCHASE);
    env.native = false;
    expect(render(<LockedDraftCard lock={lock} onUnlocked={() => {}} />)).toContain('See plans and Brief Packs');
  });

  it('AC14: free-plan lock has no "paid plans" or See plans in the app', () => {
    env.native = true;
    const app = render(<FreePlanLocked feature="Research" />);
    expect(app).toContain('Research isn’t included in your plan.');
    expect(app).not.toMatch(/paid plans|see plans/i);
    env.native = false;
    const web = render(<FreePlanLocked feature="Research" />);
    expect(web).toContain('part of the paid plans');
    expect(web).toContain('See plans');
  });

  it('AC15: plan-ending banner shows the date only in the app', () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const billing = { plans: [], packs: [], paymentsEnabled: true, canManage: true, current: current({ renewsAt: soon }) };
    signIn({ id: 'u', planStatus: 'active' });
    env.native = true;
    const app = render(<TrialBanner />, '/', [[['billing'], billing]]);
    expect(app).toContain('Your plan ends on');
    expect(app).not.toMatch(PURCHASE);
    env.native = false;
    expect(render(<TrialBanner />, '/', [[['billing'], billing]])).toContain('>Renew<');
  });

  it('AC16: unpaid trial banner is neutral in the app', () => {
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const billing = { plans: [], packs: [], paymentsEnabled: true, canManage: true, current: current({ planStatus: 'trial', subscribed: false, trialEndsAt: later }) };
    signIn({ id: 'u', planStatus: 'trial', trialEndsAt: later });
    env.native = true;
    const app = render(<TrialBanner />, '/', [[['billing'], billing]]);
    expect(app).toContain(NATIVE_COPY.planInactive);
    expect(app).not.toMatch(PURCHASE);
    env.native = false;
    expect(render(<TrialBanner />, '/', [[['billing'], billing]])).toContain('Pay now');
  });

  it('AC17: Plan & Billing status line and notes carry no pay prompt in the app', () => {
    const pending = current({ planStatus: 'trial', subscribed: false, trialEndsAt: '2026-12-01T00:00:00Z' });
    const pastDue = current({ planStatus: 'past_due' });
    const cancelled = current({ planStatus: 'cancelled', renewsAt: null });
    env.native = true;
    expect(statusLine(pending)).toBe('Advocate · Your plan isn’t active.');
    expect(statusLine(pastDue)).toBe('Advocate · Your plan isn’t active.');
    expect(daysLeftNote(cancelled)).toBe('—');
    env.native = false;
    expect(statusLine(pending)).toContain('Pay below');
    expect(statusLine(pastDue)).toContain('Update your payment');
    expect(daysLeftNote(cancelled)).toBe('Pick a plan to continue');
  });

  it('AC18: Plan & Billing hides plans, Brief Packs, invoice amounts and Razorpay in the app', () => {
    const b = src('views/BillingView.tsx');
    expect(b).toContain('{!native && <BriefPacks ');
    expect(b).toContain('{data.canManage && !native && <SubscriptionInvoices />}');
    expect(b).toContain("{!native && <div className=\"cm-current-note\">UPI, cards and netbanking via Razorpay</div>}");
    expect(b).toMatch(/\{!native && \(<>\s+<div className="cm-plans-head">/);
    expect(b).toContain("(native ? 'Ends' : 'Pay by')");
  });

  it('AC19: credit meter with no credits does not mention paying in the app', () => {
    const none = { balance: 0, allowance: 0, topup: 0, usedThisCycle: 0, unlimited: false, resetsAt: null };
    env.native = true;
    const app = render(<CreditMeter />, '/', [[['credits'], none]]);
    expect(app).toContain('No AI credits yet.');
    expect(app).not.toMatch(/paid/i);
    env.native = false;
    expect(render(<CreditMeter />, '/', [[['credits'], none]])).toContain('as soon as your plan is paid');
  });

  it('AC20: Members, Munshi and Settings drop upgrade / add-seat / convert lines in the app', () => {
    expect(src('views/MembersView.tsx')).toMatch(/isNativeApp\(\)\s+\? 'Chambers roll, roles, and invitations aren’t included in your plan\.'/);
    expect(src('components/MunshiPanel.tsx')).toContain("isNativeApp() ? 'All Munshi seats are in use. Remove someone first.'");
    expect(src('views/SettingsView.tsx')).toContain("(Capacitor.isNativePlatform() ? '' : ' Convert to a real account any time: your existing work carries over.')");
  });
});

describe('server messages in the app (api.ts interceptor)', () => {
  const reject = (code: string, error: string) => {
    const err = { message: 'x', response: { status: code === 'storage_full' ? 413 : 402, data: { code, error } } } as unknown as AxiosError;
    const handler = (apiClient.interceptors.response as unknown as { handlers: { rejected: (e: unknown) => Promise<unknown> }[] }).handlers[0];
    return handler!.rejected(err).catch((e: Error) => e.message);
  };

  it('AC21: purchase wording in API errors is replaced in the app, kept on the website', async () => {
    env.native = true;
    expect(await reject('account_not_found', 'No DifAi account uses this email. Create your free account first.')).toBe('No DifAi account uses this email.');
    expect(await reject('storage_full', 'Your free storage (1 GB) is full. Delete some files or upgrade to keep uploading.')).toBe(NATIVE_COPY.storageFull);
    expect(await reject('seat_cap_exceeded', 'Seat cap reached. Upgrade your plan to invite more advocates.')).toBe(NATIVE_COPY.seatsFull);
    env.native = false;
    expect(await reject('account_not_found', 'No DifAi account uses this email. Create your free account first.')).toContain('Create your free account first.');
    expect(nativeErrorCopy('account_not_found')).toBeNull();
  });

  it('AC22: no native copy string itself steers to buying', () => {
    for (const v of Object.values(NATIVE_COPY)) {
      const line = typeof v === 'function' ? v('Research') : v;
      expect(line).not.toMatch(PURCHASE);
    }
  });
});

// Owner 2026-11-17: the plan is chosen once, on the plan page. The sign-in page
// is one card (no Advocate / Chambers / Firm tabs). Replaces the Firm-tab tests.
const code_has_google_signin = () => /<\/form>\s*\{\/\* Google sign-in back on the card[\s\S]{0,300}<GoogleButton onCredential=\{handleGoogleCredential\} text="continue_with"/.test(src('views/AuthView.tsx'));

describe('one sign-in card, plan chosen on the plan page', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => { store.clear(); vi.unstubAllGlobals(); });

  it('website /auth (NUSI-style card, owner 2026-11-17): no plan tabs, round mark, SIGN IN, email + password, one Create your account line', () => {
    env.native = false;
    const web = render(<AuthView />, '/auth');
    expect(web).not.toMatch(/auth-side-tab|Who is signing in|Create your (firm|chambers)/);
    expect(web).toContain('auth-signin-mark');
    expect(web).toContain('Welcome back to DifAi.');
    expect(web).toMatch(/type="password"/);
    expect(web).toContain('Forgot password?');
    expect(web).toContain('New to DifAi?');
    expect(web).toContain('Create your account');
    // Owner 2026-11-17 (later): Google sign-in back on the card, under SIGN IN.
    expect(code_has_google_signin()).toBe(true);
  });

  it('website sign-up screen: Google up front, plans from ₹699, the steps say the plan is chosen next', () => {
    env.native = false;
    const web = render(<AuthView />, '/auth?signup=1');
    expect(web).toContain('Create your account');
    expect(web).toContain('Plans from ₹699 + GST a month');
    expect(web).toContain('Verify your WhatsApp number with a code');
    expect(web).toContain('Choose your plan, add your practice details and agree to the Terms');
    expect(web).not.toContain('Sign up with');
    const code = src('views/AuthView.tsx');
    expect(code).toMatch(/const startTrial[\s\S]{0,900}promptGoogle\(/); // opens Google at once
    // Creating an account no longer records a plan, so a "Start with …" pick from pricing is kept.
    expect(code).not.toMatch(/saveIntro/);
  });

  it('plan-ended renew box sits outside the email form (shows for Google sign-ups too)', () => {
    const code = src('views/AuthView.tsx');
    expect(code.indexOf('Plan ended (402')).toBeLessThan(code.indexOf('<form onSubmit={handleSignIn}'));
  });

  it('app: no create or talk-to-us link', () => {
    env.native = true;
    const app = render(<AuthView />, '/auth');
    expect(app).not.toMatch(/Create your account|Talk to us/);
  });
});
