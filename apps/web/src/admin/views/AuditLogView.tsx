import { useState } from 'react';
import { Select } from '@lexdraft/ui';
import { useAuditLog } from '../queries';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

const TARGET_TYPES = ['', 'firm', 'user', 'template', 'platform'] as const;

export function AuditLogView() {
  const [targetType, setTargetType] = useState<typeof TARGET_TYPES[number]>('');
  const [actionFilter, setActionFilter] = useState('');
  const { data: entries = [], isLoading } = useAuditLog({
    targetType: targetType || undefined,
    action: (actionFilter || undefined) as never,
    limit: 200,
  });
  const pager = usePagination(entries);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Audit log</div>
        <h1 className="display-md">Platform activity · {entries.length}</h1>
      </header>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ width: 200 }}>
          <Select
            value={targetType}
            onChange={(v) => setTargetType(v as never)}
            options={[
              { value: '', label: 'All targets' },
              { value: 'firm', label: 'Firm' },
              { value: 'user', label: 'User' },
              { value: 'template', label: 'Template' },
              { value: 'platform', label: 'Platform' },
            ]}
          />
        </div>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Filter by action (e.g. firm.suspend)…"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="muted">Loading…</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 200 }}>When</th>
              <th>Action</th>
              <th>Target</th>
              <th>Actor</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {pager.slice.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ fontSize: 12 }}>{new Date(e.createdAt).toLocaleString()}</td>
                <td><span className="badge mono" style={{ fontSize: 11 }}>{e.action}</span></td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {e.targetType}{e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ''}
                </td>
                <td>{e.actorEmail}</td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.payload ? JSON.stringify(e.payload) : '-'}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>No audit entries match.</td></tr>
            )}
          </tbody>
        </table>
      )}
      {!isLoading && entries.length > 0 && (
        <Pagination
          page={pager.page}
          totalPages={pager.totalPages}
          total={pager.total}
          pageSize={pager.pageSize}
          onChange={pager.setPage}
        />
      )}
    </div>
  );
}
