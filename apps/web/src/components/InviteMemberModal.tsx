import { useEffect, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { InviteRole } from '@lexdraft/types';
import { useCreateInvitation } from '@/hooks/useInvitations';
import { useUIStore } from '@/store/ui';

const ROLES: InviteRole[] = [
  'Managing Partner',
  'Senior Associate',
  'Associate',
  'Junior Associate',
  'Of Counsel',
  'Paralegal',
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InviteMemberModal({ open, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('Associate');
  const [message, setMessage] = useState('');
  const createInvite = useCreateInvitation();
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setRole('Associate');
      setMessage('');
      createInvite.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isValid = /\S+@\S+\.\S+/.test(email);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isValid || createInvite.isPending) return;
    createInvite.mutate(
      { email: email.trim(), role, message: message.trim() || undefined },
      {
        onSuccess: (inv) => {
          showToast({
            type: 'sage',
            text: `Invitation sent to ${inv.email}`,
          });
          // Copy the acceptance URL to clipboard so the inviter can share it manually.
          const url = `${window.location.origin}/invite/${inv.token}`;
          void navigator.clipboard?.writeText(url).catch(() => undefined);
          onClose();
        },
        onError: (err) => {
          showToast({
            type: 'vermillion',
            text: (err as Error)?.message || 'Failed to send invitation',
          });
        },
      },
    );
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-modal-title"
        style={{
          position: 'fixed',
          top: '12vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(520px, 92vw)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-modal)',
          zIndex: 101,
          padding: 28,
        }}
      >
        <div className="row" style={{ marginBottom: 20, alignItems: 'flex-start' }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Add to chambers</div>
            <h2 id="invite-modal-title" className="heading-lg">Invite a member</h2>
          </div>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: '0 8px' }}
          >
            <Icon name="close" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="col" style={{ gap: 16 }}>
          <div>
            <label className="label" htmlFor="invite-email">Work email</label>
            <input
              id="invite-email"
              className="input"
              type="email"
              placeholder="advocate@chambers.law"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div>
            <label className="label">Role</label>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`chip${role === r ? ' active' : ''}`}
                  onClick={() => setRole(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="invite-message">Personal note <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <textarea
              id="invite-message"
              className="input"
              rows={3}
              placeholder="Welcome aboard - looking forward to working together."
              value={message}
              maxLength={500}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          {createInvite.isError && (
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
              <span>{(createInvite.error as Error | null)?.message ?? 'Failed to send invitation.'}</span>
            </div>
          )}

          <div className="row" style={{ gap: 10, marginTop: 4 }}>
            <span className="body-sm muted">
              Acceptance link will be valid for 7 days and copied to your clipboard.
            </span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!isValid || createInvite.isPending}
            >
              {createInvite.isPending ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
