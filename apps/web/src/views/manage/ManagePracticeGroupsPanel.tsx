import { useFirmPracticeGroups } from '@/hooks/useFirmAdmin';
import { PhaseTwoBanner } from './ManageRolesPanel';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function ManagePracticeGroupsPanel() {
  const groups = useFirmPracticeGroups();
  const pager = usePagination(groups.data ?? []);

  if (groups.isLoading) {
    return <div className="muted">Loading practice groups…</div>;
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <PhaseTwoBanner
        title="Practice-group editing arrives in Phase 2"
        copy="The schema is in place - once the editor ships you'll be able to create groups (Litigation, Corporate, IP, …), assign Practice Group Leads, and scope team views by group."
      />

      {(groups.data ?? []).length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>
          <div className="heading-sm" style={{ marginBottom: 8 }}>No practice groups yet</div>
          <div className="body-sm muted">
            Once created, practice groups appear here. Members can then be assigned to a group from the Users tab.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Practice group</th>
                <th style={{ width: 110, textAlign: 'right' }}>Members</th>
                <th style={{ width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((g) => (
                <tr key={g.id}>
                  <td style={{ fontWeight: 500 }}>{g.name}</td>
                  <td className="mono tabular" style={{ textAlign: 'right' }}>{g.memberCount}</td>
                  <td>
                    <span className={`badge ${g.archivedAt ? 'badge-amber' : 'badge-sage'}`}>
                      {g.archivedAt ? 'Archived' : 'Active'}
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
