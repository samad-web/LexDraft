import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select } from '@lexdraft/ui';
import type { AdminUserSummary, UserStatus } from '@lexdraft/types';
import { adminApi } from '../api';
import { useAdminUsers, useDeleteUser, useResetPassword, useUpdateUser } from '../queries';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useConfirm } from '@/components/ConfirmDialog';

export function UsersView() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const { data: users = [], isLoading } = useAdminUsers({ q: q || undefined, status: status || undefined });
  const startImpersonation = useAuthStore((s) => s.startImpersonation);
  const update = useUpdateUser();
  const del = useDeleteUser();
  const reset = useResetPassword();
  const showToast = useUIStore((s) => s.showToast);
  const confirm = useConfirm();
  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(null);

  const handleImpersonate = async (u: AdminUserSummary) => {
    try {
      const grant = await adminApi.impersonate(u.id);
      startImpersonation(grant.user, grant.token, { adminId: grant.originalAdminId, adminEmail: useAuthStore.getState().user?.email ?? '' });
      navigate('/app/dashboard');
    } catch (err) {
      showToast({ type: 'vermillion', text: `Failed to impersonate: ${(err as Error).message}` });
    }
  };

  const requestDelete = async (u: AdminUserSummary) => {
    const ok = await confirm({
      title: `Permanently delete ${u.email}?`,
      message: 'This will remove the user account and revoke their access. This cannot be undone.',
      confirmLabel: 'Delete user',
      danger: true,
    });
    if (ok) del.mutate(u.id);
  };

  return (
    <div style={{ padding: 32, maxWidth: 1320, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <div className="eyebrow">Users</div>
        <h1 className="display" style={{ fontSize: 28, fontWeight: 600 }}>Cross-firm directory · {users.length}</h1>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Search by name or email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ width: 200 }}>
          <Select
            value={status}
            onChange={(v) => setStatus(v as UserStatus | '')}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'suspended', label: 'Suspended' },
              { value: 'deactivated', label: 'Deactivated' },
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="muted">Loading users…</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Firm</th>
              <th>Role</th>
              <th>Status</th>
              <th style={{ width: 240, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  {u.isSuperadmin && <span className="badge badge-vermillion mono" style={{ marginLeft: 8, fontSize: 9 }}>SUPER</span>}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{u.email}</td>
                <td>{u.firmName ?? '—'}</td>
                <td>{u.role}</td>
                <td>
                  <span className={`badge ${u.status === 'active' ? 'badge-sage' : 'badge-vermillion'}`}>{u.status}</span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    {!u.isSuperadmin && (
                      <button type="button" className="btn btn-sm" onClick={() => handleImpersonate(u)}>
                        Impersonate
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        const r = await reset.mutateAsync(u.id);
                        setResetResult({ email: u.email, tempPassword: r.tempPassword });
                      }}
                    >
                      Reset pw
                    </button>
                    {u.status === 'active' ? (
                      <button type="button" className="btn btn-sm" onClick={() => update.mutate({ id: u.id, patch: { status: 'suspended' } })}>
                        Suspend
                      </button>
                    ) : (
                      <button type="button" className="btn btn-sm" onClick={() => update.mutate({ id: u.id, patch: { status: 'active' } })}>
                        Reactivate
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                      onClick={() => { void requestDelete(u); }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>No users match.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {resetResult && (
        <div
          role="dialog"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
          }}
          onClick={() => setResetResult(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-base)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)', padding: 28, width: 520,
            }}
          >
            <div className="eyebrow">Password reset</div>
            <h3 className="display" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>Temporary password issued</h3>
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
              Communicate this password to <strong>{resetResult.email}</strong> out-of-band. It can be used to sign in once;
              ask the user to change it from their settings immediately.
            </p>
            <div
              className="mono"
              style={{
                fontSize: 18, padding: '12px 16px', marginTop: 12,
                background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)', userSelect: 'all',
              }}
            >
              {resetResult.tempPassword}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={() => setResetResult(null)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
