import { useEffect, useRef, useState } from 'react';
import {
  useStartEfilingSession,
  useRefreshEfilingCaptcha,
  useSubmitEfilingLogin,
  useConfirmDuplicateEfilingLogin,
  useEndEfilingSession,
  useEfilingPortalStates,
  fetchEfilingCaptchaAudio,
  type EfilingUserType,
} from '@/hooks/useEfiling';
import { errMsg } from './format';
import { useEfilingPortalStore } from '@/store/efilingPortal';

// =============================================================================
// PortalLoginPanel - the eFiling portal's own Sign In (filing.ecourts.gov.in/
// pdedev/), as a DifAi card, working over a server-side browser
// session on the real login page (efiling-live.service.ts):
//
//   Sign In / Fields marked with * are mandatory.
//   *Select State   ○ Advocate ○ Litigant ○ Govt. Pleader ○ Clerk
//   *Username (Username is not case sensitive)
//   *Password (Password is case sensitive)   ☐ Show Password
//   [captcha] Listen · New code [code]      (Reset) (Login)
//   New User ? Register here   Forgot Password
//
// As on the portal the captcha is there from the start, and Login sends state,
// user type, username, password and the code in one go. A valid login while
// the account is open elsewhere gets the portal's "log out other session"
// step. The portal allows ONE active session per account, so "Log out" logs
// out on the portal too (efiling-live closeSession).
// =============================================================================

type Step = 'form' | 'duplicate-login' | 'authenticated';

const LAST_LOGIN_KEY = 'difai.efiling.lastLogin';
const PORTAL = 'https://filing.ecourts.gov.in/pdedev/';

