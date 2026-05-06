import { Icon } from '@lexdraft/ui';

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
  if (!open || !member) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="member-profile-title"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
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
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 28,
          width: 'min(520px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div className="avatar" style={{ width: 56, height: 56, fontSize: 18 }}>
            {member.initials}
          </div>
          <div style={{ flex: 1 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Chambers profile</div>
            <h3 id="member-profile-title" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
              {member.name}
            </h3>
            <div className="body-sm muted" style={{ marginTop: 4 }}>{member.role}</div>
          </div>
          <span
            className={`badge ${member.status === 'active' ? 'badge-sage' : 'badge-amber'}`}
            style={{ flex: '0 0 auto' }}
          >
            {member.status === 'active' ? 'ACTIVE' : 'ON LEAVE'}
          </span>
        </div>

        <hr className="hairline" />

        <div className="col" style={{ gap: 12 }}>
          <ProfileRow label="ENROLMENT" value={member.enrolment} mono />
          <ProfileRow label="EMAIL" value={member.email} mono />
          <div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
              PRACTICE AREAS
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {member.practiceAreas.length === 0 ? (
                <span className="muted body-sm">Not specified.</span>
              ) : (
                member.practiceAreas.map((p) => (
                  <span key={p} className="badge badge-cream">{p}</span>
                ))
              )}
            </div>
          </div>
        </div>

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
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)', minWidth: 96 }}>
        {label}
      </span>
      <span
        style={{ fontSize: 13, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)' }}
        className={mono ? 'tabular' : ''}
      >
        {value}
      </span>
    </div>
  );
}
