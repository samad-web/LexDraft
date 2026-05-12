import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useSignIn, useSignUp } from '@/hooks/useAuth';
import { useMfaVerifyChallenge } from '@/hooks/useMfa';
import { useUIStore } from '@/store/ui';
import { isMfaChallenge } from '@/lib/auth-types';

// =============================================================================
// AuthView — Sign in / Sign up + 3-step onboarding
// Ported from _design/lexdraft/project/views/auth.jsx, mapped to v2 Monochrome
// tokens, wired to useSignIn / useSignUp. The "ADMIN" affordance is kept —
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
  { id: 'group', label: 'Practice Group', sub: '2–8 people' },
  { id: 'firm', label: 'Firm', sub: '9+ people' },
];

const STEP_LABELS: readonly string[] = ['', 'Profile', 'Firm details', 'Done'];

export function AuthView() {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const signUp = useSignUp();
  const showToast = useUIStore((s) => s.showToast);

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

  // Sign-up state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [enrolment, setEnrolment] = useState('');
  const [password, setPassword] = useState('');
  const [firm, setFirm] = useState('');
  // Firm-detail extras kept as local UI fields; only `firm` reaches the API today.
  const [primaryCourt, setPrimaryCourt] = useState('');
  const [practiceAreas, setPracticeAreas] = useState('');

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
      },
      { onSuccess: (resp) => onComplete(resp) },
    );
  };

  // ---- Styles -------------------------------------------------------------

  const pageStyle: CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    background: 'var(--bg-base)',
    fontFamily: 'var(--font-sans)',
  };

  const cardStyle: CSSProperties = {
    width: '100%',
    maxWidth: 480,
    padding: 40,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-xl)',
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
            alignItems: 'center',
            gap: 10,
            justifyContent: 'center',
            marginBottom: 28,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 22,
              height: 22,
              background: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.015em',
            }}
          >
            LexDraft
          </span>
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

        {/* MFA challenge — interleaved between password POST and session creation. */}
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
              <label className="label" htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                className="input"
                type="email"
                placeholder="advocate@chambers.law"
                value={signinEmail}
                onChange={(e) => setSigninEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label" htmlFor="signin-password">Password</label>
              <input
                id="signin-password"
                className="input"
                type="password"
                placeholder="••••••••"
                value={signinPassword}
                onChange={(e) => setSigninPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <input type="checkbox" /> Remember me
              </label>
              <span style={{ flex: 1 }} />
              <a
                href="#"
                style={{ fontSize: 12, color: 'var(--text-secondary)' }}
              >
                Forgot?
              </a>
            </div>
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
            <div className="divider" />
            <button
              type="button"
              className="btn btn-block"
              onClick={() => showToast({ type: 'cobalt', text: 'Google sign-in coming soon' })}
            >
              Continue with Google
            </button>
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
          </form>
        )}

        {/* SIGN UP — STEP 0 (role) */}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
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

        {/* SIGN UP — STEP 1 (profile) */}
        {tab === 'signup' && step === 1 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setStep(2);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div>
              <label className="label" htmlFor="signup-name">Full name</label>
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
              <label className="label" htmlFor="signup-email">Email</label>
              <input
                id="signup-email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="advocate@chambers.law"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label" htmlFor="signup-enrolment">
                Bar Council Enrolment No.
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
              <label className="label" htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-block btn-lg">
              Continue <Icon name="arrow" size={14} />
            </button>
          </form>
        )}

        {/* SIGN UP — STEP 2 (firm) */}
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
    </div>
  );
}

// ===========================================================================
// MfaChallengeStep — exchange a sign-in challengeId for a session.
//
// Lives in the same file as AuthView because it's only ever rendered here
// (not a generally-reusable widget — the post-password handshake is unique
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
          ? 'Expired — sign in again'
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