function readLastLogin(): { stateCode: string; userType: EfilingUserType; username: string } | null {
  try {
    const raw = localStorage.getItem(LAST_LOGIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// The four the portal's Sign In shows, in its order and with its labels.
const USER_TYPES: { value: EfilingUserType; label: string }[] = [
  { value: 'advocate', label: 'Advocate' },
  { value: 'litigant', label: 'Litigant' },
  { value: 'pleader', label: 'Govt. Pleader' },
  { value: 'clerk', label: 'Clerk' },
];


export function PortalLoginPanel({ onConnected }: { onConnected?: () => void } = {}) {
  const connection = useEfilingPortalStore((s) => s.connection);
  const connect = useEfilingPortalStore((s) => s.connect);
  const disconnect = useEfilingPortalStore((s) => s.disconnect);
  // The portal's own state list, not eCourts'.
  const { data: states, isLoading: statesLoading } = useEfilingPortalStates();

  // State, user type and username are remembered on this browser; the
  // password never is.
  const remembered = readLastLogin();
  const [stateCode, setStateCode] = useState(remembered?.stateCode ?? '');
  const [userType, setUserType] = useState<EfilingUserType>(remembered?.userType && USER_TYPES.some((t) => t.value === remembered.userType) ? remembered.userType : 'advocate');
  const [username, setUsername] = useState(remembered?.username ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [step, setStep] = useState<Step>(connection ? 'authenticated' : 'form');
  const [sessionId, setSessionId] = useState<string | null>(connection?.sessionId ?? null);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loadingCaptcha, setLoadingCaptcha] = useState(false);

  const startSession = useStartEfilingSession();
  const refreshCaptcha = useRefreshEfilingCaptcha();
  const submitLogin = useSubmitEfilingLogin();
  const confirmDuplicateLogin = useConfirmDuplicateEfilingLogin();
  const endSession = useEndEfilingSession();

  // A login abandoned half-way is closed when the panel goes away; a
  // connected session lives on for the other eFiling screens.
  const pendingRef = useRef<string | null>(null);
  pendingRef.current = step === 'authenticated' || (sessionId && connection?.sessionId === sessionId) ? null : sessionId;
  const endRef = useRef(endSession.mutate);
  endRef.current = endSession.mutate;
  useEffect(() => () => {
    if (pendingRef.current) endRef.current(pendingRef.current);
  }, []);

  // Open the portal's Sign In page and show its captcha, as the portal does on load.
  const opening = useRef(false);
  const openSignIn = async () => {
    if (opening.current) return;
    opening.current = true;
    setMessage(null);
    setLoadingCaptcha(true);
    try {
      const { sessionId: id } = await startSession.mutateAsync({ state: stateCode, userType });
      setSessionId(id);
      const { captchaImageBase64 } = await refreshCaptcha.mutateAsync(id);
      setCaptchaImage(captchaImageBase64);
      setCaptchaCode('');
    } catch (err) {
      setMessage(errMsg(err, 'Could not reach the eFiling portal right now. Try again in a few minutes.'));
    } finally {
      opening.current = false;
      setLoadingCaptcha(false);
    }
  };
  useEffect(() => {
    if (step === 'form' && !sessionId) void openSignIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per Sign In page
  }, [step, sessionId]);

  const connected = (id: string) => {
    // Hand the session over BEFORE the store update unmounts this panel.
    pendingRef.current = null;
    try { localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify({ stateCode, userType, username })); } catch { /* private window */ }
    connect({
      sessionId: id,
      username,
      stateName: states?.find((x) => String(x.code) === stateCode)?.name ?? '',
      connectedAt: new Date().toISOString(),
    });
    setPassword('');
    setStep('authenticated');
    onConnected?.();
  };

  const newCaptcha = async () => {
    if (!sessionId) return void openSignIn();
    setLoadingCaptcha(true);
    try {
      const { captchaImageBase64 } = await refreshCaptcha.mutateAsync(sessionId);
      setCaptchaImage(captchaImageBase64);
      setCaptchaCode('');
    } catch (err) {
      // The page went away (idle, restart): open a fresh Sign In.
      setSessionId(null);
      setMessage(errMsg(err, 'Could not refresh the captcha'));
    } finally {
      setLoadingCaptcha(false);
    }
  };

  const playCaptcha = async () => {
    if (!sessionId) return;
    try {
      const url = await fetchEfilingCaptchaAudio(sessionId);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch (err) {
      setMessage(errMsg(err, 'Could not play the captcha audio'));
    }
  };

  // The portal's Reset: clears what was typed.
  const resetForm = () => {
    setUsername('');
    setPassword('');
    setCaptchaCode('');
    setMessage(null);
  };

  const logIn = async () => {
    // The portal's own checks, with its wording.
    if (!stateCode) return setMessage('Please Select state');
    if (!username) return setMessage('Please enter username');
    if (!password) return setMessage('Please enter password');
    if (!captchaCode) return setMessage('Please enter captcha');
    if (!sessionId) return void openSignIn();
    setMessage(null);
    try {
      const result = await submitLogin.mutateAsync({ sessionId, state: stateCode, userType, username, password, captchaCode });
      if ('duplicateLogin' in result) {
        setCaptchaImage(result.captchaImageBase64);
        setCaptchaCode('');
        setMessage(result.reason);
        setStep('duplicate-login');
        return;
      }
      if ('retry' in result) {
        setCaptchaImage(result.captchaImageBase64);
        setCaptchaCode('');
        setMessage(result.reason);
        return;
      }
      connected(sessionId);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      // Sign In page gone (idle timeout, API restart): start a fresh one.
      if (status === 404 || status === 410) { setSessionId(null); setCaptchaImage(null); }
      setMessage(errMsg(err, 'Could not log in to eFiling'));
    }
  };

  const confirmDuplicate = async () => {
    if (!sessionId) return;
    setMessage(null);
    try {
      const result = await confirmDuplicateLogin.mutateAsync({ sessionId, password, captchaCode });
      if ('retry' in result) {
        setCaptchaImage(result.captchaImageBase64);
        setCaptchaCode('');
        setMessage(result.reason);
        return;
      }
      connected(sessionId);
    } catch (err) {
      setMessage(errMsg(err, 'Could not confirm the logout'));
    }
  };

  const logOut = () => {
    if (sessionId) endSession.mutate(sessionId);
    if (connection) disconnect();
    setSessionId(null);
    setCaptchaImage(null);
    setCaptchaCode('');
    setMessage(null);
    setPassword('');
    setStep('form');
  };

  // Login waits only for itself; the captcha loads on its own.
  const busy = submitLogin.isPending || confirmDuplicateLogin.isPending;

  const captchaRow = (
    <div className="col" style={{ gap: 8 }}>
     <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <span style={{ flexShrink: 0, width: 120, height: 44, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', background: '#ffffff', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {captchaImage
          ? <img src={`data:image/png;base64,${captchaImage}`} alt="eFiling captcha" style={{ width: 116, height: 40, objectFit: 'contain' }} />
          : <span className="body-sm muted">{loadingCaptcha ? 'Loading…' : ''}</span>}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Play captcha audio" title="Hear the code" onClick={() => { void playCaptcha(); }} disabled={!captchaImage || loadingCaptcha}>
        Listen
      </button>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Refresh captcha" title="New code" onClick={() => { void newCaptcha(); }} disabled={loadingCaptcha || busy}>
        New code
      </button>
     </div>
      <input className="input" aria-label="Captcha code" placeholder="Captcha code" value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void (step === 'duplicate-login' ? confirmDuplicate() : logIn()); }}
        autoComplete="off" />
    </div>
  );

  if (step === 'authenticated') {
    return (
      <div className="card col" style={{ gap: 8, maxWidth: 560 }}>
        <p className="body-sm">Connected to eFiling{connection?.username ? ` as ${connection.username}` : ''}{connection?.stateName ? ` · ${connection.stateName}` : ''}.</p>
        <p className="body-sm muted">Every eFiling screen in DifAi works over this session while you work here.</p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={logOut} disabled={endSession.isPending}>Log out of eFiling</button>
        </div>
      </div>
    );
  }

  return (
    <section className="card col" aria-label="Sign In" style={{ gap: 18, width: '100%', maxWidth: 520, margin: '0 auto', padding: 'clamp(16px, 5vw, 28px)' }}>
      <div className="col" style={{ gap: 4 }}>
        <h2 style={{ margin: 0, fontFamily: 'var(--font-title)', fontSize: 26, fontWeight: 600 }}>Sign In</h2>
        <p className="body-sm muted" style={{ margin: 0 }}>Your filing.ecourts.gov.in account. Fields marked with * are mandatory.</p>
      </div>

      {step === 'duplicate-login' ? (
        <div className="col" style={{ gap: 12 }}>
          <p className="body-sm" role="alert">{message || 'User already login.'}</p>
          <p className="body-sm muted">This account is open somewhere else. Enter the new code to log that session out and continue here.</p>
          {captchaRow}
          <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={logOut}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void confirmDuplicate(); }} disabled={busy || !captchaCode}>
              {confirmDuplicateLogin.isPending ? 'Signing in…' : 'Log out other session and continue'}
            </button>
          </span>
        </div>
      ) : (
        <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); void logIn(); }} autoComplete="off">
          <label className="col" style={{ gap: 6 }}>
            <span className="field-label">State *</span>
            <select className="input" aria-label="Select State" value={stateCode} onChange={(e) => setStateCode(e.target.value)} disabled={statesLoading}>
              <option value="">{statesLoading ? 'Loading…' : 'Select State'}</option>
              {states?.map((s) => <option key={s.code} value={String(s.code)}>{s.name}</option>)}
            </select>
          </label>
          <div className="col" style={{ gap: 6 }}>
            <span className="field-label">Sign in as</span>
            <span className="row" role="radiogroup" aria-label="User type" style={{ gap: 6, flexWrap: 'wrap' }}>
              {USER_TYPES.map((t) => (
                <label key={t.value} className={`chip${userType === t.value ? ' chip-on' : ''}`} style={{ cursor: 'pointer', gap: 6, ...(userType === t.value ? { background: 'var(--bg-inverse)', color: 'var(--text-inverse)', borderColor: 'var(--bg-inverse)' } : {}) }}>
                  <input type="radio" name="efiling-user-type" checked={userType === t.value} onChange={() => setUserType(t.value)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} /> {t.label}
                </label>
              ))}
            </span>
          </div>
          <label className="col" style={{ gap: 6 }}>
            <span className="field-label">Username * <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(not case sensitive)</span></span>
            <input className="input" aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} name="efiling-portal-username" autoComplete="off" />
          </label>
          <label className="col" style={{ gap: 6 }}>
            <span className="field-label">Password * <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(case sensitive)</span></span>
            <input className="input" aria-label="Password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              name="efiling-portal-password" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" />
          </label>
          <label className="row body-sm" style={{ gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} /> Show Password
          </label>
          <div className="col" style={{ gap: 6 }}>
            <span className="field-label">Captcha *</span>
            {captchaRow}
          </div>
          {message ? <p className="body-sm" role="alert" style={{ margin: 0, fontWeight: 600 }}>{message}</p> : null}
          <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-sm" onClick={resetForm} disabled={busy}>Reset</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{submitLogin.isPending ? 'Signing in…' : 'Login'}</button>
          </span>
          <span className="row body-sm" style={{ gap: 16, justifyContent: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <a href={`${PORTAL}?p=registration`} target="_blank" rel="noreferrer">New User ? Register here ↗</a>
            <a href={PORTAL} target="_blank" rel="noreferrer" title="Opens filing.ecourts.gov.in, where Forgot Password is">Forgot Password ↗</a>
          </span>
          <p className="body-sm muted" style={{ margin: 0 }}>
            Your username and password go straight to filing.ecourts.gov.in; DifAi doesn't store them. The portal allows one login per account,
            so signing in here ends your eFiling login elsewhere.
          </p>
        </form>
      )}
    </section>
  );
}
