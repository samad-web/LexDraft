import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import {
  useStartEfilingSession,
  useSubmitEfilingCredentials,
  useRefreshEfilingCaptcha,
  useSubmitEfilingLoginCaptcha,
  useConfirmDuplicateEfilingLogin,
  type EfilingUserType,
} from '@/hooks/useEfiling';
import { useEcourtsStates } from '@/hooks/useEcourts';

// =============================================================================
// EfilingView — the National e-Filing portal (filing.ecourts.gov.in) gateway.
// Mirrors EcourtsView's LiveBusinessInline state-machine shape (idle ->
// captcha -> result), extended with a login step before the captcha step,
// since e-filing's CAPTCHA sits behind state/user-type/credentials rather
// than being reachable directly like the CNR lookup.
//
// SCOPE: login + CAPTCHA are real, driven by a Playwright session on the
// backend (see efiling-live.service.ts). Once authenticated, filing itself
// (case selection, document upload, submit) isn't wired up yet - the portal's
// post-login screens require a real advocate login to capture their actual
// form fields, which nobody on this project currently holds. That step is
// surfaced here honestly as "Coming next" rather than a broken button.
// =============================================================================

type Step = 'form' | 'captcha' | 'duplicate-login' | 'authenticated';

const USER_TYPES: { value: EfilingUserType; label: string }[] = [
  { value: 'advocate', label: 'Advocate' },
  { value: 'litigant', label: 'Litigant' },
  { value: 'pleader', label: 'Government Pleader' },
  { value: 'clerk', label: 'Court Nominated Official / Clerk' },
  { value: 'gov_auth', label: 'Government Authority' },
  { value: 'insurance', label: 'Institutional Litigant' },
];

