import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { FieldError, validators } from '@lexdraft/ui';
import type { PortalSession } from '@lexdraft/types';
import { portalApi, portalErrorMessage } from '@/lib/portalApi';
import { usePortalAuthStore } from '@/store/portalAuth';

/**
 * Password sign-in for the read-only client portal.
 *
 * The firm admin shares a default password of the form `firstname@123` when
 * they enable portal access; this view exchanges that + the client's email
 * for a session JWT.
 */
export function PortalLoginView() {
  const navigate = useNavigate();
  const setSession = usePortalAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const emailError = emailTouched ? validators.email(email) : null;

  const signInMutation = useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      portalApi.post<PortalSession>('/auth/sign-in', vars),
    onSuccess: (data) => {
      setSession(data);
      navigate('/portal/dashboard', { replace: true });
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    setEmailTouched(true);
    if (!email || !password || validators.email(email)) return;
    signInMutation.mutate({ email, password });
  }

  return (
    <Shell eyebrow="Client portal" title="Sign in">
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.55 }}>
        Enter the email and password your advocate shared with you.
      </p>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label required" htmlFor="portal-email">Email</label>
          <input
            id="portal-email"
            className="input"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setEmailTouched(true)}
            placeholder="you@example.com"
            autoComplete="email"
            aria-invalid={!!emailError}
            aria-describedby={emailError ? 'portal-email-error' : undefined}
          />
          <FieldError id="portal-email-error" error={emailError} />
        </div>
        <div>
          <label className="label required" htmlFor="portal-password">Password</label>
          <input
            id="portal-password"
            className="input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="firstname@123"
            autoComplete="current-password"
          />
        </div>
        {signInMutation.isError && (
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
            {portalErrorMessage(signInMutation.error, 'Email or password is incorrect.')}
          </div>
        )}
        <button
          type="submit"
          disabled={signInMutation.isPending}
          className="btn btn-primary btn-lg btn-block"
        >
          {signInMutation.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Shell>
  );
}

// ---- Shell -------------------------------------------------------------

interface ShellProps {
  eyebrow: string;
  title: string;
  children: ReactNode;
}

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(20px, 4vw, 32px)',
  gap: 24,
  background:
    'radial-gradient(ellipse 80% 60% at 50% 50%, var(--bg-surface) 0%, var(--bg-base) 70%)',
  fontFamily: 'var(--font-sans)',
};

const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: 440,
  padding: 'clamp(28px, 5vw, 40px)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-xl)',
  boxShadow: 'var(--shadow-popover)',
};

function Shell({ eyebrow, title, children }: ShellProps) {
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {/* Brand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 24 }}>
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
              fontSize: 22,
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
              marginTop: -4,
            }}
          >
            {eyebrow}
          </div>
        </div>

        <h1
          className="display"
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            marginBottom: 8,
            textAlign: 'left',
          }}
        >
          {title}
        </h1>
        {children}
      </div>

      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          textAlign: 'center',
          maxWidth: 440,
          lineHeight: 1.8,
        }}
      >
        Secure client portal · DPDP Act 2023 · Indian-server data residency
      </div>
    </div>
  );
}
