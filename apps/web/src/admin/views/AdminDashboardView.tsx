import { Link } from 'react-router-dom';
import { usePlatformStats } from '../queries';

function formatInr(paiseFreeRupees: number): string {
  if (paiseFreeRupees >= 10000000) return `₹${(paiseFreeRupees / 10000000).toFixed(2)}Cr`;
  if (paiseFreeRupees >= 100000)   return `₹${(paiseFreeRupees / 100000).toFixed(1)}L`;
  if (paiseFreeRupees >= 1000)     return `₹${(paiseFreeRupees / 1000).toFixed(1)}K`;
  return `₹${paiseFreeRupees}`;
}

export function AdminDashboardView() {
  const { data, isLoading } = usePlatformStats();

  return (
    <div className="col stagger" style={{ gap: 28 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Platform overview</div>
        <h1 className="display-md">Operations dashboard</h1>
      </div>

      {isLoading || !data ? (
        <div className="muted">Loading platform stats…</div>
      ) : (
        <>
          <div className="grid-auto-sm" style={{ gap: 20 }}>
            <StatCard label="Firms" value={String(data.firms.total)} sub={`${data.firms.active} active · ${data.firms.suspended} suspended`} />
            <StatCard label="Users" value={String(data.users.total)} sub={`${data.users.active} active · ${data.users.superadmins} admins`} />
            <StatCard label="MRR"   value={formatInr(data.mrrInr)}   sub="Across active firms" />
            <StatCard label="Matters" value={String(data.caseCount)} sub="Active across platform" />
          </div>

          <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              className="row"
              style={{
                padding: 'var(--space-5) var(--space-6)',
                alignItems: 'center',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <h2 className="heading-lg">Recent admin activity</h2>
              <span className="spacer" />
              <Link to="/admin/audit" className="no-underline body-sm">View all →</Link>
            </div>
            {data.recentAudit.length === 0 ? (
              <div className="muted" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>
                No activity yet.
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 180 }}>When</th>
                    <th>Action</th>
                    <th>Target</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentAudit.map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono" style={{ fontSize: 12 }}>{new Date(entry.createdAt).toLocaleString()}</td>
                      <td><span className="badge">{entry.action}</span></td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {entry.targetType}{entry.targetId ? ` · ${entry.targetId.slice(0, 8)}` : ''}
                      </td>
                      <td>{entry.actorEmail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card" style={{ padding: 'var(--space-6)' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>
      <div className="display-md tabular" style={{ marginBottom: 6 }}>{value}</div>
      <div className="body-sm muted">{sub}</div>
    </div>
  );
}
