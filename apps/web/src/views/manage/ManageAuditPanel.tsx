import { useFirmAudit } from '@/hooks/useFirmAdmin';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function ManageAuditPanel() {
  const audit = useFirmAudit();
  const pager = usePagination(audit.data ?? []);

  if (audit.isLoading) {
    return <div className="fm-loading">Loading audit log…</div>;
  }
  if (audit.isError) {
    return (
      <div className="fm-error" role="alert">
        <span className="fm-error-mark" aria-hidden>!</span>
        <span>{(audit.error as Error)?.message ?? 'Failed to load audit log.'}</span>
      </div>
    );
  }

  const entries = audit.data ?? [];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="fm-footnote" style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>
        Every administrative mutation (role changes, deactivations, feature toggles, deletions) is recorded here, newest first.
      </div>

      {entries.length === 0 ? (
        <div className="fm-empty-card">No audit entries yet.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl fm-tbl">
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
                  <td>
                    <span className="fm-date">
                      {new Date(e.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td>
                    <span className="fm-code" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{e.action}</span>
                  </td>
                  <td>
                    <span className="fm-code">
                      {e.targetType}
                      {e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ''}
                    </span>
                  </td>
                  <td style={{ overflowWrap: 'anywhere' }}>{e.actorEmail}</td>
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
