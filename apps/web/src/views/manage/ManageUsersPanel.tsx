import { useMemo, useState } from 'react';
import { Icon, Select } from '@lexdraft/ui';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.length === 1 ? parts[0]!.slice(0, 2).toUpperCase() : (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
import type { FirmCreateUserResponse, FirmManagedUser, UserStatus } from '@lexdraft/types';
import {
  useFirmPracticeGroups,
  useFirmRoles,
  useFirmUsers,
  useUpdateFirmUser,
} from '@/hooks/useFirmAdmin';
import { useUIStore } from '@/store/ui';
import { InviteMemberModal } from '@/components/InviteMemberModal';
import { CreateMemberModal, CreatedMemberDialog } from './CreateMemberModal';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function ManageUsersPanel() {
  const users = useFirmUsers();
  const roles = useFirmRoles();
  const groups = useFirmPracticeGroups();
  const update = useUpdateFirmUser();
  const showToast = useUIStore((s) => s.showToast);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');
  const [roleFilter, setRoleFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createdResult, setCreatedResult] = useState<FirmCreateUserResponse | null>(null);

  const filtered = useMemo(() => {
    if (!users.data) return [];
    return users.data.filter((u) => {
      if (statusFilter && u.status !== statusFilter) return false;
      if (roleFilter && u.role?.id !== roleFilter) return false;
      if (q) {
        const needle = q.toLowerCase();
        if (!u.name.toLowerCase().includes(needle) && !u.email.toLowerCase().includes(needle)) {
          return false;
        }
      }
      return true;
    });
  }, [users.data, q, statusFilter, roleFilter]);

  const pager = usePagination(filtered);

  if (users.isLoading || roles.isLoading) {
    return <div className="fm-loading">Loading users…</div>;
  }
  if (users.isError) {
    return (
      <div className="fm-error" role="alert">
        <span className="fm-error-mark" aria-hidden>!</span>
        <span>{(users.error as Error)?.message ?? 'Failed to load users.'}</span>
      </div>
    );
  }

  const onChangeRole = (user: FirmManagedUser, roleId: string) => {
    update.mutate(
      { id: user.id, patch: { roleId } },
      {
        onSuccess: () => showToast({ type: 'sage', text: `${user.name}'s role updated` }),
        onError: (err) => showToast({
          type: 'vermillion',
          text: (err as Error).message || 'Couldn’t update role',
        }),
      },
    );
  };

  const onChangeGroup = (user: FirmManagedUser, value: string) => {
    update.mutate(
      { id: user.id, patch: { practiceGroupId: value === '' ? null : value } },
      {
        onError: (err) => showToast({
          type: 'vermillion',
          text: (err as Error).message || 'Couldn’t update practice group',
        }),
      },
    );
  };

  const onToggleStatus = (user: FirmManagedUser) => {
    const next: UserStatus = user.status === 'active' ? 'suspended' : 'active';
    update.mutate(
      { id: user.id, patch: { status: next } },
      {
        onSuccess: () => showToast({
          type: 'sage',
          text: `${user.name} is now ${next}`,
        }),
        onError: (err) => showToast({
          type: 'vermillion',
          text: (err as Error).message || 'Couldn’t change status',
        }),
      },
    );
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="fm-manage-intro">
        <p>
          Add a member two ways: <strong>Add member</strong> creates the account immediately and they sign in
          with Google; <strong>Send invite</strong> sends a link where they sign in with Google and verify their WhatsApp number.
        </p>
        <button type="button" className="btn" onClick={() => setInviteOpen(true)}>
          <Icon name="mail" size={14} /> Send invite
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" size={14} /> Add member
        </button>
      </div>

      <div className="fm-filters">
        <div className="fm-search">
          <input
            className="input"
            type="search"
            aria-label="Search members"
            placeholder="Search by name or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="fm-search-icon"><Icon name="search" size={14} /></span>
        </div>
        <div style={{ minWidth: 0 }}>
          <Select
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: '', label: 'All roles' },
              ...((roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))),
            ]}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as UserStatus | '')}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'deactivated', label: 'Deactivated' },
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="fm-empty-card">
          {users.data?.length === 0
            ? 'No users in this firm yet - invite your first co-advocate from the Invitations tab.'
            : 'No users match the current filters.'}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl fm-tbl">
            <thead>
              <tr>
                <th>Member</th>
                <th style={{ width: 210 }}>Role</th>
                <th style={{ width: 210 }}>Practice group</th>
                <th style={{ width: 120 }}>Status</th>
                <th style={{ width: 130, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="fm-user">
                      <span className="fm-avatar is-sm" aria-hidden>{initialsOf(u.name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="fm-cell-title">
                          {u.name}
                          {u.isSuperadmin && (
                            <span className="fm-pill is-solid" style={{ marginLeft: 8 }} title="Platform superadmin">
                              Platform
                            </span>
                          )}
                        </div>
                        <div className="fm-user-email">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Select
                      value={u.role?.id ?? ''}
                      onChange={(v) => onChangeRole(u, v)}
                      options={(roles.data ?? []).map((r) => ({
                        value: r.id,
                        label: r.isSystem ? r.name : `${r.name} (custom)`,
                      }))}
                    />
                  </td>
                  <td>
                    <Select
                      value={u.practiceGroup?.id ?? ''}
                      onChange={(v) => onChangeGroup(u, v)}
                      options={[
                        { value: '', label: '- No group -' },
                        ...((groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))),
                      ]}
                    />
                  </td>
                  <td>
                    <span
                      className={`fm-pill ${
                        u.status === 'active'
                          ? 'is-solid'
                          : u.status === 'suspended'
                            ? 'is-dashed'
                            : 'is-muted'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onToggleStatus(u)}
                      disabled={update.isPending}
                    >
                      {u.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fm-tbl-foot">
            <Pagination
              page={pager.page}
              totalPages={pager.totalPages}
              total={pager.total}
              pageSize={pager.pageSize}
              onChange={pager.setPage}
            />
          </div>
        </div>
      )}

      <CreateMemberModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        roles={roles.data ?? []}
        practiceGroups={groups.data ?? []}
        onCreated={(r) => { setCreateOpen(false); setCreatedResult(r); }}
      />
      <CreatedMemberDialog result={createdResult} onClose={() => setCreatedResult(null)} />
      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
