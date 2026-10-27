import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Select, Skeleton } from '@lexdraft/ui';
import type { AdminUserSummary, UserStatus } from '@lexdraft/types';
import { adminApi } from '../api';
import { useAdminUsers, useDeleteUser, useResetPassword, useSetFirmFreePlan, useUpdateUser } from '../queries';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

type TypeFilter = '' | 'advocate' | 'student' | 'firm' | 'free';
type SortKey = 'newest' | 'storage' | 'active';

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ACCOUNT_TYPE_LABEL: Record<NonNullable<AdminUserSummary['accountType']>, string> = {
  advocate: 'ADVOCATE',
  student: 'STUDENT',
  firm: 'FIRM',
};

function planLabel(u: AdminUserSummary): string {
  if (u.freePlan) return `Free · till ${formatDate(u.trialEndsAt)}`;
  if (u.planStatus === 'trial') return `${u.planTier ?? ''} trial · ends ${formatDate(u.trialEndsAt)}`;
  if (!u.planTier) return '-';
  return u.planStatus && u.planStatus !== 'active' ? `${u.planTier} · ${u.planStatus.replace('_', ' ')}` : u.planTier;
}

/** Second line under the name: who they are, from the sign-up profile. */
function profileLine(u: AdminUserSummary): string {
  const parts = u.accountType === 'student'
    ? [u.college, u.studyYear]
    : [u.enrolment, u.primaryCourt, u.practiceAreas, u.teamSize ? `${u.teamSize} people` : null];
  const place = [u.city, u.state].filter(Boolean).join(', ');
  return [...parts, place].filter(Boolean).join(' · ');
}

/** Every sign-up detail, in the order the panel and the CSV show them. */
function detailRows(u: AdminUserSummary): [string, string][] {
  return [
    ['Name', u.name],
    ['Email', u.email],
    ['WhatsApp', u.phone ?? ''],
    ['WhatsApp verified', u.phoneVerifiedAt ? formatDate(u.phoneVerifiedAt) : ''],
    ['Account type', u.accountType ? ACCOUNT_TYPE_LABEL[u.accountType] : ''],
    ['Role', u.role],
    ['Firm', u.firmName ?? ''],
    ['Enrolment no.', u.enrolment ?? ''],
    ['Primary court', u.primaryCourt ?? ''],
    ['Practice areas', u.practiceAreas ?? ''],
    ['College', u.college ?? ''],
    ['Year of study', u.studyYear ?? ''],
    ['Team size', u.teamSize ?? ''],
    ['City', u.city ?? ''],
    ['State', u.state ?? ''],
    ['Plan', planLabel(u)],
    ['Storage used', formatBytes(u.storageBytes ?? 0)],
    ['Storage limit', u.storageLimitBytes ? formatBytes(u.storageLimitBytes) : 'Unlimited'],
    ['Sign-in method', u.signInMethod === 'google' ? 'Google' : 'Password'],
    ['Joined', formatDate(u.createdAt)],
    ['Last active', formatDate(u.lastSeenAt)],
    ['Status', u.status],
  ];
}

