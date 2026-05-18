import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { PortalRequestLinkResponse, PortalSession } from '@lexdraft/types';
import { portalApi, portalErrorMessage } from '@/lib/portalApi';
import { usePortalAuthStore } from '@/store/portalAuth';

/**
 * Magic-link sign-in for the read-only client portal. Two states:
 *  1. Enter email → POST /portal/auth/request-link
 *  2. "Check your email" - also surfaces the dev link when the API returns one.
 *
 * If the URL already contains `?token=…`, we short-circuit to verifyMutation
 * so an emailed link can boot the user straight into the dashboard.
 *
 * Visual treatment mirrors the advocate /auth page: centered elevated card
 * on a radial-wash background, brand stack at the top, trust strip below.
 */
export function PortalLoginView() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setSession = usePortalAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | undefined>(undefined);
  const [verifyError, setVerifyError] = useState<string | undefined>(undefined);

  const requestMutation = useMutation({
    mutationFn: (e: string) => portalApi.post<PortalRequestLinkResponse>('/auth/request-link', { email: e }),
    onSuccess: (data) => {
      setSent(true);
      setDevLink(data.devMagicLink);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (token: string) => portalApi.post<PortalSession>('/auth/verify', { token }),
    onSuccess: (data) => {
      setSession(data);
      navigate('/portal/dashboard', { replace: true });
    },
    onError: (err) => setVerifyError(portalErrorMessage(err, 'This link is no longer valid.')),
  });

  // If we land here with a ?token= query param (i.e. clicked the email link),
  // submit it for verification automatically.
  const tokenInUrl = params.get('token');
  if (tokenInUrl && verifyMutation.status === 'idle') {
    verifyMutation.mutate(tokenInUrl);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (!email) return;
    requestMutation.mutate(email);
  }

  if (tokenInUrl) {
    return (
      <Shell eyebrow="Client portal" title="Signing you in…">
        {verifyMutation.isPending && (
          <p className="muted" style={{ fontSize: 14 }}>Verifying your link.</p>
        )}
        {verifyError && (
          <>
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
              {verifyError}
            </div>
            <a
              href="/portal/login"
              className="btn btn-block btn-lg"
              style={{ textDecoration: 'none', marginTop: 12 }}
            >
              Request a new link
            </a>
          </>
        )}
      </Shell>
    );
  }

  if (sent) {
    return (
      <Shell eyebrow="Client portal" title="Check your email">
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          If an account exists for <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>,
          we've sent a sign-in link. The link expires in 15 minutes.
        </p>
        {devLink && import.meta.env.DEV && (
          <div
            className="mono"
            style={{
              marginTop: 16,
              fontSize: 11,
              padding: 12,
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-md)',
              wordBreak: 'break-all',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>
              DEV LINK
            </span>
            <a href={devLink} style={{ color: 'var(--text-primary)' }}>{devLink}</a>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Client portal" title="Sign in">
      <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.55 }}>
        Enter the email your advocate has on file. We'll send a single-use link
        to sign you in — no password to remember.
      </p>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label className="label" htmlFor="portal-email">Email</label>
          <input
            id="portal-email"
            className="input"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        {requestMutation.isError && (
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
            {portalErrorMessage(requestMutation.error)}
          </div>
        )}
        <button
          type="submit"
          disabled={requestMutation.isPending}
          className="btn btn-primary btn-lg btn-block"
        >
          {requestMutation.isPending ? 'Sending…' : 'Send magic link'}
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
