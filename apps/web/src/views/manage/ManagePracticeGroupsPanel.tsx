import { useFirmPracticeGroups } from '@/hooks/useFirmAdmin';
import { PhaseTwoBanner } from './ManageRolesPanel';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function ManagePracticeGroupsPanel() {
  const groups = useFirmPracticeGroups();
  const pager = usePagination(groups.data ?? []);

  if (groups.isLoading) {
    return <div className="fm-loading">Loading practice groups…</div>;
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <PhaseTwoBanner
        title="Practice-group editing arrives in Phase 2"
        copy="The schema is in place - once the editor ships you'll be able to create groups (Litigation, Corporate, IP, …), assign Practice Group Leads, and scope team views by group."
      />

      {(groups.data ?? []).length === 0 ? (
        <div className="fm-empty-card">
          <div className="fm-panel-title">No practice groups yet</div>
          <div>
            Once created, practice groups appear here. Members can then be assigned to a group from the Users tab.
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl fm-tbl">
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
                  <td><span className="fm-cell-title">{g.name}</span></td>
                  <td className="num" style={{ textAlign: 'right', fontFamily: 'var(--font-title)', fontSize: 16, fontWeight: 600 }}>{g.memberCount}</td>
                  <td>
                    <span className={`fm-pill ${g.archivedAt ? 'is-muted' : 'is-solid'}`}>
                      {g.archivedAt ? 'Archived' : 'Active'}
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
