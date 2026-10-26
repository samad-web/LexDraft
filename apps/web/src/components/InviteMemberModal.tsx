import { useEffect, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { CustomRoleAccess, Invitation, InviteRole } from '@lexdraft/types';
import { useCreateInvitation } from '@/hooks/useInvitations';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';

const ROLES: InviteRole[] = [
  'Managing Partner',
  'Senior Associate',
  'Associate',
  'Junior Associate',
  'Of Counsel',
  'Paralegal',
];

type RoleChoice = InviteRole | 'Other';

// Access levels a custom role can inherit (mirrors the API's CustomRoleAccess).
const ACCESS_LEVELS: Array<{ value: CustomRoleAccess; hint: string }> = [
  { value: 'Partner',          hint: 'Full drafting, review, matters, billing view' },
  { value: 'Senior Associate', hint: 'Drafting, AI drafting, review, e-sign' },
  { value: 'Associate',        hint: 'Drafting, AI drafting, clause library' },
  { value: 'Paralegal',        hint: 'Limited drafting, templates, documents' },
  { value: 'Legal Secretary',  hint: 'Formatting, calendar, basic templates' },
  { value: 'Intern',           hint: 'Read-only or restricted drafting' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function InviteMemberModal({ open, onClose }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleChoice>('Associate');
  const [customRole, setCustomRole] = useState('');
  const [access, setAccess] = useState<CustomRoleAccess>('Associate');
  const [message, setMessage] = useState('');
  // After a successful create we stay open and show the link, because
  // without SMTP the inviter is the only way it reaches the invitee.
  const [created, setCreated] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);
  const createInvite = useCreateInvitation();
  const myEmail = useAuthStore((s) => s.user?.email ?? '');
  const myName = useAuthStore((s) => s.user?.name ?? '');
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setRole('Associate');
      setCustomRole('');
      setAccess('Associate');
      setMessage('');
      setCreated(null);
      setCopied(false);
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

  const customOk = role !== 'Other' || customRole.trim().length >= 2;
  const isValid = /\S+@\S+\.\S+/.test(email) && customOk;
  const link = created ? `${window.location.origin}/invite/${created.token}` : '';

  // "Send from my email": the invite is composed in the inviter's own mail
  // app, so it goes out from their sign-in address (and sits in their Sent
  // folder) without LexDraft ever holding their mailbox password.
  const subject = created ? `Invitation to join ${created.firm} on LexDraft` : '';
  const body = created
    ? [
        'Hello,',
        '',
        `I'd like you to join ${created.firm} on LexDraft as ${created.role}.`,
        ...(created.message ? ['', created.message] : []),
        '',
        'Open this link and continue with Google to join:',
        link,
        '',
        `The link is valid until ${new Date(created.expiresAt).toDateString()}.`,
        '',
        myName,
      ].join('\n')
    : '';
  const mailtoHref = created
    ? `mailto:${encodeURIComponent(created.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : '';
  // Gmail web compose; authuser picks the Google account matching the
  // inviter's sign-in email when they have several signed in.
  const gmailHref = created
    ? `https://mail.google.com/mail/?view=cm&fs=1${myEmail ? `&authuser=${encodeURIComponent(myEmail)}` : ''}&to=${encodeURIComponent(created.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : '';

  const copyLink = () => {
    void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => undefined);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isValid || createInvite.isPending) return;
    createInvite.mutate(
      {
        email: email.trim(),
        role,
        ...(role === 'Other' ? { customRoleName: customRole.trim(), accessLevel: access } : {}),
        message: message.trim() || undefined,
      },
      {
        onSuccess: (inv) => {
          setCreated(inv);
          const url = `${window.location.origin}/invite/${inv.token}`;
          void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => undefined);
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
          background: 'var(--scrim)',
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
            <h2 id="invite-modal-title" className="heading-lg">{created ? 'Invitation ready' : 'Invite a member'}</h2>
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

        {created ? (
          <div className="col" style={{ gap: 16 }}>
            <p className="body-md" style={{ margin: 0 }}>
              {created.emailSent
                ? <>We&apos;ve emailed the invitation to <strong>{created.email}</strong>. You can also send it from your own email below.</>
                : <>Send it to <strong>{created.email}</strong> from your own email: it opens a ready-to-send message from {myEmail ? <strong>{myEmail}</strong> : 'your address'}. Just press Send.</>}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a className="btn btn-primary" href={mailtoHref}>
                Send from my email
              </a>
              <a className="btn" href={gmailHref} target="_blank" rel="noopener noreferrer">
                Open in Gmail
              </a>
            </div>
            <div>
              <label className="label" htmlFor="invite-link">Invitation link · {created.role}</label>
              <div className="row" style={{ gap: 8 }}>
                <input
                  id="invite-link"
                  className="input mono"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ fontSize: 12 }}
                />
                <button type="button" className="btn" onClick={copyLink}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="body-sm muted">
                Valid for 7 days. They open it, continue with Google, verify their WhatsApp number, and join your firm.
              </span>
              <span className="spacer" />
              <a
                className="btn"
                href={`https://wa.me/?text=${encodeURIComponent(`You're invited to join ${created.firm} on LexDraft: ${link}`)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Share on WhatsApp
              </a>
              <button type="button" className="btn" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
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
              {[...ROLES, 'Other' as const].map((r) => (
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
            {role === 'Other' && (
              <div className="col" style={{ gap: 10, marginTop: 12 }}>
                <div>
                  <label className="label" htmlFor="invite-custom-role">Role name</label>
                  <input
                    id="invite-custom-role"
                    className="input"
                    placeholder="e.g. Office Manager, Court Clerk, Accounts"
                    value={customRole}
                    maxLength={60}
                    onChange={(e) => setCustomRole(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label" htmlFor="invite-access">Access level</label>
                  <select
                    id="invite-access"
                    className="input"
                    value={access}
                    onChange={(e) => setAccess(e.target.value as CustomRoleAccess)}
                  >
                    {ACCESS_LEVELS.map((a) => (
                      <option key={a.value} value={a.value}>{a.value}: {a.hint}</option>
                    ))}
                  </select>
                  <div className="body-sm muted" style={{ marginTop: 4 }}>
                    They&apos;ll show as &ldquo;{customRole.trim() || 'your role name'}&rdquo; with the same access as {access}.
                  </div>
                </div>
              </div>
            )}
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
              You&apos;ll get a link to share. It&apos;s valid for 7 days.
            </span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!isValid || createInvite.isPending}
            >
              {createInvite.isPending ? 'Creating…' : 'Create invitation'}
            </button>
          </div>
        </form>
        )}
      </div>
    </>
  );
}
