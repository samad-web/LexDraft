import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { TermsAgree } from '@/components/TermsConsent';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, FieldError, validators } from '@lexdraft/ui';
import {
  isGoogleSignupRequired,
  useFirmEnquiry,
  useGoogleSignIn,
  useEmailSignupComplete,
  useEmailSignupStart,
  useGoogleSignUp,
  useSendSignupOtp,
  useSignIn,
  useVerifySignupOtp,
  type EmailSignupChallenge,
  type FirmEnquirySize,
  type GoogleSignupRequired,
} from '@/hooks/useAuth';
import { useMfaVerifyChallenge } from '@/hooks/useMfa';
import { isMfaChallenge, type SignInResult } from '@/lib/auth-types';
import { googleSignInAvailable, isNativeApp } from '@/lib/google';
import { NATIVE_COPY } from '@/lib/play-policy';
import { GoogleButton } from '@/components/GoogleWhatsAppVerify';
import { ForgotPassword } from '@/components/ForgotPassword';
import { LogoMark, Wordmark } from '@/components/brand/Logo';
import { CycleToggle, gstLine, inr, MunshiPicker, PlanCards, planTotal, SIGNUP_PLANS } from '@/components/PlanCards';
import { useRenewCheckout } from '@/hooks/useBilling';
import { passwordProblem, PASSWORD_RULE } from '@/lib/password';
import { FOREIGN_NUMBER_MESSAGE, isIndianMobile, readIndianMobile, toE164India } from '@/lib/indian-phone';
import type { BillingCycle, PaidPlanId } from '@lexdraft/types';

// =============================================================================
// AuthView - Sign in / Sign up + 3-step onboarding
// Ported from _design/lexdraft/project/views/auth.jsx, mapped to v2 Monochrome
// tokens. Google is the only way in. Sign in: Google (existing accounts are
// matched on email). Create account: Google, then a WhatsApp-verified
// number, then the practice profile (useGoogleSignUp).
// =============================================================================

type AuthTab = 'signin' | 'signup';
type Role = 'solo' | 'student' | 'group' | 'firm';


/** Sign-in refused because the trial / plan ended: the owner gets a token to
 *  pay from here (api: completeSignIn + POST /billing/renew-checkout). */
const EMAIL_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.in': 'gmail.com',
  'gmaill.com': 'gmail.com', 'yaho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com',
};

/** Field problems on the sign-up form; the server re-checks every one
 *  (and also that the email's domain receives mail). */
function signupProblems(f: { name: string; email: string; phone: string; phoneForeign: boolean; password: string }) {
  const email = f.email.trim().toLowerCase();
  const [local, domain] = email.split('@');
  const typo = domain && EMAIL_TYPOS[domain] ? `${local}@${EMAIL_TYPOS[domain]}` : null;
  return {
    name: f.name.trim().length < 2 ? 'Enter your full name' : null,
    email: !email ? 'Enter your email' : !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) ? 'Enter a valid email address' : null,
    emailTypo: typo,
    phone: f.phoneForeign
      ? `${FOREIGN_NUMBER_MESSAGE} Enter your 10-digit WhatsApp number.`
      : !f.phone ? 'Enter your WhatsApp number' : !isIndianMobile(f.phone) ? 'Enter a 10-digit Indian mobile number that uses WhatsApp' : null,
    password: passwordProblem(f.password),
  };
}

function renewTokenFrom(err: unknown): string | null {
  const data = (err as { response?: { status?: number; data?: { details?: { renewToken?: string } } } } | null)?.response;
  return data?.status === 402 ? data.data?.details?.renewToken ?? null : null;
}


// Shown above the new-account steps (step index 0..2).

// Maps the `?reason=` value the api.ts interceptor appends on a 402 to a
// human-friendly banner copy. Anything we don't recognise falls through to
// the generic phrase, so future server-side codes degrade gracefully.
const PLAN_REASON_MESSAGES: Record<string, string> = {
  plan_cancelled: 'Your firm subscription has been cancelled. Renew to continue using DifAi.',
  plan_past_due:  'Your firm subscription is past due. Update billing to continue using DifAi.',
  plan_expired:   'Your firm subscription period has ended. Renew to continue using DifAi.',
  trial_expired:  'Your access has ended, or the payment was not finished. Pick a plan to keep your work.',
};

