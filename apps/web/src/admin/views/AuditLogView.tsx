import { useState } from 'react';
import { Select } from '@lexdraft/ui';
import { useAuditLog } from '../queries';

const TARGET_TYPES = ['', 'firm', 'user', 'template', 'platform'] as const;

export function AuditLogView() {
  const [targetType, setTargetType] = useState<typeof TARGET_TYPES[number]>('');
  const [actionFilter, setActionFilter] = useState('');
  const { data: entries = [], isLoading } = useAuditLog({
    targetType: targetType || undefined,
    action: (actionFilter || undefined) as never,
    limit: 200,
  });

  return (
    <div style={{ padding: 32, maxWidth: 1320, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <div className="eyebrow">Audit log</div>
        <h1 className="display" style={{ fontSize: 28, fontWeight: 600 }}>Platform activity · {entries.length}</h1>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
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
        <table className="data-table">
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
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ fontSize: 12 }}>{new Date(e.createdAt).toLocaleString()}</td>
                <td><span className="badge mono" style={{ fontSize: 11 }}>{e.action}</span></td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {e.targetType}{e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ''}
                </td>
                <td>{e.actorEmail}</td>
                <td className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.payload ? JSON.stringify(e.payload) : '—'}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>No audit entries match.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
