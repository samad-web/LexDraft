import { Icon } from '@lexdraft/ui';
import { useFirmRoles } from '@/hooks/useFirmAdmin';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function ManageRolesPanel() {
  const roles = useFirmRoles();
  const pager = usePagination(roles.data ?? []);

  if (roles.isLoading) {
    return <div className="fm-loading">Loading roles…</div>;
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <PhaseTwoBanner
        title="Custom roles arrive in Phase 2"
        copy="Today you can see the system roles and how many of your members are assigned to each. The Role Editor (clone, rename, edit feature matrix) ships in the next milestone."
      />

      {(roles.data ?? []).length === 0 ? (
        <div className="fm-empty-card">No roles available.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl fm-tbl">
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
                  <td><span className="fm-cell-title">{r.name}</span></td>
                  <td className="muted">{r.description ?? '-'}</td>
                  <td className="num" style={{ textAlign: 'right', fontFamily: 'var(--font-title)', fontSize: 16, fontWeight: 600 }}>{r.userCount}</td>
                  <td>
                    <span className={`fm-pill ${r.isSystem ? 'is-muted' : 'is-strong'}`}>
                      {r.isSystem ? 'System' : 'Custom'}
                    </span>
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
    </div>
  );
}

export function PhaseTwoBanner({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="fm-note">
      <span className="fm-note-icon" aria-hidden><Icon name="sparkle" size={14} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="fm-eyebrow" style={{ marginBottom: 4 }}>Phase 2 preview</div>
        <div className="fm-note-title">{title}</div>
        <div>{copy}</div>
      </div>
    </div>
  );
}