function downloadCsv(users: AdminUserSummary[]) {
  if (users.length === 0) return;
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = detailRows(users[0]!).map(([k]) => k);
  const lines = [header, ...users.map((u) => detailRows(u).map(([, v]) => v))].map((r) => r.map(cell).join(','));
  // BOM so Excel opens the file as UTF-8.
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lexdraft-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function UsersView() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [sort, setSort] = useState<SortKey>('newest');
  const { data: allUsers = [], isLoading } = useAdminUsers({ q: q || undefined, status: status || undefined });
  const [stateFilter, setStateFilter] = useState('');
  const states = useMemo(
    () => [...new Set(allUsers.map((u) => u.state?.trim()).filter((s): s is string => !!s))].sort(),
    [allUsers],
  );
  const users = useMemo(() => {
    const filtered = allUsers.filter((u) =>
      (!typeFilter ? true : typeFilter === 'free' ? u.freePlan : u.accountType === typeFilter)
      && (!stateFilter ? true : stateFilter === '-' ? !u.state?.trim() : u.state?.trim() === stateFilter));
    if (sort === 'storage') return [...filtered].sort((a, b) => (b.storageBytes ?? 0) - (a.storageBytes ?? 0));
    if (sort === 'active') return [...filtered].sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
    return filtered;
  }, [allUsers, typeFilter, stateFilter, sort]);
  const pager = usePagination(users);
  const setFirmFreePlan = useSetFirmFreePlan();
  const startImpersonation = useAuthStore((s) => s.startImpersonation);
  const qc = useQueryClient();
  const update = useUpdateUser();
  const del = useDeleteUser();
  const reset = useResetPassword();
  const showToast = useUIStore((s) => s.showToast);
  const confirm = useConfirm();
  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(null);
  const [detail, setDetail] = useState<AdminUserSummary | null>(null);

  const handleImpersonate = async (u: AdminUserSummary) => {
    const ok = await confirm({
      title: `Impersonate ${u.email}?`,
      message: 'Your admin session will switch to this user and you will be navigated to their dashboard. Any actions you take will be performed as them.',
      confirmLabel: 'Impersonate',
      danger: true,
    });
    if (!ok) return;
    try {
      const grant = await adminApi.impersonate(u.id);
      // Wipe admin's cached payloads - the impersonated session must see
      // its own /dashboard, /me/usage, /me/features, etc.
      qc.clear();
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
    if (ok) {
      del.mutate(u.id, {
        onError: (err) => showToast({
          type: 'vermillion',
          text: (err as Error)?.message || `Couldn’t delete ${u.email}`,
        }),
      });
    }
  };

  const toggleFreePlan = async (u: AdminUserSummary) => {
    if (!u.firmId) return;
    const ending = !!u.freePlan;
    const ok = await confirm({
      title: ending ? `Move ${u.name} off the free plan?` : `Put ${u.name} back on the free plan?`,
      message: ending
        ? 'Their account becomes a paid, active account on its current plan tier: the locked features follow that tier and the 1 GB storage limit is lifted. Set the plan and renewal on the firm page.'
        : 'Their account goes back to the free launch plan: the superadmin switches decide the locked features and storage is capped at 1 GB.',
      confirmLabel: ending ? 'End free plan' : 'Make free',
    });
    if (!ok) return;
    setFirmFreePlan.mutate(
      { firmId: u.firmId, freePlan: !ending },
      { onError: (err) => showToast({ type: 'vermillion', text: (err as Error)?.message || 'Couldn’t change the plan' }) },
    );
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Users</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <h1 className="display-md">Cross-firm directory · {users.length}</h1>
          <button type="button" className="btn btn-sm" disabled={users.length === 0} onClick={() => downloadCsv(users)}>
            Export CSV
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 12 }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Search by name, email or WhatsApp number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div style={{ width: 170 }}>
          <Select
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as TypeFilter)}
            options={[
              { value: '', label: 'All accounts' },
              { value: 'advocate', label: 'Advocates' },
              { value: 'student', label: 'Law students' },
              { value: 'firm', label: 'Firms' },
              { value: 'free', label: 'On free plan' },
            ]}
          />
        </div>
        <div style={{ width: 170 }}>
          <Select
            value={stateFilter}
            onChange={setStateFilter}
            options={[
              { value: '', label: 'All states' },
              ...states.map((s) => ({ value: s, label: s })),
              { value: '-', label: 'State not given' },
            ]}
          />
        </div>
        <div style={{ width: 170 }}>
          <Select
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'storage', label: 'Most storage' },
              { value: 'active', label: 'Recently active' },
            ]}
          />
        </div>
        <div style={{ width: 170 }}>
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
        <table className="tbl" aria-busy="true">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>WhatsApp</th>
              <th>State</th>
              <th>Plan</th>
              <th>Storage</th>
              <th>Joined</th>
              <th>Last active</th>
              <th>Status</th>
              <th style={{ width: 240, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, i) => (
              <tr key={`sk-${i}`}>
                <td><Skeleton width={120} height={14} /></td>
                <td><Skeleton width={180} height={12} /></td>
                <td><Skeleton width={110} height={12} /></td>
                <td><Skeleton width={80} height={13} /></td>
                <td><Skeleton width={110} height={13} /></td>
                <td><Skeleton width={70} height={13} /></td>
                <td><Skeleton width={80} height={13} /></td>
                <td><Skeleton width={80} height={13} /></td>
                <td><Skeleton width={62} height={20} radius="pill" /></td>
                <td style={{ textAlign: 'right' }}><Skeleton width={140} height={24} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>WhatsApp</th>
              <th>State</th>
              <th>Plan</th>
              <th>Storage</th>
              <th>Joined</th>
              <th>Last active</th>
              <th>Status</th>
              <th style={{ width: 240, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pager.slice.map((u) => (
              <tr key={u.id}>
                <td>
                  <button
                    type="button"
                    onClick={() => setDetail(u)}
                    title="View all details"
                    style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
                  >
                    {u.name}
                  </button>
                  {u.isSuperadmin && <span className="badge badge-vermillion mono" style={{ marginLeft: 8, fontSize: 9 }}>SUPER</span>}
                  {u.accountType && <span className="badge mono" style={{ marginLeft: 8, fontSize: 9 }}>{ACCOUNT_TYPE_LABEL[u.accountType]}</span>}
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                    {[u.role, u.firmName].filter(Boolean).join(' · ')}
                  </div>
                  {profileLine(u) && (
                    <div className="muted" style={{ fontSize: 11 }}>{profileLine(u)}</div>
                  )}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {u.email}
                  {u.signInMethod === 'google' && <span className="badge mono" style={{ marginLeft: 8, fontSize: 9 }}>GOOGLE</span>}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {u.phone ? (
                    <a href={`https://wa.me/${u.phone.replace(/^\+/, '')}`} target="_blank" rel="noreferrer">{u.phone}</a>
                  ) : '-'}
                </td>
                <td style={{ fontSize: 12 }}>{u.state || '-'}</td>
                <td style={{ fontSize: 12 }}>{planLabel(u)}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {formatBytes(u.storageBytes ?? 0)}
                  {u.storageLimitBytes ? (
                    <div className="muted" style={{ fontSize: 10 }}>
                      {Math.min(100, Math.round(((u.storageBytes ?? 0) / u.storageLimitBytes) * 100))}% of {formatBytes(u.storageLimitBytes)}
                    </div>
                  ) : null}
                </td>
                <td style={{ fontSize: 12 }}>{formatDate(u.createdAt)}</td>
                <td style={{ fontSize: 12 }}>{formatDate(u.lastSeenAt)}</td>
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
                    {u.firmId && !u.isSuperadmin && (u.freePlan || u.accountType === 'advocate' || u.accountType === 'student') && (
                      <button type="button" className="btn btn-sm" onClick={() => { void toggleFreePlan(u); }}>
                        {u.freePlan ? 'End free plan' : 'Make free'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        try {
                          const r = await reset.mutateAsync(u.id);
                          setResetResult({ email: u.email, tempPassword: r.tempPassword });
                        } catch (err) {
                          showToast({
                            type: 'vermillion',
                            text: (err as Error)?.message || `Couldn’t reset password for ${u.email}`,
                          });
                        }
                      }}
                    >
                      Reset pw
                    </button>
                    {u.status === 'active' ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => update.mutate(
                          { id: u.id, patch: { status: 'suspended' } },
                          { onError: (err) => showToast({ type: 'vermillion', text: (err as Error)?.message || 'Couldn’t suspend user' }) },
                        )}
                      >
                        Suspend
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => update.mutate(
                          { id: u.id, patch: { status: 'active' } },
                          { onError: (err) => showToast({ type: 'vermillion', text: (err as Error)?.message || 'Couldn’t reactivate user' }) },
                        )}
                      >
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
              <tr><td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 32 }}>No users match.</td></tr>
            )}
          </tbody>
        </table>
      )}
      {!isLoading && users.length > 0 && (
        <Pagination
          page={pager.page}
          totalPages={pager.totalPages}
          total={pager.total}
          pageSize={pager.pageSize}
          onChange={pager.setPage}
        />
      )}

      {detail && (
        <div
          role="dialog"
          aria-label={`Details for ${detail.name}`}
          style={{
            position: 'fixed', inset: 0, background: 'var(--scrim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
          }}
          onClick={() => setDetail(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-base)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)', padding: 28, width: 560, maxWidth: 'calc(100vw - 32px)',
              maxHeight: 'calc(100vh - 64px)', overflowY: 'auto',
            }}
          >
            <div className="eyebrow">User details</div>
            <h3 className="display" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{detail.name}</h3>
            <table className="tbl" style={{ marginTop: 16 }}>
              <tbody>
                {detailRows(detail).map(([k, v]) => (
                  <tr key={k}>
                    <td className="muted" style={{ fontSize: 12, width: 170 }}>{k}</td>
                    <td style={{ fontSize: 13 }}>
                      {k === 'WhatsApp' && v
                        ? <a className="mono" href={`https://wa.me/${v.replace(/^\+/, '')}`} target="_blank" rel="noreferrer">{v}</a>
                        : (v || '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {resetResult && (
        <div
          role="dialog"
          style={{
            position: 'fixed', inset: 0, background: 'var(--scrim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
          }}
          onClick={() => setResetResult(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-base)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)', padding: 28, width: 520, maxWidth: 'calc(100vw - 32px)',
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
