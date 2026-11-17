import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminAiUsageUser } from '@lexdraft/types';
import { api } from '@/lib/api';
import { useUIStore } from '@/store/ui';

const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n));

/**
 * AI use per user with DifAi's monthly credit cap (admin-per-user-usage.md).
 * `firmId` limits it to one firm (Firm detail) and lists every member.
 */
export function AiUsageUsersTable({ days, firmId }: { days: number; firmId?: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'ai-usage-users', days, firmId ?? 'all'],
    queryFn: () => api.get<{ items: AdminAiUsageUser[] }>('/admin/ai-usage/users', { days, ...(firmId ? { firmId } : {}) }),
  });
  const items = data?.items ?? [];
  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }} aria-labelledby="ai-users-h">
      <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 id="ai-users-h" className="heading-lg">AI use per user</h2>
        <div className="body-sm muted">Last {days} days · cost is DifAi's estimate · a cap limits one user's credits per plan month</div>
      </div>
      {isLoading ? <div className="muted" style={{ padding: 24 }}>Loading…</div>
        : isError ? <div role="alert" style={{ padding: 24 }}>Could not load per-user usage.</div>
        : items.length === 0 ? <div className="muted" style={{ padding: 24, textAlign: 'center' }}>No AI use in this period.</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th scope="col">User</th>{!firmId && <th scope="col">Firm</th>}
                  <th scope="col" style={{ textAlign: 'right' }}>Calls</th><th scope="col" style={{ textAlign: 'right' }}>Tokens</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Est. cost</th><th scope="col" style={{ textAlign: 'right' }}>Credits</th>
                  <th scope="col">Top feature</th><th scope="col">Monthly cap</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.userId}>
                    <td><div>{u.name}</div><div className="body-sm muted">{u.email ?? '—'}{u.role ? ` · ${u.role}` : ''}</div></td>
                    {!firmId && <td>{u.firmName ?? '—'}</td>}
                    <td className="mono tabular" style={{ textAlign: 'right' }}>{u.calls}</td>
                    <td className="mono tabular" style={{ textAlign: 'right' }}>{tokens(u.tokensIn + u.tokensOut)}</td>
                    <td className="mono tabular" style={{ textAlign: 'right' }}>₹{u.estCostInr.toLocaleString('en-IN')}</td>
                    <td className="mono tabular" style={{ textAlign: 'right' }}>{u.creditsUsed}</td>
                    <td>{u.topFeature ?? '—'}</td>
                    <td><CapEditor user={u} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

function CapEditor({ user }: { user: AdminAiUsageUser }) {
  const qc = useQueryClient();
  const showToast = useUIStore((s) => s.showToast);
  const [val, setVal] = useState(user.creditCapMonth == null ? '' : String(user.creditCapMonth));
  const n = val.trim() === '' ? null : Number(val);
  const valid = n === null || (Number.isInteger(n * 2) && n >= 0 && n <= 100000);
  const changed = n !== user.creditCapMonth;
  const m = useMutation({
    mutationFn: () => api.patch<{ creditCapMonth: number | null }>(`/admin/users/${user.userId}/credit-cap`, { cap: n }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'ai-usage-users'] });
      showToast({ type: 'sage', text: r.creditCapMonth == null ? `Cap removed for ${user.name}` : `${user.name}: ${r.creditCapMonth} credits a month` });
    },
  });
  return (
    <form className="row" style={{ gap: 6, alignItems: 'center' }} onSubmit={(e) => { e.preventDefault(); if (valid && changed) m.mutate(); }}>
      <input className="input" style={{ width: 90 }} type="number" min={0} max={100000} step={0.5} value={val}
        placeholder="none" aria-label={`Monthly credit cap for ${user.name}`} onChange={(e) => setVal(e.target.value)} />
      <button type="submit" className="btn btn-sm" disabled={!valid || !changed || m.isPending}>{m.isPending ? '…' : 'Set'}</button>
      {m.isError && <span role="alert" className="body-sm">{m.error.message}</span>}
    </form>
  );
}
