import { Icon } from '@lexdraft/ui';
import { useModalA11y } from '@/hooks/useModalA11y';

interface MemberLike {
  name: string;
  initials: string;
  role: string;
  enrolment: string;
  email: string;
  practiceAreas: string[];
  status: 'active' | 'on-leave';
}

interface MemberProfileModalProps {
  open: boolean;
  member: MemberLike | null;
  onClose: () => void;
}

export function MemberProfileModal({ open, member, onClose }: MemberProfileModalProps) {
  const shellRef = useModalA11y<HTMLDivElement>(open, onClose);
  if (!open || !member) return null;

  return (
    <div
      ref={shellRef}
      role="dialog"
      aria-modal
      aria-labelledby="member-profile-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--scrim)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-xl)',
          padding: 28,
          width: 'min(520px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div className="fm-avatar is-lg" aria-hidden>
            {member.initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="fm-eyebrow" style={{ marginBottom: 4 }}>Chambers profile</div>
            <h3 id="member-profile-title" className="fm-member-name" style={{ fontSize: 22, margin: 0 }}>
              {member.name}
            </h3>
            <div className="body-sm muted" style={{ marginTop: 4 }}>{member.role}</div>
          </div>
          <span
            className={`fm-pill ${member.status === 'active' ? 'is-solid' : 'is-dashed'}`}
            style={{ flex: '0 0 auto' }}
          >
            {member.status === 'active' ? 'Active' : 'On leave'}
          </span>
        </div>

        <dl className="fm-dl">
          <ProfileRow label="Enrolment" value={member.enrolment} />
          <ProfileRow label="Email" value={member.email} />
          <dt>Practice areas</dt>
          <dd>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {member.practiceAreas.length === 0 ? (
                <span className="muted body-sm">Not specified.</span>
              ) : (
                member.practiceAreas.map((p) => (
                  <span key={p} className="fm-pill is-plain">{p}</span>
                ))
              )}
            </div>
          </dd>
        </dl>

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(member.email);
            }}
          >
            <Icon name="file" size={14} /> Copy email
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose} style={{ minWidth: 96 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value === 'Not on record' ? 'is-muted' : undefined}>{value}</dd>
    </>
  );
}
