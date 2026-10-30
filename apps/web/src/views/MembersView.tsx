import { useMemo, useState } from 'react';
import { Icon, EmptyState, Skeleton, ErrorState } from '@lexdraft/ui';
import type { Invitation, FirmManagedUser } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { InviteMemberModal } from '@/components/InviteMemberModal';
import { MemberProfileModal } from '@/components/MemberProfileModal';
import {
  useInvitations,
  useCancelInvitation,
  useResendInvitation,
} from '@/hooks/useInvitations';
import { useCan, useFirmUsers, useUpdateFirmUser } from '@/hooks/useFirmAdmin';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.length === 1 ? parts[0]!.slice(0, 2).toUpperCase() : (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// FirmManagedUser (the real, server-backed user record) has no enrolment
// number or practice-area tags - those are chambers-roll concepts the
// backend doesn't track for users yet. Surface what's real and degrade the
// rest gracefully rather than fabricating data.
function toMember(u: FirmManagedUser): Member {
  return {
    id: u.id,
    name: u.name,
    initials: initialsOf(u.name),
    role: u.role?.name ?? 'Member',
    enrolment: 'Not on record',
    email: u.email,
    practiceAreas: [],
    status: u.status === 'active' ? 'active' : 'on-leave',
  };
}

export function MembersView() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const canManageUsers = useCan('admin.users');
  const usersQ = useFirmUsers();
  const MEMBERS = useMemo(() => (usersQ.data ?? []).map(toMember), [usersQ.data]);
  // A Solo-plan account never carries the `admin.users` feature, so
  // /firm/users 403s by design - that's not a connectivity problem, it's
  // "you have no firm-mates." Only treat the query as a genuine failure
  // (and offer Retry) when the account actually has the feature.
  const isPlanGated = usersQ.isError && !canManageUsers;
  const isGenuineError = usersQ.isError && canManageUsers;
  const stats = useMemo(() => {
    const active   = MEMBERS.filter((m) => m.status === 'active').length;
    const onLeave  = MEMBERS.length - active;
    return { total: MEMBERS.length, active, onLeave };
  }, [MEMBERS]);
  const pager = usePagination(MEMBERS);

  return (
    <div className="col stagger fm-view fm-members">
      <PageHeader
        title="Members"
        description="Partners, associates and counsel in your firm, and the role each holds."
        meta={`${stats.active} active · ${stats.onLeave} on leave`}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setInviteOpen(true)}
            disabled={!canManageUsers}
            title={canManageUsers ? undefined : 'Available on Practice and Firm plans'}
          >
            <Icon name="plus" size={14} /> Invite member
          </button>
        }
      />

      <PendingInvitations />

      {usersQ.isLoading ? (
        <div className="fm-members-grid">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={220} radius="lg" />)}
        </div>
      ) : isPlanGated ? (
        <EmptyState
          icon="members"
          title="Members management isn't on your plan"
          description="Chambers roll, roles, and invitations are available on Practice and Firm plans. Upgrade to add partners, associates, and counsel of record."
        />
      ) : isGenuineError ? (
        <ErrorState
          title="Couldn't load members"
          description="Check your connection and try again."
          onRetry={() => void usersQ.refetch()}
        />
      ) : MEMBERS.length === 0 ? (
        <EmptyState
          icon="members"
          title="No members yet"
          description="Invite your first colleague to populate the chambers roll. Roles control matter access, billing approvals, and signing authority."
        />
      ) : (
        <>
          <div className="fm-members-grid">
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
    <div className="fm-panel is-flush">
      <div className="fm-panel-head">
        <div>
          <div className="fm-eyebrow">Awaiting acceptance</div>
          <h2 className="fm-panel-title">Pending invitations</h2>
        </div>
        <span className="fm-pill is-solid">{pending.length} open</span>
      </div>
      <table className="tbl fm-tbl">
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
                  onSuccess: (r) => {
                    void navigator.clipboard?.writeText(`${window.location.origin}/invite/${r.token}`).catch(() => undefined);
                    showToast({
                      type: 'sage',
                      text: r.emailSent
                        ? `Invitation emailed again to ${inv.email}. Valid for 7 more days.`
                        : `Extended 7 days and link copied. Email isn't set up, so share it with ${inv.email} yourself.`,
                    });
                  },
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
      <td className="fm-cell-title" style={{ overflowWrap: 'anywhere' }}>{invitation.email}</td>
      <td>{invitation.role}</td>
      <td>{invitation.invitedBy.name}</td>
      <td><span className="fm-date">{expiresIn}</span></td>
      <td style={{ textAlign: 'right' }}>
        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-sm" onClick={onCopyLink}>Copy link</button>
          <button type="button" className="btn btn-sm" onClick={onResend} disabled={busy}>Resend</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
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
  const updateUser = useUpdateFirmUser();
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const requestDeactivate = () => {
    if (!confirmDeactivate) {
      setConfirmDeactivate(true);
      return;
    }
    setConfirmDeactivate(false);
    updateUser.mutate(
      { id: member.id, patch: { status: 'deactivated' } },
      {
        onSuccess: () => showToast({ type: 'sage', text: `${member.name} has been deactivated.` }),
        onError: (err) => showToast({
          type: 'vermillion',
          text: (err as Error)?.message || `Couldn't deactivate ${member.name}`,
        }),
      },
    );
  };

  return (
    <div className="fm-member">
      <div className="fm-member-head">
        <div className="fm-avatar is-lg" aria-hidden>{member.initials}</div>
        <div className="fm-member-who">
          <div className="fm-member-name">{member.name}</div>
          <div className="fm-member-role">{member.role}</div>
        </div>
        <StatusPill status={member.status} />
      </div>

      <dl className="fm-dl">
        <Field label="Enrolment" value={member.enrolment} muted={member.enrolment === 'Not on record'} />
        <Field label="Email" value={member.email} />
        <Field
          label="Practice"
          value={member.practiceAreas.length > 0 ? member.practiceAreas.join(' · ') : 'None recorded'}
          muted={member.practiceAreas.length === 0}
        />
      </dl>

      <div className="fm-member-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setProfileOpen(true)}
        >
          View profile
        </button>
        <button
          type="button"
          className={`btn btn-sm${confirmDeactivate ? ' btn-oxblood' : ' btn-ghost'}`}
          aria-label={confirmDeactivate ? `Confirm deactivate ${member.name}` : `Deactivate ${member.name}`}
          onClick={requestDeactivate}
          onBlur={() => setConfirmDeactivate(false)}
          disabled={updateUser.isPending}
          title={confirmDeactivate ? 'Click again to confirm' : `Deactivate ${member.name}`}
        >
          {updateUser.isPending ? '…' : confirmDeactivate ? 'Confirm?' : <Icon name="more" size={14} />}
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

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={muted ? 'is-muted' : undefined}>{value}</dd>
    </>
  );
}

function StatusPill({ status }: { status: Status }) {
  if (status === 'active') {
    return <span className="fm-pill is-solid" title="Active">Active</span>;
  }
  return <span className="fm-pill is-dashed" title="On leave">On leave</span>;
}
