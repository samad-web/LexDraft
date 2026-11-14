import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useSignOut } from '@/hooks/useAuth';
import { Wordmark } from '@/components/brand/Logo';
import { LEGAL_VERSION, OPERATOR } from '@/lib/legal';

// Terms + Privacy consent (build-docs/features/terms-consent.md): the
// unticked box on every sign-up form, and the agree / disagree screen shown
// to signed-in users who have not agreed to the current version.

const legalLink = (href: string, label: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{label}</a>
);

/** Required, unticked by default. The sign-up button stays disabled until it is ticked. */
export function TermsAgree({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="body-sm" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--text-secondary)', lineHeight: 1.5, cursor: 'pointer', textAlign: 'left' }}>
      <input
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, width: 16, height: 16, flex: 'none', accentColor: 'var(--text-primary)' }}
      />
      <span>
        I agree to DifAi&rsquo;s {legalLink('/terms', 'Terms of Service')} and {legalLink('/privacy', 'Privacy Policy')}, and
        I have a lawful basis for the client data I upload.
      </span>
    </label>
  );
}

/** Shown instead of the app until the user agrees to the current Terms version. */
export function TermsConsentView() {
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const signOut = useSignOut();
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<'agree' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const answer = async (granted: boolean) => {
    setBusy(granted ? 'agree' : 'decline');
    setError(null);
    try {
      await api.post('/me/dpdp/consent', { consentType: 'terms_privacy', consentVersion: LEGAL_VERSION, granted });
      if (!granted) {
        signOut();
        return;
      }
      const me = await api.get<User>('/me');
      qc.setQueryData(['me'], me);
      refreshUser(me);
    } catch (e) {
      setError((e as Error)?.message || 'Could not save your answer. Try again.');
      setBusy(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <main role="dialog" aria-modal="true" aria-labelledby="terms-consent-title" style={{ maxWidth: 520, width: '100%', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 24, background: 'var(--bg-surface, var(--bg-base))' }}>
        <div style={{ fontSize: 20, marginBottom: 16 }}><Wordmark /></div>
        <h1 id="terms-consent-title" className="heading-md" style={{ margin: '0 0 8px' }}>Our Terms and Privacy Policy</h1>
        <p className="body-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
          We have published DifAi&rsquo;s Terms of Service and Privacy Policy (version {LEGAL_VERSION}). Please read them and
          tell us whether you agree. You need to agree to keep using DifAi.
        </p>
        <TermsAgree checked={agreed} onChange={setAgreed} />
        {error && <div role="alert" className="body-sm" style={{ marginTop: 12, color: 'var(--danger, var(--text-primary))' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-pill" disabled={!agreed || busy !== null} onClick={() => answer(true)}>
            {busy === 'agree' ? 'Saving…' : 'I agree'}
          </button>
          <button type="button" className="btn btn-pill" disabled={busy !== null} onClick={() => answer(false)}>
            {busy === 'decline' ? 'Signing out…' : 'I disagree'}
          </button>
        </div>
        <p className="body-xs" style={{ color: 'var(--text-tertiary)', lineHeight: 1.55, margin: '16px 0 0' }}>
          If you disagree, you will be signed out. You can still ask for a copy of your data or for your account to be
          deleted by writing to <a href={`mailto:${OPERATOR.email}`} style={{ color: 'inherit' }}>{OPERATOR.email}</a>.
        </p>
      </main>
    </div>
  );
}
