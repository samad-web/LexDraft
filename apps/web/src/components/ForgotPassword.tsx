import { useState, type FormEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import { useForgotPassword, useResetPassword } from '@/hooks/useAuth';
import { LogoMark } from '@/components/brand/Logo';
import { passwordProblem, PASSWORD_RULE } from '@/lib/password';

// Forgot password (features/forgot-password-whatsapp.md): work email -> code
// on the account's WhatsApp -> new password. The server answers the same for
// any email, so this screen never says whether an account exists.
export function ForgotPassword({ email: startEmail, onBack }: { email: string; onBack: (email: string) => void }) {
  const forgot = useForgotPassword();
  const reset = useResetPassword();
  const [email, setEmail] = useState(startEmail);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [pwTouched, setPwTouched] = useState(false);
  const pwProblem = pwTouched ? passwordProblem(password) : null;
  const linkButton = { background: 'none', border: 0, cursor: 'pointer', padding: 0 } as const;

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (!email.trim()) return;
    reset.reset();
    forgot.mutate({ email: email.trim() }, { onSuccess: (r) => { setChallengeId(r.challengeId); setCode(''); } });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setPwTouched(true);
    if (!challengeId || code.length !== 6 || passwordProblem(password)) return;
    reset.mutate({ challengeId, code, password });
  };
  const goBack = () => onBack(email.trim());

  const head = (sub: string) => (
    <div className="auth-signin-head">
      <span className="auth-signin-mark"><LogoMark size={44} title="" /></span>
      <h1 className="auth-title auth-title--long">Reset password</h1>
      <p className="auth-signin-sub">{sub}</p>
    </div>
  );

  if (reset.isSuccess) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {head('Your password is changed. Sign in with the new password.')}
        <div className="auth-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary btn-lg btn-pill auth-submit" onClick={goBack}>Sign in</button>
        </div>
      </div>
    );
  }

  if (!challengeId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {head('Enter your work email. We send a 6-digit code to the WhatsApp number on your account.')}
        <form onSubmit={send} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label className="auth-field">
            <Icon name="mail" size={16} />
            <input
              type="email" inputMode="email" autoComplete="username" placeholder="Work email" aria-label="Work email"
              required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {forgot.isError && <span role="alert" className="auth-field-error">{forgot.error.message}</span>}
          <div className="auth-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary btn-lg btn-pill auth-submit" disabled={forgot.isPending || !email.trim()}>
              {forgot.isPending ? 'Sending…' : 'Send code'}
            </button>
          </div>
        </form>
        <p className="auth-signin-foot">
          <button type="button" className="auth-link" onClick={goBack}>Back to sign in</button>
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {head(`If ${email.trim()} has a DifAi account, we sent a 6-digit code to its WhatsApp number.`)}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label className="auth-field">
          <Icon name="shield" size={16} />
          <input
            inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code" aria-label="Verification code"
            autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ letterSpacing: '0.3em' }}
          />
        </label>
        <label className="auth-field">
          <Icon name="key" size={16} />
          <input
            type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="New password" aria-label="New password"
            required value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => setPwTouched(true)} aria-invalid={!!pwProblem}
          />
          <button type="button" className="auth-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
          </button>
        </label>
        {pwProblem && <span role="alert" className="auth-field-error">{PASSWORD_RULE}.</span>}
        {reset.isError && <span role="alert" className="auth-field-error">{reset.error.message}</span>}
        {forgot.isError && <span role="alert" className="auth-field-error">{forgot.error.message}</span>}
        <div className="auth-actions">
          <button type="button" className="auth-forgot" style={linkButton} disabled={forgot.isPending} onClick={() => send()}>
            {forgot.isPending ? 'Sending…' : 'Send a new code'}
          </button>
          <button type="submit" className="btn btn-primary btn-lg btn-pill auth-submit" disabled={reset.isPending || code.length !== 6 || !password}>
            {reset.isPending ? 'Saving…' : 'Reset'}
          </button>
        </div>
      </form>
      <p className="auth-signin-foot">
        No code? Write to <a className="auth-link" href="mailto:support@sirahdigital.in?subject=Forgot%20password">support@sirahdigital.in</a>
        {' · '}
        <button type="button" className="auth-link" onClick={goBack}>Back to sign in</button>
      </p>
    </div>
  );
}
