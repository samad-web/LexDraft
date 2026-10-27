import { useEffect, useRef, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import {
  useStartEfilingSession,
  useSubmitEfilingCredentials,
  useRefreshEfilingCaptcha,
  useSubmitEfilingLoginCaptcha,
  useConfirmDuplicateEfilingLogin,
  useEndEfilingSession,
  useEfilingPortalStates,
  type EfilingUserType,
} from '@/hooks/useEfiling';
import { errMsg } from './format';

// =============================================================================
// PortalLoginPanel — signs the advocate in to filing.ecourts.gov.in through a
// server-side browser session (efiling-live.service.ts). Login + CAPTCHA are
// real; the post-login filing form isn't driven from here yet (its selectors
// need a real advocate session to capture - docs/efiling-selector-capture-
// todo.md), so once signed in the advocate files on the portal and records
// the result in the Filings tab.
//
// The portal allows ONE active session per account: a DifAI session left
// open would lock the advocate out of their own browser, so it is closed on
// "Sign out" and whenever this panel unmounts.
// =============================================================================

type Step = 'form' | 'captcha' | 'duplicate-login' | 'authenticated';

const USER_TYPES: { value: EfilingUserType; label: string }[] = [
  { value: 'advocate', label: 'Advocate' },
  { value: 'litigant', label: 'Litigant' },
  { value: 'pleader', label: 'Government Pleader' },
  { value: 'clerk', label: 'Clerk' },
  // Portal radio #user_gov_auth (value 7) is labelled "Court Nominated
  // Officials" on the login form; "Govt. Authority" only exists on Forgot Password.
  { value: 'gov_auth', label: 'Court Nominated Official' },
  { value: 'insurance', label: 'Institutional Litigant' },
];

export function PortalLoginPanel() {
  // The portal's own 30-state list, not eCourts' - a state eCourts has but
  // eFiling doesn't would fail inside the portal with a misleading error.
  const { data: states, isLoading: statesLoading } = useEfilingPortalStates();

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
  const endSession = useEndEfilingSession();

  // Close the server-side session when the panel goes away.
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = sessionId;
  const endRef = useRef(endSession.mutate);
  endRef.current = endSession.mutate;
  useEffect(() => () => {
    if (sessionRef.current) endRef.current(sessionRef.current);
  }, []);

  const reset = () => {
    if (sessionId) endSession.mutate(sessionId);
    setSessionId(null);
    setCaptchaImage(null);
    setCaptchaCode('');
    setCaptchaError(null);
    setPassword('');
    setStep('form');
  };

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
        setCaptchaImage(result.captchaImageBase64);
        setCaptchaCode('');
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
    <div className="col" style={{ gap: 16, maxWidth: 560 }}>
      <p className="body-sm muted">
        eCourts allows one active eFiling session per account. Signing in here signs you out of eFiling in your own browser,
        and signing out here (or leaving this page) frees it again.
      </p>

      {step === 'form' ? (
        <div className="col" style={{ gap: 12, padding: 16, background: 'var(--bg-subtle)', borderRadius: 8 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="body-sm muted">State</span>
            <select className="input" value={stateCode} onChange={(e) => setStateCode(e.target.value)} disabled={statesLoading}>
              <option value="">{statesLoading ? 'Loading states…' : 'Select state'}</option>
              {states?.map((s) => (
                <option key={s.code} value={String(s.code)}>{s.name}</option>
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

          <p className="body-sm muted">Your credentials are sent straight to filing.ecourts.gov.in to open your own session. DifAI doesn't store them.</p>

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

      {(step === 'captcha' || step === 'duplicate-login') && captchaImage ? (
        <div className="col" style={{ gap: 8, padding: 16, background: 'var(--bg-subtle)', borderRadius: 8 }}>
          {step === 'duplicate-login' ? (
            <>
              <p className="body-sm">You're already signed in to eFiling somewhere else. eCourts only allows one active session per account.</p>
              <span className="body-sm muted">Enter the code below to sign out the other session and continue here.</span>
            </>
          ) : (
            <span className="body-sm muted">Enter the code you see. The eFiling portal requires it to sign in.</span>
          )}
          <img
            src={`data:image/png;base64,${captchaImage}`}
            alt="eFiling captcha"
            style={{ border: '1px solid var(--border-default)', borderRadius: 4, width: 150 }}
          />
          {captchaError ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{captchaError}</p> : null}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ maxWidth: 160 }}
              placeholder="Captcha code"
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              autoFocus
            />
            {step === 'captcha' ? (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { void handleSubmitCaptcha(); }} disabled={submitLoginCaptcha.isPending || !captchaCode}>
                  {submitLoginCaptcha.isPending ? 'Submitting…' : 'Submit'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void handleRefresh(); }} disabled={refreshCaptcha.isPending}>
                  New image
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => { void handleConfirmDuplicateLogin(); }}
                disabled={confirmDuplicateLogin.isPending || !captchaCode}
              >
                {confirmDuplicateLogin.isPending ? 'Confirming…' : 'Log out other session & continue'}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>Cancel</button>
          </div>
          {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
        </div>
      ) : null}

      {step === 'authenticated' ? (
        <div className="col" style={{ gap: 8, padding: 16, background: 'var(--bg-subtle)', borderRadius: 8 }}>
          <p className="body-sm">You're signed in to eFiling.</p>
          <p className="body-sm muted">
            Complete the filing on the portal (Case Filing → New Case Filing), using the particulars and bundle prepared in the
            Filings tab. Then record the eFiling number there. DifAI tracks it and connects the case to eCourts once it is registered.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={endSession.isPending}>
              Sign out of eFiling
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
