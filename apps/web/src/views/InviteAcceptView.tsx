import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@lexdraft/ui';
import type { AuthResponse, InvitationPublic } from '@lexdraft/types';
import {
  useAcceptInvitation,
  useInvitationByToken,
  useInviteEmailAccept,
  useInviteEmailStart,
  useJoinInvitation,
} from '@/hooks/useInvitations';
import { useExportMyData } from '@/hooks/useDpdp';
import { GoogleWhatsAppVerify, type VerifiedGoogleSignup } from '@/components/GoogleWhatsAppVerify';
import { NewPasswordField } from '@/components/NewPasswordField';
import { passwordProblem } from '@/lib/password';
import { FOREIGN_NUMBER_MESSAGE, isIndianMobile, readIndianMobile } from '@/lib/indian-phone';
import { isMfaChallenge, type SignInResult } from '@/lib/auth-types';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';

// Team join, Teams-style (features/team-join.md). The invitee joins with
// Google, or with email + WhatsApp code + password; someone who already has a
// DifAi account signs in and confirms "Join", which moves the account here.

export function InviteAcceptView() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const clear = useAuthStore((s) => s.clear);
  const showToast = useUIStore((s) => s.showToast);
  const { data, isLoading, isError, error } = useInvitationByToken(token);
  const [mode, setMode] = useState<'google' | 'email'>('google');

  const joined = (auth: AuthResponse) => {
    qc.clear();
    setSession(auth.user, auth.token);
    showToast({ type: 'sage', text: `Welcome to ${auth.user.firm ?? 'the firm'}, ${auth.user.name.split(' ')[0]}` });
    navigate('/app/dashboard', { replace: true });
  };
  const signInPath = `/auth?next=${encodeURIComponent(`/invite/${token}`)}`;

  let body: ReactNode = null;
  if (data && user && user.email.toLowerCase() === data.email.toLowerCase()) {
    body = <JoinExisting token={token} invite={data} onJoined={joined} />;
  } else if (data && user) {
    body = (
      <div className="col" style={{ gap: 12 }}>
        <p className="body-md">
          You&rsquo;re signed in as <span className="mono">{user.email}</span>, but this invitation is for{' '}
          <span className="mono">{data.email}</span>.
        </p>
        <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => { qc.clear(); clear(); }}>
          Sign out and continue as {data.email}
        </button>
      </div>
    );
  } else if (data) {
    body = (
      <>
        <div className="row" role="tablist" aria-label="How to join" style={{ gap: 8 }}>
          <button type="button" role="tab" aria-selected={mode === 'google'} className={`chip ${mode === 'google' ? 'active' : ''}`} onClick={() => setMode('google')}>
            Join with Google
          </button>
          <button type="button" role="tab" aria-selected={mode === 'email'} className={`chip ${mode === 'email' ? 'active' : ''}`} onClick={() => setMode('email')}>
            Join with email
          </button>
        </div>
        {mode === 'google'
          ? <GoogleJoin token={token} invite={data} onJoined={joined} onSignedIn={(r) => { if (isMfaChallenge(r)) navigate(signInPath); }} />
          : <EmailJoin token={token} invite={data} onJoined={joined} />}
        <p className="body-sm muted" style={{ margin: 0 }}>
          Already have a DifAi account?{' '}
          <button type="button" className="auth-link" onClick={() => navigate(signInPath)}>Sign in to join</button>
        </p>
      </>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <div className="card" style={{ width: 'min(520px, 100%)', padding: 36, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <span aria-hidden style={{ width: 32, height: 32, background: 'var(--text-primary)', borderRadius: 'var(--radius-sm)', display: 'inline-block', flexShrink: 0 }} />
          <div>
            <div className="eyebrow">DifAi</div>
            <div className="heading-md" style={{ marginTop: 2 }}>You&rsquo;ve been invited</div>
          </div>
        </div>

        {isLoading && <div className="body-md muted">Verifying invitation<span className="blink" /></div>}

        {isError && (
          <div className="col" style={{ gap: 14 }}>
            <Alert>{(error as Error | null)?.message ?? 'This invitation is no longer valid.'}</Alert>
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/auth')}>Go to sign in</button>
          </div>
        )}

        {data && (
          <>
            <div className="card-cream" style={{ padding: 18 }}>
              <div className="row" style={{ marginBottom: 8, gap: 10 }}>
                <span className="eyebrow">{data.firm}</span>
                <span className="spacer" />
                <span className="badge badge-cobalt">{data.role}</span>
              </div>
              <div className="body-md">
                <strong>{data.invitedBy}</strong> has invited <span className="mono">{data.email}</span> to join {data.firm}.
              </div>
              {data.message && (
                <p className="body-sm" style={{ marginTop: 10, paddingLeft: 12, borderLeft: '2px solid var(--border-default)', color: 'var(--text-secondary)' }}>
                  &ldquo;{data.message}&rdquo;
                </p>
              )}
            </div>
            {body}
            <div className="body-sm muted" style={{ textAlign: 'center', marginTop: 4 }}>
              By accepting you agree to DifAi&rsquo;s terms of service and privacy policy.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type JoinProps = { token: string; invite: InvitationPublic; onJoined: (auth: AuthResponse) => void };

function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="row" style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)', color: 'var(--danger)', gap: 10, fontSize: 13 }}>
      <Icon name="flag" size={14} />
      <span>{children}</span>
    </div>
  );
}

/** Signed in as the invited email: confirm moving this account into the firm. */
function JoinExisting({ token, invite, onJoined }: JoinProps) {
  const join = useJoinInvitation();
  const exportData = useExportMyData();
  return (
    <div className="col" style={{ gap: 14 }}>
      <p className="body-md" style={{ margin: 0 }}>
        Join <strong>{invite.firm}</strong> as <strong>{invite.role}</strong> with your DifAi account.
      </p>
      <ul className="body-sm" style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        <li>Your account moves to {invite.firm}. You&rsquo;ll work in their matters, with their plan.</li>
        <li>Your current matters, drafts and clients stay in your old workspace. They are not deleted and {invite.firm} can&rsquo;t see them, but you won&rsquo;t see them here.</li>
        <li>Unused days on your current plan are not refunded automatically.</li>
      </ul>
      <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} disabled={exportData.isPending} onClick={() => exportData.mutate()}>
        {exportData.isPending ? 'Preparing…' : 'Download my data first'}
      </button>
      {join.isError && <Alert>{join.error.message}</Alert>}
      <button type="button" className="btn btn-primary btn-lg" disabled={join.isPending} onClick={() => join.mutate(token, { onSuccess: onJoined })}>
        {join.isPending ? 'Joining…' : `Join ${invite.firm}`}
      </button>
    </div>
  );
}

/** Google + WhatsApp code, then name + password (unchanged flow). */
function GoogleJoin({ token, invite, onJoined, onSignedIn }: JoinProps & { onSignedIn: (r: SignInResult) => void }) {
  const accept = useAcceptInvitation();
  const [verified, setVerified] = useState<VerifiedGoogleSignup | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  if (!verified) {
    // An existing Google account signs in here; the page then shows "Join".
    return (
      <GoogleWhatsAppVerify
        expectedEmail={invite.email}
        onSignedIn={onSignedIn}
        onVerified={(v) => { setVerified(v); setName(v.profile.name); }}
      />
    );
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || passwordProblem(password)) return;
    accept.mutate({ token, body: { name: name.trim(), signupToken: verified.signupToken, password } }, { onSuccess: onJoined });
  };
  return (
    <form onSubmit={submit} className="col" style={{ gap: 14 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        {verified.profile.email} · WhatsApp {verified.phone} verified
      </div>
      <div>
        <label className="label" htmlFor="invite-name">Your full name</label>
        <input id="invite-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </div>
      <NewPasswordField id="invite-password" value={password} onChange={setPassword} />
      {accept.isError && <Alert>{(accept.error as Error).message}</Alert>}
      <button type="submit" className="btn btn-primary btn-lg" disabled={accept.isPending || !name.trim() || !!passwordProblem(password)}>
        {accept.isPending ? 'Joining…' : `Accept and join ${invite.firm}`}
      </button>
    </form>
  );
}

/** No Google: name + WhatsApp + password, then the WhatsApp code. The email
 *  is the invite's own and can't be changed. */
function EmailJoin({ token, invite, onJoined }: JoinProps) {
  const start = useInviteEmailStart();
  const accept = useInviteEmailAccept();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneForeign, setPhoneForeign] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{ signupToken: string; challengeId: string; phone: string } | null>(null);
  const phoneProblem = phoneForeign ? FOREIGN_NUMBER_MESSAGE : phone && !isIndianMobile(phone) ? 'Enter a 10-digit Indian WhatsApp number' : null;

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim() || !isIndianMobile(phone) || passwordProblem(password)) return;
    start.mutate({ token, body: { name: name.trim(), phone } }, { onSuccess: (r) => { setChallenge(r); setCode(''); } });
  };
  const finish = (e: FormEvent) => {
    e.preventDefault();
    if (!challenge || code.length !== 6) return;
    accept.mutate({ token, body: { signupToken: challenge.signupToken, challengeId: challenge.challengeId, code, password } }, { onSuccess: onJoined });
  };

  if (challenge) {
    return (
      <form onSubmit={finish} className="col" style={{ gap: 14 }}>
        <p className="body-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Enter the 6-digit code we sent on WhatsApp to <strong className="mono">{challenge.phone}</strong>.
        </p>
        <div>
          <label className="label" htmlFor="invite-code">Verification code</label>
          <input id="invite-code" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ letterSpacing: '0.3em' }} />
        </div>
        {accept.isError && <Alert>{accept.error.message}</Alert>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={accept.isPending || code.length !== 6}>
          {accept.isPending ? 'Joining…' : `Join ${invite.firm}`}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setChallenge(null); accept.reset(); }}>
          Change details
        </button>
      </form>
    );
  }
  return (
    <form onSubmit={send} className="col" style={{ gap: 14 }}>
      <div>
        <label className="label" htmlFor="invite-email">Email</label>
        <input id="invite-email" className="input mono" value={invite.email} readOnly aria-readonly />
      </div>
      <div>
        <label className="label" htmlFor="invite-email-name">Your full name</label>
        <input id="invite-email-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </div>
      <div>
        <label className="label" htmlFor="invite-phone">WhatsApp number</label>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="mono" aria-hidden>+91</span>
          <input id="invite-phone" className="input" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98765 43210" required
            value={phone} aria-invalid={!!phoneProblem}
            onChange={(e) => { const r = readIndianMobile(e.target.value); setPhone(r.digits); setPhoneForeign(r.foreign); }} />
        </div>
        {phoneProblem && <span role="alert" className="auth-field-error">{phoneProblem}</span>}
      </div>
      <NewPasswordField id="invite-email-password" value={password} onChange={setPassword} />
      {start.isError && <Alert>{start.error.message}</Alert>}
      <button type="submit" className="btn btn-primary btn-lg" disabled={start.isPending || !name.trim() || !isIndianMobile(phone) || !!passwordProblem(password)}>
        {start.isPending ? 'Sending…' : 'Send code on WhatsApp'}
      </button>
    </form>
  );
}
