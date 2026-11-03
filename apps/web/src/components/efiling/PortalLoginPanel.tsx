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
import { PortalButton, PortalInput, PortalSelect, Star } from './PortalForm';

// =============================================================================
// PortalLoginPanel - the eFiling portal's own Sign In (filing.ecourts.gov.in/
// pdedev/), in DifAi's black and white, working over a server-side browser
// session on the real login page (efiling-live.service.ts):
//
//   Sign In / Fields marked with * are mandatory.
//   *Select State   ○ Advocate ○ Litigant ○ Govt. Pleader ○ Clerk
//   *Username (Username is not case sensitive)
//   *Password (Password is case sensitive)   ☐ Show Password
//   [captcha] 🔊 ⟳ [code]      (Login) (Reset)
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

const label: React.CSSProperties = { fontWeight: 700, fontSize: 16 };
const hint: React.CSSProperties = { fontWeight: 400, fontStyle: 'italic' };

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
    <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ width: 112, height: 42, border: '1px solid var(--border-default)', background: '#ffffff', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {captchaImage
          ? <img src={`data:image/png;base64,${captchaImage}`} alt="eFiling captcha" style={{ width: 112, height: 40, objectFit: 'contain' }} />
          : <span className="body-sm muted">{loadingCaptcha ? 'Loading…' : ''}</span>}
      </span>
      <button type="button" aria-label="Play captcha audio" title="Play captcha audio" onClick={() => { void playCaptcha(); }} disabled={!captchaImage || loadingCaptcha}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 22, padding: '0 4px', color: 'var(--text-primary)' }}>🔊</button>
      <button type="button" aria-label="Refresh captcha" title="Refresh captcha" onClick={() => { void newCaptcha(); }} disabled={loadingCaptcha || busy}
        style={{ width: 40, height: 40, border: '1px solid var(--border-default)', background: 'var(--bg-surface)', borderRadius: 4, cursor: 'pointer', fontSize: 18, color: 'var(--text-primary)' }}>⟳</button>
      <PortalInput aria-label="Captcha code" placeholder="Captcha code" value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void (step === 'duplicate-login' ? confirmDuplicate() : logIn()); }}
        style={{ width: 180, height: 40 }} autoComplete="off" />
    </div>
  );

  if (step === 'authenticated') {
    return (
      <div className="col" style={{ gap: 8, padding: 16, background: 'var(--bg-surface-2)', borderRadius: 8, maxWidth: 560 }}>
        <p className="body-sm">Connected to eFiling{connection?.username ? ` as ${connection.username}` : ''}{connection?.stateName ? ` · ${connection.stateName}` : ''}.</p>
        <p className="body-sm muted">Every eFiling screen in DifAi works over this session while you work here.</p>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logOut} disabled={endSession.isPending}>Log out of eFiling</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(0, 2fr)', border: '1px solid var(--border-default)' }}>
      <section className="col" aria-label="Sign In" style={{ gap: 12, padding: '18px 28px 24px', background: 'var(--bg-surface-2)' }}>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>Sign In</h2>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Fields marked with * are mandatory.</p>

        {step === 'duplicate-login' ? (
          <div className="col" style={{ gap: 10 }}>
            <p className="body-sm" role="alert">{message || 'User already login.'}</p>
            <p className="body-sm">Enter the code below to log out the other session and continue here.</p>
            {captchaRow}
            <span className="row" style={{ gap: 8, justifyContent: 'center' }}>
              <PortalButton onClick={() => { void confirmDuplicate(); }} disabled={busy || !captchaCode}>{confirmDuplicateLogin.isPending ? 'Logging in…' : 'Logout and Login'}</PortalButton>
              <PortalButton outline onClick={logOut}>Cancel</PortalButton>
            </span>
          </div>
        ) : (
          <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void logIn(); }} autoComplete="off">
            <label className="col" style={{ gap: 6 }}>
              <span style={label}><Star />Select State</span>
              <PortalSelect aria-label="Select State" value={stateCode} onChange={(e) => setStateCode(e.target.value)} disabled={statesLoading} style={{ height: 40, maxWidth: 320 }}>
                <option value="">{statesLoading ? 'Loading…' : 'Select State'}</option>
                {states?.map((s) => <option key={s.code} value={String(s.code)}>{s.name}</option>)}
              </PortalSelect>
            </label>
            <span className="row" role="radiogroup" aria-label="User type" style={{ gap: 16, flexWrap: 'wrap' }}>
              {USER_TYPES.map((t) => (
                <label key={t.value} className="row" style={{ gap: 6, alignItems: 'center', fontWeight: 700, fontSize: 16 }}>
                  <input type="radio" name="efiling-user-type" checked={userType === t.value} onChange={() => setUserType(t.value)} /> {t.label}
                </label>
              ))}
            </span>
            <label className="col" style={{ gap: 6 }}>
              <span style={label}><Star />Username <span style={hint}>(Username is not case sensitive)</span></span>
              <PortalInput aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} name="efiling-portal-username" autoComplete="off" style={{ height: 40, maxWidth: 320 }} />
            </label>
            <label className="col" style={{ gap: 6 }}>
              <span style={label}><Star />Password <span style={hint}>(Password is case sensitive)</span></span>
              <PortalInput aria-label="Password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                name="efiling-portal-password" autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" style={{ height: 40, maxWidth: 320 }} />
            </label>
            <label className="row" style={{ gap: 8, alignItems: 'center', fontSize: 16 }}>
              <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} style={{ width: 20, height: 20 }} /> Show Password
            </label>
            {captchaRow}
            {message ? <p className="body-sm" role="alert" style={{ margin: 0, fontWeight: 700 }}>{message}</p> : null}
            <span className="row" style={{ gap: 6, justifyContent: 'center' }}>
              <PortalButton type="submit" disabled={busy}>{submitLogin.isPending ? 'Logging in…' : 'Login'}</PortalButton>
              <PortalButton onClick={resetForm} disabled={busy}>Reset</PortalButton>
            </span>
            <span className="col" style={{ gap: 6, alignItems: 'center' }}>
              <a href={`${PORTAL}?p=registration`} target="_blank" rel="noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}>New User ? Register here</a>
              <a href={PORTAL} target="_blank" rel="noreferrer" title="Opens filing.ecourts.gov.in, where Forgot Password is" style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}>Forgot Password</a>
            </span>
          </form>
        )}
      </section>
      <section className="col" aria-label="About e-Filing" style={{ gap: 12, padding: '18px 28px' }}>
        <h2 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>About e-Filing</h2>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.7, textAlign: 'justify' }}>
          e-Filing system is a complete end to end solution developed for online filing of plaints, written statements, replies and
          various applications related to cases. Both Civil and Criminal cases can be filed before any High Court or District Court of
          the country. It is designed in Bilingual (English and local language) to reach wider group covering advocates/litigants.
        </p>
        <h2 style={{ margin: '12px 0 0', fontSize: 30, fontWeight: 700 }}>e-Filing system provides several benefits</h2>
        <ul style={{ margin: 0, paddingLeft: 22, fontSize: 16, lineHeight: 1.8, listStyle: 'disc' }}>
          <li>Save time, money, travel of advocates and clients</li>
          <li>Obviate the need to physically visit the court</li>
          <li>Reduce the need of meetings between clients and advocates</li>
          <li>Automatic digitization of case records</li>
          <li>Positive impact on environment by reducing paper footprint</li>
        </ul>
        <p className="body-sm muted" style={{ marginTop: 'auto' }}>
          Your username and password go straight to filing.ecourts.gov.in to open your own session; DifAi doesn't store them.
          The portal allows one login per account, so logging in here ends your eFiling login elsewhere.
        </p>
      </section>
    </div>
  );
}
