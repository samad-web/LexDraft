import { useState } from 'react';
import { Select, Skeleton } from '@lexdraft/ui';
import type { AuditAction, AuditTargetType } from '@lexdraft/types';
import { useAuditLog } from '../queries';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

// Narrow the dropdown to a runtime-checkable subset of AuditTargetType. The
// full union is open enough that a hand-typed action string from the search
// box can't be statically narrowed — see the cast guard below.
const TARGET_TYPES = ['', 'firm', 'user', 'template', 'platform'] as const;
type TargetFilter = typeof TARGET_TYPES[number];

export function AuditLogView() {
  const [targetType, setTargetType] = useState<TargetFilter>('');
  const [actionFilter, setActionFilter] = useState('');
  // The action filter is a free-text input; it's validated server-side
  // against the AuditAction union. Cast at the boundary with the narrowest
  // type we can express — undefined when empty, otherwise the string as
  // the API contract expects (AuditAction). A bad value 404s gracefully.
  const action = actionFilter.trim() ? (actionFilter.trim() as AuditAction) : undefined;
  const { data: entries = [], isLoading } = useAuditLog({
    targetType: (targetType || undefined) as AuditTargetType | undefined,
    action,
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
            onChange={(v) => setTargetType(v as TargetFilter)}
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
        <table className="tbl" aria-busy="true">
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
            {Array.from({ length: 8 }, (_, i) => (
              <tr key={`sk-${i}`}>
                <td><Skeleton width={150} height={12} /></td>
                <td><Skeleton width={110} height={13} /></td>
                <td><Skeleton width={130} height={13} /></td>
                <td><Skeleton width={120} height={13} /></td>
                <td><Skeleton width={200} height={12} /></td>
              </tr>
            ))}
          </tbody>
        </table>
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
