import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { PortalRequestLinkResponse, PortalSession } from '@lexdraft/types';
import { portalApi, portalErrorMessage } from '@/lib/portalApi';
import { usePortalAuthStore } from '@/store/portalAuth';

/**
 * Magic-link sign-in for the read-only client portal. Two states:
 *  1. Enter email → POST /portal/auth/request-link
 *  2. "Check your email" — also surfaces the dev link when the API returns one.
 *
 * If the URL already contains `?token=…`, we short-circuit to verifyMutation
 * so an emailed link can boot the user straight into the dashboard.
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
      <Shell>
        <h1>Signing you in…</h1>
        {verifyMutation.isPending && <p>Verifying your link.</p>}
        {verifyError && (
          <>
            <p style={{ color: 'var(--danger, #c0392b)' }}>{verifyError}</p>
            <p>
              <a href="/portal/login">Request a new link</a>
            </p>
          </>
        )}
      </Shell>
    );
  }

  if (sent) {
    return (
      <Shell>
        <h1>Check your email</h1>
        <p>
          If an account exists for <strong>{email}</strong>, we've sent a sign-in link.
          The link expires in 15 minutes.
        </p>
        {devLink && (
          <p style={{ marginTop: 24, fontSize: 13, opacity: 0.7 }}>
            <strong>Dev:</strong> <a href={devLink}>{devLink}</a>
          </p>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <h1>Client Portal</h1>
      <p style={{ marginBottom: 24, opacity: 0.75 }}>
        Sign in to view your matters, hearings, invoices, and shared documents.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor="portal-email" style={{ display: 'block', marginBottom: 8 }}>Email</label>
        <input
          id="portal-email"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
          placeholder="you@example.com"
        />
        {requestMutation.isError && (
          <p style={{ color: 'var(--danger, #c0392b)', marginTop: 8 }}>
            {portalErrorMessage(requestMutation.error)}
          </p>
        )}
        <button type="submit" disabled={requestMutation.isPending} style={buttonStyle}>
          {requestMutation.isPending ? 'Sending…' : 'Send magic link'}
        </button>
      </form>
    </Shell>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 15,
  border: '1px solid var(--border, #d4d4d8)', borderRadius: 6,
  background: 'var(--card, #fff)', color: 'inherit',
};

const buttonStyle: React.CSSProperties = {
  marginTop: 16, width: '100%', padding: '10px 12px', fontSize: 15,
  background: 'var(--text, #18181b)', color: 'var(--card, #fff)',
  border: 'none', borderRadius: 6, cursor: 'pointer',
};

function Shell(props: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--bg, #f4f4f5)',
    }}>
      <div style={{
        width: '100%', maxWidth: 420, padding: 32,
        background: 'var(--card, #fff)',
        border: '1px solid var(--border, #e4e4e7)', borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {props.children}
      </div>
    </div>
  );
}
