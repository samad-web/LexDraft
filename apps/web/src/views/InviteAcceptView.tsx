import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useAcceptInvitation, useInvitationByToken } from '@/hooks/useInvitations';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';

export function InviteAcceptView() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const showToast = useUIStore((s) => s.showToast);

  const { data, isLoading, isError, error } = useInvitationByToken(token);
  const accept = useAcceptInvitation();

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) return;
    if (password !== confirm) {
      showToast({ type: 'vermillion', text: 'Passwords do not match.' });
      return;
    }
    if (password.length < 8) {
      showToast({ type: 'vermillion', text: 'Password must be at least 8 characters.' });
      return;
    }
    accept.mutate(
      { token, body: { name: name.trim(), password } },
      {
        onSuccess: (auth) => {
          setSession(auth.user, auth.token);
          showToast({ type: 'sage', text: `Welcome to ${auth.user.firm ?? 'the firm'}, ${auth.user.name.split(' ')[0]}` });
          navigate('/app/dashboard', { replace: true });
        },
        onError: (err) => {
          showToast({
            type: 'vermillion',
            text: (err as Error)?.message || 'Couldn’t accept the invitation.',
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
            <div className="eyebrow">LexDraft</div>
            <div className="heading-md" style={{ marginTop: 2 }}>You’ve been invited</div>
          </div>
        </div>

        {isLoading && (
          <div className="body-md muted">
            Verifying invitation<span className="blink" />
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
              <span>{(error as Error | null)?.message ?? 'This invitation is no longer valid.'}</span>
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
                <span className="eyebrow">{data.firm}</span>
                <span className="spacer" />
                <span className="badge badge-cobalt">{data.role}</span>
              </div>
              <div className="body-md">
                <strong>{data.invitedBy}</strong> has invited{' '}
                <span className="mono">{data.email}</span> to join the chambers.
              </div>
              {data.message && (
                <p
                  className="body-sm"
                  style={{
                    marginTop: 10,
                    paddingLeft: 12,
                    borderLeft: '2px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  “{data.message}”
                </p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="col" style={{ gap: 14 }}>
              <div>
                <label className="label" htmlFor="invite-name">Your full name</label>
                <input
                  id="invite-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Aarav Sharma"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label" htmlFor="invite-password">Choose a password</label>
                <input
                  id="invite-password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="invite-confirm">Confirm password</label>
                <input
                  id="invite-confirm"
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  minLength={8}
                  required
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
                  <span>{(accept.error as Error | null)?.message ?? 'Couldn’t accept the invitation.'}</span>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={accept.isPending || !name.trim() || password.length < 8}
                style={{ marginTop: 4 }}
              >
                {accept.isPending ? 'Joining…' : `Accept and join ${data.firm}`}
              </button>
            </form>

            <div className="body-sm muted" style={{ textAlign: 'center', marginTop: 4 }}>
              By accepting you agree to LexDraft’s terms of service and privacy policy.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