export function AuthView() {
  const navigate = useNavigate();
  const googleSignIn = useGoogleSignIn();
  const signIn = useSignIn();
  const signUp = useGoogleSignUp();
  const [searchParams, setSearchParams] = useSearchParams();
  // Android app: sign-in only, no sign-up, prices or payment (Play payments
  // policy, features/play-sign-in-only.md).
  const native = isNativeApp();
  // Android app: a Google account with no DifAi account gets a plain notice.
  const [noGoogleAccount, setNoGoogleAccount] = useState(false);

  // Renewal banner. Populated when the api.ts response interceptor redirects
  // to /auth?reason=plan_* after a 402. We read it once into local state so
  // dismissing the banner (or starting a new sign-in attempt) clears it
  // without re-reading the URL.
  const planReason = searchParams.get('reason');
  const planMessage = useMemo(() => {
    if (!planReason) return null;
    if (native) return NATIVE_COPY.planInactive;
    return PLAN_REASON_MESSAGES[planReason] ?? 'Your firm subscription is no longer active. Renew to continue.';
  }, [planReason, native]);
  const dismissPlanBanner = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('reason');
    setSearchParams(next, { replace: true });
  };

  // /auth?signup=1 (landing page CTA) opens the sign-up form directly.
  const [tab, setTab] = useState<AuthTab>(() => (!native && searchParams.get('signup') ? 'signup' : 'signin'));
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [role, setRole] = useState<Role | null>(null);
  // Step 1 of sign-up: the plan, and (Free) whether advocate or student.
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const renewCheckout = useRenewCheckout();
  const [renewPlan, setRenewPlan] = useState<PaidPlanId>('advocate');
  const [renewMunshi, setRenewMunshi] = useState(0);
  const renewChosen = SIGNUP_PLANS.find((p) => p.id === renewPlan)!;
  const renewToken = renewTokenFrom(signIn.error) ?? renewTokenFrom(googleSignIn.error);
  /** Terms + Privacy box on the Google sign-up form. Unticked by default. */
  const [agreedTerms, setAgreedTerms] = useState(false);

  // MFA challenge sub-step. Populated when the sign-in POST returns
  // { mfaRequired: true, challengeId, expiresAt } instead of a session.
  // Cleared back to null when the user goes back, completes verification,
  // or the challenge expires.
  const [mfaChallenge, setMfaChallenge] = useState<{
    challengeId: string;
    expiresAt: string;
  } | null>(null);

  // Sign-up state. `googleSignup` is set when Google returned "no account
  // yet" (from either tab); `verified` once the WhatsApp code is proved.
  const [googleSignup, setGoogleSignup] = useState<GoogleSignupRequired | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [firm, setFirm] = useState('');
  const [primaryCourt, setPrimaryCourt] = useState('');
  const [practiceAreas, setPracticeAreas] = useState('');

  const [signupEmailTouched, setSignupEmailTouched] = useState(false);
  const signupEmailError = signupEmailTouched ? validators.email(email) : null;

  // Firm-enquiry state (separate flow from self-serve sign-up). Reuses
  // `name` + `email` from sign-up so the prospect doesn't retype if they
  // hop between role options.
  const firmEnquiry = useFirmEnquiry();
  // Optional enquiry phone: 10 national digits behind a fixed +91.
  const [phone, setPhone] = useState('');
  const [phoneForeign, setPhoneForeign] = useState(false);
  const enquiryPhoneProblem = phoneForeign
    ? FOREIGN_NUMBER_MESSAGE
    : phone && !isIndianMobile(phone) ? 'Enter a 10-digit Indian mobile number, or leave it blank' : null;
  const [firmSize, setFirmSize] = useState<FirmEnquirySize | ''>('');
  const [enquiryMessage, setEnquiryMessage] = useState('');
  const [firmEnquirySent, setFirmEnquirySent] = useState(false);

  // Email + password sign-in; Google is offered underneath.
  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [forgot, setForgot] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Password chosen while setting up a new account (step 3).
  const [newPassword, setNewPassword] = useState('');
  // Sign-up form (restored 2026-11-17): name, email, WhatsApp, password -> WhatsApp code.
  const signupStart = useEmailSignupStart();
  const signupComplete = useEmailSignupComplete();
  // Google sign-up uses the same form: name + email come from Google.
  const googleOtpSend = useSendSignupOtp();
  const googleOtpVerify = useVerifySignupOtp();
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPhone, setSuPhone] = useState(''); // 10 national digits; +91 shown
  const [suPhoneForeign, setSuPhoneForeign] = useState(false);
  const [suCode, setSuCode] = useState('');
  const [suChallenge, setSuChallenge] = useState<EmailSignupChallenge | null>(null);
  const [suTouched, setSuTouched] = useState<Record<string, boolean>>({});
  const suProblems = signupProblems({ name: suName, email: suEmail, phone: suPhone, phoneForeign: suPhoneForeign, password: newPassword });
  const suShow = (f: 'name' | 'email' | 'phone' | 'password') => (suTouched[f] ? suProblems[f] : null);
  const touch = (f: string) => setSuTouched((t) => ({ ...t, [f]: true }));
  // The plan is chosen once, on the plan page after sign-up (owner 2026-11-17).
  // A preset role (the Firm tab's trial link) skips the role picker.
  const startTrial = (preset: Role | null = null) => {
    if (native) return;
    setMfaChallenge(null); setGoogleSignup(null); 
    setRole(preset); setStep(0); setTab('signup');
  };
  const bookDemo = () => { if (native) return; setMfaChallenge(null); setTab('signup'); setRole('firm'); setStep(1); };
  // Superadmins land on the platform admin tree; everyone else on the app
  // dashboard - or back on the invite they came from (?next=/invite/<token>,
  // team-join.md). Only invite paths are honoured, so it's no open redirect.
  const nextInvite = /^\/invite\/[A-Za-z0-9_-]{20,128}$/.test(searchParams.get('next') ?? '') ? searchParams.get('next')! : null;
  const onComplete = (resp?: { user?: { isSuperadmin?: boolean } }) =>
    navigate(resp?.user?.isSuperadmin ? '/admin' : nextInvite ?? '/app/dashboard');

  // ---- Submitters ---------------------------------------------------------

  // Shared by the Sign-in Google button and the sign-up Google step (when
  // the Google account already has a DifAi account).
  const handleSignedIn = (resp: SignInResult) => {
    if (isMfaChallenge(resp)) {
      setTab('signin');
      setMfaChallenge({ challengeId: resp.challengeId, expiresAt: resp.expiresAt });
      return;
    }
    onComplete(resp);
  };

  // startTrial (declared above) calls the latest handler through this ref.
  const handleGoogleCredential = (credential: string) => {
    const fromSignup = tab === 'signup';
    setNoGoogleAccount(false);
    googleSignIn.mutate(
      { credential, intent: fromSignup ? 'signup' : 'signin' },
      {
        // Sign-up page + an email that already has an account: the API refuses
        // (409 account_exists). Move to Sign in, where the error message
        // ("An account with this email already exists. Sign in instead.") shows.
        onError: (err) => {
          const code = (err as { response?: { data?: { code?: string } } }).response?.data?.code;
          if (fromSignup && code === 'account_exists') {
            setTab('signin');
            setStep(0);
            setRole(null);
          }
        },
        onSuccess: (r) => {
          if (isGoogleSignupRequired(r)) {
            // The app never creates accounts: say so, with no way onward.
            if (native) {
              setNoGoogleAccount(true);
              return;
            }
            // New Google account: same form, name + email filled from Google.
            setGoogleSignup(r);
            setSuName(r.profile.name);
            setSuEmail(r.profile.email);
            setSuChallenge(null);
            setSuTouched({});
            setTab('signup');
            setStep(0);
            setRole(null);
            return;
          }
          handleSignedIn(r);
        },
      },
    );
  };

  // Called by the MFA sub-step after a successful challenge exchange. The
  // useMfaVerifyChallenge hook has already set the session; we just need to
  // navigate to the right landing page.
  const handleMfaSuccess = (user: { isSuperadmin?: boolean }) => {
    setMfaChallenge(null);
    onComplete({ user });
  };

  const handleSignIn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!signinEmail.trim() || !signinPassword) return;
    signIn.mutate(
      { email: signinEmail.trim(), password: signinPassword },
      { onSuccess: handleSignedIn },
    );
  };


  const handleSignupStart = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuTouched({ name: true, email: true, phone: true, password: true });
    if (suProblems.name || suProblems.email || (!googleSignup && suProblems.emailTypo) || suProblems.phone || suProblems.password || !agreedTerms) return;
    if (googleSignup) {
      const { signupToken } = googleSignup;
      googleOtpSend.mutate(
        { signupToken, phone: toE164India(suPhone) },
        { onSuccess: (r) => { setSuChallenge({ signupToken, ...r }); setSuCode(''); } },
      );
      return;
    }
    signupStart.mutate(
      { name: suName.trim(), email: suEmail.trim(), phone: toE164India(suPhone) },
      { onSuccess: (c) => { setSuChallenge(c); setSuCode(''); } },
    );
  };

  const handleSignupComplete = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!suChallenge) return;
    if (googleSignup) {
      googleOtpVerify.mutate(
        { signupToken: suChallenge.signupToken, challengeId: suChallenge.challengeId, code: suCode },
        {
          onSuccess: (v) => signUp.mutate(
            { signupToken: v.signupToken, password: newPassword, name: suName.trim(), role: 'solo', acceptTerms: true },
            { onSuccess: () => navigate('/onboarding', { replace: true }) },
          ),
        },
      );
      return;
    }
    signupComplete.mutate(
      { signupToken: suChallenge.signupToken, challengeId: suChallenge.challengeId, code: suCode, password: newPassword, acceptTerms: true },
      { onSuccess: () => navigate('/onboarding', { replace: true }) },
    );
  };

  const handleFirmEnquiry = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firmSize || enquiryPhoneProblem) return;
    firmEnquiry.mutate(
      {
        name: name.trim(),
        email: email.trim(),
        phone: phone ? toE164India(phone) : undefined,
        firmName: firm.trim(),
        firmSize,
        primaryCourt: primaryCourt.trim() || undefined,
        practiceAreas: practiceAreas.trim() || undefined,
        message: enquiryMessage.trim() || undefined,
      },
      { onSuccess: () => setFirmEnquirySent(true) },
    );
  };

  // ---- Styles -------------------------------------------------------------

  const pageStyle: CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    // padding + gap live in .auth-page (globals.css) so short screens can tighten them.
    // Very subtle vertical wash to give the surface depth without competing
    // with the card. Bg-base at the edges, bg-surface near center.
    background:
      'radial-gradient(ellipse 80% 60% at 50% 50%, var(--bg-surface) 0%, var(--bg-base) 70%)',
    fontFamily: 'var(--font-sans)',
  };

  const backToStart = () => {
    setTab('signin');
    setStep(0);
    setRole(null);
    setGoogleSignup(null);
  };
  /** Leave the Google sign-up: back to the blank form. */
  const dropGoogleSignup = () => {
    setGoogleSignup(null);
    setSuName('');
    setSuEmail('');
    setSuChallenge(null);
    googleOtpSend.reset();
    googleOtpVerify.reset();
    signUp.reset();
  };
  const suSending = signupStart.isPending || googleOtpSend.isPending;
  const suStartError = signupStart.error ?? googleOtpSend.error;
  const suCreating = signupComplete.isPending || googleOtpVerify.isPending || signUp.isPending;
  const suCompleteError = signupComplete.error ?? googleOtpVerify.error ?? signUp.error;

  const noticeStyle: CSSProperties = {
    fontSize: 13,
    color: 'var(--text-primary)',
    background: 'var(--bg-surface-2)',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 12px',
  };

  // ---- Render -------------------------------------------------------------

  return (
    <div className="auth-page" style={pageStyle}>
      <div className="auth-shell">
        {/* Brand panel (owner 2026-11-17): the Play Store feature graphic,
            built in HTML so it stays sharp: wordmark, line, sub-line, bars. */}
        <aside className="auth-art auth-brand-panel">
          <div className="auth-brand-block">
            <div className="auth-brand-row">
              <Wordmark height={72} />
            </div>
            <h2 className="auth-brand-headline">Drafting that defies the clock.</h2>
            <p className="auth-brand-sub">AI drafting, case diary and eCourts for Indian advocates</p>
          </div>
        </aside>
        <div className="auth-main">
        <div className="auth-main-inner">
        {/* Brand (the sign-in card has its own round mark) */}
        {tab === 'signup' && step !== 0 && <div className="auth-head">
          <span className="auth-logo"><Wordmark height={40} /></span>
          <div
            className="mono auth-brand-text"
            style={{
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-tertiary)',
              marginTop: -6,
            }}
          >
            For Indian advocates
          </div>
        </div>}

        {/* MFA challenge - interleaved between password POST and session creation. */}
        {tab === 'signin' && mfaChallenge && (
          <MfaChallengeStep
            challengeId={mfaChallenge.challengeId}
            expiresAt={mfaChallenge.expiresAt}
            onSuccess={handleMfaSuccess}
            onCancel={() => setMfaChallenge(null)}
          />
        )}

        {/* SIGN IN */}
        {tab === 'signin' && !mfaChallenge && forgot && (
          <ForgotPassword
            email={signinEmail}
            onBack={(e) => { setForgot(false); if (e) setSigninEmail(e); setSigninPassword(''); signIn.reset(); }}
          />
        )}
        {tab === 'signin' && !mfaChallenge && !forgot && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {planMessage && (
              <div
                role="status"
                style={{
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <span style={{ flex: 1 }}>{planMessage}</span>
                <button
                  type="button"
                  onClick={dismissPlanBanner}
                  aria-label="Dismiss"
                  style={{
                    border: 0,
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {/* NUSI-style card (owner 2026-11-17), DifAi black and white. */}
            <div className="auth-signin-head">
              <span className="auth-signin-mark"><LogoMark size={44} title="" /></span>
              <h1 className="auth-title">Sign in</h1>
              <p className="auth-signin-sub">Welcome back to DifAi.</p>
            </div>
            {/* Plan ended (402 with a renew token), from Google or email sign-in. */}
            {renewToken && native && (
              <div role="alert" style={noticeStyle}>{NATIVE_COPY.planInactive}</div>
            )}
            {renewToken && !native && (
              <div style={{ ...noticeStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <strong style={{ fontSize: 14 }}>Pick a plan to continue</strong>
                <span>{signIn.error?.message ?? googleSignIn.error?.message} Your cases and documents are safe.</span>
                <CycleToggle cycle={cycle} onChange={setCycle} />
                <PlanCards
                  plans={SIGNUP_PLANS.filter((p) => p.purchasable)}
                  cycle={cycle}
                  selected={renewPlan}
                  onSelect={(id) => setRenewPlan(id as PaidPlanId)}
                  compact
                />
                <MunshiPicker plan={renewChosen} cycle={cycle} munshi={renewMunshi} min={0} onChange={setRenewMunshi} />
                <span style={{ fontSize: 13 }}>{gstLine(planTotal(renewChosen, cycle, renewMunshi))}</span>
                {renewCheckout.isError && <div role="alert">{renewCheckout.error.message}</div>}
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  disabled={renewCheckout.isPending}
                  onClick={() => renewCheckout.mutate(
                    { renewToken, plan: renewPlan, cycle, munshi: renewMunshi },
                  )}
                >
                  {renewCheckout.isPending ? 'Opening payment…' : 'Pay and continue'}
                </button>
              </div>
            )}
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label className="auth-field">
                <Icon name="clients" size={16} />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder="Email"
                  aria-label="Email"
                  required
                  value={signinEmail}
                  onChange={(e) => setSigninEmail(e.target.value)}
                />
              </label>
              <label className="auth-field">
                <Icon name="key" size={16} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Password"
                  aria-label="Password"
                  required
                  value={signinPassword}
                  onChange={(e) => setSigninPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
                </button>
              </label>
              {signIn.isError && !renewToken && (
                !native && (signIn.error as { response?: { data?: { code?: string } } }).response?.data?.code === 'account_not_found' ? (
                  <div role="alert" style={noticeStyle}>
                    No DifAi account uses this email.{' '}
                    <button type="button" className="auth-link" onClick={() => startTrial()}>
                      Create your account
                    </button>
                  </div>
                ) : (
                  <div role="alert" style={noticeStyle}>{signIn.error.message}</div>
                )
              )}
              <div className="auth-actions">
                <button type="button" className="auth-forgot" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => setForgot(true)}>Forgot password?</button>
                <button
                  type="submit"
                  className="btn btn-primary btn-lg btn-pill auth-submit"
                  disabled={signIn.isPending || !signinEmail.trim() || !signinPassword}
                >
                  {signIn.isPending ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </form>
            {/* Google sign-in back on the card (owner 2026-11-17), under SIGN IN. */}
            <div className="auth-or" aria-hidden><span>or</span></div>
            {googleSignInAvailable() ? (
              <div className="auth-google"><GoogleButton onCredential={handleGoogleCredential} text="continue_with" shape="pill" theme="filled_black" logoAlignment="center" /></div>
            ) : (
              <span className="auth-foot-g"><GoogleG /> Google (not configured)</span>
            )}
            {googleSignIn.isPending && (
              <p className="body-sm muted">Checking your Google account…</p>
            )}
            {googleSignIn.isError && !renewToken && (
              <div role="alert" style={noticeStyle}>{googleSignIn.error.message}</div>
            )}
            {noGoogleAccount && (
              <div role="alert" style={noticeStyle}>{NATIVE_COPY.noGoogleAccount}</div>
            )}
            {!native && (<>
            <p className="auth-signin-foot">
              New to DifAi?{' '}<button type="button" className="auth-link" onClick={() => startTrial()}>Create your account</button>
            </p>
            </>)}
          </div>
        )}

        {/* SIGN UP - Google only for new accounts (signup-hardening.md): the
            Google button below starts it, then the WhatsApp code, password
            and Terms in the block after this one, then /onboarding. */}
        {/* SIGN UP - form (restored 2026-11-17, owner: NUSI-style): name, email,
            WhatsApp, password -> START sends a WhatsApp code -> the code creates
            the account -> /onboarding. Google is in the strip at the bottom. */}
        {tab === 'signup' && step === 0 && (
          <div className="auth-compact" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="auth-signin-head">
              <span className="auth-signin-mark"><LogoMark size={44} title="" /></span>
              <h1 className="auth-title auth-title--long">Create your account</h1>
              {googleSignup && !suChallenge && (
                <p className="auth-signin-sub">
                  Name and email are from Google. Add your WhatsApp number and a password.{' '}
                  <button type="button" className="auth-link" onClick={dropGoogleSignup}>Use a different account</button>
                </p>
              )}
              {suChallenge && (
                <p className="auth-signin-sub">
                  Enter the 6-digit code we sent on WhatsApp to <strong className="mono" style={{ color: 'var(--text-primary)' }}>{suChallenge.phone}</strong>.
                </p>
              )}
            </div>
            {!suChallenge ? (
              <form onSubmit={handleSignupStart} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label className="auth-field">
                  <Icon name="clients" size={16} />
                  <input autoComplete="name" placeholder="Your name" aria-label="Your name" required value={suName} onChange={(e) => setSuName(e.target.value)} onBlur={() => touch('name')} aria-invalid={!!suShow('name')} />
                </label>
                {suShow('name') && <span role="alert" className="auth-field-error">{suShow('name')}</span>}
                <label className="auth-field">
                  <Icon name="mail" size={16} />
                  <input type="email" inputMode="email" autoComplete="email" placeholder="Work email" aria-label="Email" required readOnly={!!googleSignup} aria-readonly={!!googleSignup} title={googleSignup ? 'From your Google account' : undefined} value={suEmail} onChange={(e) => setSuEmail(e.target.value)} onBlur={() => touch('email')} aria-invalid={!!suShow('email')} />
                </label>
                {suShow('email') && <span role="alert" className="auth-field-error">{suShow('email')}</span>}
                {!googleSignup && !suProblems.email && suProblems.emailTypo && (
                  <span role="alert" className="auth-field-error">
                    Did you mean <strong>{suProblems.emailTypo}</strong>?{' '}
                    <button type="button" className="auth-link" onClick={() => setSuEmail(suProblems.emailTypo!)}>Use it</button>
                  </span>
                )}
                <label className="auth-field">
                  <Icon name="chat" size={16} />
                  <span className="mono" aria-hidden="true" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>+91</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="WhatsApp number (10 digits)"
                    aria-label="WhatsApp number (India, +91)"
                    required
                    value={suPhone}
                    onChange={(e) => {
                      const r = readIndianMobile(e.target.value);
                      setSuPhone(r.digits);
                      setSuPhoneForeign(r.foreign);
                      if (r.foreign) touch('phone');
                    }}
                    onBlur={() => touch('phone')}
                    aria-invalid={!!suShow('phone')}
                  />
                </label>
                {suShow('phone') && <span role="alert" className="auth-field-error">{suShow('phone')}</span>}
                <label className="auth-field">
                  <Icon name="key" size={16} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Password"
                    aria-label="Password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    onBlur={() => touch('password')}
                    aria-invalid={!!suShow('password')}
                  />
                  <button type="button" className="auth-eye" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </label>
                {suShow('password') && <span role="alert" className="auth-field-error">{suShow('password')}</span>}
                {suStartError && <div role="alert" style={noticeStyle}>{suStartError.message}</div>}
                <TermsAgree checked={agreedTerms} onChange={setAgreedTerms} />
                <div className="auth-actions" style={{ justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg btn-pill auth-submit"
                    disabled={suSending || !agreedTerms}
                  >
                    {suSending ? 'Sending…' : 'Start'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleSignupComplete} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <label className="auth-field">
                  <Icon name="shield" size={16} />
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    aria-label="Verification code"
                    autoFocus
                    value={suCode}
                    onChange={(e) => setSuCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    style={{ letterSpacing: '0.3em' }}
                  />
                </label>
                {suCompleteError && <div role="alert" style={noticeStyle}>{suCompleteError.message}</div>}
                <div className="auth-actions">
                  <button type="button" className="auth-forgot" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => { setSuChallenge(null); setSuCode(''); signupComplete.reset(); googleOtpVerify.reset(); signUp.reset(); }}>
                    Change details
                  </button>
                  <button type="submit" className="btn btn-primary btn-lg btn-pill auth-submit" disabled={suCreating || suCode.length !== 6}>
                    {suCreating ? 'Creating…' : 'Verify'}
                  </button>
                </div>
              </form>
            )}
            <p className="auth-signin-foot">
              Already have an account?{' '}
              <button type="button" className="auth-link" onClick={backToStart}>Sign in</button>
            </p>
          </div>
        )}

        {/* SIGN UP - FIRM ENQUIRY (post-submit success) */}
        {tab === 'signup' && step === 1 && role === 'firm' && firmEnquirySent && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
            <span
              aria-hidden
              style={{
                width: 56,
                height: 56,
                borderRadius: 'var(--radius-full)',
                background: 'var(--success-bg)',
                color: 'var(--success)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={26} />
            </span>
            <div className="display" style={{ fontSize: 22, textAlign: 'center' }}>
              Thanks, we&rsquo;re on it.
            </div>
            <p className="body-sm muted" style={{ textAlign: 'center', maxWidth: 380, lineHeight: 1.55 }}>
              A DifAi partner will reach out to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>{' '}
              within one business day to walk through the Firm plan, custom onboarding,
              and a tailored quote for your team.
            </p>
            <span
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                marginTop: 8,
              }}
            >
              Reference #{firmEnquiry.data?.id.slice(0, 8) ?? 'N/A'}
            </span>
            <button
              type="button"
              className="btn btn-block btn-lg"
              style={{ marginTop: 16 }}
              onClick={() => navigate('/')}
            >
              Back to home
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFirmEnquirySent(false)}
            >
              Made a mistake? Submit another enquiry
            </button>
          </div>
        )}

        {/* SIGN UP - FIRM ENQUIRY (form) */}
        {tab === 'signup' && step === 1 && role === 'firm' && !firmEnquirySent && (
          <form
            onSubmit={handleFirmEnquiry}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Firm accounts are partner-onboarded. Share a few details and we&rsquo;ll
              reach out to schedule a demo and discuss a tailored plan for your team.
            </p>
            <div className="facts-grid-2" style={{ gap: 14 }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label required" htmlFor="enq-name">Your name</label>
                <input
                  id="enq-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Aarav Sharma"
                  required
                  autoComplete="name"
                  autoFocus
                />
              </div>
              <div>
                <label className="label required" htmlFor="enq-email">Work email</label>
                <input
                  id="enq-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setSignupEmailTouched(true)}
                  placeholder="aarav@firm.law"
                  required
                  autoComplete="email"
                  aria-invalid={!!signupEmailError}
                  aria-describedby={signupEmailError ? 'enq-email-error' : undefined}
                />
                <FieldError id="enq-email-error" error={signupEmailError} />
              </div>
              <div>
                <label className="label" htmlFor="enq-phone">
                  Phone <span className="hint">Optional</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="mono" aria-hidden="true">+91</span>
                  <input
                    id="enq-phone"
                    className="input"
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => {
                      const r = readIndianMobile(e.target.value);
                      setPhone(r.digits);
                      setPhoneForeign(r.foreign);
                    }}
                    placeholder="98xxx xxxxx"
                    autoComplete="tel"
                    aria-invalid={!!enquiryPhoneProblem}
                  />
                </div>
                {enquiryPhoneProblem && <span role="alert" className="auth-field-error" style={{ marginTop: 6 }}>{enquiryPhoneProblem}</span>}
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label required" htmlFor="enq-firm">Firm name</label>
                <input
                  id="enq-firm"
                  className="input"
                  value={firm}
                  onChange={(e) => setFirm(e.target.value)}
                  placeholder="Sharma & Associates"
                  required
                  autoComplete="organization"
                />
              </div>
              <div>
                <label className="label required" htmlFor="enq-size">Firm size</label>
                <select
                  id="enq-size"
                  className="input"
                  value={firmSize}
                  onChange={(e) => setFirmSize(e.target.value as FirmEnquirySize | '')}
                  required
                >
                  <option value="" disabled>Select team size…</option>
                  <option value="9-25">9 – 25 lawyers</option>
                  <option value="26-50">26 – 50 lawyers</option>
                  <option value="51-100">51 – 100 lawyers</option>
                  <option value="100+">100+ lawyers</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="enq-court">
                  Primary court <span className="hint">Optional</span>
                </label>
                <input
                  id="enq-court"
                  className="input"
                  value={primaryCourt}
                  onChange={(e) => setPrimaryCourt(e.target.value)}
                  placeholder="Delhi High Court"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label" htmlFor="enq-areas">
                  Practice areas <span className="hint">Optional</span>
                </label>
                <input
                  id="enq-areas"
                  className="input"
                  value={practiceAreas}
                  onChange={(e) => setPracticeAreas(e.target.value)}
                  placeholder="Civil, Commercial, Banking"
                />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="label" htmlFor="enq-message">
                  What brings you to DifAi? <span className="hint">Optional</span>
                </label>
                <textarea
                  id="enq-message"
                  className="input"
                  rows={3}
                  value={enquiryMessage}
                  onChange={(e) => setEnquiryMessage(e.target.value)}
                  placeholder="A short note on what you&rsquo;re looking for: drafting, matter management, compliance, etc."
                />
              </div>
            </div>
            {firmEnquiry.isError && (
              <div
                role="alert"
                style={{
                  fontSize: 13,
                  color: 'var(--danger)',
                  background: 'var(--danger-bg)',
                  border: '1px solid var(--danger)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                }}
              >
                {(firmEnquiry.error as Error | null)?.message ?? "Couldn't send your enquiry. Try again in a moment."}
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-block btn-lg"
                onClick={() => setStep(0)}
                disabled={firmEnquiry.isPending}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-block btn-lg"
                disabled={firmEnquiry.isPending}
              >
                {firmEnquiry.isPending ? 'Sending…' : 'Request a call'}
              </button>
            </div>
            <span
              className="mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                textAlign: 'center',
              }}
            >
              No account is created until a partner confirms your plan.
            </span>
          </form>
        )}

        </div>
        {tab === 'signup' && step === 0 && !googleSignup && !suChallenge && (
          <div className="auth-foot">
            <span>Or sign up with</span>
            {googleSignInAvailable() ? (
              <GoogleButton onCredential={handleGoogleCredential} text="signup_with" shape="pill" width={210} />
            ) : (
              <span className="auth-foot-g"><GoogleG /> Google (not configured)</span>
            )}
          </div>
        )}
        </div>
      </div>
      <p className="body-xs muted auth-page-terms" style={{ textAlign: 'center', margin: 0 }}>
        By continuing you agree to DifAi&rsquo;s <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>terms of service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>privacy policy</a>.
      </p>

      {/* Trust strip - sits below the card, reinforces the legal-tech
          positioning without competing for attention. */}
      <div
        className="mono auth-trust"
        style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          textAlign: 'center',
          maxWidth: 480,
          lineHeight: 1.8,
        }}
      >
        DPDP Act 2023 · Indian-server data residency · SOC 2 Type II
      </div>
    </div>
  );
}

// ===========================================================================
// MfaChallengeStep - exchange a sign-in challengeId for a session.
//
// Lives in the same file as AuthView because it's only ever rendered here
// (not a generally-reusable widget - the post-password handshake is unique
// to the sign-in flow). Extracted as its own component because the timer +
// backup-code toggle state would otherwise bloat the parent further.
// ===========================================================================

interface MfaChallengeStepProps {
  challengeId: string;
  expiresAt: string;
  onSuccess: (user: { isSuperadmin?: boolean }) => void;
  onCancel: () => void;
}

function MfaChallengeStep({
  challengeId,
  expiresAt,
  onSuccess,
  onCancel,
}: MfaChallengeStepProps) {
  const verifyChallenge = useMfaVerifyChallenge();
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );

  // Countdown to expiry. Re-render once a second; once we hit zero, the
  // server will reject the challenge anyway, so we surface an inline
  // "Expired" state and force a sign-in restart.
  useEffect(() => {
    const id = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const expired = secondsLeft === 0;
  // Backup codes are typically 10 chars (hex-like), TOTPs are 6 digits.
  // Use input semantics that match: numeric for TOTP, plain text for backup.
  const inputMax = useBackup ? 16 : 6;
  const canSubmit = !expired && code.length >= (useBackup ? 9 : 6);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;
    verifyChallenge.mutate(
      { challengeId, code: code.trim() },
      {
        onSuccess: ({ user }) => onSuccess({ isSuperadmin: user.isSuperadmin }),
      },
    );
  };

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeLabel = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>TWO-FACTOR AUTHENTICATION</div>
        <h2
          className="display"
          style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}
        >
          Enter your authenticator code
        </h2>
        <p
          className="muted"
          style={{ fontSize: 13, marginTop: 6, color: 'var(--text-secondary)' }}
        >
          {useBackup
            ? 'Type one of the backup codes you saved during setup.'
            : 'Open your authenticator app and enter the 6-digit code.'}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="mfa-challenge-code">
          {useBackup ? 'Backup code' : 'Authentication code'}
        </label>
        <input
          id="mfa-challenge-code"
          className="input mono"
          inputMode={useBackup ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          maxLength={inputMax}
          placeholder={useBackup ? 'abcd-1234' : '000000'}
          value={code}
          onChange={(e) =>
            setCode(
              useBackup
                ? e.target.value.replace(/\s/g, '')
                : e.target.value.replace(/[^0-9]/g, ''),
            )
          }
          autoFocus
          disabled={expired}
          style={{
            fontSize: useBackup ? 18 : 24,
            letterSpacing: useBackup ? '0.1em' : '0.4em',
            textAlign: 'center',
          }}
        />
      </div>

      {!expired && (
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}
        >
          CHALLENGE EXPIRES IN {timeLabel}
        </div>
      )}

      {expired && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--danger)',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
          }}
        >
          This challenge has expired. Please sign in again.
        </div>
      )}

      {verifyChallenge.isError && !expired && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--danger)',
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
          }}
        >
          {(verifyChallenge.error as Error | null)?.message ?? 'Invalid code. Try again.'}
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary btn-lg btn-block"
        disabled={verifyChallenge.isPending || !canSubmit}
      >
        {expired
          ? 'Expired - sign in again'
          : verifyChallenge.isPending
            ? 'Verifying…'
            : 'Verify'}
      </button>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode('');
          }}
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {useBackup ? 'Use authenticator code instead' : 'Use a backup code instead'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Back to sign in
        </button>
      </div>
    </form>
  );
}

/** Google "G" mark for the card's bottom strip (brand colours, as Google requires). */
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
