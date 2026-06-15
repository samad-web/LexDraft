import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, FieldError, validators } from '@lexdraft/ui';
import { useSignIn, useSignUp, useFirmEnquiry, type FirmEnquirySize } from '@/hooks/useAuth';
import { useMfaVerifyChallenge } from '@/hooks/useMfa';
import { isMfaChallenge } from '@/lib/auth-types';

// =============================================================================
// AuthView - Sign in / Sign up + 3-step onboarding
// Ported from _design/lexdraft/project/views/auth.jsx, mapped to v2 Monochrome
// tokens, wired to useSignIn / useSignUp. The "ADMIN" affordance is kept -
// the API auto-promotes such accounts to superadmin.
// =============================================================================

type AuthTab = 'signin' | 'signup';
type Role = 'solo' | 'group' | 'firm';

interface RoleOption {
  id: Role;
  label: string;
  sub: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  { id: 'solo', label: 'Solo Advocate', sub: 'Just me' },
  { id: 'group', label: 'Practice Group', sub: '2-8 people' },
  { id: 'firm', label: 'Firm', sub: '9+ people' },
];

const STEP_LABELS: readonly string[] = ['', 'Profile', 'Firm details', 'Done'];

// Maps the `?reason=` value the api.ts interceptor appends on a 402 to a
// human-friendly banner copy. Anything we don't recognise falls through to
// the generic phrase, so future server-side codes degrade gracefully.
const PLAN_REASON_MESSAGES: Record<string, string> = {
  plan_cancelled: 'Your firm subscription has been cancelled. Renew to continue using LexDraft.',
  plan_past_due:  'Your firm subscription is past due. Update billing to continue using LexDraft.',
  plan_expired:   'Your firm subscription period has ended. Renew to continue using LexDraft.',
  trial_expired:  'Your 14-day trial has ended. Pick a plan to keep your work.',
};

