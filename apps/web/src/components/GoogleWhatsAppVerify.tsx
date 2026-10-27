import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import {
  isGoogleSignupRequired,
  useGoogleSignIn,
  useSendSignupOtp,
  useVerifySignupOtp,
  type GoogleSignupRequired,
} from '@/hooks/useAuth';
import type { SignInResult } from '@/lib/auth-types';
import { googleSignInAvailable, GOOGLE_CLIENT_ID, isNativeApp, loadGoogleIdentity, nativeGoogleCredential } from '@/lib/google';

// =============================================================================
// Google sign-in + WhatsApp number verification.
//
//   1. "Continue with Google" -> /auth/google
//        existing account -> onSignedIn (session already set, or MFA challenge)
//        new account      -> step 2
//   2. WhatsApp number -> 6-digit code sent over WhatsApp
//   3. Code verified   -> onVerified with a sign-up token that carries the
//                         verified number; the parent collects the profile
//                         and calls useGoogleSignUp.
// =============================================================================

export interface VerifiedGoogleSignup {
  signupToken: string;
  profile: GoogleSignupRequired['profile'];
  phone: string;
}

interface Props {
  onSignedIn: (resp: SignInResult) => void;
  onVerified: (v: VerifiedGoogleSignup) => void;
  /** Skip the Google step when the caller already has a sign-up token
   *  (e.g. the user pressed Google on the Sign in tab with a new account). */
  startWith?: GoogleSignupRequired | null;
  buttonText?: 'continue_with' | 'signup_with' | 'signin_with';
  /** Invitations addressed to one email: refuse any other Google account
   *  before the WhatsApp step, rather than failing at the very end. */
  expectedEmail?: string | null;
}

const noticeStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text-primary)',
  background: 'var(--bg-surface-2)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
};

export function GoogleWhatsAppVerify({ onSignedIn, onVerified, startWith, buttonText = 'continue_with', expectedEmail }: Props) {
  const googleSignIn = useGoogleSignIn();
  const sendOtp = useSendSignupOtp();
  const verifyOtp = useVerifySignupOtp();

  const [pending, setPending] = useState<GoogleSignupRequired | null>(startWith ?? null);
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; phone: string } | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [wrongAccount, setWrongAccount] = useState<string | null>(null);

  useEffect(() => {
    if (startWith) setPending(startWith);
  }, [startWith]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const handleCredential = (credential: string) => {
    googleSignIn.mutate(
      { credential },
      {
        onSuccess: (r) => {
          if (!isGoogleSignupRequired(r)) {
            onSignedIn(r);
            return;
          }
          if (expectedEmail && r.profile.email.toLowerCase() !== expectedEmail.toLowerCase()) {
            setWrongAccount(`This invitation is for ${expectedEmail}. You chose ${r.profile.email} - continue with the Google account for ${expectedEmail}.`);
            return;
          }
          setWrongAccount(null);
          setPending(r);
        },
      },
    );
  };

  const handleSend = (e?: FormEvent) => {
    e?.preventDefault();
    if (!pending) return;
    sendOtp.mutate(
      { signupToken: pending.signupToken, phone },
      {
        onSuccess: (r) => {
          setChallenge({ id: r.challengeId, phone: r.phone });
          setCode('');
          setResendIn(r.resendAfterSeconds);
        },
      },
    );
  };

  const handleVerify = (e: FormEvent) => {
    e.preventDefault();
    if (!pending || !challenge) return;
    verifyOtp.mutate(
      { signupToken: pending.signupToken, challengeId: challenge.id, code },
      { onSuccess: (r) => onVerified({ signupToken: r.signupToken, profile: pending.profile, phone: r.phone }) },
    );
  };

  // ---- Step 1: Google ------------------------------------------------------
  if (!pending) {
    if (!googleSignInAvailable()) {
      return (
        <div style={noticeStyle} role="status">
          Google sign-in is not configured.
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <GoogleButton onCredential={handleCredential} text={buttonText} />
        {googleSignIn.isPending && (
          <p className="body-sm muted" style={{ textAlign: 'center' }}>Checking your Google account…</p>
        )}
        {googleSignIn.isError && (
          <div role="alert" style={noticeStyle}>{googleSignIn.error.message}</div>
        )}
        {wrongAccount && <div role="alert" style={noticeStyle}>{wrongAccount}</div>}
      </div>
    );
  }

  const who = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <Icon name="check" size={14} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{pending.profile.name}</div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {pending.profile.email}
        </div>
      </div>
    </div>
  );

  // ---- Step 2: WhatsApp number ---------------------------------------------
  if (!challenge) {
    return (
      <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {who}
        <div>
          <label className="label required" htmlFor="wa-phone">
            WhatsApp number
            <span className="hint">We&rsquo;ll send a 6-digit code</span>
          </label>
          <input
            id="wa-phone"
            className="input mono"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            autoFocus
          />
        </div>
        {sendOtp.isError && <div role="alert" style={noticeStyle}>{sendOtp.error.message}</div>}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={sendOtp.isPending || phone.trim().length < 10}>
          {sendOtp.isPending ? 'Sending…' : 'Send code on WhatsApp'}
        </button>
      </form>
    );
  }

  // ---- Step 3: code --------------------------------------------------------
  return (
    <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {who}
      <p className="body-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        Enter the code we sent on WhatsApp to <strong className="mono" style={{ color: 'var(--text-primary)' }}>{challenge.phone}</strong>.
      </p>
      <div>
        <label className="label required" htmlFor="wa-code">Verification code</label>
        <input
          id="wa-code"
          className="input mono"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
          autoFocus
          style={{ letterSpacing: '0.3em', fontSize: 18 }}
        />
      </div>
      {verifyOtp.isError && <div role="alert" style={noticeStyle}>{verifyOtp.error.message}</div>}
      {sendOtp.isError && <div role="alert" style={noticeStyle}>{sendOtp.error.message}</div>}
      <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={verifyOtp.isPending || code.length !== 6}>
        {verifyOtp.isPending ? 'Verifying…' : 'Verify'}
      </button>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setChallenge(null); verifyOtp.reset(); }}>
          Change number
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={resendIn > 0 || sendOtp.isPending} onClick={() => handleSend()}>
          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}

