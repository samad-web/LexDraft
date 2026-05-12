import { useFirmAudit } from '@/hooks/useFirmAdmin';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function ManageAuditPanel() {
  const audit = useFirmAudit();
  const pager = usePagination(audit.data ?? []);

  if (audit.isLoading) {
    return <div className="muted">Loading audit log…</div>;
  }
  if (audit.isError) {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <span className="badge badge-vermillion" style={{ marginRight: 8 }}>Error</span>
        <span className="body-sm">{(audit.error as Error)?.message ?? 'Failed to load audit log.'}</span>
      </div>
    );
  }

  const entries = audit.data ?? [];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="body-sm muted">
        Every administrative mutation (role changes, deactivations, feature toggles, deletions) is recorded here, newest first.
      </div>

      {entries.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>
          <div className="muted">No audit entries yet.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 200 }}>When</th>
                <th>Action</th>
                <th>Target</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((e) => (
                <tr key={e.id}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <span className="badge mono" style={{ fontSize: 11 }}>{e.action}</span>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {e.targetType}
                    {e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ''}
                  </td>
                  <td>{e.actorEmail}</td>
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
