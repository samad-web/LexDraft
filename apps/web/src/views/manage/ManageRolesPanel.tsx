import { useFirmRoles } from '@/hooks/useFirmAdmin';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function ManageRolesPanel() {
  const roles = useFirmRoles();
  const pager = usePagination(roles.data ?? []);

  if (roles.isLoading) {
    return <div className="muted">Loading roles…</div>;
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <PhaseTwoBanner
        title="Custom roles arrive in Phase 2"
        copy="Today you can see the system roles and how many of your members are assigned to each. The Role Editor (clone, rename, edit feature matrix) ships in the next milestone."
      />

      {(roles.data ?? []).length === 0 ? (
        <div className="muted">No roles available.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Role</th>
                <th>Description</th>
                <th style={{ width: 100, textAlign: 'right' }}>Members</th>
                <th style={{ width: 110 }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td className="muted">{r.description ?? '—'}</td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>{r.userCount}</td>
                  <td>
                    <span className={`badge ${r.isSystem ? '' : 'badge-cobalt'}`}>
                      {r.isSystem ? 'System' : 'Custom'}
                    </span>
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
    </div>
  );
}

export function PhaseTwoBanner({ title, copy }: { title: string; copy: string }) {
  return (
    <div
      className="card"
      style={{
        background: 'var(--bg-surface-2)',
        borderColor: 'var(--border-default)',
        padding: 20,
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 6 }}>Phase 2 preview</div>
      <div className="heading-sm" style={{ marginBottom: 4 }}>{title}</div>
      <div className="body-sm muted">{copy}</div>
    </div>
  );
}