export function AuthView() {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const signUp = useSignUp();
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

  const [tab, setTab] = useState<AuthTab>('signin');
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [role, setRole] = useState<Role | null>(null);

  // MFA challenge sub-step. Populated when the sign-in POST returns
  // { mfaRequired: true, challengeId, expiresAt } instead of a session.
  // Cleared back to null when the user goes back, completes verification,
  // or the challenge expires.
  const [mfaChallenge, setMfaChallenge] = useState<{
    challengeId: string;
    expiresAt: string;
  } | null>(null);

  // Sign-in state
  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [signinEmailTouched, setSigninEmailTouched] = useState(false);
  const signinEmailError = signinEmailTouched ? validators.email(signinEmail) : null;

  // Sign-up state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [enrolment, setEnrolment] = useState('');
  const [password, setPassword] = useState('');
  const [firm, setFirm] = useState('');
  const [primaryCourt, setPrimaryCourt] = useState('');
  const [practiceAreas, setPracticeAreas] = useState('');

  const [signupEmailTouched, setSignupEmailTouched] = useState(false);
  const [signupPasswordTouched, setSignupPasswordTouched] = useState(false);
  const signupEmailError = signupEmailTouched ? validators.email(email) : null;
  const signupPasswordError = signupPasswordTouched
    ? validators.minLength(password, 8, 'Password')
    : null;

  // Firm-enquiry state (separate flow from self-serve sign-up). Reuses
  // `name` + `email` from sign-up so the prospect doesn't retype if they
  // hop between role options.
  const firmEnquiry = useFirmEnquiry();
  const [phone, setPhone] = useState('');
  const [firmSize, setFirmSize] = useState<FirmEnquirySize | ''>('');
  const [enquiryMessage, setEnquiryMessage] = useState('');
  const [firmEnquirySent, setFirmEnquirySent] = useState(false);

  const isSignup = tab === 'signup';
  // Superadmins land on the platform admin tree; everyone else on the app dashboard.
  const onComplete = (resp?: { user?: { isSuperadmin?: boolean } }) =>
    navigate(resp?.user?.isSuperadmin ? '/admin' : '/app/dashboard');

  // ---- Submitters ---------------------------------------------------------

  const handleSignIn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    signIn.mutate(
      { email: signinEmail, password: signinPassword },
      {
        onSuccess: (resp) => {
          // Branch on whether the server demanded an MFA challenge. The
          // useSignIn hook handles the session-creation side; we only deal
          // with where to route the user from here.
          if (isMfaChallenge(resp)) {
            setMfaChallenge({
              challengeId: resp.challengeId,
              expiresAt: resp.expiresAt,
            });
            return;
          }
          onComplete(resp);
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

  const handleSignUp = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!role) return;
    signUp.mutate(
      {
        email,
        password,
        name,
        role,
        firm: firm || undefined,
        enrolment: enrolment || undefined,
        primaryCourt: primaryCourt || undefined,
        practiceAreas: practiceAreas || undefined,
      },
      { onSuccess: (resp) => onComplete(resp) },
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

  const cardStyle: CSSProperties = {
    width: '100%',
    maxWidth: 480,
    padding: 'clamp(28px, 5vw, 44px)',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-popover)',
  };

  const tabRowStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    gap: 0,
    marginBottom: 28,
    borderBottom: '1px solid var(--border-subtle)',
  };

  const showTabs = (!isSignup || step === 0) && !mfaChallenge;

  // ---- Render -------------------------------------------------------------

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
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
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              background: 'var(--text-primary)',
              borderRadius: 'var(--radius-md)',
              display: 'inline-block',
            }}
          />
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: '-0.018em',
            }}
          >
            LexDraft
          </div>
          <div
            className="mono"
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

        {/* Tabs OR step indicator */}
        {showTabs ? (
          <div style={tabRowStyle} role="tablist" aria-label="Authentication mode">
            {([
              ['signin', 'Sign in'],
              ['signup', 'Create account'],
            ] as const).map(([id, label]) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setTab(id);
                    setStep(0);
                    setRole(null);
                  }}
                  style={{
                    padding: '12px 20px',
                    fontSize: 14,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderBottom: active
                      ? '2px solid var(--text-primary)'
                      : '2px solid transparent',
                    marginBottom: -1,
                    background: 'transparent',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  style={{
                    flex: 1,
                    height: 3,
                    background: s <= step ? 'var(--text-primary)' : 'var(--border-subtle)',
                    borderRadius: 'var(--radius-full)',
                  }}
                />
              ))}
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              STEP {step} OF 3 · {STEP_LABELS[step]}
            </div>
          </div>
        )}

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
          <form
            onSubmit={handleSignIn}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div>
              <label className="label required" htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                className="input"
                type="email"
                placeholder="advocate@chambers.law"
                value={signinEmail}
                onChange={(e) => setSigninEmail(e.target.value)}
                onBlur={() => setSigninEmailTouched(true)}
                required
                autoComplete="email"
                aria-invalid={!!signinEmailError}
                aria-describedby={signinEmailError ? 'signin-email-error' : undefined}
              />
              <FieldError id="signin-email-error" error={signinEmailError} />
            </div>
            <div>
              <label className="label required" htmlFor="signin-password">Password</label>
              <PasswordInput
                id="signin-password"
                value={signinPassword}
                onChange={(v) => setSigninPassword(v)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
            {/*
              "Remember me" + "Forgot?" affordances removed — neither was
              wired (checkbox had no state, link was href="#"). Reintroduce
              them only when a session-extension flag and password-reset
              flow exist server-side.
            */}
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
            {signIn.isError && (
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
                {(signIn.error as Error | null)?.message ?? 'Sign-in failed.'}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              disabled={signIn.isPending}
            >
              {signIn.isPending ? 'Signing in…' : 'Sign in'}
            </button>
            {import.meta.env.DEV && (
              <p
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  textAlign: 'center',
                  marginTop: 8,
                  letterSpacing: '0.12em',
                }}
              >
                TIP: USE EMAIL CONTAINING "ADMIN" FOR SUPERADMIN DEMO
              </p>
            )}
          </form>
        )}

        {/* SIGN UP - STEP 0 (role) */}
        {tab === 'signup' && step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p
              style={{
                fontSize: 14,
                color: 'var(--text-secondary)',
                textAlign: 'center',
                marginBottom: 4,
              }}
            >
              Choose how you’ll use LexDraft
            </p>
            <div className="facts-grid-3" style={{ gap: 10 }}>
              {ROLE_OPTIONS.map((r) => {
                const active = role === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRole(r.id)}
                    style={{
                      padding: 18,
                      textAlign: 'left',
                      background: active ? 'var(--text-primary)' : 'var(--bg-surface)',
                      color: active ? 'var(--bg-base)' : 'var(--text-primary)',
                      border: `1px solid ${active ? 'var(--text-primary)' : 'var(--border-default)'}`,
                      borderRadius: 'var(--radius-lg)',
                      cursor: 'pointer',
                      transition: 'border-color 150ms, background 150ms, color 150ms',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 16,
                        marginBottom: 4,
                        fontWeight: 600,
                      }}
                    >
                      {r.label}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 10, opacity: 0.7 }}
                    >
                      {r.sub}
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block btn-lg"
              disabled={!role}
              style={{ opacity: role ? 1 : 0.4 }}
              onClick={() => setStep(1)}
            >
              Continue <Icon name="arrow" size={14} />
            </button>
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
              A LexDraft partner will reach out to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>{' '}
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
              Reference #{firmEnquiry.data?.id.slice(0, 8) ?? '—'}
            </span>
            <button
              type="button"
              className="btn btn-block btn-lg"
              style={{ marginTop: 16 }}
              onClick={() => navigate('/')}
            >
              Back to home
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
                  What brings you to LexDraft? <span className="hint">Optional</span>
                </label>
                <textarea
                  id="enq-message"
                  className="input"
                  rows={3}
                  value={enquiryMessage}
                  onChange={(e) => setEnquiryMessage(e.target.value)}
                  placeholder="A short note on what you&rsquo;re looking for — drafting, matter management, compliance, etc."
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

        {/* SIGN UP - STEP 1 (profile) — Solo / Practice */}
        {tab === 'signup' && step === 1 && role !== 'firm' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Gate step transition on validation. Native required + the
              // email validator above flag the bad fields, but the form
              // would still advance to step 2 on every Enter press without
              // this guard — meaning a bad email only surfaces at the
              // final API call. Force-touch the email field so the
              // FieldError renders if it wasn't already.
              setSignupEmailTouched(true);
              if (!name.trim() || signupEmailError || password.length < 8) return;
              setStep(2);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div>
              <label className="label required" htmlFor="signup-name">Full name</label>
              <input
                id="signup-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Aarav Sharma"
                required
                autoComplete="name"
              />
            </div>
            <div>
              <label className="label required" htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setSignupEmailTouched(true)}
                placeholder="advocate@chambers.law"
                required
                autoComplete="email"
                aria-invalid={!!signupEmailError}
                aria-describedby={signupEmailError ? 'signup-email-error' : undefined}
              />
              <FieldError id="signup-email-error" error={signupEmailError} />
            </div>
            <div>
              <label className="label" htmlFor="signup-enrolment">
                Bar Council Enrolment No.
                <span className="hint">Optional</span>
              </label>
              <input
                id="signup-enrolment"
                className="input mono"
                value={enrolment}
                onChange={(e) => setEnrolment(e.target.value)}
                placeholder="D/4419/2018"
              />
            </div>
            <div>
              <label className="label required" htmlFor="signup-password">
                Password
                <span className="hint">Min 8 characters</span>
              </label>
              <PasswordInput
                id="signup-password"
                value={password}
                onChange={(v) => setPassword(v)}
                onBlur={() => setSignupPasswordTouched(true)}
                autoComplete="new-password"
                required
                minLength={8}
                aria-invalid={!!signupPasswordError}
                aria-describedby={signupPasswordError ? 'signup-password-error' : undefined}
              />
              <FieldError id="signup-password-error" error={signupPasswordError} />
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg">
              Continue <Icon name="arrow" size={14} />
            </button>
          </form>
        )}

        {/* SIGN UP - STEP 2 (firm) */}
        {tab === 'signup' && step === 2 && (
          <form
            onSubmit={handleSignUp}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div>
              <label className="label" htmlFor="signup-firm">
                {role === 'solo' ? 'Chambers name' : 'Firm name'}
              </label>
              <input
                id="signup-firm"
                className="input"
                value={firm}
                onChange={(e) => setFirm(e.target.value)}
                placeholder="Sharma & Associates"
                autoComplete="organization"
              />
            </div>
            <div>
              <label className="label" htmlFor="signup-court">Primary court</label>
              <input
                id="signup-court"
                className="input"
                value={primaryCourt}
                onChange={(e) => setPrimaryCourt(e.target.value)}
                placeholder="Delhi High Court"
              />
            </div>
            <div>
              <label className="label" htmlFor="signup-areas">Practice areas</label>
              <input
                id="signup-areas"
                className="input"
                value={practiceAreas}
                onChange={(e) => setPracticeAreas(e.target.value)}
                placeholder="Civil, Commercial, Banking"
              />
            </div>
            {signUp.isError && (
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
                {(signUp.error as Error | null)?.message ?? 'Sign-up failed.'}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-block btn-lg"
              disabled={signUp.isPending}
            >
              {signUp.isPending ? 'Creating account…' : 'Finish setup'}
            </button>
          </form>
        )}
      </div>

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
  const canSubmit = !expired && code.length >= (useBackup ? 6 : 6);

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

// ===========================================================================
// PasswordInput - input with an inline show/hide eye toggle. Local to AuthView
// because it's only ever used here; if a third password field shows up
// elsewhere we'll lift it into @lexdraft/ui.
// ===========================================================================

interface PasswordInputProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

function PasswordInput({
  id,
  value,
  onChange,
  onBlur,
  autoComplete,
  placeholder,
  required,
  minLength,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        className="input"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        style={{ paddingRight: 38 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        tabIndex={-1}
        style={{
          position: 'absolute',
          right: 6,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 0,
          padding: 6,
          cursor: 'pointer',
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} size={16} />
      </button>
    </div>
  );
}