const NATIVE_LABEL = {
  continue_with: 'Continue with Google',
  signup_with: 'Sign up with Google',
  signin_with: 'Sign in with Google',
} as const;

/** Browser: Google's own rendered button (required by Google's branding
 *  rules). Android app: a native-picker button. */
type GoogleButtonProps = {
  onCredential: (credential: string) => void;
  text?: 'continue_with' | 'signup_with' | 'signin_with';
  /** 'pill' = the sign-in page's round button. */
  shape?: 'rectangular' | 'pill';
  /** Pre-selects this account in Google's account chooser (web). */
  loginHint?: string;
  /** Fixed button width in px (web); default fills the container. */
  width?: number;
};

export function GoogleButton(props: GoogleButtonProps) {
  return isNativeApp() ? <NativeGoogleButton {...props} /> : <WebGoogleButton {...props} />;
}

function NativeGoogleButton({ onCredential, text = 'continue_with', shape }: GoogleButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      onCredential(await nativeGoogleCredential());
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      // Closing the account picker is not an error worth showing.
      if (!/cancel/i.test(msg)) setError(msg || 'Google sign-in failed. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" className={`btn btn-primary btn-lg btn-block${shape === 'pill' ? ' btn-pill' : ''}`} onClick={start} disabled={busy}>
        <GoogleMark /> {busy ? 'Opening Google…' : NATIVE_LABEL[text]}
      </button>
      {error && <div role="alert" style={noticeStyle}>{error}</div>}
    </div>
  );
}

/** Google "G" mark, white disc so the brand colours sit on the black button. */
function GoogleMark() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: '50%', background: '#fff', marginRight: 8,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    </span>
  );
}

function WebGoogleButton({ onCredential, text = 'continue_with', shape = 'rectangular', loginHint, width }: GoogleButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity()
      .then((gsi) => {
        if (cancelled || !ref.current) return;
        gsi.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r) => cb.current(r.credential),
          ux_mode: 'popup',
          ...(loginHint ? { login_hint: loginHint } : {}),
        });
        ref.current.replaceChildren();
        gsi.renderButton(ref.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape,
          text,
          width: width ?? Math.min(400, Math.max(200, ref.current.offsetWidth)),
        });
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => { cancelled = true; };
  }, [text, shape, loginHint, width]);

  if (loadError) return <div role="alert" style={noticeStyle}>{loadError}</div>;
  // colorScheme: Google's button iframe is a light document; on a dark page a
  // mismatched color-scheme paints an opaque white box around it.
  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center', minHeight: 44, colorScheme: 'light' }} />;
}