export function EfilingView() {
  const { data: states, isLoading: statesLoading } = useEcourtsStates();

  const [stateCode, setStateCode] = useState('');
  const [userType, setUserType] = useState<EfilingUserType>('advocate');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [step, setStep] = useState<Step>('form');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startSession = useStartEfilingSession();
  const submitCredentials = useSubmitEfilingCredentials();
  const refreshCaptcha = useRefreshEfilingCaptcha();
  const submitLoginCaptcha = useSubmitEfilingLoginCaptcha();
  const confirmDuplicateLogin = useConfirmDuplicateEfilingLogin();

  const handleConnect = async () => {
    setError(null);
    if (!stateCode || !username || !password) {
      setError('Select a state and enter your eFiling username and password.');
      return;
    }
    try {
      const { sessionId: id } = await startSession.mutateAsync({ state: stateCode, userType });
      const { captchaImageBase64, sessionId: finalId } = await submitCredentials.mutateAsync({ sessionId: id, username, password });
      setSessionId(finalId);
      setCaptchaImage(captchaImageBase64);
      setStep('captcha');
    } catch (err) {
      setError(errMsg(err, 'Could not reach the eFiling portal right now. Try again in a few minutes.'));
    }
  };

  const handleRefresh = async () => {
    if (!sessionId) return;
    try {
      const { captchaImageBase64 } = await refreshCaptcha.mutateAsync(sessionId);
      setCaptchaImage(captchaImageBase64);
      setCaptchaCode('');
      setCaptchaError(null);
    } catch (err) {
      setError(errMsg(err, 'Could not refresh the captcha'));
    }
  };

  const handleSubmitCaptcha = async () => {
    if (!sessionId) return;
    setCaptchaError(null);
    try {
      const result = await submitLoginCaptcha.mutateAsync({ sessionId, captchaCode });
      if ('duplicateLogin' in result) {
        // Correct credentials, but eCourts only allows one active session
        // per advocate account - the portal needs the password re-entered
        // (a separate form) to confirm logging out the other session.
        setCaptchaImage(result.captchaImageBase64);
        setCaptchaCode('');
        setCaptchaError(null);
        setStep('duplicate-login');
        return;
      }
      if ('retry' in result) {
        setCaptchaImage(result.captchaImageBase64);
        setCaptchaCode('');
        setCaptchaError(result.reason);
        return;
      }
      setStep('authenticated');
    } catch (err) {
      setError(errMsg(err, 'Could not submit the captcha'));
    }
  };

  const handleConfirmDuplicateLogin = async () => {
    if (!sessionId) return;
    setCaptchaError(null);
    try {
      const result = await confirmDuplicateLogin.mutateAsync({ sessionId, password, captchaCode });
      if ('retry' in result) {
        setCaptchaImage(result.captchaImageBase64);
        setCaptchaCode('');
        setCaptchaError(result.reason);
        return;
      }
      setStep('authenticated');
    } catch (err) {
      setError(errMsg(err, 'Could not confirm the logout'));
    }
  };

  return (
    <div className="col" style={{ gap: 20, maxWidth: 560 }}>
      <div className="col" style={{ gap: 4 }}>
        <h1 className="h3">eFiling (eCourts)</h1>
        <p className="body-sm muted">Log in to the National e-Filing portal without leaving LexDraft.</p>
      </div>

      {step === 'form' ? (
        <div className="col" style={{ gap: 12, padding: 16, background: 'var(--bg-subtle)', borderRadius: 8 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">State</span>
            <select className="input" value={stateCode} onChange={(e) => setStateCode(e.target.value)} disabled={statesLoading}>
              <option value="">Select state</option>
              {states?.map((s) => (
                <option key={s.state_code} value={String(s.state_code)}>{s.state_name}</option>
              ))}
            </select>
          </label>

          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">User type</span>
            <select className="input" value={userType} onChange={(e) => setUserType(e.target.value as EfilingUserType)}>
              {USER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">Bar Code / Email / Mobile / Unique Code</span>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>

          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">Password</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>

          <p className="body-sm muted">Your credentials are sent straight to filing.ecourts.gov.in to open your own session — LexDraft doesn't store them.</p>

          {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => { void handleConnect(); }}
            disabled={startSession.isPending || submitCredentials.isPending}
          >
            {startSession.isPending || submitCredentials.isPending ? 'Connecting…' : <><Icon name="eye" size={12} /> Log in to eFiling</>}
          </button>
        </div>
      ) : null}

      {step === 'captcha' && captchaImage ? (
        <div className="col" style={{ gap: 8, padding: 16, background: 'var(--bg-subtle)', borderRadius: 8 }}>
          <span className="body-sm muted">Enter the code you see — the eFiling portal requires this to sign in.</span>
          <img
            src={`data:image/png;base64,${captchaImage}`}
            alt="eFiling captcha"
            style={{ border: '1px solid var(--border-default)', borderRadius: 4, width: 150 }}
          />
          {captchaError ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{captchaError}</p> : null}
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ maxWidth: 160 }}
              placeholder="Captcha code"
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              autoFocus
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void handleSubmitCaptcha(); }} disabled={submitLoginCaptcha.isPending || !captchaCode}>
              {submitLoginCaptcha.isPending ? 'Submitting…' : 'Submit'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void handleRefresh(); }} disabled={refreshCaptcha.isPending}>
              New image
            </button>
          </div>
          {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
        </div>
      ) : null}

      {step === 'duplicate-login' && captchaImage ? (
        <div className="col" style={{ gap: 8, padding: 16, background: 'var(--bg-subtle)', borderRadius: 8 }}>
          <p className="body-sm">You're already signed in to eFiling somewhere else — eCourts only allows one active session per account.</p>
          <span className="body-sm muted">Confirm your password and the code below to sign out the other session and continue here.</span>
          <img
            src={`data:image/png;base64,${captchaImage}`}
            alt="eFiling captcha"
            style={{ border: '1px solid var(--border-default)', borderRadius: 4, width: 150 }}
          />
          {captchaError ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{captchaError}</p> : null}
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ maxWidth: 160 }}
              placeholder="Captcha code"
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { void handleConfirmDuplicateLogin(); }}
              disabled={confirmDuplicateLogin.isPending || !captchaCode}
            >
              {confirmDuplicateLogin.isPending ? 'Confirming…' : 'Log out other session & continue'}
            </button>
          </div>
          {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
        </div>
      ) : null}

      {step === 'authenticated' ? (
        <div className="col" style={{ gap: 8, padding: 16, background: 'var(--bg-subtle)', borderRadius: 8 }}>
          <p className="body-sm">You're signed in to eFiling.</p>
          <p className="body-sm muted">
            Filing a document from here — picking the case, uploading a LexDraft-generated PDF, and submitting — is coming next.
            That step needs a live advocate session to map the portal's actual filing form, which this build hasn't done yet.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? fallback;
}
