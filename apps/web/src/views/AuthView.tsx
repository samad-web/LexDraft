import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, FieldError, validators } from '@lexdraft/ui';
import {
  isGoogleSignupRequired,
  useFirmEnquiry,
  useGoogleSignIn,
  useGoogleSignUp,
  useEmailSignupComplete,
  useEmailSignupStart,
  useSignIn,
  type EmailSignupChallenge,
  type FirmEnquirySize,
  type GoogleSignupRequired,
} from '@/hooks/useAuth';
import { useMfaVerifyChallenge } from '@/hooks/useMfa';
import { isMfaChallenge, type SignInResult } from '@/lib/auth-types';
import { googleSignInAvailable } from '@/lib/google';
import { AuthArt } from '@/components/AuthArt';
import { GoogleButton, GoogleWhatsAppVerify } from '@/components/GoogleWhatsAppVerify';
import { LogoMark } from '@/components/brand/Logo';
import { CycleToggle, PlanCards, SIGNUP_PLANS } from '@/components/PlanCards';
import { useRenewCheckout } from '@/hooks/useBilling';
import { readIntro } from '@/lib/intro';
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


const EMAIL_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.in': 'gmail.com',
  'gmaill.com': 'gmail.com', 'yaho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com',
};

/** Field problems on the sign-up form; the server re-checks every one
 *  (and also that the email's domain receives mail). */
function signupProblems(f: { name: string; email: string; phone: string; password: string }) {
  const email = f.email.trim().toLowerCase();
  const [local, domain] = email.split('@');
  const typo = domain && EMAIL_TYPOS[domain] ? `${local}@${EMAIL_TYPOS[domain]}` : null;
  const digits = f.phone.replace(/\D/g, '').replace(/^(91|0)(?=[6-9]\d{9}$)/, '');
  return {
    name: f.name.trim().length < 2 ? 'Enter your full name' : null,
    email: !email ? 'Enter your email' : !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email) ? 'Enter a valid email address' : null,
    emailTypo: typo,
    phone: !digits ? 'Enter your WhatsApp number' : !/^[6-9]\d{9}$/.test(digits) ? 'Enter a 10-digit mobile number that uses WhatsApp' : null,
    password: f.password.length < 8 ? 'Use at least 8 characters' : null,
  };
}

/** Sign-in refused because the trial / plan ended: the owner gets a token to
 *  pay from here (api: completeSignIn + POST /billing/renew-checkout). */
function renewTokenFrom(err: unknown): string | null {
  const data = (err as { response?: { status?: number; data?: { details?: { renewToken?: string } } } } | null)?.response;
  return data?.status === 402 ? data.data?.details?.renewToken ?? null : null;
}


// Shown above the new-account steps (step index 0..2).

// Maps the `?reason=` value the api.ts interceptor appends on a 402 to a
// human-friendly banner copy. Anything we don't recognise falls through to
// the generic phrase, so future server-side codes degrade gracefully.
const PLAN_REASON_MESSAGES: Record<string, string> = {
  plan_cancelled: 'Your firm subscription has been cancelled. Renew to continue using DifAI.',
  plan_past_due:  'Your firm subscription is past due. Update billing to continue using DifAI.',
  plan_expired:   'Your firm subscription period has ended. Renew to continue using DifAI.',
  trial_expired:  'Your free access or trial has ended. Pick a plan to keep your work.',
};

