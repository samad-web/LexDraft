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
    <div className="col stagger" style={{ gap: 24 }}>
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
        <div className="grid-3" style={{ gap: 20 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={180} />)}
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
