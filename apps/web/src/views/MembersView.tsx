import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { Invitation } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { InviteMemberModal } from '@/components/InviteMemberModal';
import { MemberProfileModal } from '@/components/MemberProfileModal';
import {
  useInvitations,
  useCancelInvitation,
  useResendInvitation,
} from '@/hooks/useInvitations';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

type Status = 'active' | 'on-leave';

interface Member {
  id: string;
  name: string;
  initials: string;
  role: string;
  enrolment: string;
  email: string;
  practiceAreas: string[];
  status: Status;
}

const MEMBERS: Member[] = [];

export function MembersView() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const stats = useMemo(() => {
    const active   = MEMBERS.filter((m) => m.status === 'active').length;
    const onLeave  = MEMBERS.length - active;
    return { total: MEMBERS.length, active, onLeave };
  }, []);
  const pager = usePagination(MEMBERS);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>§ - CHAMBERS ROLL</div>
          <h1 className="heading-xl">Members</h1>
          <p className="body-md muted" style={{ marginTop: 8, maxWidth: 560 }}>
            Partners, associates, and counsel of record. Roles control matter access, billing approvals, and signing authority.
          </p>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="mono tabular" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
            {stats.active} ACTIVE · {stats.onLeave} ON LEAVE
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setInviteOpen(true)}
          >
            <Icon name="plus" size={14} /> Invite member
          </button>
        </div>
      </div>

      <PendingInvitations />

      {MEMBERS.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-9)' }}>
          <p className="body-md muted">No members yet. Invite your first colleague to populate the chambers roll.</p>
        </div>
      ) : (
        <>
          <div className="grid-3" style={{ gap: 20 }}>
            {pager.slice.map((m) => <MemberCard key={m.id} member={m} />)}
          </div>
          <Pagination
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            pageSize={pager.pageSize}
            onChange={pager.setPage}
          />
        </>
      )}

      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

function PendingInvitations() {
  const { data: invitations, isLoading } = useInvitations();
  const cancel = useCancelInvitation();
  const resend = useResendInvitation();
  const showToast = useUIStore((s) => s.showToast);

  const pending = useMemo(
    () => (invitations ?? []).filter((inv) => inv.status === 'pending'),
    [invitations],
  );

  if (isLoading || pending.length === 0) return null;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="row" style={{ padding: 24, alignItems: 'flex-end', borderBottom: '1px solid var(--border-subtle)' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Awaiting acceptance</div>
          <div className="heading-md">Pending invitations</div>
        </div>
        <span className="spacer" />
        <span className="badge badge-cobalt">{pending.length} open</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Invited by</th>
            <th>Expires</th>
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((inv) => (
            <PendingRow
              key={inv.id}
              invitation={inv}
              onCopyLink={() => {
                const url = `${window.location.origin}/invite/${inv.token}`;
                void navigator.clipboard?.writeText(url).catch(() => undefined);
                showToast({ type: 'sage', text: 'Acceptance link copied to clipboard' });
              }}
              onResend={() =>
                resend.mutate(inv.id, {
                  onSuccess: () => showToast({ type: 'sage', text: `Invitation refreshed for ${inv.email}` }),
                  onError: (err) => showToast({
                    type: 'vermillion',
                    text: (err as Error)?.message || `Couldn’t resend invitation for ${inv.email}`,
                  }),
                })
              }
              onCancel={() =>
                cancel.mutate(inv.id, {
                  onSuccess: () => showToast({ type: 'cobalt', text: `Invitation cancelled for ${inv.email}` }),
                  onError: (err) => showToast({
                    type: 'vermillion',
                    text: (err as Error)?.message || `Couldn’t cancel invitation for ${inv.email}`,
                  }),
                })
              }
              busy={cancel.isPending || resend.isPending}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingRow({
  invitation,
  onCopyLink,
  onResend,
  onCancel,
  busy,
}: {
  invitation: Invitation;
  onCopyLink: () => void;
  onResend: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const expiresIn = formatExpiry(invitation.expiresAt);
  return (
    <tr>
      <td style={{ fontWeight: 500 }} className="mono">{invitation.email}</td>
      <td>{invitation.role}</td>
      <td>{invitation.invitedBy.name}</td>
      <td className="body-sm muted tabular">{expiresIn}</td>
      <td style={{ textAlign: 'right' }}>
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-sm" onClick={onCopyLink}>Copy link</button>
          <button type="button" className="btn btn-sm" onClick={onResend} disabled={busy}>Resend</button>
          <button type="button" className="btn btn-sm btn-oxblood" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

function formatExpiry(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) return `in ${days}d ${hours}h`;
  return `in ${hours}h`;
}

function MemberCard({ member }: { member: Member }) {
  const showToast = useUIStore((s) => s.showToast);
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const requestDeactivate = () => {
    if (!confirmDeactivate) {
      setConfirmDeactivate(true);
      return;
    }
    // No firm-level deactivate endpoint exists yet; record the intent so the
    // managing partner can act on it. When the backend route lands, swap this
    // toast for a real mutation call.
    showToast({
      type: 'amber',
      text: `Deactivation requested for ${member.name}. Managing partner will review.`,
    });
    setConfirmDeactivate(false);
  };

  return (
    <div className="card card-hover" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div className="avatar" style={{ width: 44, height: 44, fontSize: 14 }}>{member.initials}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="heading-sm" style={{ marginBottom: 2 }}>{member.name}</div>
          <div className="body-sm muted">{member.role}</div>
        </div>
        <StatusPill status={member.status} />
      </div>

      <hr className="hairline" />

      <div className="col" style={{ gap: 10 }}>
        <Field label="ENROLMENT"     value={member.enrolment} mono />
        <Field label="EMAIL"         value={member.email}     mono />
        <div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
            PRACTICE AREAS
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {member.practiceAreas.map((p) => (
              <span key={p} className="badge badge-cream">{p}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <button
          type="button"
          className="btn btn-sm"
          style={{ flex: 1 }}
          onClick={() => setProfileOpen(true)}
        >
          View profile
        </button>
        <button
          type="button"
          className={`btn btn-sm${confirmDeactivate ? ' btn-oxblood' : ''}`}
          aria-label={confirmDeactivate ? `Confirm deactivate ${member.name}` : `Deactivate ${member.name}`}
          onClick={requestDeactivate}
          onBlur={() => setConfirmDeactivate(false)}
          title={confirmDeactivate ? 'Click again to confirm' : `Deactivate ${member.name}`}
        >
          {confirmDeactivate ? 'Confirm?' : <Icon name="more" size={14} />}
        </button>
      </div>

      <MemberProfileModal
        open={profileOpen}
        member={member}
        onClose={() => setProfileOpen(false)}
      />
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)', minWidth: 88 }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)' }} className={mono ? 'tabular' : ''}>
        {value}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status === 'active') {
    return (
      <span className="badge badge-sage" title="Active">
        <span className="dot dot-sage" style={{ marginRight: 6 }} />
        ACTIVE
      </span>
    );
  }
  return (
    <span className="badge badge-amber" title="On leave">
      <span className="dot dot-amber" style={{ marginRight: 6 }} />
      ON LEAVE
    </span>
  );
}
