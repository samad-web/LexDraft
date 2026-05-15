import { useMemo, useState } from 'react';
import { Select } from '@lexdraft/ui';
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
    return <div className="muted">Loading users…</div>;
  }
  if (users.isError) {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="badge badge-vermillion">Error</span>
          <span className="body-sm">{(users.error as Error)?.message ?? 'Failed to load users.'}</span>
        </div>
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
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div className="body-sm muted" style={{ flex: 1, minWidth: 200 }}>
          Add a member two ways: <strong>Add member</strong> creates the account immediately with a password
          you control; <strong>Send invite</strong> emails a link so they set their own password.
        </div>
        <button type="button" className="btn" onClick={() => setInviteOpen(true)}>
          + Send invite
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          + Add member
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="Search by name or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ width: 220 }}>
          <Select
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: '', label: 'All roles' },
              ...((roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))),
            ]}
          />
        </div>
        <div style={{ width: 180 }}>
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
        <div className="card" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>
          <div className="muted">
            {users.data?.length === 0
              ? 'No users in this firm yet - invite your first co-advocate from the Invitations tab.'
              : 'No users match the current filters.'}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Member</th>
                <th style={{ width: 200 }}>Role</th>
                <th style={{ width: 200 }}>Practice group</th>
                <th style={{ width: 130 }}>Status</th>
                <th style={{ width: 140, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>
                      {u.name}
                      {u.isSuperadmin && (
                        <span
                          className="badge badge-vermillion mono"
                          style={{ marginLeft: 8, fontSize: 9 }}
                          title="Platform superadmin"
                        >
                          PLATFORM
                        </span>
                      )}
                    </div>
                    <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {u.email}
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
                      className={`badge ${
                        u.status === 'active'
                          ? 'badge-sage'
                          : u.status === 'suspended'
                            ? 'badge-amber'
                            : 'badge-vermillion'
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
          <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
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