export function AuthView() {
  const navigate = useNavigate();
  const googleSignIn = useGoogleSignIn();
  const signIn = useSignIn();
  const signUp = useGoogleSignUp();
  const [searchParams, setSearchParams] = useSearchParams();

  // Renewal banner. Populated when the api.ts response interceptor redirects
  // to /auth?reason=plan_* after a 402. We read it once into local state so
  // dismissing the banner (or starting a new sign-in attempt) clears it
  // without re-reading the URL.
  const planReason = searchParams.get('reason');
  const planMessage = useMemo(() => {
    if (!planReason) return null;
    return PLAN_REASON_MESSAGES[planReason] ?? 'Your firm subscription is no longer active. Renew to continue.';
  }, [planReason]);
  const dismissPlanBanner = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('reason');
    setSearchParams(next, { replace: true });
  };

  // /auth?signup=1 (landing page CTA) opens the sign-up form directly.
  const [tab, setTab] = useState<AuthTab>(() => (searchParams.get('signup') ? 'signup' : 'signin'));
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [role, setRole] = useState<Role | null>(null);
  // Step 1 of sign-up: the plan, and (Free) whether advocate or student.
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const renewCheckout = useRenewCheckout();
  const [renewPlan, setRenewPlan] = useState<PaidPlanId>('solo');
  const renewToken = renewTokenFrom(signIn.error) ?? renewTokenFrom(googleSignIn.error);
  // Sign-up form. The landing page's "What's your name?" pre-fills the name.
  const signupStart = useEmailSignupStart();
  const signupComplete = useEmailSignupComplete();
  const [suName, setSuName] = useState(() => readIntro().name ?? '');
  const [suEmail, setSuEmail] = useState('');
  const [suPhone, setSuPhone] = useState('');
  const [suCode, setSuCode] = useState('');
  const [suChallenge, setSuChallenge] = useState<EmailSignupChallenge | null>(null);

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
  const [phone, setPhone] = useState('');
  const [firmSize, setFirmSize] = useState<FirmEnquirySize | ''>('');
  const [enquiryMessage, setEnquiryMessage] = useState('');
  const [firmEnquirySent, setFirmEnquirySent] = useState(false);

  // Who is signing in (the left tabs): copy changes, and the "new here" link
  // starts a trial (advocate) or a firm enquiry / demo (firm).
  const [audience, setAudience] = useState<'advocate' | 'firm'>(() => (readIntro().size === 'team' ? 'firm' : 'advocate'));
  // Email + password sign-in; Google is offered underneath.
  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Password chosen while setting up a new account (step 3).
  const [newPassword, setNewPassword] = useState('');
  // Field errors show once a field is left, or for all fields on START.
  const [suTouched, setSuTouched] = useState<Record<string, boolean>>({});
  const suProblems = signupProblems({ name: suName, email: suEmail, phone: suPhone, password: newPassword });
  const suShow = (f: 'name' | 'email' | 'phone' | 'password') => (suTouched[f] ? suProblems[f] : null);
  const touch = (f: string) => setSuTouched((t) => ({ ...t, [f]: true }));
  const firmSide = audience === 'firm' || (tab === 'signup' && role === 'firm');
  // A preset role (the Firm tab's trial link) skips the role picker.
  const startTrial = (preset: Role | null = null) => {
    setMfaChallenge(null); setGoogleSignup(null); 
    setRole(preset); setStep(0); setTab('signup');
  };
  const bookDemo = () => { setMfaChallenge(null); setTab('signup'); setRole('firm'); setStep(1); };
  // Superadmins land on the platform admin tree; everyone else on the app dashboard.
  const onComplete = (resp?: { user?: { isSuperadmin?: boolean } }) =>
    navigate(resp?.user?.isSuperadmin ? '/admin' : '/app/dashboard');

  // ---- Submitters ---------------------------------------------------------

  // Shared by the Sign-in Google button and the sign-up Google step (when
  // the Google account already has a DifAI account).
  const handleSignedIn = (resp: SignInResult) => {
    if (isMfaChallenge(resp)) {
      setTab('signin');
      setMfaChallenge({ challengeId: resp.challengeId, expiresAt: resp.expiresAt });
      return;
    }
    onComplete(resp);
  };

  const handleGoogleCredential = (credential: string) => {
    googleSignIn.mutate(
      { credential },
      {
        onSuccess: (r) => {
          if (isGoogleSignupRequired(r)) {
            // New Google account - set up the practice next.
            setGoogleSignup(r);
            
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
    if (suProblems.name || suProblems.email || suProblems.emailTypo || suProblems.phone || suProblems.password) return;
    signupStart.mutate(
      { name: suName.trim(), email: suEmail.trim(), phone: suPhone.trim() },
      { onSuccess: (c) => { setSuChallenge(c); setSuCode(''); } },
    );
  };

  const handleSignupComplete = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!suChallenge) return;
    signupComplete.mutate(
      { signupToken: suChallenge.signupToken, challengeId: suChallenge.challengeId, code: suCode, password: newPassword },
      { onSuccess: () => navigate('/onboarding', { replace: true }) },
    );
  };

  const handleFirmEnquiry = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!firmSize) return;
    firmEnquiry.mutate(
      {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
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
    padding: 'clamp(20px, 4vw, 32px)',
    gap: 24,
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
    <div style={pageStyle}>
      <div className="auth-shell">
        <aside className="auth-art">
          <AuthArt />
          <div className="auth-art-brand">
            <LogoMark size={32} ink="var(--art-ink)" paper="var(--art-0)" />
            DifAI
          </div>
          <nav className="auth-side-tabs" aria-label="Sign in options">
            <button
              type="button"
              className={`auth-side-tab${firmSide ? '' : ' is-active'}`}
              aria-current={firmSide ? undefined : 'page'}
              onClick={() => { backToStart(); setAudience('advocate'); }}
            >
              Advocate
            </button>
            <button
              type="button"
              className={`auth-side-tab${firmSide ? ' is-active' : ''}`}
              aria-current={firmSide ? 'page' : undefined}
              onClick={() => { backToStart(); setAudience('firm'); }}
            >
              Firm
            </button>
          </nav>
          <p className="auth-art-tagline">
            {firmSide
              ? 'Matters, team, hearings and billing for your whole firm.'
              : 'Your hearings, drafts and matters in one app.'}
          </p>
        </aside>
        <div className="auth-main">
        <div className="auth-main-inner">
        {/* Brand */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            marginBottom: 28,
          }}
        >
          <span aria-hidden className="auth-logo"><LogoMark size={46} ink="var(--bg-surface)" paper="var(--text-primary)" /></span>
          <div
            className="auth-brand-text"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: '-0.018em',
            }}
          >
            DifAI
          </div>
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
        </div>

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
        {tab === 'signin' && !mfaChallenge && (
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
            <div style={{ textAlign: 'center' }}>
              <h1 className="auth-title">Sign in</h1>
              <p className="body-sm" style={{ color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.55 }}>
                {audience === 'firm' ? 'Welcome back to your firm.' : 'Welcome back to your practice.'}
              </p>
            </div>
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label className="auth-field">
                <Icon name="clients" size={16} />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder={audience === 'firm' ? 'Work email' : 'Email'}
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
              {renewToken && (
                <div style={{ ...noticeStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <strong style={{ fontSize: 14 }}>Pick a plan to continue</strong>
                  <span>{signIn.error?.message ?? googleSignIn.error?.message} Your cases and documents are safe.</span>
                  <CycleToggle cycle={cycle} onChange={setCycle} />
                  <PlanCards
                    plans={SIGNUP_PLANS.filter((p) => p.id === 'solo' || p.id === 'practice')}
                    cycle={cycle}
                    selected={renewPlan}
                    onSelect={(id) => setRenewPlan(id as PaidPlanId)}
                    compact
                  />
                  {renewCheckout.isError && <div role="alert">{renewCheckout.error.message}</div>}
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    disabled={renewCheckout.isPending}
                    onClick={() => renewCheckout.mutate({ renewToken, plan: renewPlan, cycle })}
                  >
                    {renewCheckout.isPending ? 'Opening payment…' : 'Pay and continue'}
                  </button>
                </div>
              )}
              {signIn.isError && !renewToken && (
                (signIn.error as { response?: { data?: { code?: string } } }).response?.data?.code === 'account_not_found' ? (
                  <div role="alert" style={noticeStyle}>
                    No DifAI account uses this email.{' '}
                    <button type="button" className="auth-link" onClick={() => startTrial(audience === 'firm' ? 'group' : null)}>
                      {audience === 'firm' ? 'Start your firm’s 14-day trial' : 'Create your free account'}
                    </button>
                  </div>
                ) : (
                  <div role="alert" style={noticeStyle}>{signIn.error.message}</div>
                )
              )}
              <div className="auth-actions">
                <a className="auth-forgot" href="mailto:support@lexdraft.in?subject=Forgot%20password">Forgot password?</a>
                <button
                  type="submit"
                  className="btn btn-primary btn-lg btn-pill auth-submit"
                  disabled={signIn.isPending || !signinEmail.trim() || !signinPassword}
                >
                  {signIn.isPending ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </form>
            {googleSignIn.isPending && (
              <p className="body-sm muted" style={{ textAlign: 'center' }}>Checking your Google account…</p>
            )}
            {googleSignIn.isError && !renewToken && (
              <div role="alert" style={noticeStyle}>{googleSignIn.error.message}</div>
            )}
            <p className="body-sm" style={{ textAlign: 'center', margin: 0, color: 'var(--text-secondary)' }}>
              {audience === 'firm' ? (
                <>New firm on DifAI?{' '}<button type="button" className="auth-link" onClick={() => startTrial('group')}>Start a 14-day free trial</button></>
              ) : (
                <>New to DifAI?{' '}<button type="button" className="auth-link" onClick={() => startTrial()}>Create your free account</button></>
              )}
            </p>
            <p className="mono" style={{ textAlign: 'center', margin: '-8px 0 0', fontSize: 10, letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>
              {audience === 'firm'
                ? 'Every feature for 14 days · no card needed'
                : 'Free for advocates & law students till 1 June 2027'}
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm auth-firm-link"
              style={{ alignSelf: 'center' }}
              onClick={bookDemo}
            >
              Firm with 9+ lawyers? Book a demo
            </button>
          </div>
        )}

        {/* SIGN UP - form (name, email, WhatsApp, password) -> START sends a
            WhatsApp code -> code creates the account -> /onboarding. A new
            Google account (footer button) continues in the block below. */}
        {tab === 'signup' && step === 0 && !googleSignup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <h1 className="auth-title">{audience === 'firm' ? 'Free trial' : 'Create account'}</h1>
              <p className="body-sm" style={{ color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.55 }}>
                {suChallenge
                  ? <>Enter the 6-digit code we sent on WhatsApp to <strong className="mono" style={{ color: 'var(--text-primary)' }}>{suChallenge.phone}</strong>.</>
                  : audience === 'firm'
                    ? '14 days of every feature. No card needed.'
                    : 'Free for advocates & law students till 1 June 2027.'}
              </p>
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
                  <input type="email" inputMode="email" autoComplete="email" placeholder={audience === 'firm' ? 'Work email' : 'Email'} aria-label="Email" required value={suEmail} onChange={(e) => setSuEmail(e.target.value)} onBlur={() => touch('email')} aria-invalid={!!suShow('email')} />
                </label>
                {suShow('email') && <span role="alert" className="auth-field-error">{suShow('email')}</span>}
                {!suProblems.email && suProblems.emailTypo && (
                  <span role="alert" className="auth-field-error">
                    Did you mean <strong>{suProblems.emailTypo}</strong>?{' '}
                    <button type="button" className="auth-link" onClick={() => setSuEmail(suProblems.emailTypo!)}>Use it</button>
                  </span>
                )}
                <label className="auth-field">
                  <Icon name="chat" size={16} />
                  <input type="tel" inputMode="tel" autoComplete="tel" placeholder="WhatsApp number (10 digits)" aria-label="WhatsApp number" required value={suPhone} onChange={(e) => setSuPhone(e.target.value)} onBlur={() => touch('phone')} aria-invalid={!!suShow('phone')} />
                </label>
                {suShow('phone') && <span role="alert" className="auth-field-error">{suShow('phone')}</span>}
                <label className="auth-field">
                  <Icon name="key" size={16} />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Password (8+ characters)"
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
                <span className="body-xs" style={{ color: 'var(--text-tertiary)', marginTop: -6 }}>
                  We send a 6-digit code on WhatsApp to verify your number. All fields are required.
                </span>
                {signupStart.isError && <div role="alert" style={noticeStyle}>{signupStart.error.message}</div>}
                <div className="auth-actions">
                  <span className="body-xs" style={{ color: 'var(--text-tertiary)', maxWidth: 240, lineHeight: 1.5 }}>
                    By starting you agree to DifAI&rsquo;s Terms and Privacy Policy.
                  </span>
                  <button
                    type="submit"
                    className="btn btn-primary btn-lg btn-pill auth-submit"
                    disabled={signupStart.isPending}
                  >
                    {signupStart.isPending ? 'Sending…' : 'Start'}
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
                {signupComplete.isError && <div role="alert" style={noticeStyle}>{signupComplete.error.message}</div>}
                <div className="auth-actions">
                  <button type="button" className="auth-forgot" style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => { setSuChallenge(null); setSuCode(''); signupComplete.reset(); }}>
                    Change details
                  </button>
                  <button type="submit" className="btn btn-primary btn-lg btn-pill auth-submit" disabled={signupComplete.isPending || suCode.length !== 6}>
                    {signupComplete.isPending ? 'Creating…' : 'Verify'}
                  </button>
                </div>
              </form>
            )}
            <p className="body-sm" style={{ textAlign: 'center', margin: 0, color: 'var(--text-secondary)' }}>
              Already have {audience === 'firm' ? 'a practice' : 'an account'}?{' '}
              <button type="button" className="auth-link" onClick={backToStart}>Sign in</button>
            </p>
          </div>
        )}

        {/* SIGN UP - one screen: WhatsApp number + password + Google, then the
            WhatsApp code. The account is created right after the code, and
            /onboarding takes over (plan, practice details). */}
        {tab === 'signup' && step === 0 && googleSignup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <h1 className="auth-title">{audience === 'firm' ? 'Free trial' : 'Create account'}</h1>
              <p className="body-sm" style={{ color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.55 }}>
                {googleSignup
                  ? `Welcome, ${googleSignup.profile.name.split(' ')[0]}. Add your WhatsApp number and a password for ${googleSignup.profile.email}.`
                  : audience === 'firm'
                    ? '14 days of every feature. No card needed.'
                    : 'Free for advocates & law students till 1 June 2027.'}
              </p>
            </div>
            <GoogleWhatsAppVerify
              phoneFirst
              afterPhone={(
              <div>
                <label className="label required" htmlFor="signup-password">
                  Password
                  <span className="hint">At least 8 characters</span>
                </label>
                <input
                  id="signup-password"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                />
              </div>
              )}
              ready={newPassword.length >= 8}
              notReadyText="Enter your WhatsApp number and a password"
              startWith={googleSignup}
              buttonText="signup_with"
              onSignedIn={handleSignedIn}
              onVerified={(v) => {
                signUp.mutate(
                  { signupToken: v.signupToken, password: newPassword, name: v.profile.name, role: 'solo' },
                  { onSuccess: () => navigate('/onboarding', { replace: true }) },
                );
              }}
            />
            {signUp.isPending && <p className="body-sm muted" style={{ textAlign: 'center' }}>Creating your account…</p>}
            {signUp.isError && <div role="alert" style={noticeStyle}>{(signUp.error as Error | null)?.message ?? 'Sign-up failed.'}</div>}
            <p className="body-xs" style={{ textAlign: 'center', margin: 0, color: 'var(--text-tertiary)' }}>
              Next you choose a plan and set up your practice.
            </p>
            <p className="body-sm" style={{ textAlign: 'center', margin: 0, color: 'var(--text-secondary)' }}>
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
              A DifAI partner will reach out to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>{' '}
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
                <input
                  id="enq-phone"
                  className="input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98xxx xxxxx"
                  autoComplete="tel"
                />
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
                  What brings you to DifAI? <span className="hint">Optional</span>
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
        {tab === 'signin' && !mfaChallenge && (
          <div className="auth-foot">
            <span>Or sign in with</span>
            {googleSignInAvailable() ? (
              <GoogleButton onCredential={handleGoogleCredential} text="signin_with" shape="pill" width={210} />
            ) : (
              <span className="auth-foot-g"><GoogleG /> Google (not configured)</span>
            )}
          </div>
        )}
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
      <p className="body-xs muted" style={{ textAlign: 'center', margin: 0 }}>
        By continuing you agree to DifAI&rsquo;s terms of service and privacy policy.
      </p>

      {/* Trust strip - sits below the card, reinforces the legal-tech
          positioning without competing for attention. */}
      <div
        className="mono"
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
