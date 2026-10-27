/**
 * Landing page for a co-counsel handover invite - the cross-firm counterpart
 * to InviteAcceptView. The recipient may have no DifAI account at all, so
 * accepting doubles as sign-up: it provisions them their OWN trial Solo firm
 * (never the referring firm - see co-counsel.service.ts::acceptByToken) and
 * grants read-only guest access to exactly the one referred case.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useAcceptCoCounselByToken, useCoCounselInviteByToken } from '@/hooks/useCoCounsel';
import { GoogleWhatsAppVerify, type VerifiedGoogleSignup } from '@/components/GoogleWhatsAppVerify';
import type { SignInResult } from '@/lib/auth-types';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';

export function CoCounselAcceptView() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const showToast = useUIStore((s) => s.showToast);

  const { data, isLoading, isError, error } = useCoCounselInviteByToken(token);
  const accept = useAcceptCoCounselByToken();

  const [name, setName] = useState('');
  const [verified, setVerified] = useState<VerifiedGoogleSignup | null>(null);

  // Already a DifAI user: this link is for new advocates, so sign them in;
  // the handover itself is accepted from inside the app.
  const handleExisting = (_resp: SignInResult) => {
    showToast({ type: 'cobalt', text: 'You already have a DifAI account - accept the handover from inside the app.' });
    navigate('/app/dashboard', { replace: true });
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token || !verified) return;
    accept.mutate(
      { token, body: { name: name.trim(), signupToken: verified.signupToken } },
      {
        onSuccess: (result) => {
          if (result.auth) {
            setSession(result.auth.user, result.auth.token);
          }
          showToast({ type: 'sage', text: `You're in - welcome to DifAI, ${name.trim().split(' ')[0]}` });
          navigate(`/app/co-counsel/${result.grant.caseId}`, { replace: true });
        },
        onError: (err) => {
          showToast({
            type: 'vermillion',
            text: (err as Error)?.message || 'Couldn’t accept this handover.',
          });
        },
      },
    );
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <div
        className="card"
        style={{
          width: 'min(520px, 100%)',
          padding: 36,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <span
            aria-hidden
            style={{
              width: 32,
              height: 32,
              background: 'var(--text-primary)',
              borderRadius: 'var(--radius-sm)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <div>
            <div className="eyebrow">DifAI</div>
            <div className="heading-md" style={{ marginTop: 2 }}>You&rsquo;ve been asked to co-counsel</div>
          </div>
        </div>

        {isLoading && (
          <div className="body-md muted">
            Verifying handover<span className="blink" />
          </div>
        )}

        {isError && (
          <div className="col" style={{ gap: 14 }}>
            <div
              role="alert"
              className="row"
              style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--danger-bg)',
                color: 'var(--danger)',
                gap: 10,
              }}
            >
              <Icon name="flag" size={14} />
              <span>{(error as Error | null)?.message ?? 'This handover request is no longer valid.'}</span>
            </div>
            <button
              type="button"
              className="btn"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => navigate('/auth')}
            >
              Go to sign in
            </button>
          </div>
        )}

        {data && (
          <>
            <div className="card-cream" style={{ padding: 18 }}>
              <div className="row" style={{ marginBottom: 8, gap: 10 }}>
                <span className="eyebrow">{data.sourceFirmName}</span>
                <span className="spacer" />
                <span className="badge badge-cobalt">{data.caseCnr}</span>
              </div>
              <div className="body-md">
                You&rsquo;ve been asked to take over <strong>{data.caseTitle}</strong>.
              </div>
              {data.reason && (
                <p
                  className="body-sm"
                  style={{
                    marginTop: 10,
                    paddingLeft: 12,
                    borderLeft: '2px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  &ldquo;{data.reason}&rdquo;
                </p>
              )}
              <p className="body-xs muted" style={{ marginTop: 12 }}>
                Accepting creates your own free DifAI account and gives you read access to this
                one matter - its hearings, notes, and documents. You can upgrade to a full plan any time.
              </p>
            </div>

            {!verified ? (
              <GoogleWhatsAppVerify
                onSignedIn={handleExisting}
                onVerified={(v) => { setVerified(v); setName(v.profile.name); }}
              />
            ) : (
            <form onSubmit={handleSubmit} className="col" style={{ gap: 14 }}>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {verified.profile.email} · WhatsApp {verified.phone} verified
              </div>
              <div>
                <label className="label" htmlFor="cocounsel-name">Your full name</label>
                <input
                  id="cocounsel-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={data.invitedName ?? 'Priya Nair'}
                  required
                  autoFocus
                  autoComplete="name"
                />
              </div>
              {accept.isError && (
                <div
                  role="alert"
                  className="row"
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--danger-bg)',
                    color: 'var(--danger)',
                    gap: 10,
                    fontSize: 13,
                  }}
                >
                  <Icon name="flag" size={14} />
                  <span>{(accept.error as Error | null)?.message ?? 'Couldn’t accept this handover.'}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={accept.isPending || !name.trim()}
                style={{ marginTop: 4 }}
              >
                {accept.isPending ? 'Setting up…' : 'Accept and take over this matter'}
              </button>
            </form>
            )}

            <div className="body-sm muted" style={{ textAlign: 'center', marginTop: 4 }}>
              By accepting you agree to DifAI&rsquo;s terms of service and privacy policy.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
